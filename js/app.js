/* ============================================================
   app.js — AIDOOi MVP customer journey
   Covers WF-01 … WF-08 of "AIDOOi MVP - 8 Core Workflows Rev 1".
   Frontend responsibilities only (Master Plan §6): show the eight
   choices, collect the minimum inputs, present up to four options,
   one cart / one checkout / one payment, simple grouped order status.
   ============================================================ */

import { STYLES, COLOURS, TIERS, fmtAED, tierOfPrice } from './standards.js';
import { PATHS, pathById, sizeClass, area, projectBudget, BED_W } from './paths.js';
import { partnerById, candidates } from './catalogue.js';
import {
  runRecommendation, runProject, rankIndividual, alternativesFor, applyReplacement,
  removeItem, classifyMatch, MIN_PRODUCT_MATCH
} from './engine.js';
import * as C from './commerce.js';
import { brandMark, icon, productArt, roomPlan, esc } from './ui.js';

/* ---------------- State ---------------- */
const S = {
  customer: null,
  project: null,       // { pathId, spec, style, colour, tier, projectBudget }
  run: null,           // recommendation run (room paths)
  projectRun: null,    // multi-module run (studio / apartment / villa)
  individual: null,
  optionKey: null,
  purchaseSelectionByOption: {},
  checkoutItems: null,
  viewing: null,
  reservation: null,
  order: null,
  orders: [],
  pendingAction: null  // resumed after registration (WF-04 §1 / WF-05 §1)
};
const app = () => document.getElementById('app');
const currentOption = () => S.run && S.run.options.find(o => o.key === S.optionKey);
function selectedPurchaseItems(option = currentOption()) {
  if (!option) return [];
  const selected = S.purchaseSelectionByOption[option.key];
  if (!selected) {
    const startingItem = option.items.find(item => item.slot.role === 'anchor') || option.items[0];
    return startingItem ? [startingItem] : [];
  }
  return option.items.filter(item => selected.includes(item.slot.key));
}
const purchaseTotal = items => items.reduce((total, item) => total + item.offer.sellingPrice * (item.qty || 1), 0);

/* Product types whose price and fit branch on capacity / size (AID-LOG-001 §4). */
const BRANCH_OPTS = {
  'Sofa': ['2', '3', '4', '5'],
  'Dining Table': ['2', '4', '6', '8', '10'],
  'Bed': ['Single', 'Queen', 'King', 'Super King'],
  'Wardrobe': ['Small', 'Medium', 'Large'],
  'Rug': ['Small', 'Medium', 'Large', 'Extra Large']
};
const INDIVIDUAL_TYPES = ['Sofa', 'Accent Chair', 'Coffee Table', 'Dining Table', 'Bed',
  'Wardrobe', 'TV Unit', 'Rug', 'Floor Lamp', 'Mirror', 'Desk', 'Office Chair'];
/* The product that leads each path, used for representative budget imagery. */
/* ---------------- Router ---------------- */
const routes = {};
const route = (p, fn) => (routes[p] = fn);
function go(hash) {
  /* Setting an unchanged hash fires no hashchange, so render explicitly. */
  if (location.hash === hash) render(); else location.hash = hash;
}
function render() {
  const raw = (location.hash || '#/').slice(1);
  const [path, ...rest] = raw.split('/').filter(Boolean);
  const view = routes[path || 'home'] || routes.home;
  app().innerHTML = view(rest);
  const steps = document.querySelector('.steps');
  const activeStep = steps?.querySelector('.s[aria-current="step"]');
  if (steps && activeStep && window.matchMedia('(max-width: 767px)').matches)
    steps.scrollLeft = activeStep.offsetLeft - (steps.clientWidth - activeStep.clientWidth) / 2;
  window.scrollTo(0, 0);
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('on', a.getAttribute('href') === '#/' + (path || '')));
}
window.addEventListener('hashchange', render);

/* ---------------- Presentation helpers ---------------- */
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const std  = c => `<span class="std">${esc(c)}</span>`;
const activeCurrency = () => S.project?.budget?.currency || 'AED';
const fmtINR = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
const formatAmount = (amount, currency = activeCurrency()) =>
  currency === 'INR' ? `₹${fmtINR(amount * AED_TO_INR)}` : `AED ${fmtAED(amount)}`;
const money = (n, cls = '') => `<span class="price ${cls}"><span class="cur">${activeCurrency() === 'INR' ? '₹' : 'AED'}</span>${activeCurrency() === 'AED' ? ' ' : ''}${activeCurrency() === 'INR' ? fmtINR(n * AED_TO_INR) : fmtAED(n)}</span>`;
const tile = (p, cls = '') => `<div class="tile ${cls}">${productArt(p)}</div>`;
const AED_TO_INR = 23;

function stepper(active) {
  const steps = ['Profile', 'Recommendations', 'Review', 'Room preview', 'Viewing', 'Checkout', 'Orders'];
  return `<nav class="steps" aria-label="Your progress">` + steps.map((s, i) =>
    `<div class="s ${i === active ? 'on' : i < active ? 'done' : ''}" ${i === active ? 'aria-current="step"' : ''}>
       <span class="n">${i < active ? '✓' : i + 1}</span><span>${s}</span></div>` +
    (i < steps.length - 1 ? `<span class="sep ${i < active ? 'done' : ''}" aria-hidden="true"></span>` : '')).join('') + `</nav>`;
}

function matchBars(c) {
  return [['Fit quality', c.fit, 30], ['Style match', c.style, 25], ['Colour match', c.colour, 15],
          ['Budget / value', c.budget, 15], ['Practical match', c.practical, 10], ['Availability', c.avail, 5]]
    .map(([l, v, w]) => `<div class="kv"><span>${l} <small>${w}%</small></span>
      <span class="bar"><i style="width:${Math.max(0, v)}%"></i></span>
      <span>${v < 0 ? '—' : v}</span></div>`).join('');
}

function scoreBars(o) {
  const b = o.breakdown;
  return [['Product match quality', b.productMatchQuality, 40],
          ['Composition harmony', b.harmony.total, 30],
          ['Functional completeness', b.completeness, 20],
          ['Budget performance', b.budgetPerformance, 10]]
    .map(([l, v, w]) => `<div class="kv"><span>${l} <small>${w}%</small></span>
      <span class="bar"><i style="width:${Math.round(v)}%"></i></span>
      <span>${Math.round(v)}</span></div>`).join('');
}

/** A real catalogue product that represents a type at a tier (AID-LOG-001 §5).
    The size branch is held constant so the cards differ by quality, not scale. */
const REP_BRANCH = { 'Sofa': '3', 'Bed': 'Queen', 'Dining Table': '6', 'Wardrobe': 'Medium', 'Rug': 'Large' };
function repProduct(type, tier) {
  const pool = candidates(type, REP_BRANCH[type] ?? null);
  const whole = pool.length ? pool : candidates(type);
  return whole.find(p => p.priceTier === tier) || whole.find(p => p.priceTier === 'Standard') || whole[0];
}

/* ============================================================
   Home
   ============================================================ */
let heroCache = null;
function heroPlan() {
  if (!heroCache) {
    const r = runRecommendation({ pathId: 'livingRoom', tier: 'Standard', style: 'scandinavian',
      colour: 'beige', spec: { length: 5.4, width: 4.2 } });
    heroCache = r.options.length
      ? roomPlan(r.options[0], { area: r.room.area, lengthM: 5.4, widthM: 4.2 }).svg
      : '';
  }
  return heroCache;
}

route('home', () => `
<section class="hero wrap">
  ${stepper(0)}
  <div class="split">
    <div>
      <div class="eyebrow">Your intelligent interior assistant</div>
      <h1 class="display d1">Tell us the room.<br>We will furnish it<br><span>properly.</span></h1>
      <p class="lead">Describe your room and explore a few furniture ideas. Choose the pieces you like and try a sample order.</p>
      <div class="row" style="margin-top:var(--s5)">
        <a class="btn btn-primary btn-lg" href="#/paths">Find my best match</a>
      </div>
    </div>
    <div class="heroart">${heroPlan()}</div>
  </div>
</section>

<section class="section-sm wrap">
  <div class="grid g4" style="gap:var(--s5)">
    ${[['ruler', 'Measured, not guessed', 'Real dimensions in, a size classification out. Fit and circulation are checked before anything is recommended.'],
       ['sparkle', 'Four complete options', 'Best Overall, Best Value, Best Style Match and Premium Choice — one quality bar, four different objectives.'],
       ['eye', 'See it before you buy', `Every recommended product is physically viewable. 5% deposit, capped at ${formatAmount(500)}, credited or refunded in full.`],
       ['bag', 'One cart, many sellers', 'A single payment to AIDOOi. We split the order across showrooms behind the scenes.']
      ].map(([ic, t, d]) => `
      <div class="feature"><span class="ic">${icon(ic)}</span>
        <div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}
  </div>
</section>

<section class="section wrap">
  <div class="row between" style="margin-bottom:var(--s4)">
    <div>
      <div class="eyebrow">In the catalogue</div>
      <h2 class="display d2" style="margin:0">Real products, real stock, real showrooms</h2>
    </div>
    <a class="btn btn-secondary" href="#/paths">Start furnishing</a>
  </div>
  <div class="grid g5">
    ${['Sofa', 'Bed', 'Dining Table', 'Floor Lamp', 'Rug'].map(t => {
      const p = repProduct(t, 'Standard');
      return `<div class="pcard">${tile(p)}
        <div class="body"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc(p.primaryStyle)} · ${esc(p.material)}</div></div></div>`;
    }).join('')}
  </div>
</section>`);

/* ============================================================
   WF-01 — Path selection (AID-SPC-001)
   ============================================================ */
route('paths', () => `
<section class="section wrap">
  ${stepper(0)}
  <div class="eyebrow">Step 1 · AID-SPC-001</div>
  <h1 class="display d2">What are you furnishing?</h1>
  <p class="lead" style="max-width:620px">One question routes you into the right path.
  Everything after this is only what that path actually needs.</p>
  <div class="grid g4" style="margin-top:var(--s5)">
    ${PATHS.map(p => `
      <button class="choice" data-act="pick-path" data-id="${p.id}">
        <span class="ic">${icon(p.icon)}</span>
        <span class="t">${p.label}</span>
        <span class="d">${p.blurb}</span>
        <span class="d" style="margin-top:10px">${std(p.spc + ' · ' + p.log)}</span>
      </button>`).join('')}
  </div>
</section>`);

/* ============================================================
   WF-01 — Profiling (AID-SPC-002…009)
   ============================================================ */
route('profile', () => {
  const p = pathById(S.project?.pathId);
  if (!p) return redirect('#/paths');
  const sp = S.project.spec;

  const num = (k, label, hint, val, unit = 'm', step = '0.1') => `
    <label class="field"><span>${label}</span><span class="inline-unit">
      <input type="number" step="${step}" min="0" data-spec="${k}" value="${val ?? ''}" placeholder="${hint}">
      <span class="u">${unit}</span></span></label>`;

  const chips = (k, label, opts, val, note = '') => `
    <div class="field"><span class="lbl">${label}</span>
      <div class="row tight">${opts.map(o =>
        `<button class="choice chip" data-spec-set="${k}" data-val="${o}" aria-pressed="${String(val) === String(o)}">
           <span class="t">${o}</span></button>`).join('')}</div>
      ${note ? `<small style="display:block;margin-top:10px">${note}</small>` : ''}</div>`;

  let inputs = '';
  if (p.inputs.includes('dimensions')) {
    inputs += `<div class="grid g2">${num('length', 'Room length', '5.5', sp.length)}${num('width', 'Room width', '4.2', sp.width)}</div>`;
    const a = area(sp.length, sp.width);
    const cls = a > 0 ? sizeClass(p.id, a) : null;
    inputs += `<div id="room-size-summary" class="note" style="margin-bottom:var(--s4)">
      ${cls ? `<strong>${a.toFixed(1)} m²</strong> → size classification <strong>${cls}</strong>.`
        : 'Enter both dimensions to see your room size classification.'}
      <br><small>You never choose the size class — AIDOOi derives it from your measurements ${std(p.log + ' §3')}.</small></div>`;
  }
  if (p.inputs.includes('bedSize'))  inputs += chips('bedSize', 'Bed size', ['Single', 'Queen', 'King', 'Super King'], sp.bedSize, 'The bed anchors the room; everything else is fitted around it (AID-LOG-003 §4).');
  if (p.inputs.includes('capacity')) inputs += chips('capacity', 'Dining capacity', [2, 4, 6, 8, 10], sp.capacity, 'Table size and chair quantity are derived from this (AID-LOG-004 §3).');
  if (p.inputs.includes('users'))    inputs += chips('users', 'Workspace users', [1, 2, 3], sp.users, 'One appropriate office chair per workspace user (AID-LOG-005 §3).');
  if (p.inputs.includes('totalArea'))inputs += num('totalArea', 'Total area', '38', sp.totalArea, 'm²', '1');
  if (p.inputs.includes('sleepingSetup')) inputs += chips('sleepingSetup', 'Sleeping setup', ['Single Bed', 'Queen Bed', 'King Bed', 'Sofa Bed'], sp.sleepingSetup);
  if (p.inputs.includes('bedrooms')) inputs += chips('bedrooms', 'Bedrooms', [1, 2, 3, 4], sp.bedrooms);
  if (p.inputs.includes('floors'))   inputs += chips('floors', 'Floors', [1, 2, 3], sp.floors);
  if (p.inputs.includes('livingArea')) inputs += num('livingArea', 'Living room area', '26', sp.livingArea, 'm²', '1');
  if (p.inputs.includes('diningCapacity')) inputs += chips('diningCapacity', 'Dining capacity', [4, 6, 8, 10], sp.diningCapacity);
  if (p.inputs.includes('officeYesNo')) inputs += chips('officeYesNo', 'Include a home office?', ['Yes', 'No'], sp.officeYesNo);
  if (p.inputs.includes('consistency')) inputs += chips('consistency', 'Repeat the same products in similar rooms?', ['Yes', 'No'], sp.consistency,
    'A preference only — it never overrides fit, capacity or availability.');
  if (p.inputs.includes('productType')) {
    inputs += `<label class="field"><span>Product type</span>
      <select data-spec="productType">${INDIVIDUAL_TYPES.map(t =>
        `<option ${sp.productType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const bo = BRANCH_OPTS[sp.productType];
    if (bo) inputs += chips('branch', 'Size / capacity', bo, sp.branch, 'AID-LOG-001 §4 prices this branch separately.');
  }
  if (p.inputs.includes('media')) {
    inputs += `<div class="field"><label class="lbl" for="media-description">Room photo or floor plan <span style="color:var(--text-3);font-weight:400">— optional</span></label>
      <input type="text" id="media-description" data-spec="media" value="${esc(sp.media || '')}" placeholder="Paste a file name or link">
      <span class="media-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-act="choose-media">Upload from device</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="capture-media">Take a photo</button>
      </span>
      <input type="file" id="media-upload" data-media-upload accept="image/jpeg,image/png,image/webp" hidden>
      <input type="file" id="media-camera" data-media-upload accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
      ${sp.mediaImage && /^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/.test(sp.mediaImage) ? `
        <div class="media-preview">
          <img src="${sp.mediaImage}" alt="Uploaded room photo or floor plan">
          <div class="row between">
            <small>${esc(sp.mediaImageName || 'Uploaded photo')}</small>
            <button type="button" class="btn btn-text btn-sm" data-act="remove-media">Remove photo</button>
          </div>
        </div>` : ''}
      <div id="media-status" class="note err media-status" role="status" hidden></div>
      <small style="display:block;margin-top:8px">Extra context only. Leaving it empty never blocks your recommendation.</small></div>`;
  }

  const styleBlock = `
    <div class="field"><span class="lbl">Style preference ${std('AID-DATA-009')}</span>
      <div class="grid g2" style="gap:10px">
        ${[{ id: 'assisted', label: 'Let AIDOOi decide' }, ...STYLES].map(s => `
          <button class="choice chip" style="width:100%;text-align:center" data-spec-set="style" data-val="${s.id}"
            aria-pressed="${S.project.style === s.id}"><span class="t">${s.label}</span></button>`).join('')}
      </div></div>`;

  const colourBlock = `
    <div class="field" style="margin-bottom:0"><span class="lbl">Colour direction ${std('AID-DATA-007')}</span>
      <div class="grid g2" style="gap:10px">
        ${[{ id: 'assisted', label: 'Let AIDOOi decide', hex: '#FFFFFF' }, ...COLOURS.slice(0, 11)].map(c => `
          <button class="choice chip" data-spec-set="colour" data-val="${c.id}" aria-pressed="${S.project.colour === c.id}">
            <span class="t"><span class="swatch" style="background:${c.hex === 'linear' ? 'linear-gradient(90deg,#B7A78F,#6B7F63,#3B5A7A)' : c.hex}"></span>${c.label}</span></button>`).join('')}
      </div></div>`;

  const budget = S.project.budget || {};
  const budgetCurrency = budget.currency || 'INR';
  const budgetMinimum = budget.min ?? budget.minINR ?? '';
  const budgetMaximum = budget.max ?? budget.maxINR ?? '';
  const budgetBlock = `
    <div class="field" style="margin-bottom:0">
      <span class="lbl">Your budget range ${std(p.log || 'AID-LOG-001')}</span>
      <label class="field budget-currency-select"><span>Budget currency</span>
        <select data-budget-currency>
          <option value="INR" ${budgetCurrency === 'INR' ? 'selected' : ''}>INR (₹)</option>
          <option value="AED" ${budgetCurrency === 'AED' ? 'selected' : ''}>AED</option>
        </select>
      </label>
      <small class="budget-currency-note">Product prices and totals will be shown in your selected currency. Currency conversion is approximate at 1 AED = ₹${AED_TO_INR}.</small>
      <div class="grid g2 budget-range-inputs">
        <label class="field"><span>Minimum budget (${budgetCurrency === 'INR' ? '₹ INR' : 'AED'})</span>
          <input type="number" min="1" step="1" inputmode="numeric" data-budget="min"
            value="${esc(budgetMinimum)}" placeholder="1,000">
        </label>
        <label class="field"><span>Maximum budget (${budgetCurrency === 'INR' ? '₹ INR' : 'AED'})</span>
          <input type="number" min="1" step="1" inputmode="numeric" data-budget="max"
            value="${esc(budgetMaximum)}" placeholder="50,000">
        </label>
      </div>
      <small id="budget-validation" class="budget-validation" role="status"></small>
      <small class="budget-currency-note">The recommendation system uses AED internally and stays within your selected range when eligible products are available.</small>
    </div>`;

  const ready = profileReady();
  return `
<section class="section wrap">
  ${stepper(0)}
  <div class="row between" style="margin-bottom:var(--s5)">
    <div>
      <div class="eyebrow">${p.spc}</div>
      <h1 class="display d2" style="margin-bottom:6px">${p.label}</h1>
      <p class="meta" style="margin:0">${p.blurb}</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/paths">Change path</a>
  </div>

  <div class="split">
    <div class="card pad-lg">${inputs}</div>
    <div class="card pad-lg">${styleBlock}${colourBlock}</div>
  </div>
  <div class="card pad-lg" style="margin-top:var(--s4)">${budgetBlock}</div>

  <div class="row" style="margin-top:var(--s5)">
    <button class="btn btn-primary btn-lg" data-act="run" ${ready ? '' : 'disabled'}>Generate my recommendations</button>
    ${ready ? '' : '<span class="meta">Complete the required inputs to continue.</span>'}
  </div>
</section>`;
});

function profileReady() {
  const p = pathById(S.project?.pathId);
  if (!p || !selectedBudgetRange()) return false;
  const sp = S.project.spec;
  if (p.kind === 'room') return area(sp.length, sp.width) > 0 &&
    (!p.inputs.includes('bedSize') || sp.bedSize) &&
    (!p.inputs.includes('capacity') || sp.capacity) &&
    (!p.inputs.includes('users') || sp.users);
  if (p.kind === 'project') return !!projectBudget(p.id, 0, sp) &&
    (!p.inputs.includes('bedrooms') || sp.bedrooms) &&
    (!p.inputs.includes('totalArea') || sp.totalArea);
  return !!sp.productType;
}

function selectedBudgetRange() {
  const budget = S.project?.budget;
  if (!budget) return null;
  const min = Number(budget.min ?? budget.minINR), max = Number(budget.max ?? budget.maxINR);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min)
    return null;
  const rate = budget.currency === 'AED' ? 1 : AED_TO_INR;
  const minAED = budget.minAED != null && Number.isFinite(Number(budget.minAED)) ? Number(budget.minAED) : min / rate;
  const maxAED = budget.maxAED != null && Number.isFinite(Number(budget.maxAED)) ? Number(budget.maxAED) : max / rate;
  return {
    min: Math.round(min), max: Math.round(max),
    minAED, maxAED,
    currency: budget.currency || 'INR'
  };
}

function updateBudgetInputs() {
  const project = S.project;
  const budget = project?.budget || {};
  const message = document.getElementById('budget-validation');
  const selected = selectedBudgetRange();

  if (message) {
    message.textContent = budget.min && budget.max && !selected
      ? 'Enter a positive minimum and a maximum budget greater than the minimum.'
      : '';
    message.classList.toggle('is-error', !!message.textContent);
  }
  const runButton = document.querySelector('[data-act="run"]');
  if (runButton) runButton.disabled = !profileReady();
}

/* ============================================================
   WF-02 — Recommendations (AID-LOG-009 / 010)
   ============================================================ */
route('recommendations', () => {
  const p = pathById(S.project?.pathId);
  if (!p) return redirect('#/paths');
  if (p.kind === 'product') return individualView();
  if (p.kind === 'project') return projectView();

  const r = S.run;
  if (!r) return redirect('#/profile');
  if (r.status === 'Failed') return `
    <section class="section wrap">
      ${stepper(1)}
      <div class="note err"><strong>We couldn't create a room plan.</strong><br>${esc(r.reason)}</div>
      <a class="btn btn-secondary" style="margin-top:var(--s4)" href="#/profile">Adjust my inputs</a></section>`;

  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="row between" style="margin-bottom:var(--s5)">
    <div>
      <h1 class="display d2" style="margin-bottom:8px">Your ${p.label.toLowerCase()} ideas</h1>
      <p class="meta" style="margin:0;max-width:720px">${r.room.area.toFixed(1)} m² · ${r.cls} · budget ${formatAmount(r.range[0])}–${formatAmount(r.range[1])}</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/profile">Change inputs</a>
  </div>

  <div class="grid g2">${r.options.map((o, i) => optionCard(o, i === 0)).join('')}</div>
</section>`;
});

function optionCard(o, primary) {
  const anchor = o.items.find(i => i.slot.role === 'anchor') || o.items[0];
  const others = o.items.filter(i => i !== anchor).slice(0, 2);
  return `
  <div class="card optcard ${primary ? 'primary' : ''}">
    <div class="strip">
      <div class="tile">${productArt(anchor.product)}
        ${primary ? `<span class="tile-badge">${pill('Suggested', 'navy')}</span>` : ''}</div>
      ${others.map(i => `<div class="tile">${productArt(i.product)}</div>`).join('')}
    </div>
    <div class="objective">${o.label}</div>
    <div class="row between" style="align-items:baseline">
      ${money(o.total)}
      <span class="meta">${o.items.length} items</span>
    </div>
    <button class="btn btn-primary btn-block" data-act="open-option" data-key="${o.key}">View items</button>
  </div>`;
}

/* ============================================================
   WF-03 — Review, visualization & replacement
   ============================================================ */
route('option', rest => {
  if (!S.run) return redirect('#/paths');
  S.optionKey = rest[0] || S.optionKey;
  const o = currentOption();
  if (!o) return redirect('#/recommendations');
  const purchaseItems = selectedPurchaseItems(o);
  const purchaseSubtotal = purchaseTotal(purchaseItems);

  return `
<section class="section wrap">
  ${stepper(2)}
  <div class="row between" style="margin-bottom:var(--s4)">
    <div>
      <h1 class="display d2" style="margin-bottom:6px">${o.label}</h1>
      <p class="meta" style="margin:0">${S.project.spec.length} × ${S.project.spec.width} m · ${o.items.length} room items</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/recommendations">Back to ideas</a>
  </div>

  <div class="selection-summary">
    <div class="selection-count"><strong>${purchaseItems.length} item${purchaseItems.length === 1 ? '' : 's'} selected</strong>${money(purchaseSubtotal, 'sm')}</div>
    <div class="row tight">
      <button class="btn btn-ghost btn-sm" data-act="clear-purchase-selection" ${purchaseItems.length ? '' : 'disabled'}>Clear</button>
      <button class="btn btn-primary btn-sm" data-act="open-preview" ${purchaseItems.length ? '' : 'disabled'}>Preview room</button>
    </div>
  </div>
  <p class="meta" style="margin:0 0 var(--s3)">Select only the furniture you want. The room suggestion stays complete.</p>
  <div class="pgrid purchase-grid">${o.items.map(productCard).join('')}</div>
</section>`;
});

function roomPreviewSvg(items, length, width) {
  const slots = [
    [185, 236], [390, 245], [270, 298], [470, 300], [325, 173],
    [180, 315], [520, 235], [265, 205], [430, 185], [550, 320], [350, 330]
  ];
  const furniture = items.map((item, index) => {
    const [x, y] = slots[index % slots.length];
    const pieceWidth = item.product.type === 'Sofa' || item.product.type === 'Bed' ? 178 : 112;
    const pieceHeight = Math.round(pieceWidth * 0.75);
    return productArt(item.product).replace('<svg ', `<svg x="${x}" y="${y}" width="${pieceWidth}" height="${pieceHeight}" `);
  }).join('');
  return `<svg class="room-iso" viewBox="0 0 800 470" role="img" aria-label="Illustrative 3D-style room using the selected furniture and your room measurements">
    <defs>
      <linearGradient id="preview-left-wall" x2="0" y2="1"><stop stop-color="#F9F5EF"/><stop offset="1" stop-color="#EDE4D8"/></linearGradient>
      <linearGradient id="preview-right-wall" x2="0" y2="1"><stop stop-color="#F4EEE6"/><stop offset="1" stop-color="#E4D9CA"/></linearGradient>
      <linearGradient id="preview-floor" x2="0" y2="1"><stop stop-color="#E7DCCB"/><stop offset="1" stop-color="#D4C4AE"/></linearGradient>
      <pattern id="preview-planks" width="44" height="22" patternUnits="userSpaceOnUse" patternTransform="skewY(-25)">
        <path d="M0 0H44M0 11H44M0 22H44M22 0V11M0 11V22" fill="none" stroke="#B9A78F" stroke-opacity=".22"/>
      </pattern>
      <filter id="preview-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#33291F" flood-opacity=".18"/></filter>
    </defs>
    <path d="M85 115 400 15 400 160 85 270Z" fill="url(#preview-left-wall)"/>
    <path d="M715 115 400 15 400 160 715 270Z" fill="url(#preview-right-wall)"/>
    <path d="M85 270 400 160 715 270 400 415Z" fill="url(#preview-floor)" filter="url(#preview-shadow)"/>
    <path d="M85 270 400 160 715 270 400 415Z" fill="url(#preview-planks)"/>
    <path d="M85 115 85 270M715 115 715 270M400 15V160M85 270 400 415 715 270" fill="none" stroke="#C5B6A2" stroke-width="3"/>
    <path d="M335 237 400 215 465 237 400 260Z" fill="#DED0BC" opacity=".75"/>
    ${furniture}
    <g fill="#5F5A50" font-family="Inter,Arial,sans-serif" font-size="13">
      <text x="400" y="435" text-anchor="middle">${Number(length).toFixed(1)} m</text>
      <text x="62" y="196" text-anchor="middle" transform="rotate(-24 62 196)">${Number(width).toFixed(1)} m</text>
      <text x="400" y="458" text-anchor="middle" fill="#82796D" font-size="11">ROOM PREVIEW · SCALED FROM YOUR MEASUREMENTS</text>
    </g>
  </svg>`;
}

function previewPhotoStage(items, image) {
  const spots = [[14, 44], [42, 55], [66, 37], [27, 20], [60, 18], [76, 60]];
  return `<div class="photo-room-stage">
    <img class="preview-room-photo" src="${image}" alt="Your uploaded room photo">
    ${items.slice(0, 6).map((item, index) => {
      const [left, top] = spots[index % spots.length];
      return `<div class="photo-room-piece" style="--piece-left:${left}%;--piece-top:${top}%">
        ${productArt(item.product)}<span>${esc(item.product.name)}${item.qty > 1 ? ` × ${item.qty}` : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

route('preview', () => {
  if (!S.run) return redirect('#/recommendations');
  const option = currentOption();
  if (!option) return redirect('#/recommendations');
  const items = selectedPurchaseItems(option);
  if (!items.length) return redirect('#/option/' + option.key);
  const length = Number(S.project.spec.length) || 5;
  const width = Number(S.project.spec.width) || 4;
  const photo = S.project.spec.mediaImage && /^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/.test(S.project.spec.mediaImage);
  const roomView = photo ? previewPhotoStage(items, S.project.spec.mediaImage) : roomPreviewSvg(items, length, width);
  return `
<section class="section wrap">
  ${stepper(3)}
  <div class="row between" style="margin-bottom:var(--s4)">
    <div><h1 class="display d2" style="margin-bottom:6px">See your furniture in the room</h1>
      <p class="meta" style="margin:0">${length} × ${width} m · ${items.length} selected item${items.length === 1 ? '' : 's'}</p></div>
    <a class="btn btn-ghost btn-sm" href="#/option/${option.key}">Edit selection</a>
  </div>
  <div class="room-preview-frame">${roomView}</div>
  <p class="preview-disclaimer">${photo
    ? 'Furniture is shown as an approximate concept overlay on your photo. This demo does not perform photorealistic placement.'
    : 'No room photo added — this illustrative 3D-style room is based on your measurements. Furniture size and placement are approximate.'}</p>
  <div class="preview-bottom">
    <div><span class="meta">${items.length} selected item${items.length === 1 ? '' : 's'}</span>${money(purchaseTotal(items), 'sm')}</div>
    <button class="btn btn-primary" data-act="start-viewing">Continue</button>
  </div>
</section>`;
});

function productCard(it) {
  const p = it.product, of = it.offer;
  const isSelectedForPurchase = selectedPurchaseItems().some(item => item.slot.key === it.slot.key);
  return `
  <div class="pcard ${isSelectedForPurchase ? 'selected' : ''}" data-item-row="${esc(it.slot.key)}">
    ${tile(p)}
    <div class="body">
      <div class="nm">${esc(p.name)}${it.qty > 1 ? ` × ${it.qty}` : ''}</div>
      <div class="foot">
        ${money(of.sellingPrice * it.qty, 'sm')}
      </div>
      <button class="btn ${isSelectedForPurchase ? 'btn-secondary' : 'btn-ghost'} btn-sm btn-block selection-toggle"
        data-act="toggle-purchase-item" data-item="${esc(it.slot.key)}">
        ${isSelectedForPurchase ? '✓ Selected' : '+ Add'}
      </button>
    </div>
  </div>`;
}

/* ============================================================
   Individual product path (AID-SPC-009)
   ============================================================ */
function individualView() {
  const res = S.individual;
  if (!res) return redirect('#/profile');
  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="eyebrow">AID-SPC-009 · AID-LOG-001 · AID-LOG-009</div>
  <h1 class="display d2">${res.results.length} ranked ${esc(S.project.spec.productType)} match${res.results.length === 1 ? '' : 'es'}</h1>
  <p class="meta" style="max-width:640px">Budget ${formatAmount(res.range[0])}–${formatAmount(res.range[1])}.
  Products scoring below ${MIN_PRODUCT_MATCH} are never shown, even when that leaves a short list.</p>
  <div class="pgrid" style="margin-top:var(--s5)">
    ${res.results.slice(0, 16).map(c => `
      <div class="pcard">${tile(c.product)}
        <div class="body">
          <div class="nm">${esc(c.product.name)}</div>
          <div class="sub">${esc(c.product.primaryStyle)} · ${esc(c.product.primaryColour)} · ${esc(c.product.width)} cm</div>
          <div class="foot">${money(c.offer.sellingPrice, 'sm')}${pill(`${c.total}`, c.total >= 80 ? 'ok' : '')}</div>
          <div class="meta" style="font-size:12px">${esc(classifyMatch(c.total))} · ${esc(partnerById[c.offer.partnerId].name)}</div>
        </div></div>`).join('')}
  </div>
  ${res.results.length === 0 ? `<div class="note err" style="margin-top:var(--s4)">No product in this budget range satisfies the
    mandatory requirements. AIDOOi surfaces the limited inventory rather than lowering the threshold.</div>` : ''}
</section>`;
}

/* ============================================================
   Multi-module project paths (AID-LOG-006 / 007 / 008)
   ============================================================ */
function projectView() {
  const pr = S.projectRun;
  if (!pr) return redirect('#/profile');
  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="eyebrow">${pr.runId} · ${pr.status}</div>
  <h1 class="display d2">${pr.modules.length} coordinated room modules</h1>
  <p class="meta" style="max-width:720px">Selected budget ${formatAmount(S.project.minimumBudgetAED)}–${formatAmount(pr.projectCeiling)}, allocated by relative cost weight
  rather than fixed percentages ${std('AID-LOG-007 §4')}.</p>
  ${pr.constraint ? `<div class="note err" style="margin-top:var(--s4)">${esc(pr.constraint)}</div>` : ''}

  <div class="card pad-lg" style="margin-top:var(--s4)">
    <div class="row between" style="align-items:center">
      <div><div class="eyebrow" style="margin:0">Project total</div>
      <span class="meta">${pr.modules.reduce((t, m) => t + ((m.run.options && m.run.options[0]) ? m.run.options[0].items.length : 0), 0)} products across ${pr.modules.length} rooms</span></div>
      ${money(pr.total, 'lg')}
    </div>
  </div>

  <div class="grid g2" style="margin-top:var(--s4)">
    ${pr.modules.map((m, i) => {
      const o = m.run.options && m.run.options[0];
      return `<div class="card">
        <div class="row between" style="align-items:flex-start;margin-bottom:var(--s3)">
          <div><h3 style="margin:0 0 4px">${esc(m.label)}</h3>
            <div class="meta">${m.area.toFixed(1)} m² · ${esc(m.cls)}${m.floor ? ' · ' + esc(m.floor) : ''}${m.bedSize ? ' · ' + esc(m.bedSize) : ''}</div></div>
          <div style="text-align:right"><div class="meta">Allocated</div><strong class="num">${formatAmount(m.share)}</strong></div>
        </div>
        ${o ? `
          <div class="strip" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${o.items.slice(0, 4).map(it => `<div class="tile sq">${productArt(it.product)}</div>`).join('')}
          </div>
          <div class="row between" style="margin-top:var(--s3);align-items:baseline">
            ${money(o.total)}<span class="meta">${o.items.length} products · score ${o.score}</span></div>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:var(--s3)" data-act="open-module" data-mod="${i}">Open this room</button>
        ` : `<div class="note err">${esc(m.run.reason || 'No valid composition for this module.')}</div>`}
      </div>`;
    }).join('')}
  </div>
</section>`;
}

/* ============================================================
   WF-04 — Viewing, deposit & attribution
   ============================================================ */
route('viewing', () => {
  if (!S.customer) return registerView('viewing');
  const v = S.viewing;
  if (!v) return redirect('#/recommendations');
  const nextStep = v.state === 'Awaiting Seller Confirmation'
    ? `<button class="btn btn-primary btn-block" data-act="confirm-sellers">Confirm availability</button>`
    : v.state === 'Awaiting Deposit'
      ? `<button class="btn btn-primary btn-block" data-act="pay-deposit">Pay ${formatAmount(v.deposit.amount)} deposit</button>`
      : v.state === 'Confirmed'
        ? `<button class="btn btn-primary btn-block" data-act="viewing-outcome" data-val="Completed">Mark viewing complete</button>`
        : v.state === 'Completed'
          ? `<a class="btn btn-primary btn-block" href="#/checkout">Continue to checkout</a>`
          : '';
  const statusLabel = {
    'Awaiting Seller Confirmation': 'Checking availability',
    'Awaiting Deposit': 'Ready to confirm',
    Confirmed: 'Deposit paid',
    Completed: 'Viewing complete',
    'No-show': 'Viewing not completed'
  }[v.state] || v.state;

  return `
<section class="section wrap">
    ${stepper(4)}
    <div class="eyebrow">Viewing</div>
  <h1 class="display d2">Your selected items</h1>
  <p class="meta">${v.items.length} item${v.items.length === 1 ? '' : 's'} selected</p>

  <div class="simple-viewing">
    <div class="card pad-lg">
      ${v.items.map(it => `
        <div class="viewing-item">
          <div class="tile">${productArt(it.product)}</div>
          <strong>${esc(it.product.name)}</strong>
          <strong>${formatAmount(it.offer.sellingPrice * (it.qty || 1))}</strong>
        </div>`).join('')}
    </div>
    <aside class="card pad-lg viewing-total">
      <div class="eyebrow">Viewing deposit</div>
      <div class="price lg">${formatAmount(v.deposit.amount)}</div>
      <div class="meta">Deposit${v.deposit.capped ? ` · maximum ${formatAmount(500)}` : ''}</div>
      <div class="viewing-status">${pill(statusLabel, v.state === 'Completed' ? 'ok' : 'beige')}</div>
      ${nextStep}
    </aside>
  </div>
</section>`;
});

/* ============================================================
   WF-05 — Purchase, checkout & payment
   ============================================================ */
route('checkout', () => {
  if (!S.customer) return registerView('checkout');
  const o = currentOption();
  if (!o) return redirect('#/recommendations');
  const items = S.checkoutItems || S.viewing?.items || selectedPurchaseItems(o);
  if (!items.length) return redirect('#/option/' + o.key);
  S.checkoutItems = items;
  if (!S.reservation) S.reservation = C.createReservation(C.validateSellers(items));
  const res = S.reservation;
  const credit = C.depositCredit(S.viewing);
  const gross = purchaseTotal(items);
  const payable = Math.max(0, gross - credit);

  return `
<section class="section wrap">
    ${stepper(5)}
    <div class="eyebrow">Final step</div>
  <h1 class="display d2">Confirm your order</h1>
  <p class="meta">${items.length} selected item${items.length === 1 ? '' : 's'}</p>

  <div class="card pad-lg simple-checkout">
    <div class="checkout-items">
      ${items.map(item => `
        <div class="viewing-item">
          <div class="tile">${productArt(item.product)}</div>
          <strong>${esc(item.product.name)}${item.qty > 1 ? ` × ${item.qty}` : ''}</strong>
          <strong>${formatAmount(item.offer.sellingPrice * (item.qty || 1))}</strong>
        </div>`).join('')}
    </div>
    <div class="checkout-total">
      <div><span>Order total</span><strong>${formatAmount(gross)}</strong></div>
      ${credit ? `<div><span>Deposit paid</span><strong>− ${formatAmount(credit)}</strong></div>` : ''}
      <div class="payable"><span>Due now</span><strong>${formatAmount(payable)}</strong></div>
      <button class="btn btn-primary btn-block" style="margin-top:var(--s4)" data-act="pay" ${res.state === 'Active' ? '' : 'disabled'}>
        Place demo order</button>
      ${res.state !== 'Active' ? '<p class="note err">This selection is no longer available. Go back and choose another option.</p>' : ''}
      <p class="meta" style="margin-bottom:0">Demo only — no real payment is taken.</p>
    </div>
  </div>
</section>`;
});

/* ============================================================
   WF-06 / 07 / 08 — Orders, issues, settlement
   ============================================================ */
route('orders', () => {
  if (!S.orders.length) return `
    <section class="section wrap">
      ${stepper(6)}
      <h1 class="display d2">No orders yet</h1>
      <p class="lead" style="max-width:520px">Your sample orders will appear here.</p>
      <a class="btn btn-primary" href="#/paths">Plan a room</a></section>`;

  return `
<section class="section wrap">
    ${stepper(6)}
    <h1 class="display d2">Your orders</h1>
  ${S.orders.map(order => `
    <div class="card pad-lg simple-order" style="margin-top:var(--s4)">
      <div class="row between" style="align-items:center">
        <div><div class="eyebrow">Order placed</div><h3 style="margin:0">${esc(order.id)}</h3></div>
        <div style="text-align:right"><div class="meta">Paid</div><strong class="price sm">${formatAmount(order.paid)}</strong></div>
      </div>
      <div class="order-items">
        ${order.sellerOrders.flatMap(so => so.lines).map(line => `
          <div class="viewing-item">
            <strong>${esc(line.snapshot.productName)}${line.snapshot.quantity > 1 ? ` × ${line.snapshot.quantity}` : ''}</strong>
            <span></span>
            <strong>${formatAmount(line.snapshot.grossLineAmount)}</strong>
          </div>`).join('')}
      </div>
      ${order.depositCredit ? `<p class="meta">Viewing deposit applied: ${formatAmount(order.depositCredit)}</p>` : ''}
      <p class="meta" style="margin-bottom:0">Thanks for trying the AIDOOi demo.</p>
    </div>`).join('')}
  <a class="btn btn-primary" style="margin-top:var(--s4)" href="#/paths">Plan another room</a>
</section>`;
});

/* ============================================================
   Registration gate (AID-LOG-013)
   ============================================================ */
function registerView(resume) {
  S.pendingAction = resume;
  const activeStep = resume === 'checkout' ? 5 : 4;
  return `
<section class="section wrap" style="max-width:560px">
  ${stepper(activeStep)}
  <div class="eyebrow">AID-LOG-013 · registration required</div>
  <h1 class="display d2">Create your AIDOOi account</h1>
  <p class="lead">Guests explore and get recommendations freely. Registration is required only at viewing and
  purchase — and you return to exactly where you were, with your project intact.</p>
  <div class="card pad-lg" style="margin-top:var(--s4)">
    <label class="field"><span>Full name</span><input type="text" id="reg-name" placeholder="Your name"></label>
    <label class="field"><span>Mobile or email</span><input type="text" id="reg-contact" placeholder="+971 50 000 0000"></label>
    <button class="btn btn-primary btn-block btn-lg" data-act="register">Continue</button>
  </div>
</section>`;
}

/* ============================================================
   Modals
   ============================================================ */
function openModal(html) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="modal">${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  return el;
}
const closeModal = () => document.querySelectorAll('.overlay').forEach(e => e.remove());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function productCardModal(it) {
  const p = it.product, o = it.offer, partner = partnerById[o.partnerId];
  openModal(`
    <div class="row between" style="align-items:flex-start">
      <div><div class="eyebrow">${esc(p.mainCategory)} › ${esc(p.category)} › ${esc(p.type)}</div>
        <h2 class="display d3" style="margin:0">${esc(p.name)}</h2></div>
      <button class="btn btn-text" data-act="close-modal">Close</button>
    </div>
    <div class="split" style="gap:var(--s4);margin-top:var(--s4)">
      <div class="tile wide">${productArt(p)}</div>
      <div>
        <div class="row between" style="align-items:center">${money(o.sellingPrice)}
          ${pill(`${it.total} · ${classifyMatch(it.total)}`, it.total >= 80 ? 'ok' : '')}</div>
        ${o.originalPrice ? `<div class="meta">Was ${formatAmount(o.originalPrice)}</div>` : ''}
        <table class="data" style="margin-top:var(--s3)">
          <tr><td>Dimensions</td><td>${esc(p.width)} W × ${esc(p.depth)} D × ${esc(p.height)} H cm</td></tr>
          <tr><td>Style</td><td>${esc(p.primaryStyle)}${p.secondaryStyle ? ' / ' + esc(p.secondaryStyle) : ''}</td></tr>
          <tr><td>Colour</td><td>${esc(p.primaryColour)}</td></tr>
          <tr><td>Material</td><td>${esc(p.material)}</td></tr>
          <tr><td>Availability</td><td>${esc(o.availability)} · ${esc(o.viewingStatus)} · delivery ${o.deliveryDays} days</td></tr>
          <tr><td>Showroom</td><td>${esc(partner.name)} — ${esc(partner.location)}</td></tr>
          <tr><td>Price tier</td><td>${esc(tierOfPrice(p.type, p.branch, o.sellingPrice))}</td></tr>
          <tr><td>Identifiers</td><td class="std">${esc(p.parentId)} · ${esc(p.id)}<br>${esc(o.id)} · SKU ${esc(o.sellerSku)}</td></tr>
        </table>
      </div>
    </div>
    <h3 style="margin-top:var(--s5)">Why this product scored ${it.total} ${std('AID-LOG-009 §3')}</h3>
    ${matchBars(it)}
    <div class="row" style="margin-top:var(--s4)">
      <button class="btn btn-secondary" data-act="replace" data-item="${esc(it.slot.key)}">Replace this product</button>
      <button class="btn btn-ghost" data-act="close-modal">Keep it</button>
    </div>`);
}

function replaceModal(it) {
  const alts = alternativesFor(S.run, currentOption(), it);
  openModal(`
    <div class="row between" style="align-items:flex-start">
      <div><div class="eyebrow">Replace · ${esc(it.product.type)}</div>
        <h2 class="display d3" style="margin:0">Eligible alternatives</h2></div>
      <button class="btn btn-text" data-act="close-modal">Close</button>
    </div>
    <p class="meta">Only eligible alternatives are shown. Your choice is revalidated against fit, practical needs,
    availability, budget and composition harmony before it is applied ${std('WF-03 steps 6–8')}.</p>
    <div id="replace-msg"></div>
    <div class="pgrid" style="margin-top:var(--s3)">
      ${alts.map((c, i) => `
        <div class="pcard">${tile(c.product)}
          <div class="body">
            <div class="nm">${esc(c.product.name)}</div>
            <div class="sub">${esc(c.product.primaryStyle)} · ${esc(c.product.primaryColour)} · ${esc(c.product.width)} cm</div>
            <div class="foot">${money(c.offer.sellingPrice, 'sm')}${pill('Match ' + c.total, c.total >= 80 ? 'ok' : '')}</div>
            <button class="btn btn-secondary btn-sm btn-block" style="margin-top:10px"
              data-act="apply-replace" data-item="${esc(it.slot.key)}" data-alt="${i}">Use this instead</button>
          </div></div>`).join('')}
    </div>`);
  window.__alts = alts;
}

/* ============================================================
   Actions
   ============================================================ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act], [data-spec-set]');
  if (!t) return;

  if (t.dataset.specSet) {
    const k = t.dataset.specSet, v = t.dataset.val;
    if (k === 'style' || k === 'colour' || k === 'tier') S.project[k] = v;
    else S.project.spec[k] = v;
    save(); render();
    return;
  }

  const act = t.dataset.act;
  const o = currentOption();

  switch (act) {
    case 'pick-path': {
      const id = t.dataset.id;
      const spec = {};
      if (id === 'individualProduct') {
        spec.productType = INDIVIDUAL_TYPES[0];
        spec.branch = BRANCH_OPTS[spec.productType][1];
      }
      S.project = { pathId: id, spec, style: 'assisted', colour: 'assisted', tier: 'Standard', projectBudget: '',
        budget: { currency: 'INR', min: '', max: '' } };
      S.run = S.projectRun = S.individual = S.viewing = S.reservation = S.checkoutItems = null;
      S.purchaseSelectionByOption = {};
      save(); go('#/profile');
      break;
    }
    case 'choose-media': document.getElementById('media-upload')?.click(); break;
    case 'capture-media': document.getElementById('media-camera')?.click(); break;
    case 'remove-media':
      delete S.project.spec.mediaImage;
      delete S.project.spec.mediaImageName;
      save(); render();
      break;
    case 'run': {
      const p = pathById(S.project.pathId);
      S.reservation = S.checkoutItems = null;
      S.purchaseSelectionByOption = {};
      const budgetRange = selectedBudgetRange();
      S.project.budgetRangeAED = [budgetRange.minAED, budgetRange.maxAED];
      if (p.kind === 'room') {
        S.project.budgetOverride = S.project.budgetRangeAED;
        S.project.minimumSpendAED = budgetRange.minAED;
        S.run = runRecommendation(S.project);
        S.optionKey = S.run.options[0] && S.run.options[0].key;
      } else if (p.kind === 'project') {
        S.project.projectBudget = budgetRange.maxAED;
        S.project.minimumBudgetAED = budgetRange.minAED;
        S.projectRun = runProject(S.project);
      } else {
        S.individual = rankIndividual({
          type: S.project.spec.productType, branch: S.project.spec.branch || null,
          style: S.project.style, colour: S.project.colour, tier: S.project.tier,
          range: S.project.budgetRangeAED
        });
      }
      save(); go('#/recommendations');
      break;
    }
    case 'open-option': S.optionKey = t.dataset.key; save(); go('#/option/' + t.dataset.key); break;
    case 'clear-purchase-selection':
      S.purchaseSelectionByOption[o.key] = [];
      S.reservation = null;
      S.checkoutItems = null;
      render();
      break;
    case 'open-preview':
      if (selectedPurchaseItems(o).length) go('#/preview');
      break;
    case 'toggle-purchase-item': {
      const itemKey = t.dataset.item;
      const current = selectedPurchaseItems(o).map(item => item.slot.key);
      if (current.includes(itemKey)) {
        S.purchaseSelectionByOption[o.key] = current.filter(key => key !== itemKey);
      } else {
        S.purchaseSelectionByOption[o.key] = [...current, itemKey];
      }
      S.reservation = null;
      S.checkoutItems = null;
      render();
      break;
    }
    case 'open-module': {
      const m = S.projectRun.modules[Number(t.dataset.mod)];
      S.run = m.run; S.optionKey = m.run.options[0].key;
      S.project = { ...S.project, spec: { ...S.project.spec, length: Math.sqrt(m.area * 1.35), width: Math.sqrt(m.area / 1.35) } };
      save(); go('#/option/' + S.optionKey);
      break;
    }
    case 'why': {
      const opt = S.run.options.find(x => x.key === t.dataset.key);
      openModal(`
        <div class="row between" style="align-items:flex-start">
          <div><div class="eyebrow">${esc(opt.classification)}</div>
            <h2 class="display d3" style="margin:0">${esc(opt.label)}</h2></div>
          <button class="btn btn-text" data-act="close-modal">Close</button></div>
        <p>${esc(opt.blurb)}</p>
        ${scoreBars(opt)}
        <p class="meta" style="margin-top:var(--s3)">All four options share one quality foundation. They differ only
        in the optimization objective applied after the minimum quality is satisfied ${std('AID-LOG-010 §14, §18')}.</p>`);
      break;
    }
    case 'card':    productCardModal(o.items.find(i => i.slot.key === t.dataset.item)); break;
    case 'replace': closeModal(); replaceModal(o.items.find(i => i.slot.key === t.dataset.item)); break;
    case 'apply-replace': {
      const res = applyReplacement(S.run, o, t.dataset.item, window.__alts[Number(t.dataset.alt)]);
      if (!res.ok) {
        const box = document.getElementById('replace-msg');
        if (box) box.innerHTML = `<div class="note err" style="margin-top:var(--s3)">Replacement rejected — ${esc(res.reason)}</div>`;
      } else { closeModal(); S.reservation = null; save(); render(); }
      break;
    }
    case 'remove': {
      const res = removeItem(S.run, o, t.dataset.item);
      if (!res.ok) alert(res.reason);
      S.reservation = null; save(); render();
      break;
    }
    case 'start-viewing': {
      S.checkoutItems = selectedPurchaseItems(o);
      if (!S.customer) { S.pendingAction = 'viewing'; go('#/viewing'); break; }
      S.viewing = C.createViewing({ items: S.checkoutItems, projectId: S.run.runId, customer: S.customer });
      save(); go('#/viewing');
      break;
    }
    case 'start-purchase': S.checkoutItems = selectedPurchaseItems(o); S.reservation = null; go('#/checkout'); break;
    case 'register': {
      const name = document.getElementById('reg-name').value.trim() || 'Guest Customer';
      const contact = document.getElementById('reg-contact').value.trim();
      S.customer = { name, contact, id: 'CUS-' + Math.random().toString(36).slice(2, 8).toUpperCase() };
      const resume = S.pendingAction;
      if (resume === 'viewing' && !S.viewing && o)
        S.viewing = C.createViewing({ items: S.checkoutItems || selectedPurchaseItems(o), projectId: S.run.runId, customer: S.customer });
      save(); go('#/' + (resume || 'recommendations'));
      break;
    }
    case 'confirm-sellers': C.confirmSellers(S.viewing); save(); render(); break;
    case 'pay-deposit':     C.payDeposit(S.viewing);     save(); render(); break;
    case 'viewing-outcome': C.recordViewingOutcome(S.viewing, t.dataset.val); save(); render(); break;
    case 'pay': {
      const res = C.capturePayment({ items: S.checkoutItems || selectedPurchaseItems(o), reservation: S.reservation, viewing: S.viewing, customer: S.customer });
      if (!res.ok) { alert(res.reason); break; }
      S.order = res.order; S.orders.push(res.order);
      if (S.viewing) {
        S.viewing.attribution.stage = 'Purchased';
        S.viewing.attribution.history.push({ stage: 'Purchased', at: Date.now() });
      }
      S.reservation = null; save(); go('#/orders');
      break;
    }
    case 'close-modal': closeModal(); break;
    case 'reset': localStorage.removeItem('aidooi'); location.hash = '#/'; location.reload(); break;
  }
});

/* Visualization hotspot → product card (AID-LOG-011 §4) */
document.addEventListener('click', e => {
  const hs = e.target.closest('.hotspot');
  if (!hs) return;
  const o = currentOption();
  const it = o && o.items.find(i => i.slot.key === hs.dataset.item);
  if (it) productCardModal(it);
});

function onFieldInput(e) {
  const budgetField = e.target.dataset.budget;
  if (budgetField && S.project) {
    S.project.budget = S.project.budget || {};
    const budget = S.project.budget;
    budget[budgetField] = e.target.value;
    const rate = budget.currency === 'AED' ? 1 : AED_TO_INR;
    budget[`${budgetField}AED`] = Number(e.target.value) > 0 ? Number(e.target.value) / rate : null;
    save();
    updateBudgetInputs();
    return;
  }
  const k = e.target.dataset.spec;
  if (!k || !S.project) return;
  if (k === 'projectBudget') S.project.projectBudget = e.target.value;
  else S.project.spec[k] = e.target.value;
  if (k === 'productType') {
    const bo = BRANCH_OPTS[e.target.value];
    S.project.spec.branch = bo ? bo[Math.min(1, bo.length - 1)] : null;
  }
  save();
  if (k === 'length' || k === 'width') updateRoomProfileSummary();
  const btn = document.querySelector('[data-act="run"]');
  if (btn) btn.disabled = !profileReady();
}
document.addEventListener('input', onFieldInput);
document.addEventListener('change', e => {
  if (e.target.tagName === 'SELECT') onFieldInput(e);
  if (e.target.matches('[data-spec="totalArea"], [data-spec="livingArea"], [data-spec="productType"]'))
    render();
  if (e.target.matches('[data-budget-currency]')) changeBudgetCurrency(e.target.value);
  if (e.target.matches('[data-media-upload]')) uploadMedia(e.target);
});

function changeBudgetCurrency(nextCurrency) {
  const budget = S.project?.budget;
  if (!budget || !['INR', 'AED'].includes(nextCurrency)) return;
  const previousCurrency = budget.currency || 'INR';
  const nextRate = nextCurrency === 'AED' ? 1 : AED_TO_INR;
  for (const key of ['min', 'max']) {
    const input = document.querySelector(`[data-budget="${key}"]`);
    const legacyValue = key === 'min' ? budget.minINR : budget.maxINR;
    const value = Number(input?.value ?? budget[key] ?? legacyValue);
    if (!Number.isFinite(value) || value <= 0) {
      budget[key] = '';
      budget[`${key}AED`] = null;
      continue;
    }
    const aedValue = budget[`${key}AED`] != null
      ? Number(budget[`${key}AED`])
      : value / (previousCurrency === 'AED' ? 1 : AED_TO_INR);
    budget[`${key}AED`] = aedValue;
    budget[key] = String(Math.round(aedValue * nextRate));
  }
  budget.currency = nextCurrency;
  delete budget.minINR;
  delete budget.maxINR;
  save();
  render();
}

function updateRoomProfileSummary() {
  const p = pathById(S.project?.pathId);
  if (!p || p.kind !== 'room') return;
  const spec = S.project.spec;
  const roomArea = area(spec.length, spec.width);
  const cls = roomArea > 0 ? sizeClass(p.id, roomArea) : null;
  const sizeSummary = document.getElementById('room-size-summary');
  if (sizeSummary) {
    sizeSummary.innerHTML = `${cls
      ? `<strong>${roomArea.toFixed(1)} m²</strong> → size classification <strong>${cls}</strong>.`
      : 'Enter both dimensions to see your room size classification.'}
      <br><small>You never choose the size class — AIDOOi derives it from your measurements ${std(p.log + ' §3')}.</small>`;
  }
}

async function uploadMedia(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const status = document.getElementById('media-status');
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw new Error('Choose a JPEG, PNG or WebP image.');
    if (file.size > 15 * 1024 * 1024)
      throw new Error('This image is over 15 MB. Choose a smaller photo.');
    const imageData = await optimizeMediaImage(file);
    if (!S.project) return;
    S.project.spec.mediaImage = imageData;
    S.project.spec.mediaImageName = file.name;
    save();
    render();
  } catch (error) {
    if (!status) throw error;
    status.textContent = error instanceof Error ? error.message : 'The image could not be uploaded.';
    status.hidden = false;
  } finally {
    input.value = '';
  }
}

async function optimizeMediaImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The selected image could not be opened.'));
      img.src = objectUrl;
    });
    const maxDimension = 1000;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('The image could not be processed.')),
        'image/jpeg', 0.78));
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The processed image could not be read.'));
      reader.onerror = () => reject(new Error('The processed image could not be read.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function redirect(hash) { setTimeout(() => go(hash), 0); return '<section class="section wrap"><p class="meta">Loading…</p></section>'; }

/* Only lightweight, re-derivable state is persisted. Recommendation runs hold
   live object graphs, so they are rebuilt rather than serialized. */
function save() {
  try { localStorage.setItem('aidooi', JSON.stringify({ customer: S.customer, project: S.project })); }
  catch { /* private window or blocked storage — the app works without it */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('aidooi') || 'null');
    if (!d) return;
    S.customer = d.customer || null;
    S.project = d.project || null;
  } catch { /* ignore */ }
}

/* ---------------- Boot ---------------- */
load();
document.getElementById('brand-mark').innerHTML = brandMark(34);
render();

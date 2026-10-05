# AIDOOi MVP — how to run it

This folder is the **running AIDOOi MVP**. It has no build step, no package manager, no database
and no accounts. Everything — the catalogue, the recommendation engine, viewing, checkout, orders
and settlement — runs in the browser.

---

## 1. Run it

### The one command you need

```bash
cd "/Users/Downloads/likhi project/mvp"
python3 -m http.server 8777
```

Then open **<http://localhost:8777>** in Chrome, Safari, Edge or Firefox.

Stop the server with `Ctrl + C`.

### Why a server, and not just double-clicking index.html

The app is written as native **ES modules** (`<script type="module">`). Browsers refuse to load
modules over the `file://` protocol for security reasons, so opening `index.html` directly shows a
blank page and a CORS error in the console. Any static file server fixes this.

### Alternatives, if you do not have Python

| You have | Command |
|---|---|
| Node.js | `npx serve -l 8777` &nbsp;or&nbsp; `npx http-server -p 8777` |
| PHP | `php -S localhost:8777` |
| VS Code | Right-click `index.html` → **Open with Live Server** |
| Ruby | `ruby -run -e httpd . -p 8777` |

### Port already in use?

```bash
lsof -ti:8777 | xargs kill      # free the port
python3 -m http.server 8080     # or just pick another one
```

### Showing it to someone on another machine

On the same Wi-Fi, find your local IP and share it:

```bash
ipconfig getifaddr en0          # macOS, e.g. 192.168.1.24
# the other person opens http://192.168.1.24:8777
```

---

## 2. A five-minute demo path

This is the route to walk a client through. It touches all eight workflows.
The progress bar stays visible throughout the customer journey and highlights the current page.

| # | Do this | What to point out |
|---|---|---|
| 1 | Home → **Find my best match** | Start a sample room-furnishing journey |
| 2 | Choose **Living Room** | One entry question routes into one of eight paths (AID-SPC-001) |
| 3 | Enter length `5.5`, width `4.5` | 24.8 m² → size classification **Medium**, derived by the system, never chosen by the customer. Optionally upload a room photo or floor plan from your device or camera. |
| 4 | Pick **Scandinavian** and **Beige** | Controlled vocabularies, not free text (AID-DATA-009 / 007) |
| 5 | Choose INR or AED, then set a minimum and maximum budget | Product prices and totals use the selected currency; conversion uses the prototype's approximate fixed rate of ₹23 per AED |
| 6 | **Generate my recommendations** | A small set of complete room ideas to compare |
| 7 | Browse the room ideas | Compare the sample furniture sets and choose one to review |
| 8 | Select what you want | The key item starts selected; add or remove products to make your own set |
| 9 | **Preview room** | See the selected furniture in a measurement-based 3D-style room, or as an approximate overlay on your uploaded photo |
| 10 | **Continue** → register | Only selected products appear in the simple viewing summary |
| 11 | Confirm availability → pay deposit | 5% of selected products, capped at AED 500 |
| 12 | Mark viewing complete → checkout | The deposit becomes a credit against the selected order |
| 13 | **Pay** | Place the sample order for selected products |
Things worth trying off the happy path:

- A **tiny room** (2.8 × 2.6 living room) — watch the composition shrink rather than break.
- A different budget — the available room ideas change with the inputs.
- **Villa** with 4 bedrooms and 2 floors — eight coordinated room modules from one budget.
- **Individual Product** → Premium Sofa — a deliberately short list, because products below match 60
  are never shown.

---

## 3. What is in each file

```
mvp/
├── index.html              Page shell, fonts, header and footer
├── css/
│   └── aidooi.css          The whole design system as tokens (AID-DATA-015)
└── js/
    ├── standards.js        Controlled vocabularies + AID-LOG-001 price matrix
    ├── paths.js            The 8 customer paths, size classes, compositions, budgets
    ├── catalogue.js        Generated AIP / AID / AIO records and partner stores
    ├── engine.js           AID-LOG-009 scoring + AID-LOG-010 composition logic
    ├── commerce.js         Viewing, deposit, checkout, orders, settlement
    ├── art.js              Product illustrations drawn from each product's own data
    ├── ui.js               Brand mark, icons, the measured room plan
    └── app.js              Router, views and all user actions
```

Every file cites the standard section that governs each decision, in comments at the decision point.
If a number looks arbitrary, the citation next to it says where it came from.

For a full section-by-section explanation of every screen and module, see
[`../docs/06-mvp-walkthrough.md`](../docs/06-mvp-walkthrough.md).

---

## 4. How the data behaves

- The catalogue is **generated deterministically** at page load from a fixed seed, so the same
  products, prices and stock appear on every machine and in every demo.
- Prices come from the **AID-LOG-001 tier bands** for each product type and size branch — they are
  not random numbers.
- Only `Verified` + `Active` products with an in-stock, active offer can enter recommendation. That
  gate is real; it is the first MVP acceptance gate.

### Resetting between demos

Click **Reset demo data** in the footer, or clear the site's local storage. Only your name and
current project are stored locally — nothing is sent anywhere.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, CORS error in console | Opened `index.html` directly | Serve it over HTTP (section 1) |
| Blank page, 404 on `js/app.js` | Server started from the wrong folder | `cd` into `mvp/` first |
| Fonts look wrong | Google Fonts blocked or offline | Harmless — the system fallbacks are set |
| Nothing happens on a button | Stale cached module | Hard reload: `Cmd/Ctrl + Shift + R` |
| "Generate" stays greyed out | A required input is missing or the budget range is invalid | Complete dimensions/conditional inputs and enter a positive minimum plus a greater maximum budget |

---

## 6. What this build is, and is not

**It is** the complete customer journey and the complete decision logic: the real AID-LOG-009 scoring
weights, the real AID-LOG-010 composition rules and thresholds, the real deposit and settlement
arithmetic, and the real state machines.

**It is not** production infrastructure. There is no database, no authentication, no payment
provider and no admin back office — by design. Those are Phase 1, 6 and 7 of the Master Plan build
sequence. See `../docs/04-build-plan.md` for what each phase still needs, and
`../docs/05-gaps-and-decisions.md` for the 14 places where the standards are silent and a decision
had to be taken.

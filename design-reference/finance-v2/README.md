# Finance v2 — Static Design Reference

This folder is a **frozen, reference-only** copy of the **Finance v2** Claude Design
("Hebrew Finance Management UI"). It exists purely as a visual reference for future
UI work. **It is not wired into the app** — no routes, no API calls, no real data,
no React components. Nothing here imports from or affects `client/` or `server/`.

Source: claude.ai/design project `993ccc21-3b9b-40ac-a26d-5ba5c23885fe`,
file `Finance v2.dc.html`. Exported via the Claude Design MCP, kept byte-for-byte.

## Files

| File         | What it is |
|--------------|------------|
| `index.html` | Exact copy of `Finance v2.dc.html` — the Claude Design source (an `<x-dc>` template with inline theme CSS and an embedded mock-data script). |
| `support.js` | The Claude Design runtime, referenced by `index.html` as `./support.js`. It parses the template and renders it client-side. |

## Screens included

All nine screens live in the single `index.html`, switched via the sidebar nav:
**Dashboard, Transactions, Budgets, Reports, Categories, Loans, Shopping, Lego,
Settings** — plus an Add-Transaction modal and toast notifications.

## Dark / Light mode & RTL

- **Both themes are preserved.** `index.html` defines `[data-theme="dark"]` and
  `[data-theme="light"]` token sets; the header theme button toggles between them
  at runtime.
- **RTL Hebrew is preserved** — the root element is `<div dir="rtl">`.

## How to view locally

The design renders client-side, so **an internet connection is required** the first
time (see "Note on external resources" below). Then either:

- **Quick:** open `index.html` in a browser (double-click, or drag it into a tab), **or**
- **Reliable:** serve the folder statically and open the URL it prints, e.g.
  - `npx serve .`  (from inside this folder), or
  - `python -m http.server`  (then browse to `http://localhost:8000/`).

Expected result: the "כספומטר" dashboard renders in dark mode, right-to-left; the
theme button flips light/dark; the sidebar switches between the nine screens.

## Note on external resources

`support.js` loads React/ReactDOM from the unpkg CDN, and `index.html` loads the
Heebo and Material Symbols fonts from Google Fonts. These absolute URLs are part of
the original Claude Design output; they are what make the file render. All *local*
references (`./support.js`) are relative. Making the CDN/font URLs local would mean
downloading and inlining them, i.e. altering the exported design — deliberately not
done here to keep this an exact reference.

## Deliberate deviations from the requested example layout

- **No separate `styles.css`.** The Claude Design export keeps its CSS inline inside
  the `<x-dc>` template's `<helmet>`. Splitting it out would require editing the
  template and re-testing the runtime — i.e. recreating the design — which this task
  forbids. The single-file structure is kept intact.
- **No `assets/` screenshots.** The design project contains two reference PNGs
  (`screenshots/budgets.png`, `screenshots/v2-dash-dark.png`). They could not be
  reliably transferred as intact binary through this session's tooling, so they were
  omitted rather than shipped corrupt. They remain available in the Claude Design
  project itself. The interactive `index.html` renders every screen live, so nothing
  visual is lost.

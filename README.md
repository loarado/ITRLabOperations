# ITR Lab Visualizer

ITR Lab Visualizer is the Illinois Tech Robotics Lab’s shared lab-map,
inventory, project-request, and treasury-planning application.

## Production site

Use the production Vercel deployment for normal testing and verification:

<https://itr-lab-visualizer-indol.vercel.app/>

The production application uses Vercel serverless functions and Neon Postgres for
accounts, projects, treasury records, admin sessions, and migrated lab documents.
After a change is pushed to `main`, Vercel creates a deployment automatically.
Open the production link after the deployment reaches **Ready** and verify the
affected workflow there.

## Deploying a change

```bash
git status
git push origin main
```

Then open the Vercel project dashboard to confirm the Production deployment is
**Ready**. If it fails, use that deployment’s **Logs** tab; do not try to fix a
Vercel issue by running a static file server.

## Required Vercel environment variables

Set these in Vercel Project Settings → Environment Variables for Production (and
Preview when you use preview deployments):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled Postgres connection string used by the serverless API. |
| `ITR_ADMIN_PASSWORD` | Password for Lab Map / Inventory administrator login. |
| `ITR_TREASURER_EMAILS` | Comma-separated member-account emails allowed into Treasury Dashboard. |
| `ITR_MIGRATION_SECRET` | One-time JSON-to-Neon migration authorization; keep secret. |

Never commit passwords, connection strings, tokens, or `.env` files.

## Editing website text

Edit visitor-facing copy in the matching HTML file below. Push the change and
verify it on the production site. Do not manually edit saved projects, inventory,
treasury records, or shelf data in production; use the app so Neon and audit
history stay consistent.

| Website section | HTML file | What belongs there |
| --- | --- | --- |
| **Lab Map** | `web/pages/lab_overview.html` | Header eyebrow, `LAB EXPLORER` heading, subtitle, controls, dialog headings, and help text. Rooms, walls, shelves, and labels are data—not page copy. |
| **Lab Inventory** | `web/pages/lab_inventory.html` | Header/subtitle, search placeholder, instructions, button labels, and dialog help text. Items and stock are database data. |
| **Project Dashboard** | `web/pages/project_dashboard.html` | Dashboard title, introduction, form headings, field labels, placeholders, and request instructions. Submitted projects are database data. |
| **Treasury Dashboard** | `web/pages/treasury_dashboard.html` | Dashboard title, login wording, filter labels, empty-state copy, and review-dialog labels. Treasury reviews are database data. |
| **Shelf Editor** | `web/pages/shelf_editor.html` | Editor headings, labels, hints, dialog text, and buttons. Shelf layouts and bins are database data. |
| **Legacy shelf prototype** | `web/pages/shelf_inventory_editor.html` | Reference-only prototype. It does not use the production save/login flow. |

The Project and Treasury page navigation labels live in their HTML. Lab Map and
Inventory navigation is created by `web/scripts/inventory_ui.js`; edit its
`sectionNavigation` list to rename those shared links.

## Project layout

```text
ITRLabVisualizer/
├── web/
│   ├── pages/        HTML structure and visible text
│   ├── scripts/      Browser behavior for editors and dashboards
│   └── styles/       Shared responsive red/black/white theme
├── api/              Vercel/FastAPI entry point
├── data/             Local seed/fallback JSON and history
├── defaults/         Local reset layout
├── tests/            Local regression tests; not shipped to Vercel
├── lab_server.py     Optional local JSON-backed development server
├── inventory.py      Inventory validation and calculations
├── projects.py       Project-request validation
├── treasury.py       Treasury-review validation
├── reports.py        Anonymous-report validation
├── neon_accounts.py  Neon member-account/session support
├── restore_backup.py Local backup recovery utility
└── vercel.json       Vercel function and bundle configuration
```

### Styles and browser behavior

- `web/styles/editor.css` — shared visual theme, navigation, buttons, dialogs,
  map canvas, and shelf canvas.
- `web/scripts/dashboards.js` — member login, projects, purchase suggestions,
  project editing, and Treasury Dashboard.
- `web/scripts/lab.js`, `web/scripts/map_editor.js`,
  `web/scripts/map_elements.js`, `web/scripts/map_geometry.js`, and
  `web/scripts/lab_tools.js` — Lab Map viewer and editor.
- `web/scripts/inventory_ui.js` and `web/scripts/inventory_list.js` — inventory
  display, editing, search, and map locations.
- `web/scripts/shelf.js`, `web/scripts/shelf_model.js`, and
  `web/scripts/shelf_decor.js` — shelf views and editor behavior.
- `web/scripts/common.js`, `web/scripts/draft_manager.js`, and
  `web/scripts/editor_recovery.js` — shared authentication, saves, drafts,
  undo/redo, and recovery behavior.

## Optional local development

The local server is useful only when deliberately testing local JSON-backed
behavior or developing without a Vercel deployment. It is not the production
verification path:

```bash
python3 lab_server.py
```

Open `http://localhost:8000/`. Do not use `python3 -m http.server`; it cannot
provide this application’s API, login, or saving routes.

## Regression tests

The `tests/` directory is retained as local regression coverage for map,
inventory, shelf, dashboard, and backup behavior. Tests and historical docs are
excluded from Vercel’s function bundle and are never served to visitors.

For local maintenance only:

```bash
python3 -m unittest discover -s tests -v
```

Browser checks require their local browser tooling and are not required for a
normal production content or styling update. Production verification remains the
deployed Vercel URL above.

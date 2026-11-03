# ITR Lab Visualizer

An editable CSS-grid lab floor plan and structured inventory, with shared password-protected editing. LAB MAP and LAB INVENTORY use the same item and stock records; shelf matrices describe physical layout. Python 3 is the only runtime dependency. The new editors use no external libraries or CDNs.

## Run

Stop the old `python3 -m http.server` process with **Ctrl+C**, then run this from the project directory:

```bash
python3 lab_server.py
```

Open **http://localhost:8000/**. The root page opens the red **Lab Explorer**. Signing in switches to the blue **Lab Editor**.

Click **Admin login** and enter **`itr`** to edit. Anyone can view; the server requires an authenticated admin session for every save. Keep the terminal running. Press **Ctrl+C** to stop it. After application updates, restart the server to load its updated API and asset routes.

If port 8000 is occupied, stop the old server or use:

```bash
python3 lab_server.py --port 8001
```

Then open **http://localhost:8001/**. Do not use `0.0.0.0` as a browser address.

**The old static-server command and opening HTML directly do not support the editors' loading, login, or saving APIs.**

### Share on your lab network

```bash
python3 lab_server.py --host 0.0.0.0
```

Other computers should open `http://<server-computer-LAN-IP>:8000/`. They see the same files and can sign in with the same admin password. This is a local/LAN development server; use HTTPS and a production deployment before exposing it to the internet.

To change the starting password, set `ITR_ADMIN_PASSWORD` before starting the server:

```bash
ITR_ADMIN_PASSWORD='your-new-password' python3 lab_server.py
```

## Project and Treasury Dashboards

### Member accounts with Neon

Project creation now requires a member account. Members sign up with a name,
email, and a password of at least 12 characters. Passwords are salted and hashed
with PBKDF2-SHA256 (600,000 iterations); plaintext passwords are never stored.
The project submission stores the authenticated account ID, name, and email as
the project owner, and the dashboard pre-fills the lead and contact fields.
Sessions are stored in Postgres, so they survive a server restart.

To create the required database through Vercel:

1. In the Vercel dashboard, open **Marketplace**, install **Neon**, create a
   Postgres database in a region near the lab, and connect it to this project.
   Vercel injects the connection string as an environment variable. See the
   [Vercel Neon Marketplace guide](https://vercel.com/marketplace/neon/neon).
2. Confirm the injected variable is named `DATABASE_URL`. If the integration
   gives it another name, add a sensitive `DATABASE_URL` variable whose value is
   the Neon connection string. Set it for Production, Preview, and Development;
   Vercel documents the environment scopes in its
   [environment-variable guide](https://vercel.com/docs/environment-variables).
3. For local development, install the optional Postgres driver and export the
   same connection string (do not commit it):

   ```bash
   python3 -m pip install -r requirements-local.txt
   export DATABASE_URL='postgresql://…'
   python3 lab_server.py
   ```

   With `DATABASE_URL` set, startup creates `itr_users` and `itr_sessions`
   automatically. Create a member from **Project Dashboard**, then submit a
   project to verify the connection.

4. In **Treasury Dashboard**, sign in as the treasurer, open a project, and use
   **Delete project** to permanently remove a test project and its treasury
   record. The action checks both current revisions before deleting, preventing
   a stale tab from removing a newly changed project.

This repository's existing Python server and map/inventory/project documents are
file-backed, so they are intended for a persistent server or local/LAN use. Neon
is now the durable account/session database. Before deploying the *whole current
application* to Vercel serverless, migrate the remaining `data/*.json` write
paths (projects, treasury, inventory, layouts) to Postgres or another durable
store: Vercel function filesystems are not persistent. Do not deploy this
file-writing server unchanged and assume its JSON data will survive requests.

Vercel's Marketplace can provision Neon and inject credentials automatically;
the [storage integration documentation](https://vercel.com/docs/marketplace-storage)
describes that flow.

The navigation now includes **PROJECT DASHBOARD** and **TREASURY DASHBOARD**.
Anyone can submit a project request in Project Dashboard; it does not require an
account and it never reserves, subtracts from, or otherwise changes LAB INVENTORY.
Every request requires a project lead/contact, a stage (**Idea**, **Planned**, or
**Procurement-ready**), and a best current cost estimate. Idea-stage estimates may
be rough, but must include an amount, currency, confidence, and short basis. A
Procurement-ready request also requires an itemized purchase list with quantities
and unit prices. Item names offer read-only inventory suggestions; recorded stock
must still be verified before relying on it.

Project submissions are stored separately in `data/projects.json`. Their technical
request and estimate remain separate from treasurer-only review fields in
`data/treasury.json`, so a funding decision never rewrites a team's request.
Both documents have independent revision history under `data/history/projects/`
and `data/history/treasury/`, use the same atomic journal as the rest of the app,
and are included in a full lab backup.

The treasurer account can view project contacts, estimated costs, purchase items,
and make a planning record with a review status, period, funding source, approved
amount, and private notes. It cannot edit the map or inventory. Administrators can
also use Treasury Dashboard. The default local development credentials are:

```text
Treasurer username: treasurer
Treasurer password: treasury
```

Change these before a shared deployment:

```bash
ITR_TREASURER_USERNAME='lab-treasurer' \
ITR_TREASURER_PASSWORD='choose-a-strong-password' \
ITR_ADMIN_USERNAME='admin' \
ITR_ADMIN_PASSWORD='choose-a-strong-password' \
python3 lab_server.py
```

The Treasury Dashboard is a planning and approval workspace, not an accounting
ledger. It deliberately keeps requested estimates and approved amounts distinct;
a future ledger can reference project IDs without changing their request or review
history. Totals are shown separately by currency—no exchange-rate conversion is
performed automatically.

## Inventory: presence first, optional detail

**LAB MAP** and **LAB INVENTORY** use the same item and stock records. Most entries
need only a name. **Presence** means an item is at a location, with no count or price
required. Inventory names use compact wrapping entries. In LAB INVENTORY, click a
name to locate it on LAB MAP; use the adjacent pencil to edit as an admin. A separate
**Details** disclosure appears only for meaningful information, including zero counts
and prices. Names, locations, internal metadata and default presence values do not
create empty disclosures. Optional fields in the editor start collapsed;
blank quantity and price remain unknown. Existing detailed records retain their data.
Approximate availability remains supported in optional details.

For fast entry, sign in, click a shelf on **LAB MAP**, and type in **Add inventory…**.
On a Complex shelf, click a bin in the preview first. Press Enter or the adjacent
**Add** button. The saved entry appears immediately and the input stays focused for
the next name. Simple shelves offer direct shelf inventory; Complex shelves keep
one **Inventory** overview containing both direct shelf stock and bin inventory.
Selecting a bin switches that same section to **Selected Inventory**. Clicking an
overview entry selects its only bin and expands real details; entries in multiple
bins offer a compact location choice. **Clear bin** returns to the overview. Quick
entry adds to the shelf in the overview and to the selected bin otherwise. The preview includes decor and cannot move or resize bins.
Use **Open Shelf Editor** for structural changes. Read-only visitors can select bins
and inspect the same compact rows without editing controls.

Save a newly created location in a named layout before recording stock there.
Quick entry trims blank input, handles input-method composition, blocks simultaneous
submissions and reuses its operation ID after uncertain saves. A single exact-name
match already at the destination is returned without changing its details or quantity.
Several distinct same-name entries require choosing an identity from their details.
Quick entry never splits commas or merges similar names across locations. To record
an existing item elsewhere, open its item details and choose **Add this item to
another location**, or use **Item identity** in optional details.

In **LAB INVENTORY**, choose **Add inventory**, type a name and select a destination
on the visual lab map. Click a Simple shelf directly; a Complex shelf opens a bin
preview and provides **Use this shelf** for direct shelf stock. **Back to lab map**
lets you switch destinations while preserving the name and optional details. Tables,
machines and carts are also destinations. Walls, doors, sections, arrows, text and
Misc decorative markers cannot hold stock. The optional location selector supports
Unassigned and recovery of unmapped entries. Moving or renaming an object preserves
its stable inventory link; deleting it preserves its stock as unmapped.

Inventory saves immediately, independently of named layout saves. Both views refresh
the same records. Other tabs receive an update signal; **Refresh inventory** checks
other browsers. Stale detailed edits retain the form and require reviewing the latest
record. A stale quick entry refreshes inventory and offers a retry of the retained name.
Detailed forms and transfers have session/tab-scoped browser recovery. Inline quick
entry retains failed text in the open panel but does not persist unsaved typing across
reloads. Save entries before leaving the page.

Exact quantities and prices use decimal strings. Estimated value is shown only when
stock units and price units agree, rounded for the recorded currency. Values never
combine different units or currencies. **Transfer quantity** atomically moves a known
exact amount; **Edit stock / relocate** moves other entries as a whole. **Archive**
keeps an entry and its quantities for review/reactivation. In the edit interface,
**Remove from this location** removes only that item’s assignments at the selected
location. **Delete permanently** removes the item and all active and archived
assignments, with one confirmation naming the item and affected locations. These
actions require an admin session and the current inventory revision; stale edits
cannot recreate deleted identities. Deletion first checkpoints the saved lab, retains
audit snapshots and reports, and stores a technical deleted-identity marker outside
active inventory. **Manage locations** opens the existing location management view.
Layout undo, restore and copying never undo stock changes or copy inventory. Copying
bins or shelves assigns fresh structural IDs; original stock remains at its source.

Clicking an inventory name highlights its distinct mapped location associations by
stable identity. Exactly one recorded mapped destination opens its panel automatically,
selects its bin when applicable, and centers it at a useful zoom. Several locations
highlight together and offer destination choices; multiple bins on one shelf open
that shelf’s overview without selecting an arbitrary bin. Unavailable locations are
explained. An item with mapped and unavailable associations offers an explicit choice.
Desktop focus reserves the drawer width; narrow screens use a bottom drawer. The map
remains pannable and zoomable. **Clear highlighting** exits the location view and
restores previous visibility, zoom and map scroll. This state never changes geometry.
Rapid navigation invalidates pending requests for earlier destinations.

Map search returns concise destinations such as **Hardware Shelf · Motor Bin**.
Each bin result opens that specific bin. Shelf names, notes/keywords, bin names and
inventory information remain searchable; a shelf-metadata match opens the overview.

## Anonymous shelf reports

Each shelf panel has one **Report incorrect information** action. Any visitor can
submit a description without an account, name or email. A selected bin can optionally
be included as context. A successful submission confirms receipt; failures retain the
text. Reports never change inventory automatically.

Admins see **Shelf reports · N pending** in the header. Open it to review the shelf,
optional context, text, local submission time and status. **Open location / editing
controls** navigates to the affected shelf; **Resolve** and **Dismiss** keep the report
with its status. Renamed locations use their current label; removed locations retain
original context. The indicator refreshes on focus and every 30 seconds while logged
in. Review data and status changes require admin authorization. Report text is rendered
as text, limited to 2,000 characters; the server allows five submissions per minute
and twenty per hour per network address. Addresses are not stored in report records.
Retries and accidental identical repeats within five minutes do not create duplicates.

## Inventory storage, migration and coordinated recovery

Layouts remain in their existing JSON files. Structured records live in
`data/inventory.json`; audit snapshots live in `data/history/inventory/<revision>.json`.
JSON reuses the server lock and `pending-save.json` atomic-write/roll-forward journal,
so inventory and its audit snapshots commit together. Pending transactions finish
on startup or an authorized write retry. Reads return an error while recovery is
pending and never change saved data or expose partial files. Location status is derived from geometry, so deleting or
restoring layout needs no second stock transaction. SQLite would add a second
transaction/backup system without improving this first version; no runtime dependency
or geometry-storage rewrite is introduced.

Startup first assigns missing stable bin IDs in current shelf files, preserving
existing identities, geometry and revision numbers. Historical snapshots remain
unchanged. Before writes, the server checkpoints `data/` and `defaults/` under
`../.itr-backups/`, then uses the existing atomic save journal.

The one-time **bin-contents migration** converts current comma-separated bin contents
into presence entries at their original bins. It trims whitespace, ignores empty
segments and treats prose without commas as one name. It includes dormant bins and
retained unplaced shelf files without treating them as mapped locations. Existing
structured entries are never split or overwritten. An unambiguous equivalent entry
at the bin is skipped; ambiguous identities and overlong names are retained for review.
Bin names do not create or rename items, and keywords never create stock.

Original contents and keywords are recoverable in `data/bin-contents-migration.json`
and the `before-bin-contents-*.tar.gz` checkpoint. **Inventory activity** displays
converted, skipped-duplicate and review counts and provides an admin-only source
record download. Bin Contents/Keywords editing and display are retired; shelf-level
notes and keywords stay available. Blank default “New bin” labels display as “empty”
regardless of geometry/style, while inventory and meaningful metadata preserve labels.

The migration marker makes restarts safe. Keep it with the inventory in every backup.
Old imports and layout restores retire competing bin fields into recoverable
`legacyBinText`, never convert historical prose into new stock and never reverse real
stock edits. Shelf imports assign fresh bin IDs. Deterministic legacy IDs reconnect
old locations only when their original shelf/anchor/legacy document identity agrees;
ambiguous locations remain available for explicit relocation.

**Before updating a running server, save or export your active layout drafts and save
inventory entries. Restarting loses authenticated sessions and RAM drafts.** Then start
`python3 lab_server.py` normally; migration is automatic and checkpointed. Development
checks never operate on your populated data.

Use **Download full lab backup** (admin only) in LAB INVENTORY for a coherent saved
snapshot of layout, every shelf file including unplaced shelves, structured inventory,
map and inventory histories, migration sources/marker, anonymous reports, and defaults. It excludes private unsaved drafts. The JSON
is labelled `itr-full-backup`; Export JSON in map/shelf editors contains geometry and
notes only. Audit downloads are reference snapshots, not complete recovery backups.
Alternatively, save drafts, stop the server, and copy `data/` and `defaults/` together;
include any pending journal when recovering an interrupted save. Retain the external
migration checkpoint separately. Do not restore only an inventory file over a different
layout and assume its missing locations have been recovered.

To recover a downloaded full backup, validate and restore into a **new directory**:

```bash
python3 restore_backup.py /path/itr-full-lab-backup.json /path/recovered-lab
python3 lab_server.py --data-dir /path/recovered-lab/data --defaults-dir /path/recovered-lab/defaults --port 8001
```

The restore tool validates every document/path and stock record before writing,
rejects incomplete or malformed backups and existing destinations, and publishes
only a complete recovered directory. Review the recovered server before deliberately
switching your usual server to those paths. The original data directory remains
available. Full recovery deliberately restores the backed-up stock state; ordinary
layout restoration does not. Inventory activity and audit snapshots let you inspect
older counts and make an explicit current correction without rolling stock backward.
Do not run multiple server processes against the same data directory. No Python
packages or runtime dependencies have been added.

## Explore the lab (View Only)

Visitors see **Lab Explorer**, a red interface with technical UI typography and the map's original item fonts/colors. **Admin Login** and **View Only** remain visible. Editor sidebars, coordinate fields, export, history, and save controls are hidden.

Click a shelf to open a read-only information drawer. Simple shelves show shelf metadata; Complex shelves show the physical grid, including half-cell bins. Complex shelves initially fit the whole grid in the viewing area. Use **+ / −** to inspect bins and **Fit shelf** to return to the overview; zoomed shelves can be scrolled. Click or focus a bin to select it and view its compact inventory below the map. No separate bin cards or bin keyword fields are shown. The grid cannot be edited in View Only. Click a section to see its area, access status, and contained items. Close the drawer with **Close** or **Escape**; the map remains interactive while the drawer is open.

The grouped **Sections**, **Paths**, **Storage**, **Tables**, **Carts / seating**, and **Machines / tools** checkboxes only affect visibility. Hidden objects have no map hit targets. They never modify saved data. Search matches partial text without regard to case, including shelf names, shelf notes/keywords, bin names, and shared inventory metadata. Matching results can be opened directly. Narrow screens support horizontal map scrolling and zoom.

## Edit normal items (Admin)

- Use **Add to Lab** at the top of the sidebar for shelves, tables, carts/seating, machines, walls, and labels.
- The **Item Directory** groups these types into independent collapsible categories. Search reveals matching groups without changing your normal collapse preferences.
- Select an item to edit its name, position, dimensions, colors, font, or position lock. Area is computed from the item center and the current section names. When sections overlap, the smallest containing section wins, then section ID breaks ties; outside sections the value is Lab. Drag unlocked items or use arrow keys to move by one cell.
- Equipment cannot overlap other equipment or leave the outline. It may be dragged across walls and doors, but an invalid final placement is reverted. Paste uses the same validator. Labels wrap between whole words and shrink to fit their boxes, so words such as “Table” are not split across lines.
- Use **Ctrl/Cmd+C** and **Ctrl/Cmd+V** to duplicate a selected normal item into nearby clear space. Copies have new IDs. Copied shelves retain bins, decor, style, descriptive notes and keywords, with fresh child bin IDs, and save to separate files. Structured inventory assignments and quantities are excluded; source stock is unchanged. Text fields retain normal copy/paste.
- Sections, interior walls, doors, and arrows are map-level elements. Their controls and direct editing are unavailable in normal item mode.

Editor groups use short ease-in/ease-out transitions, respect reduced-motion preferences, and remove collapsed controls from keyboard/pointer interaction.

## Lab Map Editor

As an admin, click **Lab Map Editor** in the header. Normal item controls disappear; physical items remain dimmed as context and cannot be dragged. Use the map groups to edit:

- **Outline & grid:** click a vertex, drag it, or use arrow keys for one-cell movements. Selected-point X/Y inputs and the full coordinate list stay available. Use **Delete point**, Delete/Backspace, or **Insert point after selected**. At least three distinct points with nonzero area must remain inside the grid. Arrow keys do not edit the map while typing.
- **Center lab in grid:** after applying larger grid dimensions, use this button in **Outline & grid** to center the whole floor plan. It moves the outline, all items (including locked items), sections, arrows, walls, and doors together, preserving their spacing and shelf inventories. Movement snaps to whole cells, so opposite margins may differ by one cell. Undo reverses it; Save changes records it as a named version.
- **Sections:** select an existing section or **Add section**. Edit its name, colors, fonts, and hatching. Existing section positions start locked; uncheck **Lock position and size** before moving/resizing. Section labels are placed in available space to avoid equipment.
- **Interior walls:** enter start/end grid coordinates and thickness, then **Add wall**. Select a wall to drag it, drag its endpoint handles, use arrow keys, or edit coordinates and **Update wall**. **Delete wall** removes it.
- **Doors:** enter hinge coordinates, radius (1–20 units), and one of four swing quadrants (NW, NE, SW, SE), then **Add door**. Select it to drag, move with arrow keys, change radius/orientation with **Update door**, or delete it. The quarter-circle swing footprint is reserved against final equipment placement.
- **Traffic arrows:** use the controls described below to move or reshape routes.

**Leave Lab Map Editor** returns to item editing and removes map-editing hit targets/handles. Changes remain in your instance draft until you explicitly save a named version. Login/logout and visibility/theme changes do not rewrite the saved lab.

The initial outline and placements remain the existing grid interpretation of the supplied floor-plan sketch, not a surveyed architectural drawing.

## Reset and saved-version history

Click **Version history / reset** in the lab toolbar. Select **Original layout** or a timestamped saved revision, then click **Restore selected layout**. Admin login is required to restore.

Restoring loads the selected layout into this editor instance’s draft. Undo/redo of a version restore also switches its associated shelf-layout draft through private backend memory; those memory references are excluded from saved/exported files. It does **not** write to disk or add a version. Opening history, Undo, Redo, and Reload saved also do not add versions. New saved versions also restore their shelf layouts and descriptive notes into the private draft. Structured item/stock records have independent history and are never restored by a map operation. Original and older map-only versions preserve the current shelf layouts because they have no shelf snapshot. Click **Save changes**, enter a version name, and click **Save version** to make the draft persistent. Saved versions show their names in the history menu.

History is persisted in `data/history/lab/` and survives browser reloads and server restarts. The original floor plan is kept separately in `defaults/lab.json`. History starts with the layout saved when this feature was added; older, previously unrecorded revisions are not available. Back up `data/` and `defaults/` together.

## Edit traffic arrows

Inside **Lab Map Editor**, select a red dotted arrow or choose it in **Traffic arrows**. You can:

- Drag the line to move the entire arrow, snapping to whole grid cells.
- Drag circular handles to move endpoints or bends, snapping to tenths of a cell.
- Edit the **Route points** coordinates and click **Apply points**. Add or remove lines to add or remove bends (at least two points are required).
- Use arrow keys to move the selected route, **Reverse arrow** to change direction, or **Delete arrow** to remove it.
- Click **Add arrow** to create another route.

Arrow changes remain in the draft and support Undo, Redo, and version restore. Coordinates start at zero and must remain inside the grid. The **Paths** checkbox controls visibility only.

## Edit a shelf

1. As an admin, select a shelf to view inventory, or click **Open Shelf Editor** for structural changes. Lab drafts are cached before navigation.
2. New shelves default to **Simple**: enter **Shelf name**, **Shelf descriptive notes**, and **Keywords**. The canvas supports visual Shelf Decor; inventory bins remain hidden until Complex mode.
3. To lay out bins, choose **Complex** in **Shelf mode** and click **Apply mode**. This activates the existing matrix editor.
4. In Complex mode, select an empty half-cell to **Add bin here**, or edit an existing bin's name, position, size, and style. Bin contents are the shared inventory entries; there are no bin Contents or Keywords inputs. Dragging and arrow keys snap to 0.5 units; dimensions use 0.5 steps with a minimum of 1. **Ctrl/Cmd+C/V** copies the selected bin with its metadata/style into the nearest valid space, or refuses if the shelf is full. Matrix resizing preserves bins.
5. Switching either way preserves all metadata and every bin. Dormant bins remain stored in Simple mode. Their structured inventory remains searchable in LAB INVENTORY and map inventory search; item details can expose a retained bin or relocate its stock. Legacy bin prose is preserved in migration/recovery data; current inventory is searchable in both views.
6. Save a named version and reload to share and verify the shelf contents.

Each layout editor opens its saved contents or recovers its cached draft for this instance. **Save changes** (or Ctrl/Cmd+S) opens a version-name dialog; only confirming **Save version** writes changes to disk. Canceling the dialog leaves the draft unsaved. Saving from either editor commits the instance’s lab and included shelf drafts as one named lab version, while keeping shelf layouts in independent files. This includes layout edits cached while moving between editors. Saved versions capture the corresponding matrices and descriptive notes. Structured inventory uses its separate Save inventory workflow. Other browsers see saved data, not your draft.

**Undo**, **Redo**, **Export JSON**, and **Reload saved** are available in both editors. Shelf JSON can also be imported as structure and descriptive notes. Every imported bin gets a fresh ID; existing stock remains linked to its former locations and is discoverable as unmapped when those locations are absent. Imports never import stock or quantities. Undo can recover the replaced location identities before saving. If another admin has saved the same lab or shelf since you loaded it, saving is blocked rather than overwriting their changes. Export your draft, then reload the latest version to reconcile it.

## Instance memory and Undo

Each signed-in browser tab has an independent lab draft and independent shelf drafts. The backend caches the draft plus up to **40 Undo/Redo steps** in RAM, keyed by login session, tab instance, and editor. Another tab does not automatically load that working copy; **Manage drafts** can list and delete working copies across tabs in the same authenticated session. Other login sessions cannot access them.

- **Ctrl/Cmd+Z** undoes a grid edit; **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redoes it. When typing in a field, the browser’s normal text undo remains available.
- Draft caching happens shortly after edits and is flushed before editor navigation. Caching never creates a persistent version.
- Drafts are temporary: server restart, logout, session expiry, or eight hours without cache updates clears them. A fresh tab starts a new instance. Use a named save or Export JSON to retain work permanently.
- A saved version is shared; a cached draft is private to its instance. Save-conflict checks still prevent overwriting another admin’s newer saved version.

### Shelf Decor

**Shelf Decor** in the shelf sidebar adds rectangles/squares, circles/ellipses, and triangles. Drag a shape to move it and use its bottom-right handle or width/height fields to resize. Positions and dimensions snap to quarter-cells, with a minimum size of 0.25 cells. Arrow keys move selected decor by a quarter-cell. Outline thickness (0–20 px), outline/fill/text colors, and optional wrapping text are editable. Delete Decor or Delete/Backspace removes only the selected shape; typing fields retain normal keyboard behavior.

Bins stay above decor. If a bin covers a shape, select the shape from the sidebar. Turn off **Edit decor on canvas** to reach empty cells under shapes. Use **Ctrl/Cmd+C/V** to copy selected decor, including appearance and text, into a nearby quarter-cell position. Pasted shapes get fresh IDs and become selected; Undo/Redo, recovery, export and named saving work normally. Decor may overlap bins and other shapes. A shape filling the whole canvas has no distinct nearby paste position; an oversized shape or the 200-shape limit is explained without changing the draft. Copying a bin replaces the decor clipboard and vice versa; clipboard contents are local to this shelf page and cleared on logout/reset/reload. Text fields keep normal copy/paste.

Decor belongs to the shelf, remains in both modes, and appears read-only in the Explorer with bin tooltips still available. Canvas shrinking cannot cut off bins or decor.

Shelf JSON gains an optional `decor` array of objects with `id`, `shape`, `x`, `y`, `w`, `h`, `text`, `outlineWidth`, `outlineColor`, `fillColor`, and `textColor`. Coordinates are zero-based shelf cells. IDs are unique within a shelf. Existing files without decor need no migration. Decor is excluded from inventory indexing/search and is preserved by shelf export/import, copies, drafts, named saves, and versions. Rendering is shared in `shelf_model.js`; `shelf_decor.js` adds editing behavior.

### Delete temporary drafts

Open **Manage drafts** from either editor, choose **Delete Draft**, and confirm with the red button. Cancel or Escape makes no change. Deletion removes exactly that session/tab/resource working copy from backend memory and its browser recovery record. It never removes saved JSON, inventory files, or version history. Deleting the active copy loads the latest saved state; deleting the last copy leaves an empty list. A draft-only shelf falls back to its blank inventory while its parent map draft still exists, or returns to the lab if it no longer exists. Other drafts remain untouched. Server deletion counters prevent late writes or stale recovery records from recreating deleted drafts; subsequent deliberate edits can create a new working copy.

### Refresh recovery

`editor_recovery.js` keeps a small localStorage safety copy of each working document after meaningful edits and drag-end, before the delayed server cache write. A pending text-field edit is flushed through its normal change handler on refresh. Keys are scoped by browser origin, a server-provided project/session identifier, tab instance, and lab/shelf resource. Records include format, timestamp, committed lab revision, document revision, and draft-deletion counter. UI recovery includes editing mode, zoom, scroll, and expanded groups; selections are cleared.

On load, authentication and recovery context are established first. The map recovers before inventories so newly added shelves can load. Pending browser copies pass the existing server draft validation before the working document is displayed and editing is enabled. Normal server drafts retain undo history; the emergency browser copy preserves current data rather than duplicating the full undo stack. Invalid, expired (eight hours), deleted, or older-revision snapshots are ignored. Storage failures show a warning and leave server caching available.

Successful **Save changes** clears the committed browser copies and preserves edits made during the save. Failed saves retain recovery data. Intentional logout clears browser recovery for that login session, discards its server drafts, and loads committed visitor data. Recovery creates no saved versions. Because sessions remain temporary and are held in server memory, this is refresh protection during an active session, not a replacement for saving/exporting before logout, session expiry, or server restart.

When updating the running application, save or export active work before restarting `lab_server.py` to load new API routes. Development tests use disposable data and do not restart your live server.

## Files and matrix format

- `inventory.py`, `inventory_ui.js`, `inventory_list.js`, `lab_inventory.html` — Shared item/stock model, quick entry, visual destination picker, compact rows and map highlighting.
- `reports.py`, `data/reports.json` — Anonymous submission validation and durable admin review.
- `data/bin-contents-migration.json` — Conversion marker, original bin prose and review summary; include in backups.
- `restore_backup.py` — Validated full-backup recovery into a new directory.
- `data/inventory.json`, `data/history/inventory/` — Stock records and independent audit snapshots.
- `lab_server.py` — Dependency-free Python server, admin sessions, validation, revision checks, and atomic JSON writes.
- `lab_overview.html`, `lab.js`, `lab_tools.js` — Main lab editor, traffic arrow tools, and restore controls.
- `shelf_editor.html`, `shelf.js`, `shelf_model.js` — Simple/Complex shelf interface and backward-compatible model helpers, opened with a shelf ID such as `shelf_editor.html?id=R01`.
- `map_editor.js` — Explicit map-editing mode and interactive outline controls.
- `map_elements.js`, `map_geometry.js` — Wall/door tools, logical collision geometry, and derived section containment.
- `explorer.js` — Read-only shelf/section drawers and search results.
- `editor_groups.js` — Accessible animated collapsible groups.
- `common.js`, `editor.css` — Auth, named saves, draft history, shared styling, and distinct themes.
- `data/lab.json` — Lab grid, sections, fixtures, footprint, paths, interior walls, and doors.
- `data/shelves/R01.json`, `R02.json`, etc. — **One independent file per shelf**, initially 34 rows × 30 columns. New files default to Simple mode while retaining an empty matrix for optional Complex use.
- `shelf_inventory_editor.html` — Original standalone editor, retained unchanged as a legacy reference. Its JSON format differs from the new matrices, and it does not use shared admin saving.

Each matrix cell is either `null` or a bin object. A bin is stored at the integer cell containing its top-left corner. Optional `offsetX`/`offsetY` values of `0.5` place that corner halfway through the cell (omitted means zero). Width/height and positions accept 0.5 increments, with each dimension at least 1. Covered cells remain `null`. No overlapping bins are allowed. A small complete shelf file looks like:

```json
{
  "id": "R01",
  "revision": 0,
  "schemaVersion": 3,
  "mode": "complex",
  "name": "Hardware shelf",
  "contents": "Fasteners and small parts",
  "keywords": "assembly",
  "rows": 2,
  "cols": 3,
  "matrix": [
    [{"id":"B-fasteners","name":"Fastener bin","w":2,"h":1,"background":"#dc4545","color":"#ffffff","fontSize":14,"fontFamily":"system-ui","bold":true}, null, null],
    [null, null, null]
  ]
}
```

Legacy matrix-only shelf files are normalized in memory: populated matrices become Complex; empty matrices become Simple. Missing metadata gets safe defaults, with the lab label as the legacy shelf-name fallback. Reads never rewrite the source file; an explicit named save writes the new fields. Startup performs the checkpointed bin-ID and bin-contents migrations described above, without rewriting historical snapshots or resetting revision numbers. Complex grids are retained even in Simple mode. Existing lab section entries remain in their legacy JSON representation for compatibility, while the UI treats them exclusively as map structure.

Supported fonts are `system-ui`, `Arial`, `Georgia`, and `monospace`. Colors are six-digit hex strings. Font sizes range from 6–96; rows and columns range from 1–60. Each shelf file stores one matrix row per line for easier manual editing.

Prefer the editor or JSON import for changes. If hand-editing files while browsers are open, increment `revision` so stale browser drafts cannot overwrite those changes. **Reload saved** after editing a file. Back up `data/` and `defaults/` together, or download a full lab backup from LAB INVENTORY. This includes `inventory.json`, `bin-contents-migration.json`, `reports.json` when present, and both history trees; a layout export alone is not an inventory backup.

New shelf files are created when the lab is explicitly saved; saving a new shelf from a cached lab draft can also create its file. Removing a shelf from the map retains its inventory file; Undo or restoring an item with the same ID reconnects it. A shared HTML editor loads the selected shelf file; there is no duplicated HTML per shelf.

## Development checks

Running the application still requires only Python: `python3 lab_server.py`. Node, npm,
Prettier, ESLint, and Playwright are optional development tools; there is no build step.
Do not use a live lab server for testing or restart it with unsaved work.

For formatting and linting, install Node.js 22.13+ (22.x) or 24+ (with npm), then run from
the project root:

```bash
npm ci --ignore-scripts
npm run format:check
npm run lint
```

`package-lock.json` pins the development dependencies. `npm run format` applies
Prettier to the same explicit scope: the three active HTML pages and their 15
first-party JavaScript files, listed in `package.json`. It excludes data, defaults,
history, the legacy standalone editor, CSS, documentation, and installed/generated
files. `.prettierignore` also limits formatting to this approved source list.
Strict HTML whitespace handling intentionally places some tag brackets on adjacent
lines to preserve inline spacing; embedded-language formatting is disabled to
preserve inline code and template contents.

Lint runs without autofix. `eslint.config.mjs` models each page's classic-script
loading group and derives shared globals only from actual top-level declarations.
Update those groups and the explicit package script lists when adding or removing
an active script. The configuration itself uses a separate Node environment.
The small rule set catches undefined names, invalid global assignments, duplicate
arguments/keys/cases, unreachable code, invalid regular expressions, and invalid
`typeof` comparisons; it does not enforce another formatting style.

### Backend tests

No Node or third-party Python packages are needed:

```bash
python3 -m unittest discover -s tests -v
```

With development tooling installed, `npm run test:backend` runs the same command.
This verifies the backend only, not browser behavior.

### Browser tests

Optional browser verification requires Playwright and Chromium. For example:

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser_smoke.py
python3 tests/run_browser_suite.py
```

On Linux, Chromium also needs its system libraries; if they are missing,
`python3 -m playwright install-deps chromium` installs them and may require
administrator access. Keep the virtual environment activated when running the
npm test commands so `python3` resolves to the environment with Playwright.

```bash
npm run test:browser
npm test
```

`test:browser` runs the standalone smoke script, then the browser suite. The suite
runs each distinct inherited test once and deliberately excludes the smoke script.
`npm test` runs backend tests followed by both browser entry points. These commands
stop and return a failure when a command fails; missing Playwright or Chromium is
not a browser pass. Report any skipped checks separately from a complete result.

Tests use disposable fixture data and independent servers on randomly assigned
local ports. They cover saved versions, draft recovery/deletion, shelf modes and
decor, copying, undo/redo, exports, map geometry, visitor/Admin controls, and
responsive layouts. They do not write to the populated `data/` or `defaults/`
directories. Browser screenshots go to the system temporary directory.

## Geometry and saved-state details

Normal map zoom ranges from **75% to 300%**; temporary inventory focus can fit multiple destinations below 75%. The normal minimum is 25% smaller than the old 100% minimum. Fit returns to 100%. Panning uses the viewport scrollbars, and all editing converts pointer positions through the actual rendered map bounds.

Interior `walls` are arrays of `{id, a: [x,y], b: [x,y], thickness}`. `doors` are arrays of `{id, x, y, radius, orientation}` with hinge coordinates and NW/NE/SW/SE orientation. Missing arrays mean no elements and are not added merely by reading an older file. They save with the map and appear read-only outside Lab Map Editor. Legacy rectangular wall items still load separately.

Shelf schema 3 retains the matrix and adds optional half-cell offsets and bin IDs (new/duplicated bins get fresh IDs); integer bins and schema 2/legacy files remain valid. For a six-unit shelf, four bins of width 1.5 have anchor columns 0, 1, 3, and 4, with offsetX values 0, 0.5, 0, and 0.5. Both shelf views use doubled CSS grid tracks so half-unit positions and sizes remain exact. Bin collisions compare logical rectangles, not integer occupancy or rounded pixels.

Wall placement uses the grid line as the boundary: items can sit flush against it without leaving an empty cell for the painted stroke. A wall may not pass through an item’s interior, and an item may not be completely contained in a thick wall’s body. Doors reserve the interior of their quarter-disk swing. Items can touch its straight sides or curved boundary without an extra clearance cell; the decorative stroke does not block placement. These checks are shared by normal placement and paste. Visibility does not change collision constraints or persistent geometry. The display layers put paths, walls, and doors below equipment, with editing handles above it.

Named versions contain both `layout` and `shelves` snapshots. Saves validate all included shelf revisions before writing. A disk journal (`data/pending-save.json`) allows an interrupted, explicitly requested save to finish on the next server start; atomic file replacement and the server lock prevent normal requests from seeing partial saves. Do not edit the journal manually. No shelf snapshot can reconstruct shelf changes that were already lost before this fix.

## Misc markers

In **Add to Lab**, choose **Misc item**, then **Add item**. Use these for fire extinguishers and other map annotations. Choose **Square**, **Line**, **Triangle**, or **Circle**; adjust width/height, shape color (Background), and text styling. **Show text label** toggles the label while keeping the name available in search and the information panel. Lines also have direction and thickness controls.

Misc markers can overlap equipment, walls, doors, other markers, and areas outside the floor-plan outline, anywhere within the map grid. They do not block equipment placement. Dragging, arrow keys, copy/paste, undo/redo, named saves, and read-only viewing work as for other items. The **Misc items** visibility checkbox hides markers without changing saved data.

Misc shapes stretch to their grid width and height: squares become rectangles and circles become ellipses. Select a misc item to edit its outline color and thickness (0 hides the outline). Line outlines surround the colored line.

Select a shelf in the lab editor to edit its **Location ID**. This searchable label
appears in the directory, panels and shelf editor. Readable labels such as R08 and
L01 stay unchanged. Startup checkpoints the lab and backfills generated shelf IDs
with unused S-1, S-2, … labels, preserving internal IDs, filenames, revisions and
inventory/report links. The repeatable migration changes current presentation only;
it does not rewrite historical layouts. `data/location-labels.json` reserves labels
for saved, copied, draft and retained shelf identities. Allocation and collision
checks run under the server lock. Restored layouts recover an identity’s own label
or receive an unused label if an imported label belongs to another identity. Moving
or renaming a shelf keeps its label. Explicit label edits reject collisions. Location
labels and misc styling support undo and become persistent with Save changes.
Include the registry with full backups; older backups acquire it on startup.

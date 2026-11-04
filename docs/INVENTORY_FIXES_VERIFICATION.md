# Inventory presentation and navigation fixes

This change builds on the pre-existing working tree. It does not reset the lab,
replace stock identities, copy stock into new records, or change shelf filenames.
The original README and applicable instructions were inspected before editing;
there were no repository AGENTS.md files. The initial working-tree patch and
source-relative review diffs are under `/tmp/itr-six-fixes/`.

## Separately verified changes

1. **Search destinations:** reproduced the noisy shelf-level motor result, then
   added destination identities to the existing index. Bin names and stock matches
   resolve to exact bins; shelf metadata matches resolve to the overview. Search
   tests passed before proceeding to panel changes.
2. **Shelf panels:** reproduced two inventory sections. One compact section now
   contains the whole shelf or the selected bin. Overview item clicks select a
   unique bin and preserve meaningful expansion; multiple-bin entries offer choices.
   Shelf and bin quick-entry tests cover the intended destination, failure/retry,
   composition, duplicate submission and retained input. Notes, reporting, decor,
   shelf zoom and a compact Clear bin control remain available.
3. **Inventory density:** replaced cards with shared wrapping entries. Name clicks
   navigate; disclosure and admin pencil actions remain independent. Name-only,
   placeholder-only and metadata-only entries have no disclosure; zero counts and
   prices are retained. The fixture has 95 name-only entries plus five representative
   entries: **63 names are fully visible at 1440 × 900**, without changing browser
   zoom. Checks also cover 768/390 widths and long names without clipping or overlap.
4. **Map focus:** reproduced the missing automatic panel. One association now opens
   and focuses its exact destination. Multiple associations remain highlighted with
   choices, including bins on one shelf and locations across shelves. Duplicate
   records in different units at one destination count as one association. Non-shelf,
   unmapped, hidden-bin, rapid-navigation and clearing cases pass. Desktop reserves
   the drawer width; mobile uses a bottom drawer. Manual zoom/pan remains available.
5. **Permanent deletion:** reproduced the missing operation, then added separate
   delete-item and remove-location actions through the authenticated inventory
   transaction. Tests cover confirmation cancellation, multiple locations, archive,
   unrelated records, stale revisions, unauthorized requests, deleted acknowledgements,
   reload, restart and layout restore. A pre-deletion checkpoint and deleted-identity
   marker prevent accidental resurrection; audit snapshots and reports are retained.
6. **Short location labels:** checkpointed startup allocation preserves readable
   labels and internal identities. Reservations include retained shelves and history;
   concurrent allocation, copying, repeat backfill, explicit collision rejection and
   restore collision repair pass. Full backup recovery validates the new registry.

## Checks actually run

- Baseline: all **41 backend tests**, browser smoke, lint and formatting passed.
- Final backend: **45 tests passed** (`python -m unittest discover -s tests -v`).
- Final browser suite: **78 distinct tests passed** (`tests/run_browser_suite.py`).
- Final browser smoke passed (`tests/browser_smoke.py`).
- Updated acceptance fixture: **8 tests passed** (`tests/browser_compact_inventory.py`),
  including final zero-value, placeholder and long-name assertions.
- Final ESLint and Prettier checks passed.
- The browser suite includes saving, copying, undo/redo, refresh recovery, reporting,
  location pickers, structural imports, geometry and layout restoration.

The first integration run failed on superseded UI assertions and two regressions
(Add shelf timing and empty legacy shelf-name fallback). These were corrected and
verified; the final suite above completed successfully. Browser checks initially
needed unavailable system libraries, and npm was absent from PATH. Node and the
missing Chromium libraries were downloaded/extracted into `/tmp/itr-dev-tools/`
without changing application dependencies. The final commands used that Node on
PATH and the extracted libraries via LD_LIBRARY_PATH.

## Saved evidence and data safeguards

A pre-edit data/defaults backup is saved at:

`.itr-backups/before-six-inventory-fixes-20261005-1c8bf479.tar.gz`

All **127 populated data/default files** were compared byte-for-byte with the
pre-edit snapshot and remain unchanged. No production backfill or deletion was run.
Automatic short-label backfill will occur on the next application-server startup;
save/export active drafts before restarting, as described in README. It checkpoints
current saved data and changes display labels only. Include `location-labels.json`
and inventory deletion markers in full backups. Explicit recovery of an older full
backup intentionally restores that backup's stock; ordinary layout restore does not.

Before/after screenshots and test logs are saved under `/tmp/itr-six-fixes/` and
`/tmp/itr-*.log`. Screenshot names include:

- `before-inventory-1440.png`, `after-inventory-1440.png`
- `before-inventory-768.png`, `after-inventory-768.png`
- `before-inventory-390.png`, `after-inventory-390.png`
- `before-panel.png`, `after-panel.png`
- `after-navigation-768.png`, `after-navigation-390.png`
- `after-location-label.png`

The desktop inventory, shelf-panel and mobile inventory/navigation screenshots were
visually inspected. Tests used disposable data and randomly assigned local ports.
A full browser engine matrix and manual tests on physical phones were not run.

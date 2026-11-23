# Budget implementation plan

## Purpose

The budget workspace exists to reduce the Treasurer's manual work in IIT's
312 budgeting site. It is a preparation and club-record system, not an
attempted integration with 312. The central outcome is that officers can
quickly find, verify, copy, and retain the information needed to enter a
small number of clear budget items in the correct 312 section.

The five dashboard tabs mirror the ways 312 separates submissions. A budget
section is therefore more than a visual filter: it must retain its own records
and must not combine a Lab Item, Event, or Project with another section.

The intended first-release budget workspace is complete: Lab Items, Projects &
Capital Items, Events and Programming, Conferences & Competitions, and the
currency-grouped Total view are separate term-scoped workflows. Editable DOCX
supporting-document exports are available for Lab Items, Events and
Programming, and each named Projects & Capital Items group.

## Non-negotiable boundaries

- The next viable term is Spring 2027. Prior and later terms must remain
  separately selectable and historically intact.
- President (`brauliokoalas@gmail.com`), Treasurer
  (`dnadar@hawk.illinoistech.edu`), and individually assigned Officers may
  access the Admin Dashboard budget workspace.
- Officers may create and correct budget records. This does not grant them
  project approval, Treasury private-note, project-message, or project-delete
  powers.
- Budget approval is distinct from OSL funding. The budget workspace must not
  change or infer an OSL result.
- Public Lab Map and Lab Inventory reads remain independent of login/session
  checks. No budget middleware may be added to those endpoints.
- Money is validated decimal data with an ISO currency code. Totals never add
  unlike currencies together.
- The app does not submit to 312, purchase items, receive inventory, reserve
  stock, or alter inventory quantities.

## Delivery strategy

We will deliberately avoid designing a generic all-purpose spreadsheet before
the Lab Items interaction has been tested. The first implementation is a
durable, term-scoped Lab Items accounting table with a stable set of columns,
autosave, and preset starting rows. Once its editing behavior and layout are
right, its table engine, validation, audit trail, autosave, and term handling
will be reused for Projects & Capital Items.

The Project section then adds the complicated pieces on top of that proven
table: source-project linkage, six-category consolidation, a five-or-fewer
312 budget-item output, and supporting-document generation.

## Current implementation status

The Lab Items baseline is implemented and its editing behavior has been
reviewed as usable. It is the reference table for the later Projects & Capital
Items work; it is not a placeholder or a proposed interaction anymore.

- Officers, the Treasurer, and the President can open the Spring 2027 Lab
  Items table from the private Admin Dashboard. The API enforces that access;
  public Lab Map and Lab Inventory reads remain session-independent.
- The table has one blank trailing row. Typing in it creates the next blank
  row; clearing every value in a populated row removes that row. There is no
  Add row button.
- Every saved Lab Items row has the fixed **Lab Consumables** category. The
  category is visible but intentionally not editable in this section.
- Rows autosave, retain unfinished drafts, show readiness warnings above the
  table, and provide hover/focus copy-down controls. Ordinary autosave and
  row-management operations do not create noisy history entries.
- A 312-ready row needs a line-item name, category, vendor, unit price, and
  quantity. Vendor remains saveable while missing so Officers can continue
  drafting, but it is reported in the warning list.
- Quantity is a positive whole number. Unit price and calculated totals use
  decimal storage, but returned values are normalized so an entered `2` is
  shown as `2`, not `2.000000`; displayed currency totals remain two-decimal
  preparation aids.
- Links are optional, but if provided must be public `http://` or `https://`
  URLs. Validation feedback presents that specific correction instead of only
  a generic request failure.
- Non-empty vendor values must match the canonical `Supplier Name` in
  `data/approved-vendors.csv`. Project submission and both budget tables offer
  an authenticated type-ahead picker; the server still validates and
  canonicalizes the selected name on save. Common approved aliases (Amazon,
  McMaster, and Digikey) and an omitted trailing `LLC` resolve efficiently to
  their canonical supplier records.
- Category labels have sufficient table width to remain visible. Autosave
  response handling preserves newer in-progress cell edits rather than
  replacing them with an older server response.

Projects & Capital Items now also has the same manual, term-scoped accounting
table baseline, with a required picker for Raw Material, Mechanism Components,
Primitive Electrical Components, Motion Electrical Components, and Computing
and Sensing Components. It intentionally excludes Lab Consumables. Fully
budget-approved projects assigned to the selected term appear first as a
read-only import preview; an Officer can explicitly import its whole-quantity
purchase rows once. The import is idempotent, retains the source project name
on each imported row, and removes the project from that term's preview. The
table renders contiguous imported rows as a vertically merged Project name
group whose boundaries Officers may drag to include or remove adjacent rows.
During that drag, the pointer determines the row even when it is over the
merged Project name cell, and every row in the resulting project range is
highlighted yellow. The trailing empty row is highlighted red and is never
included; releasing there instead expands the group through the final real
budget row.
The approved-project preview and the Projects & Capital Items readiness
warnings are collapsed by default. When shown, readiness warnings include
missing project names and links, and consolidate adjacent items with the same
missing fields into a single readable line-item range.
This is deliberately not automatic synchronization: five-or-fewer category
summaries and per-field source snapshots are deferred enhancements, not
requirements for the released budget workflow.

The preview, explicit import, imported-row grouping, legacy empty-name
placeholder, and corrected merged-cell editing behavior were verified by the
user. The implementation commits are `c46aa3d`, `c395bbe`, `a7a014a`,
`83c5754`, and `f450c59`.

Events and Programming is now a separate, term-scoped worksheet with up to 15
named rows, optional descriptions, a USD 3,000 shared cap enforced in the
browser and API, and currency-safe Total inclusion. Conferences & Competitions
is also a separate term-scoped worksheet with up to 10 validated entries,
required cost documents where applicable, mileage guidance, and USD totals.
The Total tab reads all four sections and displays section and overall totals
grouped by currency. Lab Items and Events each export one editable DOCX for
the selected term; Projects & Capital Items exports an editable DOCX for each
selected named project group, with its saved rows grouped by category.

The remaining items in this document are optional operational follow-up or
future enhancements: a real 312 parallel run, live multi-user verification,
five-or-fewer 312 summary output, automatic source synchronization, and later
approval/reconciliation refinements. They do not block normal use of the
released budget workspace.

## Shared technical foundation

Additive Neon/Postgres tables will be created through the existing idempotent
schema setup. Existing member accounts, officer roles, project JSON, project
approvals, Treasury records, and public map/inventory data will not be
rewritten.

The initial shared records are:

- `budget_terms`: term ID, label, start/end dates, state, timestamps, and the
  preset version used to create it. Spring 2027 is the initial active term.
  Authorized officers can create a named upcoming or active term from any
  section's budget-term selector; creation never copies, edits, or deletes a
  historical term's entries.
- `budget_records`: a term, section (`lab-items`, `projects-capital`, or
  `events`), creator/editor, timestamps, and an optimistic revision.
- `budget_line_items`: the individual editable accounting rows, each with a
  durable ID, stable row order, validated fields, calculated total, and row
  revision.
- `budget_project_imports`: an idempotent per-term link between an imported
  project and its Projects & Capital Items record.
- `budget_activity`: a concise audit trail for meaningful record creation and
  project-import events. It deliberately does not log every keystroke,
  automatic blank-row change, or ordinary copy-down action.
- `budget_conference_records`: one revisioned JSON entry collection per term
  for the initial Conferences & Competitions worksheet.

Use Postgres `NUMERIC` for unit price, quantity, and stored totals. Return
decimal values as strings to the browser so JavaScript floating-point math
cannot silently change a submitted value. The UI may display a calculated
total immediately, but the server recalculates and persists it.

All writes require an individual active Officer, Treasurer, or President
assignment. Read APIs return only the selected budget term and section. Member
sessions are denied server-side; hiding buttons alone is never authorization.

## Phase 1: Lab Items table

### Goal

Provide the straightforward, shared accounting table Officers need for the
Lab Items 312 section. This phase contains no project synchronization,
categories-to-summary logic, external funding workflow, inventory changes, or
PDF generation.

### Table shape

The initial fixed columns should be the reusable line-item core:

| Column | Behavior |
| --- | --- |
| Line item name | Required descriptive item/group name. |
| Category / grouping | Required selection from the six club categories; no arbitrary/free-text category. Lab Items defaults this value to the Lab category. |
| Link | Optional `http`/`https` vendor or supporting URL. |
| Unit price | Non-negative decimal plus row currency. |
| Quantity | Positive whole number, defaulting to 1 when a price is supplied. |
| Vendor | Required for a 312-ready row. The row may remain saved while this is blank, but the readiness warning identifies it. |
| Total cost | Server-calculated `unit price × quantity`; read-only in the first release. |
| Description / notes | Optional detailed context needed for club records or 312 entry. |

The six allowed category values are Raw Material, Mechanism Components,
Primitive Electrical Components, Motion Electrical Components, Computing and
Sensing Components, and the existing Lab category currently named **Lab
Consumables**. Lab Items rows automatically select that final category and do
not permit a different selection. The phrase “Lab Components” in the workflow
discussion should be confirmed as either a rename of `Lab Consumables` or an
informal reference to it before implementation, so no 312-facing label is
accidentally inconsistent.

The initial table has its fixed column headings and exactly one empty row. It
does not use a preset collection of guessed purchases and it has no `Add row`
button.

### Interaction design

- The Lab Items tab opens on Spring 2027 and makes the term visible and
  switchable; past terms are viewable but not accidentally edited.
- Officers edit cells directly. A per-table state communicates `Saving…`,
  `Saved`, or a precise retryable error; no separate Save button is required
  for ordinary cell edits.
- There is always exactly one blank trailing row. Once an Officer enters any
  content in that row, the app treats it as a real row and immediately renders
  one new empty row beneath it. If all content in a populated row is deleted,
  that row disappears; the table still retains exactly one blank trailing row.
  The implementation must handle a cleared middle row and rapid typing/paste
  without creating duplicate blank rows.
- Category selection is mandatory. Every Lab Items row begins with the Lab
  category already selected. A readiness warning area above the table lists
  incomplete rows and missing required information, including Vendor and
  Category, rather than preventing an Officer from saving unfinished work.
  The exact 312-ready requirement for Link, price, and quantity will be shown
  in that same warning once confirmed.
- On hover or keyboard focus, each populated editable cell exposes a small
  `Copy down` control. It copies that cell's current value into every existing
  populated row below it, but never into the single blank trailing row. The
  control must require confirmation when it would replace non-empty values and
  must remain keyboard-accessible with an unambiguous accessible label.
- Each populated Lab Items, Projects & Capital Items, and Events and
  Programming row also exposes a compact Remove control. It confirms before
  deleting populated data; blank trailing rows have no removal action.
- Browser edits are debounced and sent as a small batch with the record/table
  revision. A conflict returns the newest data and asks the Officer to review
  it rather than silently overwriting another Officer's work.
- Automatic trailing-row expansion, deletion of an emptied row, and ordinary
  copy-down operations are normal table editing behavior, not individual
  budget-history events. Reordering, if introduced later, persists durable row
  order without producing noisy per-cell audit records.
- The tab includes the approved Lab purpose statement and a concise reminder
  that a budget row never purchases, receives, reserves, or changes Lab
  Inventory.
- A compact section subtotal groups by currency. It is an entry-preparation
  aid, not an available-balance claim.

### Lab Items milestones

1. **Complete:** establish the Lab Items table shape, final column order,
   fixed **Lab Consumables** label, self-expanding blank-row behavior, and
   whole-number quantity rule.
2. **Complete:** add the additive schema, Spring 2027 term, role-protected
   endpoints, server validation, revisions, and focused tests.
3. **Complete:** replace the placeholder with the authenticated editable table,
   autosave/readiness states, category default, hover/focus copy-down controls,
   subtotal, and clear inline validation feedback.
4. **Complete in local verification:** exercise saved-row validation and the
   table regression coverage for rapid edits; confirm category visibility and
   no unintended changes to public Lab Map/Inventory route behavior.
5. **Pending:** verify with real Spring 2027 practice entries and two Officer
   sessions in the deployed environment. Refine only from Treasurer feedback,
   preserving the verified table interaction unless a new change is approved.

## Phase 2: Projects & Capital Items

### 312-oriented model

Each approved project remains distinct. Its screen is organized into two
explicit 312 preparation areas:

1. **Request information**
   - Project Name/Section
   - Project Description

2. **Budget items**
   - no more than five concise, generalized entries for that project;
   - each entry has a category/name, total cost, currency, and its supporting
     documentation reference.

The Project section will not make a row for every gear, belt, bracket, or
other granular purchase. It will retain those granular rows as supporting
documentation, while presenting a small set of category summaries for 312.

### Standard project categories

The category picker for a project summary uses these six club-defined values:

1. Raw Material
2. Mechanism Components
3. Primitive Electrical Components
4. Motion Electrical Components
5. Computing and Sensing Components
6. Lab Consumables

Each detailed project line item is assigned one of these categories or marked
unassigned. The system sums detailed rows within a category to produce the
312-ready budget item total. A warning blocks a 312-ready output if more than
five non-zero categories are selected; Officers must combine/reclassify or
explicitly exclude a category before copying to 312. This preserves the six
category vocabulary without ever making all six automatic 312 items.

### Project workspace layout

For each project, display:

- a **312 Request** card with copy controls for project name/section and
  description;
- a **312 Budget Items** table with up to five category summaries, each with a
  copyable item name and total;
- a **Detailed supporting items** table using the proven Lab table columns:
  line-item name, category, link, unit price, quantity, vendor, total cost,
  and description/notes;
- a **Supporting documentation** panel with project leader, team, project
  justification, image references/captions, and the detailed line-item table;
- a source/synchronization status and an audit trail so an Officer knows
  whether values came from a submitted project or were corrected in budget.

The request card and category-summary items are optimized for manual transfer
to 312: compact wording, obvious totals, and copy actions. The detailed table
exists for traceability and the attachment, not to force detailed entry into
312.

### Project source synchronization

A fully budget-approved project creates or updates one linked project budget
record in the selected term. “Approved for budget” remains independent of OSL
funding. The approval rule implemented for new work is one leadership approval
below $500 and both President and Treasurer approvals at or above $500 USD.

The initial safe import is an explicit, one-time action rather than an
automatic update. Preview eligibility requires a fully approved project and an
exact selected-term planning period; an item-review warning therefore never
means that project approval is missing. Fractional quantities and projects
without itemized purchase rows remain visible for review but cannot be imported
until an Officer resolves them. Imported projects are linked idempotently per
term and are hidden from the preview after import.

Project submission data seeds the request card and detailed line items. To
protect Officer corrections, the system stores a last-synchronized source
snapshot per field and per stable project line item:

- a non-empty project value that changed since that snapshot may update its
  linked budget field;
- an empty project value never erases an Officer correction;
- an unchanged project value leaves an Officer correction intact;
- deleted/removed source rows are flagged for review rather than silently
  deleting a budget record;
- manual budget rows have no project source and are never overwritten.

The project form currently has no durable line-item IDs. Before automated
line-level synchronization is enabled, new items need stable IDs and existing
items need a safe first-link matching rule. This is required to avoid duplicate
or mismatched rows when a member reorders a purchase list.

### Supporting-document exports (completed)

Exports create an editable supporting-document starting point; they are not a
new official budget record, a PDF, or a document store. The initial output is
a downloaded **DOCX** file. Officers can open it in Microsoft Word or upload
it to Google Drive and open it with Google Docs, then add justification,
captions, and images. The application will not upload a file to Google, retain
an edited copy, or infer that an externally edited document changed the budget.

**Completion record:** The user verified successful, clean, editable Lab Items
and Events and Programming DOCX exports on November 22 and 23, 2026,
respectively. Projects & Capital Items export was also verified: a named
project is selected in the budget table, then exported as its own editable
DOCX. Its line-item table is grouped by category rather than repeating the
project name.

The export scopes are deliberately fixed:

| Budget section | Export unit | Table layout |
| --- | --- | --- |
| Lab Items | One document for the selected term's Lab Items table | Every saved populated Lab Items row, in table order. |
| Events and Programming | One document for the selected term's Events table | Every saved event row, in table order. |
| Projects & Capital Items | One document for each non-empty Project name group | Only that project's saved rows, grouped by category rather than repeating the Project name in the first table column. |

For a Project export, category is the leftmost grouping: each populated
category receives a heading or merged group cell followed by its line items.
Project name appears in the document title and metadata, not once per row.
Rows without a Project name are manual/unassigned capital rows and have no
per-project export until an Officer supplies a name. Uncategorised project rows
must be visibly collected under `Category needs review`; the export must never
silently assign a category. Empty trailing UI rows are never exported.

Every document uses the saved server response for the selected term, includes
an export timestamp and term/section title, preserves the line-item data and
currency, and clearly labels its editable sections. The document should
include: a title; a short purpose/context section; an `Add justification here`
section; an `Add images, captions, or supporting context here` section; the
line-item table; and source links as clickable links. It must label calculated
totals as preparation information, not proof of available funds. Project
documents additionally include the project name and, when available from the
linked source, description, leader, team, and submitted documentation links.

#### Delivered design

1. A small server-side document builder and protected download routes generate
   DOCX on demand from current persisted term data. Browser rows are not
   trusted and downloading does not write an export record.
2. The well-supported DOCX-generation dependency is pinned in
   `requirements.txt`. Output stays in memory and is returned with an
   attachment filename; no object storage, uploads, or Google OAuth is needed.
3. One `Export supporting document` action is available for Lab Items and Events and
   Programming after the selected term is loaded and saved. Disable it while a
   save is outstanding, for closed terms only if read access is retained, and
   when no populated rows exist.
4. Projects & Capital Items export groups are derived exclusively from durable
   `projectName` values. Selecting a distinct non-empty group reveals its
   export action; a current saved revision is required before download. Manual
   unnamed rows remain out of those project documents.
5. The server formats tables and performs category grouping. Category order
   follows the existing project vocabulary; saved row order is retained within
   a category, per-currency subtotals are included, and unlike currencies are
   never added together.
6. Focused authorization, selection, grouping, filename, and unsaved-data
   coverage protects the download paths. Lab and Events exports were manually
   verified as editable in the user's workflow.
7. A small real 312 parallel run is an optional operational follow-up, not a
   condition for using the exported documents as supporting documentation.

Future PDF or direct Google Drive creation is intentionally separate. A PDF is
not the primary artifact because it does not satisfy the requirement that
officers add images and justification after export.

### Project milestones

1. Confirm the exact 312 Budget Item fields and examples, the meaning of the
   312 attachment/link field, and what counts as a justification/image source.
2. **Complete:** reuse the term/table/audit foundation for a manual Projects &
   Capital Items table and add the five allowed project categories. A
   read-only fully-approved-project preview and explicit idempotent import now
   create a per-term project link without modifying the source submission.
   Imported rows display their project name as an editable, vertically merged
   group; legacy rows retain an empty editable placeholder. User-verified in
   commits `c46aa3d`, `c395bbe`, `a7a014a`, `83c5754`, and `f450c59`.
3. **Deferred enhancement:** automatic per-field synchronization, exact source
   snapshots, stable project line-item IDs, and Officer-correction preservation.
4. **Complete:** editable DOCX supporting-document exports for each selected
   named project group. The separate request card and copy-oriented
   five-or-fewer budget-item output remain later Project workflow work.
5. Test projects with zero, one, five, and six populated categories; missing
   links; project edits; Officer corrections; concurrent changes; legacy line
   items; manual capital records; and OSL/budget-decision separation.
6. Parallel-enter a small real budget in 312, compare the copied values and
   attachment with the Treasurer's expected workflow, then refine before wider
   rollout.

## Deferred from this plan

- Automated 312 submission or browser automation.
- Purchasing, reimbursements, inventory receipt, stock changes, or reservation.
- A decision that a calculated budget total represents available funds.
- Email notifications.

## Decisions needed before the Project phase

1. Should prior terms be read-only after close, or may Officers correct them
   with an audit record?
2. Confirm the exact 312 Budget Item inputs beyond name/category and total;
   this determines the later copy-oriented summary controls. Supporting-
   document DOCX exports do not depend on that decision.
3. **Confirmed and implemented:** `$500 exactly` requires both President and
   Treasurer approval.
4. **Confirmed and implemented:** fully approved projects require an explicit
   per-project import action; previewing never writes a budget row.
5. Define the policy for material changes to an already budget-approved
   project: which changes require renewed leadership approval?
6. **Confirmed for the initial export:** officers add images and justification
   after download in Word or Google Docs. The app does not host uploads or
   embed images in this release.
7. Confirm whether the emergency shared `itr` administrator may edit official
   budget records. The recommendation is to keep it out of leadership approval
   actions regardless.

## Change discipline

No work begins from this planning document alone. Once a phase is explicitly
approved, changes will be limited to that phase, tests will be added and run,
the public Lab Map/Inventory behavior will be checked, and each completed
scoped change will be committed immediately. Unrelated working-tree files will
remain untouched.

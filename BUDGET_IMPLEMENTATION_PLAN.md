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

This document intentionally prioritizes **Lab Items**, then **Projects &
Capital Items**. Events, Conferences & Competitions, and Total will receive
their own approved plans after the two workflows below are usable.

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
- Category labels have sufficient table width to remain visible. Autosave
  response handling preserves newer in-progress cell edits rather than
  replacing them with an older server response.

Projects & Capital Items now also has the same manual, term-scoped accounting
table baseline, with a required picker for Raw Material, Mechanism Components,
Primitive Electrical Components, Motion Electrical Components, and Computing
and Sensing Components. It intentionally excludes Lab Consumables. This is a
manual table for now: project-request synchronization, one-project-per-312
request grouping, five-or-fewer category summaries, and supporting-document
generation remain pending.

The following work is still pending: live multi-user production verification,
the project-specific budget workflow, and the remaining budget tabs.

## Shared technical foundation

Additive Neon/Postgres tables will be created through the existing idempotent
schema setup. Existing member accounts, officer roles, project JSON, project
approvals, Treasury records, and public map/inventory data will not be
rewritten.

The initial shared records are:

- `budget_terms`: term ID, label, start/end dates, state, timestamps, and the
  preset version used to create it. Spring 2027 is the initial active term.
- `budget_table_presets` and `budget_preset_rows`: versioned default rows for
  starting a new term. Copy a preset into a new term; never apply a later
  preset change backward to an already-open historical term.
- `budget_records`: a term, section (`lab-items` initially, then
  `projects-capital`), lifecycle, title/context, creator/editor, timestamps,
  and an optimistic revision.
- `budget_line_items`: the individual editable accounting rows, each with a
  durable ID, stable row order, validated fields, calculated total, and row
  revision.
- `budget_activity`: a concise audit trail for meaningful record lifecycle,
  synchronization, and archive events. It deliberately does not log every
  keystroke, automatic blank-row change, or ordinary copy-down action.

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

### Supporting documentation and PDF

First build a print-ready project document from the saved budget data,
including project name/description, leader, team, justification, images or
image references, and the detailed line-item table. The practical initial PDF
path is a browser print view (`Save as PDF`), which works in Vercel without
introducing a server-side rendering binary or a new file service.

A one-click downloadable server-generated PDF can follow only after agreeing
on a supported renderer, image-storage/location policy, output appearance,
and performance limits. The app currently has no managed upload/object-storage
service, so image uploads must not be assumed in the first project release.

### Project milestones

1. Confirm the exact 312 Budget Item fields and examples, the meaning of the
   312 attachment/link field, and what counts as a justification/image source.
2. **Baseline complete:** reuse the term/table/audit foundation for a manual
   Projects & Capital Items table and add the five allowed project categories.
   **Pending:** turn those rows into distinct, linked project records and add
   the five-item 312 summary constraint.
3. Add the fully-approved-project link and idempotent synchronization, with
   exact-$500 dual-approval coverage and Officer-correction preservation.
4. Build the request card, copy-oriented budget-item output, detailed rows,
   and print-ready supporting-document view.
5. Test projects with zero, one, five, and six populated categories; missing
   links; project edits; Officer corrections; concurrent changes; legacy line
   items; manual capital records; and OSL/budget-decision separation.
6. Parallel-enter a small real budget in 312, compare the copied values and
   attachment with the Treasurer's expected workflow, then refine before wider
   rollout.

## Deferred from this plan

- Events, Conferences & Competitions, and Total-tab implementation.
- Automated 312 submission or browser automation.
- Purchasing, reimbursements, inventory receipt, stock changes, or reservation.
- A decision that a calculated budget total represents available funds.
- Email notifications.

## Decisions needed before the Project phase

1. Should prior terms be read-only after close, or may Officers correct them
   with an audit record?
2. Confirm the exact 312 Budget Item inputs beyond name/category and total;
   this determines the final copy/export controls.
3. Confirm that `$500 exactly` requires both President and Treasurer approval,
   superseding the current implementation's `> $500` behavior.
4. Confirm whether fully approved projects should appear automatically in the
   selected budget term, as proposed, or require an Officer to click an
   explicit `Add to budget` action.
5. Define the policy for material changes to an already budget-approved
   project: which changes require renewed leadership approval?
6. Decide how images enter supporting documentation: external image links,
   an approved future file-storage service, or initially no embedded images.
7. Confirm whether the emergency shared `itr` administrator may edit official
   budget records. The recommendation is to keep it out of leadership approval
   actions regardless.

## Change discipline

No work begins from this planning document alone. Once a phase is explicitly
approved, changes will be limited to that phase, tests will be added and run,
the public Lab Map/Inventory behavior will be checked, and each completed
scoped change will be committed immediately. Unrelated working-tree files will
remain untouched.

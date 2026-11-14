# Future implementation roadmap

This document captures work intentionally deferred until the approved items in
`IMPLEMENTATION_CHECKLIST.md` are complete. It is planning only and does not
authorize implementation of the sections below.

## Treasurer budget workspace

### Goal

Evolve the Treasurer Dashboard from a project-review workflow into the
Robotics Club's central budget workspace: a clearer replacement for the
current Microsoft Excel budget sheet. It must retain the existing member
project-submission and Treasurer review flow while supporting the other budget
categories the club manages.

### Roles and permissions

- The future site experience is split broadly into **member** and **admin**
  modes, both in server-enforced authorization and in the visible UI. Members
  see only the forms they may submit, their own projects/requests, the lab map,
  and lab inventory. They do not see the budget dashboard or officer-only
  planning/editing tools.
- Admins (club officers) see the budget dashboard and can view and edit the
  officer-managed records across the application, subject to the special
  approval rule below. The UI should make this distinction obvious rather than
  merely hiding controls while still loading private data.
- Treasurers manage the budget workspace, approve project submissions, and
  control official budget records.
- Admins (club officers) can create and edit official records in every budget
  section. Admin access must remain server-enforced; a member session is not
  sufficient.
- Members submit project and conference/competition requests only through
  approved member-facing workflows. They do not gain access to private budget
  planning data merely by submitting a request.
- Existing private Treasury notes remain private. Existing project sharing and
  future activity-log behavior must keep their own permissions.

### [x] Durable officer roles and President authorization — initial rollout

Start the future roadmap with an authorization foundation, before building a
new budget tab or granting a President broad access through a hard-coded login.
The President must be an assigned role on a real member account, not a second
shared credential or an implicit super-Treasurer role.

**First-task scope**

1. Define and document the server-enforced permission matrix for Member,
   Officer/Admin, Treasurer, and President. It must explicitly cover project
   review decisions, project deletion, shared messages, private Treasury notes,
   Lab Map and Inventory edits, official-budget edits, officer-role assignment,
   and high-value approvals.
2. Design a normalized Neon officer-assignment model keyed to member-account
   IDs. Each assignment needs a role, effective start and end dates, assigning
   actor, handoff/revocation reason, and immutable change history. Permit only
   one active Treasurer and one active President unless a later written policy
   intentionally changes that rule.
3. Preserve the existing standardized `Sign in` experience. After login, the
   server—not the page—must determine the account's active role/capabilities.
4. Do not change project approval behavior, create budget records, or expose
   private Treasury notes in this item. In particular, the President must not
   automatically receive every Treasurer-only power merely because the role is
   higher-ranking.
5. Add authorization tests for unassigned members, active assignments, Officer
   grants/revocations, and denials for protected data and actions.

**Initial assignments for this rollout:** Seed the President assignment for
`brauliokoalas@gmail.com` and the Treasurer assignment for
`dnadar@hawk.illinoistech.edu` through deployment configuration after both
member accounts exist. The existing `itr` sign-in remains an emergency
administrator path; it is not an Officer account and must not replace
individual account assignments or their audit trail.

**Completion record:** The production-verified implementation is in
`9808121`. President, Treasurer, and Officer capabilities are resolved from
durable account assignments; the President can grant and revoke Officer access
by member-account email; the standardized sign-in flow and emergency `itr`
administrator path remain available. Treasurer-only project decisions and
private Treasury notes remain unchanged.

### [x] Authorized President and Treasurer handoffs

Leadership roles can be transferred through a narrowly scoped, server-enforced
handoff flow before high-value approvals or official budget records are built.

1. Define who may initiate, approve, cancel, and complete each handoff. A
   current President may transfer the President role to an existing member, and
   the current Treasurer may transfer the Treasurer role to an existing member.
   The active President may also transfer the Treasurer role when continuity
   requires it, including when the current Treasurer is unreachable. A
   Treasurer may never transfer the President role.
2. Require the target to be an existing member account, validate the effective
   date, end the prior active assignment atomically, and record all actors and
   reasons in the immutable assignment history. The transfer must require an
   explicit confirmation and a handoff reason; initial release transfers take
   effect immediately rather than being scheduled for a future date.
3. Prevent more than one active President or Treasurer and reject stale,
   expired, or self-conflicting handoff attempts at the API.
4. Provide a narrowly scoped management UI distinct from ordinary Officer
   access management.
5. Test both role handoffs, unauthorized requests, and the prior holder losing
   protected access.

**Completion record:** Implemented in `a10fe97` and verified in production by
the user on November 7, 2026. The handoff is immediate, requires a reason and
explicit confirmation, transfers only to an existing eligible member account,
and records the assignment history. The prior holder retains their member
account but loses the transferred leadership capability.

The later high-value workflow will require independent, separately recorded
Treasurer and President approvals for qualifying USD requests; it must not be
combined with this handoff item.

### [x] Signed-in member password change

Members can change their own password from an authenticated session without
email delivery. The server must verify the current password, enforce the
existing password-strength limits, replace the salted password hash, and end
all sessions for that account so the member signs in again with the new
password. The feature must never reveal password values or permit one member
to change another member's password.

Email-based password recovery remains deferred until the approved sending
domain, provider, sender authentication, delivery/bounce handling, and opt-in
policy exist.

**Completion record:** Implemented in `9f75fe2` and verified in production by
the user on November 7, 2026. A password change verifies the current password,
requires a new non-reused password, and ends all sessions for that account.

### [x] Admin Dashboard navigation and ITR Budget shell

Keep **Admin Dashboard** as the authorized entry point rather than replacing
it with either project management or the budget. It provides two workspaces:

- **Project Management** retains the existing project-review workflow,
  leadership approvals, project messages, activity history, and deletion
  controls.
- **ITR Budget** provides the Spring 2027 foundation with empty tabs for
  Projects & Capital Items, Events, Lab Items, Conferences & Competitions, and
  Total.

**Term management update:** Officers can now create and switch among separate
budget terms from each section's selector. Each term has its own fresh section
records, while returning to an existing term restores its saved rows unchanged.

The entry page uses the same interactive launch-button treatment as the home
page and displays the active President, Treasurer, and Officers with their
member-account names and emails. The roster is available only to authenticated
admin-workspace users.

This item deliberately creates no official budget records, budget tables, or
automatic project-to-budget synchronization. It is a navigational and visual
foundation only; the next budget item can implement Projects & Capital Items
without changing the established project-review workflow.

**Completion record:** Implemented locally pending production verification.

### [x] Dual approval for high-value project requests

For USD project requests over **$500**, both the Treasurer and President must
record an **Approved for budget** decision before the request is fully approved
for the budget. Either role may independently approve a request at or below
$500 USD; that single decision is fully approved. Project submissions use USD
only.

- Store President and Treasurer decisions separately with actor, status,
  amount, currency, message, timestamp, and audit event.
- Show each approval on the member project timeline and detail view. Label
  project messages from those roles as `President` and `Treasury`.
- Keep the internal budget decision separate from the external OSL funding
  outcome. `Approved for budget` means ITR leadership will include the request
  in the budget; `OSL funded` is recorded independently by Treasury after an
  OSL award or funding decision. One must never overwrite the other.
- Show each role's `Approved for budget $X` decision while awaiting the
  remaining decision. When all required decisions are present, show `Fully
  approved for the budget` with one amount or the low-to-high range when
  budget amounts differ.
- Preserve private Treasury notes. President messages are member-visible and
  must never expose private Treasury notes.
- Do not create a budget-table record in this item; later budget work consumes
  only the fully approved outcome.

**Completion record:** Implemented in `d40b922` and verified in production by
the user on November 7, 2026. The transition preserves existing `planned`
leadership decisions as `Approved for budget`; the old ambiguous `approved`
label is treated as the historical external-funding outcome rather than an
internal budget approval.

### Future access and high-value approval model

1. Define a durable officer-assignment model for the currently assigned
   Treasurer and President. Assignments need an effective start/end date,
   change history, and an authorized handoff process so annual officer changes
   do not require source-code or environment-variable edits.
2. A project or conference/competition request with a total over **$500 USD**
   requires approval from both the currently assigned Treasurer and President
   before it becomes an approved official budget record. A USD request at or
   below $500 needs one approval. Store each approval separately with its
   actor, role, timestamp, and decision; one approval must not overwrite the
   other.
3. Keep project-submission estimates in USD so the $500 threshold is applied
   consistently. Any future non-USD workflow needs a separately approved
   conversion policy before it can enter the budget workspace.
4. Changes that raise an already-approved request above $500, change its
   currency, or materially change its scope must return it to the appropriate
   approval state. Record the reason in the activity history.
5. Below the threshold, any authorized admin may view and edit the remaining
   officer-managed aspects of the budget workspace. This does not grant members
   administrative access or expose private Treasury data.
6. Test member/admin UI separation, API authorization, Treasurer/President
   handoffs, both approval orders, stale-role denial, threshold changes, USD
   threshold handling, and audit history.

### Shared budget model

1. Create a durable Neon-backed budget workspace with a revisioned document or
   normalized tables, selected before implementation based on reporting and
   concurrent-edit requirements. Do not place official budget data in browser
   storage or project JSON.
2. Every official entry needs an ID, section, lifecycle status, creator/editor,
   timestamps, notes, and a stable link to its source project or request when
   applicable.
3. Store money as a validated decimal amount plus ISO currency. The Total view
   must group totals by currency; it must never silently compare or sum unlike
   currencies.
4. Keep editable official records separate from member submissions. Approval
   creates or links an official record; it must not destroy the original
   request, review history, or shared messages.
5. Add durable activity events for official record creation, edit, approval,
   rejection, and deletion when the activity-log foundation is available.
6. Define an import/migration plan for existing Excel data before any live
   replacement rollout. Validate a sample import and retain a recoverable
   source export.

### Treasurer dashboard layout

The dashboard presents five tabs, with **Projects & Capital Items** selected
by default:

1. Projects & Capital Items
2. Events and Programming
3. Lab Items
4. Conferences & Competitions
5. Total

Tabs should preserve their own draft/filter state while the Treasurer works,
but no tab should expose another role's private data. Keep the current Project
Submissions queue prominent within the first tab rather than removing it.

### 1. Projects & Capital Items

The tab contains two distinct areas:

- **Project Submissions**: the existing Treasurer review queue for member
  ideas and project requests.
- **Official budget table**: the records used to enter approved projects in
  the IIT submission portal. A fully approved project first appears in a
  read-only, term-scoped preview; an Officer explicitly imports it into a
  linked official entry. Treasurers and admins can also create or edit official
  entries manually.

Each official line-item row includes:

| Field | Notes |
| --- | --- |
| Project Name/Section | Identifies the approved project or budget grouping. |
| Project Description | Brief portal-ready context. |
| Line Item | The item or expenditure being requested. |
| Link | Vendor/product/supporting URL; validate allowed URL schemes. |
| Unit Price | Decimal amount in the entry currency. |
| Quantity | Positive decimal or integer according to the final portal rule. |
| Vendor | Supplier name. |
| Name | Portal/contact or responsible-name field; define exact IIT meaning before release. |
| Total Cost | Calculated from unit price × quantity, with any approved override explicitly labelled and audited. |
| Notes | Internal budget context, with visibility rules defined before implementation. |

Plan:

1. Map existing approved project purchase items into a preview of official rows
   without changing the source submission.
2. **Complete:** require an explicit import action before creating linked
   official rows; it is idempotent per project and term, so retries cannot
   duplicate records. Imported rows retain a visible project-name grouping.
   The user verified preview, import, legacy-name placeholders, and merged-row
   grouping in commits `c46aa3d`, `c395bbe`, `a7a014a`, `83c5754`, and
   `f450c59`. The preview and budget-readiness details are collapsed by
   default; adjacent readiness issues now appear as readable line-item ranges.
3. Support manual official rows for capital items that did not begin as member
   submissions, with the same validation and audit rules.
4. Provide a portal-friendly export after the IIT submission format is
   confirmed; do not assume Excel column names alone are a complete contract.
5. Test approval creation, duplicate prevention, manual edits, linked-source
   integrity, multiple currencies, and Treasurer/admin authorization.

### 2. Events

**Initial worksheet complete:** Events and Programming has a separate,
term-scoped three-column table for Event Name, optional Description, and
Budget Amount. A new table begins with 15 `ITR Workshop` rows at USD 200 each.
Rows are removed by clearing their Event Name; no UI can create more than 15.
The browser clamps an edited amount to the remaining shared allowance, and the
API independently rejects a saved total above USD 3,000. This is intentionally
not yet the full approval/documentation workflow below.

Provide an editable budget-entry form and official event records with:

- Event Name
- Explain How Your Event Ties to Your Mission/Vision
- Outline Reasoning For Costs

The final design should support one or more associated cost rows, an approval
state, supporting documentation, and inclusion in the currency-grouped Total
view. Test incomplete drafts, approval, edit permissions, and totals.

### 3. Lab Items

This section uses the Projects & Capital Items line-item table for official Lab
budget entries. It displays this guidance exactly or with approved copy edits:

> The Robotics Club is homed in the Elevate Underground Lab, a space shared
> between Robotics and Cosplay Club. These items help maintain the space and
> continue creating a welcoming and clean space for students to work in.

Plan:

1. Keep Lab Items budget rows separate from inventory quantities and stock
   records; a budget entry does not reserve, purchase, or receive inventory.
2. Allow Treasurers and admins to create and edit line items using the same
   money, vendor, link, quantity, total, and notes rules as capital items.
3. Add a future integration point for item receipt/inventory intake, but do not
   automatically modify inventory in the initial release.

### 4. Conferences & Competitions

**Initial worksheet complete:** this tab starts empty with an Add competition
button and supports no more than 10 collapsed request forms. Each summary
shows its conference description or `Unnamed`. Required form fields and cost
documents are validated on save. Optional travel method plus distance offers
guidance at USD 0.76 per mile; it does not automatically change the stated
transportation cost. Entry totals and the combined total are shown in USD.

Build a request form whose approved expenditures contribute to the Total view.
The form captures:

- Description of Conference
- Selection process (how attendees and count are chosen)
- Date of Conference
- Commitment Made
- Type of Conference
- Number of People going
- Number of executive-board attendees (minimum one)
- Whether anyone is presenting and what they are presenting
- Cost of Registration and a supporting document
- Cost of Transportation and a supporting document
- Cost of Lodging

Display the transportation guidance:

> Plane (approximately $303 per person as of 11/25) or driving. Mileage
> guidance in the initial worksheet is reimbursed at 76 cents per mile.

Plan:

1. Validate attendee counts, require at least one executive-board attendee,
   validate dates, and require a supporting document for registration and
   transportation when a cost is entered.
2. Preserve each cost category separately, then calculate a transparent total
   in the selected currency. Do not imply that the guidance amount is a live
   quote.
3. Separate member submission from Treasurer/admin approval and official
   budget-entry creation.
4. Test missing documents, count constraints, approval/rejection, edits,
   permissions, and total inclusion.

### 5. Total

The Total tab is a read-only budget summary by default. It should:

- show currency-grouped cards for Projects & Capital Items, Events and
  Programming, Lab Items, Conferences & Competitions, and the overall total
  (initial implementation complete);
- show approved and planned totals separately where useful;
- group totals by currency and by the four contributing budget sections;
- offer drill-down links back to source official entries;
- make pending, rejected, archived, and draft inclusion rules explicit;
- avoid treating a calculated total as an accounting ledger or a guarantee of
  available funds.

### Delivery sequence

1. Confirm the Excel sheet's fields, formulas, approval meanings, currency
   practices, and IIT portal requirements with the Treasurer.
2. Design the shared durable schema, migration/import process, audit trail,
   and role matrix.
3. Add the five-tab shell and read-only Total summary behind Treasurer/admin
   authorization.
4. Implement Projects & Capital Items official records and approval linkage.
5. Implement Events, then Lab Items, then Conferences & Competitions as
   separately testable parent items.
6. Conduct an Excel parallel-run, reconcile totals, train officers, and only
   then designate the dashboard as the working budget tool.

### Out of scope for the first release

- Automatic purchasing, reimbursement, inventory receipt, or stock changes.
- Direct submission to the IIT portal unless its supported integration contract
  is approved and tested.
- Email notifications; they remain governed by the deferred-email requirements
  in `IMPLEMENTATION_CHECKLIST.md`.

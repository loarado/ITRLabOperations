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

### [ ] Next parent item: authorized President and Treasurer handoffs

The assignment records already retain effective dates and audit events, but
the initial rollout intentionally does not allow anyone to replace a President
or Treasurer through the application. Before building high-value approvals or
official budget records, define and implement a safe leadership-handoff flow.

1. Define who may initiate, approve, cancel, and complete each handoff. A
   President must not be able to silently appoint their own replacement or
   unilaterally replace the Treasurer without the agreed authorization rule.
2. Require the target to be an existing member account, validate the effective
   date, end the prior active assignment atomically, and record all actors and
   reasons in the immutable assignment history.
3. Prevent more than one active President or Treasurer and reject stale,
   expired, or self-conflicting handoff attempts at the API.
4. Provide a narrowly scoped management UI distinct from ordinary Officer
   access management.
5. Test both role handoffs, cancellation/expiry behavior, concurrent attempts,
   unauthorized requests, and the prior holder losing protected access.

The later high-value workflow will require independent, separately recorded
Treasurer and President approvals for qualifying USD requests; it must not be
combined with this handoff item.

### Future access and high-value approval model

1. Define a durable officer-assignment model for the currently assigned
   Treasurer and President. Assignments need an effective start/end date,
   change history, and an authorized handoff process so annual officer changes
   do not require source-code or environment-variable edits.
2. A project or conference/competition request with a total over **$500 USD**
   requires approval from both the currently assigned Treasurer and President
   before it becomes an approved official budget record. Store each approval
   separately with its actor, role, timestamp, and decision; one approval must
   not overwrite the other.
3. Define the currency policy before release. Until an approved conversion
   policy exists, a request in a non-USD currency must not be silently assessed
   against the $500 USD threshold; require an explicit USD-equivalent review or
   a separately approved threshold decision.
4. Changes that raise an already-approved request above $500, change its
   currency, or materially change its scope must return it to the appropriate
   approval state. Record the reason in the activity history.
5. Below the threshold, any authorized admin may view and edit the remaining
   officer-managed aspects of the budget workspace. This does not grant members
   administrative access or expose private Treasury data.
6. Test member/admin UI separation, API authorization, Treasurer/President
   handoffs, both approval orders, stale-role denial, threshold changes,
   non-USD handling, and audit history.

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
2. Events
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
  the IIT submission portal. Approving a project submission creates a linked
  official entry automatically. Treasurers and admins can also create or edit
  official entries manually.

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
2. Require an explicit approval action before creating linked official rows;
   make the action idempotent so retries cannot duplicate records.
3. Support manual official rows for capital items that did not begin as member
   submissions, with the same validation and audit rules.
4. Provide a portal-friendly export after the IIT submission format is
   confirmed; do not assume Excel column names alone are a complete contract.
5. Test approval creation, duplicate prevention, manual edits, linked-source
   integrity, multiple currencies, and Treasurer/admin authorization.

### 2. Events

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

> Plane (approximately $303 per person as of 11/25) or driving (gas is
> reimbursed at 70 cents/gallon).

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

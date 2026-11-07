# ITR Lab Operations implementation checklist

This is the working plan for approved workflow improvements. It is intentionally
implemented **one parent item at a time**, only after a new user request. It is
not permission to begin a future item automatically.

## How this checklist is used

1. Start one item only when explicitly requested.
2. Confirm the working tree is clean and inspect the affected flow before editing.
3. Keep existing Neon project data valid. New JSON fields must be optional and
   default safely for already-submitted projects.
4. Add focused regression coverage, deploy only the scoped change, and let the
   user test it in production.
5. Leave the parent checkbox unchecked until the user confirms the feature is
   complete after testing. Then make a documentation-only commit that changes it
   to `[x]` and records the final commit below it.
6. Do not combine later checklist items into the active item without explicit
   direction.

## Current baseline and constraints

- Production is Vercel serverless Python/FastAPI backed by Neon Postgres.
- Members own and can edit their submitted projects. Treasurers review projects.
  Admins currently manage Lab Map and Inventory through the admin session.
- Project data is stored as JSON in Neon, so additive optional fields do not
  require a destructive database migration.
- A single optional `documentationUrl` is currently available. Item 8 replaces
  it with backward-compatible multiple named links; it must not erase existing
  documentation URLs.
- Inventory suggestions never reserve stock. That remains true after item 9.
- Test the production deployment at <https://itr-lab-operations.vercel.app/>.

## Shared safety checklist for every item

- [ ] Define affected roles and permissions before editing.
- [ ] Preserve existing project records and API clients with safe defaults.
- [ ] Add or update focused automated tests.
- [ ] Run syntax/whitespace checks and the relevant local test suite.
- [ ] Deploy, then manually test the affected member, treasurer, and/or admin
      flow in production.
- [ ] Commit only scoped files with a descriptive message.

---

## Approved roadmap

### [x] 1. Member project-first dashboard and status timeline

**Approved behavior**

- A signed-in member who already owns projects sees those projects before a new
  submission form.
- The new-project form becomes a compact “New project” action or separate
  collapsible section rather than the default dominant screen.
- Each project shows a clear status timeline based on treasurer activity.
- Opening a project replaces the project-card list with a full project detail
  view, with an explicit control to return to all projects.
- When a project has purchase items, its detail view shows a compact editable
  purchase list with an `Add item` action. Projects without items do not show
  an empty purchase-list section.
- `Edit project details` opens the submission form by itself, so the project
  detail and timeline are not duplicated above the form.
- Logged-out visitors see a clear view-only notice at the top of the dashboard.

**Implementation plan**

1. Make the member dashboard load “My projects” first when at least one project
   exists; keep an obvious `New project request` action.
2. Add a project summary/detail view with current status, submitted date, last
   update, requested estimate, project details, supporting documentation, and
   future visible reviewer information. It must replace—not appear beneath—the
   project-card list, and provide a `Back to all projects` action.
3. Build a timeline that can initially show submitted/current status from the
   existing fields, then accept later events from items 2, 7, and 11 without a
   redesign.
4. Preserve the current draft form and local draft recovery; do not discard a
   partially completed request merely because a member has existing projects.
5. Render purchase items only when present, showing name and calculated item
   total with focused `Edit item` and `Add item` actions that open the existing
   edit form.
6. Keep the edit form separate from the list/detail state and label its entry
   action `Edit project details`.
7. Test a logged-out visitor, a new member, a member with one project, a member
   with several projects, purchase-item editing/adding, editing an existing
   project, and opening the form for a new project.

**Dependencies / future integration**

- Item 11 adds formal decision events.
- Item 2 adds conversation events.
- Item 7 provides the durable activity history that enriches this timeline.

**Completion record:** Base project-first dashboard and timeline were committed
in `24dc865`; the detail-view, purchase-list, visitor notice, separate-edit
screen, and Treasury delete refinements were committed in `393d73d`. The user
verified the complete item in production on November 6, 2026.

### [x] 2. Member–treasurer project comments and small private notes area

**Approved behavior**

- Members and treasurers can exchange project comments visible to the project
  owner and treasurer.
- Treasurer private notes remain a small, clearly labelled treasurer-only area.
- Members must never see private treasury notes.

**Implementation plan**

1. Add a project-comment data model with author, role, text, timestamp, and
   project ID. Comments are append-only at first to protect the audit trail.
2. Add authenticated API routes that allow only the owner or a treasurer to read
   and write that project’s shared comments.
3. Render the member-visible `Project messages` board in the project detail
   view and a separate `Project messages` action in Treasury. Keep it outside
   the Treasury planning-record form.
4. Keep the existing `treasuryNotes` field private; visually separate it from
   the shared thread and label it `Private treasury notes`.
5. Let a Treasurer include an optional review message beside private notes;
   submit it atomically with the review and surface it in the member timeline.
   General project messages remain outside the timeline. Item 5 later adds an
   unread indicator.
6. Test authorization: another member cannot read/write the thread; an admin can
   read it only after item 12 grants that role explicitly.

**Completion record:** Shared project-message storage and authorization were
committed in `6a34f48`; the Treasury review-message workflow and timeline
refinements were committed in `de186d0` and `9df0024`. The user verified the
complete member/Treasury messaging and private-note separation in production
on November 6, 2026.

### [x] 3. Non-invasive project readiness checklist

**Approved behavior**

- Show helpful, non-blocking guidance while completing a request and/or on its
  review screen.
- Explain what would improve the chance of approval without forcing optional
  material for Idea or Planned projects.

**Implementation plan**

1. Add a compact checklist panel near the project form, not a modal or
   interruption.
2. Mark required fields separately from recommendation items. Required rules
   remain server-enforced; recommendations do not block submission.
3. Suggested checklist items: clear description, estimate amount/basis,
   supporting documentation, team/contact details, and purchase items when
   appropriate for the selected stage.
4. Make Procurement-ready guidance stricter while retaining the existing
   purchase-list requirement.
5. Recalculate it live without expensive inventory/API requests.
6. Test blank, Idea, Planned, and Procurement-ready requests.

**Completion record:** Implemented in `ae22ffc`; verified in production by the
user on November 6, 2026.

### [x] 4. Review and finalize project submission

**Approved behavior**

- Before the first final submission, a member can review their entire request.
- A single main `Edit request` action returns to the form; no per-section edit
  links are required.
- If important optional information is absent, show brief contextual text beside
  the relevant part explaining how it could improve approval chances.

**Implementation plan**

1. Change the form’s primary progression to `Review request`, keeping entered
   data in the existing draft mechanism.
2. Add a read-only review screen that renders project, estimate, purchase list,
   documentation, and readiness guidance.
3. Use normal server validation on the final `Submit project request` action;
   never rely solely on the browser review screen.
4. Keep a single `Edit request` action that restores the exact draft.
5. Ensure edit-and-save of already submitted projects remains a separate,
   clearly labelled workflow and is not mistaken for a new submission.
6. Test browser refresh, cancellation, invalid required fields, and final
   submission from the review screen.

**Completion record:** Implemented in `9ff7cce`; verified in production by the
user on November 6, 2026.

### [x] 5. In-app change indicator; defer email

**Approved behavior**

- A small red dot/badge—not a pop-up—appears when a member has unread changes
  on one of their projects.
- Opening/checking the changed project clears the indicator for that member.
- Email notifications are deferred until a proper sender/domain and delivery
  plan exists.

**Implementation plan**

1. Define which events create an unread change: a treasurer comment, status or
   decision change, and visible documentation/timeline update.
2. Store per-member read markers rather than a global “read” boolean, so one
   owner’s action cannot clear another user’s state.
3. Add a small red badge to the member project list and detail navigation; do
   not use intrusive dialogs.
4. Mark events read only after the project detail is opened successfully.
5. Add a future-only email subsection after the feature describing required
   sender authentication, opt-in rules, and delivery testing. Do not implement
   email in this item.
6. Test fresh sign-in, multiple projects, refresh, and a status/comment change.

**Completion record:** Implemented in `c8c8ed0`; verified in production by the
user on November 6, 2026. Email remains explicitly deferred.

**Future email delivery requirements (not implemented):** Use an authenticated
sender/domain, obtain and honor member opt-in/preferences, and test delivery
and unsubscribe handling before sending project-update email.

### [~] 6. Treasurer cost-first review queue — deferred

**Approved behavior**

- Make requested cost/estimate the most prominent fact on each submitted
  project.
- Add sort by requested cost; extensive filtering is intentionally out of scope
  because the review queue is expected to stay small.

**Implementation plan**

1. Promote requested amount and currency in each treasury project card.
2. Add a clear sort control for highest-to-lowest and lowest-to-highest request
   cost, with a sensible default documented in the UI.
3. Handle multiple currencies honestly: sort by numeric value only within a
   selected currency or group cards by currency; never silently compare USD and
   non-USD amounts as equivalent.
4. Preserve current search and status filter behavior.
5. Test empty queues, equal values, unknown/invalid data protection, and more
   than one currency.

**Deferred record:** November 6, 2026. The Treasurer Dashboard will no longer
be updated with this cost-first review queue.

### [x] 7. Durable project activity log for treasurers and admins

**Approved behavior**

- Treasurers and admins can read a durable project activity log.
- The log records meaningful project events, not every page view.

**Implementation plan**

1. Define a server-side event schema: project submitted, owner edit, shared
   comment, treasurer decision/status change, documentation change, and delete.
2. Write events in the same database transaction as the relevant change so an
   event cannot claim an update that did not save.
3. Provide read-only routes/views for treasurer and, after item 12, admin.
4. Redact private treasury note text from general event payloads; log that a
   private note changed without exposing its contents.
5. Reuse these events for the member timeline, while filtering out internal-only
   entries.
6. Test role-based visibility and the delete/audit retention policy before
   allowing destructive actions.

**Completion record:** Implemented with transactional, retained project audit
events, role-filtered activity APIs, member timeline reuse, and the Treasury
activity-log view on November 6, 2026.

### [ ] 8. Multiple named supporting-documentation links with required checks

**Approved behavior**

- Members may add any number of optional documentation links.
- Each link has a short human-readable name and a visible check state.
- A failed check shows a clear error and blocks final submission while that link
  is present.
- A project may still be submitted with zero documentation links.

**Implementation plan**

1. Replace the single form input with an add/remove list of `{label, url}`
   entries. Migrate an existing `documentationUrl` into one labelled entry such
   as `Supporting documentation` without deleting it.
2. Validate labels, URL length, and `http`/`https` scheme both in browser and
   server code.
3. Add a dedicated, protected link-check endpoint with strict SSRF protections:
   reject private/local IP ranges, re-check redirects, restrict schemes/ports,
   use short timeouts, limit redirects and response bytes, and never return
   fetched document contents to the browser.
4. Use `HEAD` with a bounded `GET` fallback for hosts that reject `HEAD`.
   Persist only the check result/time, not remote document data.
5. Present pending/pass/fail state beside every link. On failure, show a visible
   explanation and prevent review-finalization/submission until the link is
   removed or passes.
6. Treat permission-denied/private documents as failed checks, so submitters
   must share a viewable link with reviewers.
7. Display labelled approved links to members and treasurers, opening with
   `noopener noreferrer`.
8. Test redirects, invalid schemes, private-network targets, timeouts, 403/404,
   an existing single-link project, no-link submission, and multiple links.

**Completion record:** _Not started._

### [ ] 9. Inventory consideration with map location links

**Approved behavior**

- Selecting an inventory suggestion does more than say “item considered.”
- The member can see recorded item locations and open the corresponding Lab Map
  location.
- It remains a planning aid only; no reservation or stock deduction occurs.

**Implementation plan**

1. Enrich suggestion results with safe location labels and map targets already
   known to the inventory API.
2. After selecting an item, show a compact selected-inventory card in the
   purchase item containing its name, current recorded locations, and `View on
   Lab Map` links.
3. Use the existing map query/highlight behavior rather than inventing a second
   map navigation system.
4. Persist only the inventory item ID with the project item; locations must be
   read live so moves/renames do not leave stale project data.
5. Show the same inventory/map context to treasurers when reviewing purchase
   items.
6. Test no location, one location, multiple locations, archived stock, and a
   later map rename/removal.

**Completion record:** _Not started._

### [x] 10. Inventory availability warnings — declined

**Decision:** Do not add availability/quantity warnings to project suggestions.
The inventory’s present purpose is to show whether an item exists and where it
is, and most records do not have reliable quantity/availability detail. Item 9
must not imply availability or reservation.

### [ ] 11. Treasurer decision template visible to project submitters

**Approved behavior**

- Treasurers record a clear decision/reason when approving, declining, or
  requesting changes.
- Submitters can see the member-visible decision information.
- Only treasurers can approve, decline, or add treasurer decisions/comments.

**Implementation plan**

1. Separate member-visible decision fields from private treasury planning notes.
   Proposed visible fields: status, decision reason, approved amount/currency,
   funding source when appropriate, decision timestamp, and treasurer display
   name/role.
2. Require a decision reason for `approved`, `declined`, and `needs-details`;
   validate it server-side.
3. Add clear treasurer controls that save the decision atomically with its
   activity-log event.
4. Render the latest decision prominently in the member project detail and
   status timeline.
5. Do not expose `treasuryNotes` in this response or through member APIs.
6. Test permissions, decision changes, required reasons, amount/currency,
   visible versus private data, and audit history.

**Completion record:** _Not started._

### [ ] 12. Admin dashboard with read-only project oversight and deletion

**Approved behavior**

- Add an Admin Dashboard accessible only to an existing admin session.
- Admins can view all project information, shared comments, activity, and
  documentation, and can delete projects.
- Admins cannot approve, decline, or add treasurer comments/decisions.
- Treasurers retain exclusive approval/denial and treasurer-comment authority.

**Implementation plan**

1. Add a dedicated admin-only API authorization check; do not treat a member or
   treasurer login as admin access.
2. Add an Admin Dashboard route and navigation entry that only loads project
   data after admin authentication.
3. Provide a read-only project list/detail view with owner, estimate,
   documentation, shared comments, and activity log.
4. Add project deletion with an explicit confirmation that names the target.
   Record a deletion audit event and decide/test whether dependent comments and
   treasury records are retained or deleted consistently.
5. Hide or disable all treasury-decision actions in the admin UI and enforce
   that prohibition server-side.
6. Test admin, treasurer, ordinary member, logged-out access, unauthorized
   deletion, and post-delete behavior across member and treasury views.

**Completion record:** _Not started._

---

### [ ] 13. Project sharing and co-editor permissions

**Approved behavior**

- A project owner can share a project with existing member accounts by searching
  for a name or email address.
- A shared member can edit project details, including the purchase list, but
  cannot make treasury decisions or view private treasury notes.
- Owners can later review and revoke co-editor access.

**Implementation plan**

1. Design a dedicated project-collaborator relation in Neon rather than placing
   emails in project JSON. Store project ID, account ID, role, grant time, and
   revocation state with uniqueness constraints.
2. Add a privacy-preserving owner-only account search endpoint: require a
   meaningful query, return a small limited result set, and expose only the
   minimum display information needed to select an existing member.
3. Add owner-only grant and revoke endpoints, with server-side checks that the
   target is an existing member and that an owner cannot accidentally remove
   their own ownership.
4. Extend the member project query to return projects the member owns or may
   edit. Clearly distinguish owner and shared projects in the dashboard.
5. Permit owner or current co-editor edits in project update routes; keep
   sharing controls owner-only and preserve treasurer-only review actions.
6. Add a compact sharing control to the project detail/edit experience, with a
   confirmation before revocation. Do not expose private treasury notes.
7. Add collaboration grant/revoke/edit events to the future durable activity
   log in item 7, without blocking the initial sharing release on that log.
8. Test search privacy, authorization, owner edits, co-editor edits, revoked
   access, another member denied access, and Treasury visibility of co-editor
   changes.

**Completion record:** _Not started; planned only._

---

## Deferred work

### [ ] Email notifications

Do not implement until there is an approved sending domain, a provider, sender
authentication, delivery/bounce handling, and a clear anti-spam/opt-in policy.
In-app indicators in item 5 come first.

## Explicitly excluded from the current roadmap

- Automatic inventory reservation or stock deduction from a project request.
- Quantity/availability warnings based on incomplete inventory metadata.
- Large treasury filtering systems beyond cost sorting and the existing simple
  search/status controls.
- React, TypeScript, Tailwind, or a replacement frontend framework solely for
  these improvements.

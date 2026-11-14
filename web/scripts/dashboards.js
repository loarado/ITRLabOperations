'use strict';
const dashboard = document.body.dataset.dashboard;
const $ = (selector) => document.querySelector(selector);
const SESSION_HINT_KEY = 'itr-dashboard-session-hint';
function sessionHint() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_HINT_KEY) || 'null'); }
  catch { return null; }
}
function rememberSession(state) {
  try {
    sessionStorage.setItem(SESSION_HINT_KEY, JSON.stringify({
      member: !!state.member, user: state.user || null, username: state.username || '', role: state.role || 'visitor',
      roles: state.roles || [], admin: !!state.admin, officer: !!state.officer,
      treasurer: !!state.treasurer, president: !!state.president,
    }));
  } catch {}
}
const node = (tag, text = '', className = '') => {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
};
async function request(path, method = 'GET', body, signal) {
  const warmed = method === 'GET' && window.itrNavigationCache?.read(path);
  if (warmed) return warmed;
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The account service at this address returned a web page instead of an API response. Open itr-lab-operations.vercel.app and try again.');
  }
  if (!response.ok) {
    const error = new Error(result.detail || result.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (method === 'GET') window.itrNavigationCache?.store(path, result);
  if (response.ok && (path === '/api/logout' || path.startsWith('/api/account/') || (method !== 'GET' && (path.startsWith('/api/projects') || path.startsWith('/api/treasury') || path.startsWith('/api/budget'))))) window.itrNavigationCache?.clearPrivate();
  return result;
}
function id() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => n.toString(16).padStart(2, '0')).join('');
}
function setStatus(text, error = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('error', error);
}
function displayDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function actorLabel(role, name) {
  if (role === 'treasurer') return 'Treasury';
  if (role === 'president') return 'President';
  return name;
}
function budgetDecisionLabel(status) {
  return ({
    'approved-for-budget': 'Approved for budget',
    planned: 'Approved for budget',
    'needs-review': 'Needs review',
    'needs-details': 'Needs details',
    declined: 'Declined',
  })[status] || String(status || 'needs-review').replaceAll('-', ' ');
}
function isBudgetApproved(status) { return status === 'approved-for-budget' || status === 'planned'; }
function fundingStatusLabel(status) {
  return ({ 'not-requested': 'Not requested', pending: 'Awaiting OSL decision', 'osl-funded': 'OSL funded', declined: 'Declined' })[status] || String(status || '').replaceAll('-', ' ');
}
function inventoryMapLink(itemId) {
  // Match the Lab Inventory action exactly: the map resolves the item's live
  // stock locations, highlights every match, and opens a single shelf/bin.
  return `lab_overview.html?item=${encodeURIComponent(itemId)}`;
}
function inventoryContextCard(context) {
  const card = node('section', '', 'selected-inventory-card');
  card.append(node('strong', 'Selected lab inventory item'), node('span', context.name, 'muted'));
  const locations = context.stocks || [];
  if (!locations.length) card.append(node('small', 'No active recorded locations.', 'hint'));
  else {
    const list = node('ul');
    locations.forEach((stock) => {
      const row = node('li');
      const link = document.createElement('a');
      link.href = inventoryMapLink(context.itemId);
      link.textContent = `View on Lab Map: ${stock.label}`;
      row.append(link);
      list.append(row);
    });
    card.append(node('small', 'Current recorded locations:', 'hint'), list);
  }
  return card;
}

if (dashboard === 'projects') setupProjects();
if (dashboard === 'treasury') setupTreasury();
if (dashboard === 'admin') setupAdmin();

function setupAdmin() {
  let projects = [];
  const formatMoney = (estimate = {}) => `${estimate.currency || ''} ${estimate.amount || 'Not specified'}`.trim();
  const renderDetail = (project) => {
    const detail = $('#adminProjectDetail'); detail.hidden = false; detail.replaceChildren();
    detail.append(node('h3', project.title), node('p', `${project.owner?.name || project.lead} · ${project.contact}`),
      node('p', project.description), node('p', `Requested: ${formatMoney(project.estimate)}`));
    if (project.treasury?.status) detail.append(node('p', `Treasury status: ${project.treasury.status.replaceAll('-', ' ')}`));
    if (project.lineItems?.length) detail.append(node('p', `Purchase items: ${project.lineItems.map((item) => item.name).join(', ')}`));
    if (project.comments?.length) {
      const comments = node('section', '', 'project-discussion'); comments.append(node('h4', 'Shared project messages'));
      project.comments.forEach((comment) => comments.append(node('p', `${comment.authorName}: ${comment.text}`)));
      detail.append(comments);
    }
  };
  const render = () => {
    const host = $('#adminProjects'); host.replaceChildren();
    projects.forEach((project) => {
      const card = node('article', '', 'member-project-card');
      card.append(node('h3', project.title), node('p', `${project.owner?.name || project.lead} · ${project.stage.replaceAll('-', ' ')}`),
        node('strong', `Requested: ${formatMoney(project.estimate)}`));
      const open = node('button', 'View project'); open.type = 'button'; open.addEventListener('click', () => renderDetail(project)); card.append(open); host.append(card);
    });
    if (!projects.length) host.append(node('p', 'No project requests found.', 'inventory-empty'));
  };
  const load = async () => { const result = await request('/api/admin/projects'); projects = result.projects || []; render(); };
  const session = async () => {
    const state = await request('/api/session'); const officer = state.role === 'admin';
    $('#adminAccess').textContent = officer ? 'ITR Officer · project oversight' : 'Officer sign-in required';
    $('#adminAuth').textContent = officer ? 'Log out' : 'Sign in'; $('#adminNotice').hidden = officer; $('#adminProjectsCard').hidden = !officer;
    if (officer) await load();
  };
  $('#adminAuth').addEventListener('click', async () => { const state = await request('/api/session'); if (state.role === 'admin') { await request('/api/logout', 'POST', {}); await session(); } else $('#adminLogin').showModal(); });
  $('#cancelAdminLogin').addEventListener('click', () => $('#adminLogin').close());
  $('#adminLoginForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await request('/api/account/login', 'POST', { email: $('#adminEmail').value, password: $('#adminPassword').value }); $('#adminPassword').value = ''; $('#adminLogin').close(); await session(); } catch (error) { $('#adminLoginError').textContent = error.message; } });
  $('#adminRefresh').addEventListener('click', () => load().catch((error) => { $('#adminFeedback').textContent = error.message; }));
  session().catch((error) => { $('#adminFeedback').textContent = error.message; });
}

function setupProjects() {
  const form = $('#projectForm');
  const savedKey = 'itr-project-request-draft';
  let itemNumber = 0;
  let editingProjectId = null;
  let member = null;
  let projects = [];
  let selectedProject = null;
  let restoredDraft = false;
  const suggestionState = new WeakMap();
  const vendorSuggestionState = new WeakMap();

  function setProjectLoading(loading) {
    $('#projectLoading').hidden = !loading;
  }

  function money(estimate = {}) {
    return `${estimate.currency || ''} ${estimate.amount || 'Not specified'}`.trim();
  }
  function statusValue(project) {
    return project.treasury?.status || project.status || 'submitted';
  }
  function statusLabel(status) {
    return String(status || 'submitted').replaceAll('-', ' ');
  }
  function approvalSummary(project) {
    const approvals = project.approvals || {}, decisions = approvals.decisions || {};
    const approved = Object.values(decisions).filter((decision) => isBudgetApproved(decision.status) && decision.approvedAmount);
    if (approvals.fullyApproved) {
      const amounts = approved.map((decision) => Number(decision.approvedAmount)).filter(Number.isFinite).sort((a, b) => a - b);
      const currency = approved[0]?.currency || project.estimate?.currency || 'USD';
      const amount = amounts.length ? (amounts[0] === amounts.at(-1) ? amounts[0] : `${amounts[0]}–${amounts.at(-1)}`) : 'an amount to be confirmed';
      return `Fully approved for the budget: ${currency} ${amount}`;
    }
    return null;
  }
  function unreadBadge() {
    const badge = node('span', '', 'project-unread');
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'Unread project changes');
    badge.title = 'Unread project changes';
    return badge;
  }
  async function markProjectRead(project, detail) {
    if (!project.hasUnreadChanges) return;
    try {
      await request('/api/projects/' + encodeURIComponent(project.projectId) + '/read', 'POST', {});
      project.hasUnreadChanges = false;
      const listed = projects.find((candidate) => candidate.projectId === project.projectId);
      if (listed) listed.hasUnreadChanges = false;
      detail.querySelectorAll('.project-unread').forEach((badge) => badge.remove());
      renderProjects();
    } catch {
      // The detail is still available; leave the indicator until a later successful read marker update.
    }
  }
  function checklistItem(host, text, complete) {
    const item = node('li', text, complete ? 'ready' : 'pending');
    item.dataset.ready = String(complete);
    host.append(item);
  }
  function updateReadiness() {
    const required = $('#readinessRequired');
    const recommended = $('#readinessRecommended');
    if (!required || !recommended) return;
    required.replaceChildren();
    recommended.replaceChildren();
    const filled = (selector) => $(selector).value.trim().length > 0;
    const stage = $('#project-stage').value;
    const items = [...$('#lineItems').children];
    checklistItem(required, 'Project name', filled('#project-title'));
    checklistItem(required, 'Project lead and contact details', filled('#project-lead') && filled('#project-contact'));
    checklistItem(required, 'Project description', filled('#project-description'));
    checklistItem(required, 'USD estimate amount, confidence, and basis',
      filled('#estimate-amount') && filled('#estimate-confidence') && filled('#estimate-basis'));
    if (stage === 'procurement-ready') {
      const hasPurchaseItem = items.some((item) => ['.item-name', '.item-quantity', '.item-unit', '.item-price']
        .every((selector) => item.querySelector(selector).value.trim()));
      checklistItem(required, 'At least one complete purchase item for this Procurement-ready request', hasPurchaseItem);
      const itemDetailsComplete = items.length > 0 && items.every((item) => {
        const specification = item.querySelector('.item-specification').value.trim();
        const vendor = item.querySelector('.item-vendor').value.trim();
        const link = item.querySelector('.item-link').value.trim();
        return specification && (vendor || link);
      });
      checklistItem(recommended, 'For every purchase item, add part details and a vendor or product link', itemDetailsComplete);
    } else if (stage === 'planned') {
      checklistItem(recommended, 'Add a purchase list when you know what the project will need', items.length > 0);
    } else {
      checklistItem(recommended, 'Purchase items can wait until your Idea is better defined', false);
    }
    checklistItem(recommended, 'Clear description of what you are making and why', $('#project-description').value.trim().length >= 40);
    checklistItem(recommended, 'Supporting documentation or a design/proposal link', readDocumentationLinks().length > 0);
    checklistItem(recommended, 'Team members or roles beyond the project lead', filled('#project-team'));
  }
  function updateEditorHeading() {
    const editing = !!editingProjectId;
    $('#projectEditorTitle').textContent = editing
      ? `Edit project: ${selectedProject?.title || 'project'}`
      : 'New project request';
    $('#projectEditorHint').textContent = editing
      ? 'Update your request and save the changes when you are ready.'
      : 'Start with any detail you have. Every request needs a best current cost estimate; submitting does not reserve or change lab inventory.';
    form.querySelector('[type=submit]').textContent = editing
      ? 'Save project changes'
      : 'Review request';
    $('#clearProject').textContent = editing ? 'Discard unsaved edits' : 'Clear form';
    $('#backToProjects').hidden = !projects.length;
  }
  function setEditorVisible(visible, focus = false) {
    $('#projectEditorCard').hidden = !visible;
    if (visible) $('#projectReviewCard').hidden = true;
    if (visible && projects.length) $('#myProjectsCard').hidden = true;
    if (!visible && projects.length) $('#myProjectsCard').hidden = false;
    updateEditorHeading();
    if (visible && focus) {
      $('#projectEditorCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('#project-title').focus();
    }
  }
  function emptyEditorFields() {
    itemNumber = 0;
    form.reset();
    $('#lineItems').replaceChildren();
    renderDocumentationLinks([{}]);
    $('#projectFeedback').textContent = '';
    subtotal();
  }
  function clearNewProjectForm() {
    editingProjectId = null;
    selectedProject = null;
    $('#projectReviewCard').hidden = true;
    emptyEditorFields();
    localStorage.removeItem(savedKey);
    restoredDraft = false;
  }
  function applyMember(state) {
    member = state.member ? state.user : null;
    $('#accountAccess').textContent = member
      ? `${member.name} · ${member.email}`
      : 'Member login required';
    $('#accountAuth').textContent = member ? 'Log out' : 'Sign in';
    $('#changePassword').hidden = !member;
    form.querySelector('[type=submit]').disabled = !member;
    $('#submitProjectRequest').disabled = !member;
    $('#projectVisitorNotice').hidden = !!member;
    if (!member) {
      projects = [];
      selectedProject = null;
      $('#myProjectsCard').hidden = true;
      setProjectLoading(false);
      setEditorVisible(true);
      return;
    }
    if (!$('#project-lead').value.trim()) $('#project-lead').value = member.name;
    if (!$('#project-contact').value.trim()) $('#project-contact').value = member.email;
  }
  async function session() {
    const state = await request('/api/session');
    rememberSession(state);
    applyMember(state);
  }
  const hintedMember = sessionHint();
  if (hintedMember?.member) applyMember(hintedMember);
  function timelineEvent(timeline, title, detail, timestamp, current = false) {
    const event = node('li', '', 'project-timeline-event');
    if (current) event.classList.add('current');
    event.append(node('strong', title));
    if (detail) event.append(node('span', detail, 'muted'));
    if (timestamp) {
      const time = node('time', displayDate(timestamp), 'muted');
      time.dateTime = timestamp;
      event.append(time);
    }
    timeline.append(event);
  }
  function activityDescription(event) {
    const labels = {
      project_submitted: 'Project submitted', owner_edit: 'Project details updated',
      documentation_changed: 'Supporting documentation changed', shared_comment: 'Project message posted',
      treasury_review: `Treasury status: ${statusLabel(event.payload?.status || 'updated')}`,
    };
    return labels[event.type] || 'Project activity updated';
  }
  async function loadMemberActivity(project, timeline) {
    try {
      const result = await request('/api/projects/' + encodeURIComponent(project.projectId) + '/activity');
      if (selectedProject?.projectId !== project.projectId || !result.events?.length) return;
      timeline.replaceChildren();
      result.events.forEach((event) => timelineEvent(timeline, activityDescription(event), ['treasurer', 'president'].includes(event.actorRole) ? `Updated by ${actorLabel(event.actorRole, event.actorName)}.` : '', event.occurredAt));
    } catch (_) { /* Keep the baseline timeline when activity is unavailable. */ }
  }
  function displayComments(host, comments) {
    host.replaceChildren();
    if (!comments.length) {
      host.append(node('p', 'No shared comments yet.', 'hint'));
      return;
    }
    comments.forEach((comment) => {
      const entry = node('article', '', 'project-comment');
      const heading = node('div', '', 'project-comment-heading');
      heading.append(node('strong', actorLabel(comment.authorRole, comment.authorName)),
        node('span', displayDate(comment.createdAt), 'muted'));
      entry.append(heading, node('p', comment.text));
      host.append(entry);
    });
  }
  async function loadMemberComments(project, host) {
    host.replaceChildren(node('p', 'Loading project discussion…', 'hint'));
    try {
      const result = await request('/api/projects/' + encodeURIComponent(project.projectId) + '/comments');
      if (selectedProject?.projectId !== project.projectId) return;
      displayComments(host, result.comments || []);
    } catch (error) {
      host.replaceChildren(node('p', error.message, 'error'));
    }
  }
  function showProjectList() {
    selectedProject = null;
    $('#myProjectsTitle').textContent = 'My projects';
    $('#myProjectsHint').textContent = 'Track project requests, review their current status, or start another request.';
    $('#myProjects').hidden = false;
    $('#memberProjectDetail').hidden = true;
    $('#backToProjectList').hidden = true;
    $('#newProject').hidden = false;
  }
  function collaboratorControls(project) {
    const section = node('section', '', 'project-discussion');
    section.append(node('h4', 'Co-editors'), node('p', 'Share this request with an existing member account.', 'hint'));
    const current = node('div'), search = document.createElement('input'), results = node('div');
    search.type = 'search'; search.placeholder = 'Search member name or email'; search.maxLength = 254;
    const find = node('button', 'Find member'); find.type = 'button';
    const refresh = async () => {
      const response = await request('/api/projects/' + encodeURIComponent(project.projectId) + '/collaborators'); current.replaceChildren();
      if (!response.collaborators.length) current.append(node('p', 'No co-editors yet.', 'hint'));
      response.collaborators.forEach((person) => { const row = node('p', `${person.name} · ${person.email}`); const revoke = node('button', 'Remove'); revoke.type = 'button'; revoke.addEventListener('click', async () => { if (confirm(`Remove ${person.name} as a co-editor?`)) { await request('/api/projects/' + encodeURIComponent(project.projectId) + '/collaborators/' + encodeURIComponent(person.id), 'DELETE'); await refresh(); } }); row.append(' ', revoke); current.append(row); });
    };
    find.addEventListener('click', async () => { const response = await request('/api/projects/' + encodeURIComponent(project.projectId) + '/collaborators/search?q=' + encodeURIComponent(search.value)); results.replaceChildren(); response.members.forEach((person) => { const add = node('button', `Add ${person.name}`); add.type = 'button'; add.addEventListener('click', async () => { await request('/api/projects/' + encodeURIComponent(project.projectId) + '/collaborators', 'POST', { userId: person.id }); results.replaceChildren(); search.value = ''; await refresh(); }); results.append(add); }); if (!response.members.length) results.append(node('p', 'No matching member accounts.', 'hint')); });
    section.append(current, search, find, results); refresh().catch((error) => { current.replaceChildren(node('p', error.message, 'error')); }); return section;
  }
  function showProjectDetail(project) {
    selectedProject = project;
    const detail = $('#memberProjectDetail');
    $('#myProjectsTitle').textContent = 'Project details';
    $('#myProjectsHint').textContent = 'Review your request, its current treasury status, and the items you plan to purchase.';
    $('#myProjects').hidden = true;
    detail.hidden = false;
    $('#backToProjectList').hidden = false;
    $('#newProject').hidden = true;
    detail.replaceChildren();
    const heading = node('div', '', 'card-heading');
    const headingText = node('div');
    headingText.append(node('h3', project.title));
    if (project.hasUnreadChanges) headingText.append(unreadBadge());
    const status = statusValue(project);
    headingText.append(node('span', statusLabel(status), `project-status status-${status}`));
    const edit = node('button', 'Edit project details');
    edit.type = 'button';
    edit.addEventListener('click', () => loadProject(project));
    heading.append(headingText, edit);
    const summary = node('div', '', 'member-project-summary');
    summary.append(
      node('p', `Requested: ${money(project.estimate)}`),
      node('p', `Estimate confidence: ${statusLabel(project.estimate?.confidence)}`),
      node('p', `Stage: ${statusLabel(project.stage)}`),
      node('p', `Project lead: ${project.lead}${project.contact ? ' · ' + project.contact : ''}`),
      node('p', `Submitted: ${displayDate(project.submittedAt)}`),
      node('p', `Last project update: ${displayDate(project.updatedAt)}`),
    );
    if (project.nonItemCost && Number(project.nonItemCost) !== 0)
      summary.append(node('p', `Additional non-item cost: ${project.nonItemCost} ${project.estimate?.currency || 'USD'}`));
    if (project.team) summary.append(node('p', `Team: ${project.team}`));
    if (project.description) summary.append(node('p', project.description));
    if (project.estimate?.basis) summary.append(node('p', `Estimate basis: ${project.estimate.basis}`));
    const approvalText = approvalSummary(project);
    if (approvalText) summary.append(node('p', approvalText));
    Object.values(project.approvals?.decisions || {}).forEach((decision) => {
      if (isBudgetApproved(decision.status)) summary.append(node('p', `${actorLabel(decision.role, decision.actorName)} approved this for the budget${decision.approvedAmount ? `: ${decision.currency || 'USD'} ${decision.approvedAmount}` : ''}`));
    });
    appendDocumentationLinks(summary, project.documentationLinks || (project.documentationUrl ? [{ label: 'Supporting documentation', url: project.documentationUrl }] : []));
    const timelineHeading = node('h4', 'Project status timeline');
    const timeline = node('ol', '', 'project-timeline');
    timelineEvent(timeline, 'Project submitted', 'Your request is ready for treasury review.', project.submittedAt);
    if (project.updatedAt && project.updatedAt !== project.submittedAt)
      timelineEvent(timeline, 'Project details updated', 'You updated this request.', project.updatedAt);
    if (project.treasury?.status)
      timelineEvent(
        timeline,
        `Treasury status: ${statusLabel(project.treasury.status)}`,
        project.treasury.reviewHasMessage
          ? 'Treasury updated the project review with an attached message.'
          : 'Treasury updated the project review with no message.',
        project.treasury.updatedAt,
        true,
      );
    if (project.treasury?.fundingStatus)
      timelineEvent(timeline, `OSL funding: ${fundingStatusLabel(project.treasury.fundingStatus)}`, 'Treasury recorded the current external funding outcome.', project.treasury.updatedAt, true);
    else
      timelineEvent(timeline, 'Awaiting treasury review', 'A treasurer has not updated the review status yet.', null, true);
    detail.append(heading, summary, timelineHeading, timeline);
    if (project.collaborationRole === 'owner') detail.append(collaboratorControls(project));
    loadMemberActivity(project, timeline);
    const discussion = node('section', '', 'project-discussion');
    discussion.append(node('h4', 'Project messages'), node('p', 'Shared messages with Treasury and the President.', 'hint'));
    const comments = node('div', '', 'project-comments');
    discussion.append(comments);
    const commentField = document.createElement('textarea');
    commentField.maxLength = 4000;
    commentField.rows = 3;
    commentField.placeholder = 'Reply to Treasury or the President, or add a project update.';
    const commentLabel = node('label', 'Add a message', 'field');
    commentLabel.append(commentField);
    const feedback = node('p', '', 'error');
    const send = node('button', 'Post message');
    send.type = 'button';
    send.addEventListener('click', async () => {
      feedback.textContent = '';
      send.disabled = true;
      try {
        await request('/api/projects/' + encodeURIComponent(project.projectId) + '/comments', 'POST', { text: commentField.value });
        commentField.value = '';
        await loadMemberComments(project, comments);
      } catch (error) { feedback.textContent = error.message; }
      finally { send.disabled = false; }
    });
    discussion.append(commentLabel, feedback, send);
    detail.append(discussion);
    loadMemberComments(project, comments);
    markProjectRead(project, detail);
    if (project.lineItems?.length) {
      const purchases = node('section', '', 'member-purchase-list');
      purchases.append(node('h4', 'Purchase list'));
      project.lineItems.forEach((item, index) => {
        const itemRow = node('article', '', 'member-purchase-item');
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const total = Number.isFinite(quantity) && Number.isFinite(unitPrice)
          ? `${(quantity * unitPrice).toFixed(2)} ${project.estimate?.currency || 'USD'}`
          : 'Not specified';
        const itemText = node('div');
        itemText.append(node('strong', item.name || `Purchase item ${index + 1}`), node('span', `Total: ${total}`, 'muted'));
        const editItem = node('button', 'Edit item');
        editItem.type = 'button';
        editItem.addEventListener('click', () => loadProject(project, { itemIndex: index }));
        itemRow.append(itemText, editItem);
        purchases.append(itemRow);
      });
      const addItem = node('button', 'Add item');
      addItem.type = 'button';
      addItem.addEventListener('click', () => loadProject(project, { addItem: true }));
      purchases.append(addItem);
      detail.append(purchases);
    }
  }
  function renderProjects() {
    const host = $('#myProjects');
    host.replaceChildren();
    projects.forEach((project) => {
      const card = node('article', '', 'member-project-card');
      const status = statusValue(project);
      card.append(
        node('h3', project.title),
        node('span', project.collaborationRole === 'editor' ? 'Shared with you' : 'Project owner', 'muted'),
        node('span', statusLabel(status), `project-status status-${status}`),
        node('strong', `Requested: ${money(project.estimate)}`),
        node('p', `Last update: ${displayDate(project.updatedAt)}`, 'muted'),
      );
      if (project.hasUnreadChanges) card.querySelector('h3').append(' ', unreadBadge());
      const open = node('button', 'View project');
      open.type = 'button';
      open.addEventListener('click', () => showProjectDetail(project));
      card.append(open);
      host.append(card);
    });
  }
  async function loadMine(response = null) {
    if (!member) {
      setProjectLoading(false);
      return;
    }
    response = response || await request('/api/projects/mine');
    projects = response.projects || [];
    setProjectLoading(false);
    $('#myProjectsCard').hidden = !projects.length;
    if (!projects.length) {
      selectedProject = null;
      setEditorVisible(true);
      return;
    }
    renderProjects();
    if (selectedProject) {
      const refreshed = projects.find((project) => project.projectId === selectedProject.projectId);
      if (refreshed) showProjectDetail(refreshed);
      else showProjectList();
    } else showProjectList();
    $('#newProject').textContent = restoredDraft
      ? 'Continue unfinished request'
      : 'New project request';
    if (!editingProjectId) setEditorVisible(false);
  }
  function loadProject(project, options = {}) {
    editingProjectId = project.id || project.projectId;
    selectedProject = project;
    const fields = [
      ['title', '#project-title'], ['lead', '#project-lead'],
      ['contact', '#project-contact'], ['team', '#project-team'],
      ['description', '#project-description'],
      ['stage', '#project-stage'], ['nonItemCost', '#non-item-cost'],
    ];
    fields.forEach(([key, selector]) => { $(selector).value = project[key] || ''; });
    renderDocumentationLinks(project.documentationLinks || (project.documentationUrl ? [{ label: 'Supporting documentation', url: project.documentationUrl }] : []));
    Object.entries(project.estimate || {}).forEach(([key, value]) => {
      const input = $('#estimate-' + key);
      if (input) input.value = value;
    });
    itemNumber = 0;
    $('#lineItems').replaceChildren();
    (project.lineItems || []).forEach((item) => {
      const wrapper = itemFields();
      $('#lineItems').append(wrapper);
      Object.entries(item).forEach(([key, value]) => {
        const input = wrapper.querySelector(itemFieldSelector(key));
        if (input) input.value = value ?? '';
      });
      if (item.inventoryItemId) {
        wrapper.dataset.inventoryItemId = item.inventoryItemId;
        loadSelectedInventoryContext(wrapper);
      }
    });
    $('#projectFeedback').textContent = '';
    setEditorVisible(true, !options.addItem && !Number.isInteger(options.itemIndex));
    if (options.addItem) {
      const wrapper = itemFields();
      $('#lineItems').append(wrapper);
      wrapper.querySelector('.item-name').scrollIntoView({ block: 'center', behavior: 'smooth' });
      wrapper.querySelector('.item-name').focus();
    } else if (Number.isInteger(options.itemIndex)) {
      const target = $('#lineItems').children[options.itemIndex]?.querySelector('.item-name');
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus();
      }
    }
    setStatus(`Editing ${project.title}.`);
    subtotal();
  }
  function itemFields() {
    itemNumber += 1;
    const wrapper = node('article', '', 'project-line-item');
    wrapper.innerHTML = `<div class="card-heading"><h3>Purchase item ${itemNumber}</h3><button type="button" class="remove-item">Remove</button></div><div class="inventory-form-grid"><label class="field">Item name *<input class="item-name" maxlength="500" required></label><label class="field">Specification / part details<input class="item-specification" maxlength="2000"></label><label class="field">Quantity *<input class="item-quantity" inputmode="decimal" value="1" required></label><label class="field">Unit *<input class="item-unit" maxlength="100" value="each" required></label><label class="field">Unit price *<input class="item-price" inputmode="decimal" required></label><label class="field">Priority<select class="item-priority"><option value="needed">Needed</option><option value="critical">Critical</option><option value="nice-to-have">Nice to have</option></select></label><label class="field">Approved vendor<input class="item-vendor" maxlength="500" autocomplete="off"></label><label class="field">Product URL<input class="item-link" maxlength="2000" placeholder="https://…"></label></div><p class="hint">Type at least two characters, then select a supplier from IIT's approved vendor list.</p><div class="vendor-suggestions suggestions" aria-live="polite"></div><div class="selected-inventory" aria-live="polite"></div><div class="suggestions" aria-live="polite"></div>`;
    wrapper.querySelector('.remove-item').addEventListener('click', () => {
      suggestionState.get(wrapper)?.controller?.abort();
      vendorSuggestionState.get(wrapper)?.controller?.abort();
      suggestionState.delete(wrapper);
      wrapper.remove();
      subtotal();
      saveDraft();
    });
    const state = { controller: null, ticket: 0 };
    suggestionState.set(wrapper, state);
    const vendorState = { controller: null, ticket: 0 };
    vendorSuggestionState.set(wrapper, vendorState);
    let timer;
    wrapper.querySelector('.item-name').addEventListener('input', () => {
      clearTimeout(timer);
      state.controller?.abort();
      const ticket = ++state.ticket;
      const host = wrapper.querySelector('.suggestions');
      host.replaceChildren();
      if (wrapper.querySelector('.item-name').value.trim().length < 2) return;
      host.append(node('small', 'Searching lab inventory…', 'hint'));
      timer = setTimeout(() => suggestions(wrapper, ticket), 250);
    });
    let vendorTimer;
    wrapper.querySelector('.item-vendor').addEventListener('input', () => {
      clearTimeout(vendorTimer); vendorState.controller?.abort();
      const ticket = ++vendorState.ticket, value = wrapper.querySelector('.item-vendor').value.trim();
      const host = wrapper.querySelector('.vendor-suggestions'); host.replaceChildren();
      if (value.length < 2) return;
      host.append(node('small', 'Searching vendors…', 'vendor-searching'));
      vendorTimer = setTimeout(() => projectVendorSuggestions(wrapper, ticket, value), 180);
    });
    wrapper.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', () => {
      subtotal();
      saveDraft();
    }));
    return wrapper;
  }
  async function projectVendorSuggestions(wrapper, ticket, value) {
    const state = vendorSuggestionState.get(wrapper), host = wrapper.querySelector('.vendor-suggestions');
    if (!state || value.length < 2 || ticket !== state.ticket) return;
    const controller = new AbortController(); state.controller = controller;
    try {
      const data = await request('/api/vendors?q=' + encodeURIComponent(value), 'GET', undefined, controller.signal);
      if (ticket !== state.ticket || wrapper.querySelector('.item-vendor').value.trim() !== value) return;
      host.replaceChildren();
      if (!data.vendors.length) { host.append(node('small', 'No approved vendor matches. Keep typing or choose a listed supplier.', 'hint')); return; }
      data.vendors.forEach((vendor) => { const button = node('button', vendor, 'suggestion'); button.type = 'button'; button.addEventListener('click', () => { wrapper.querySelector('.item-vendor').value = vendor; host.replaceChildren(); saveDraft(); }); host.append(button); });
    } catch (error) {
      if (error.name !== 'AbortError' && ticket === state.ticket) host.replaceChildren(node('small', error.message, 'error'));
    } finally { if (state.controller === controller) state.controller = null; }
  }
  function fillFromInventory(wrapper, match) {
    const details = [match.description, match.category && `Category: ${match.category}`,
      match.keywords && `Keywords: ${match.keywords}`, match.notes && `Notes: ${match.notes}`]
      .filter(Boolean).join('\n').slice(0, 2000);
    const values = {
      name: match.name,
      specification: details,
      unit: match.priceUnit || match.stocks?.find((stock) => stock.unit)?.unit || '',
      unitPrice: match.unitPrice || '', vendor: match.vendor || '', productLink: match.productLink || '',
    };
    Object.entries(values).forEach(([key, value]) => {
      const input = wrapper.querySelector(itemFieldSelector(key));
      if (input && value) input.value = value;
    });
  }
  async function loadSelectedInventoryContext(wrapper) {
    const itemId = wrapper.dataset.inventoryItemId;
    const host = wrapper.querySelector('.selected-inventory');
    if (!itemId || !host) return;
    host.replaceChildren(node('small', 'Loading current recorded locations…', 'hint'));
    try {
      const context = await request('/api/inventory/items/' + encodeURIComponent(itemId) + '/context');
      if (wrapper.dataset.inventoryItemId === itemId) host.replaceChildren(inventoryContextCard(context));
    } catch (error) {
      if (wrapper.dataset.inventoryItemId === itemId) host.replaceChildren(node('small', 'This selected inventory item is no longer recorded.', 'hint'));
    }
  }
  async function suggestions(wrapper, ticket) {
    const state = suggestionState.get(wrapper);
    const name = wrapper.querySelector('.item-name').value.trim();
    const host = wrapper.querySelector('.suggestions');
    if (!state || name.length < 2 || ticket !== state.ticket) return;
    const controller = new AbortController();
    state.controller = controller;
    try {
      const data = await request('/api/inventory/suggestions?q=' + encodeURIComponent(name), 'GET', undefined, controller.signal);
      if (ticket !== state.ticket || wrapper.querySelector('.item-name').value.trim() !== name) return;
      host.replaceChildren();
      if (!data.results.length) {
        host.append(node('small', 'No recorded lab inventory matches.', 'hint'));
        return;
      }
      host.append(node('p', 'Possible lab inventory matches — verify before relying on them.', 'hint'));
      data.results.forEach((match) => {
        const button = node('button', `${match.name}${match.category ? ' · ' + match.category : ''}`, 'suggestion');
        button.type = 'button';
        const details = match.stocks.map((stock) => stock.tracking === 'exact' ? `${stock.label}: ${stock.quantity ?? 'unknown'} ${stock.unit}` : stock.tracking === 'availability' ? `${stock.label}: ${stock.availability}` : `${stock.label}: present`).join('; ') || 'No active recorded stock';
        button.title = details;
        button.addEventListener('click', () => {
          wrapper.dataset.inventoryItemId = match.itemId;
          fillFromInventory(wrapper, match);
          host.replaceChildren(node('p', `Using lab inventory details for: ${match.name}. This is a planning aid only; it does not reserve or deduct stock.`, 'hint'));
          wrapper.querySelector('.selected-inventory').replaceChildren(inventoryContextCard(match));
          saveDraft();
          subtotal();
        });
        host.append(button, node('small', details));
      });
    } catch (error) {
      if (error.name === 'AbortError' || ticket !== state.ticket) return;
      host.replaceChildren();
      host.append(node('small', error.message, 'error'));
    } finally {
      if (state.controller === controller) state.controller = null;
    }
  }
  function readItem(wrapper) {
    return {
      name: wrapper.querySelector('.item-name').value,
      specification: wrapper.querySelector('.item-specification').value,
      quantity: wrapper.querySelector('.item-quantity').value,
      unit: wrapper.querySelector('.item-unit').value,
      unitPrice: wrapper.querySelector('.item-price').value,
      priority: wrapper.querySelector('.item-priority').value,
      vendor: wrapper.querySelector('.item-vendor').value,
      productLink: wrapper.querySelector('.item-link').value,
      inventoryItemId: wrapper.dataset.inventoryItemId || null,
    };
  }
  function itemFieldSelector(key) {
    return '.item-' + ({ productLink: 'link', unitPrice: 'price' }[key] || key);
  }
  function documentationUrlError(value) {
    if (/\[.+\]\(.+\)/.test(value)) return 'Enter the URL itself, not Markdown link formatting. For example: https://example.com/proposal';
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.'))
        return 'Enter a complete public web address, such as https://example.com/proposal.';
      if (parsed.username || parsed.password) return 'Documentation links cannot include a username or password.';
      return '';
    } catch { return 'Enter a complete public web address, such as https://example.com/proposal.'; }
  }
  function documentationFields(link = {}) {
    const wrapper = node('article', '', 'project-line-item documentation-link');
    wrapper.innerHTML = `<div class="card-heading"><h3>Documentation link</h3><button type="button" class="remove-documentation">Remove</button></div><div class="inventory-form-grid"><label class="field">Link name *<input class="documentation-label" maxlength="200" placeholder="e.g. Design proposal"></label><label class="field">URL *<input class="documentation-url" type="url" maxlength="2000" inputmode="url" placeholder="https://…"></label></div><div class="documentation-check hint" aria-live="polite"></div><button type="button" class="check-documentation">Check link</button>`;
    wrapper.querySelector('.documentation-label').value = link.label || '';
    wrapper.querySelector('.documentation-url').value = link.url || '';
    const showCheck = (result) => {
      const host = wrapper.querySelector('.documentation-check');
      host.textContent = result.checkMessage || '';
      host.className = `documentation-check ${result.checkStatus === 'failed' ? 'error' : result.checkStatus === 'passed' ? 'ready' : 'hint'}`;
      wrapper.dataset.checkStatus = result.checkStatus || '';
      wrapper.dataset.checkedAt = result.checkedAt || '';
      wrapper.dataset.checkMessage = result.checkMessage || '';
    };
    if (link.checkStatus) showCheck(link);
    wrapper.querySelector('.remove-documentation').addEventListener('click', () => { wrapper.remove(); updateReadiness(); saveDraft(); });
    wrapper.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
      delete wrapper.dataset.checkStatus; delete wrapper.dataset.checkedAt; delete wrapper.dataset.checkMessage;
      wrapper.querySelector('.documentation-check').textContent = '';
      updateReadiness(); saveDraft();
    }));
    wrapper.querySelector('.check-documentation').addEventListener('click', async () => {
      const button = wrapper.querySelector('.check-documentation');
      const url = wrapper.querySelector('.documentation-url').value.trim();
      if (!url) return showCheck({ checkStatus: 'failed', checkMessage: 'Enter a URL before checking this link.' });
      const urlError = documentationUrlError(url);
      if (urlError) return showCheck({ checkStatus: 'failed', checkMessage: urlError });
      button.disabled = true; showCheck({ checkMessage: 'Checking link…' });
      try { showCheck(await request('/api/projects/documentation-check', 'POST', { url })); }
      catch (error) {
        const unavailable = error.message.includes('web page instead of its API response');
        showCheck({ checkStatus: 'failed', checkMessage: unavailable
          ? 'Link checking is unavailable on this server. This does not prevent submission.'
          : error.message });
      }
      finally { button.disabled = false; saveDraft(); }
    });
    return wrapper;
  }
  function renderDocumentationLinks(links) {
    const host = $('#documentationLinks');
    host.replaceChildren();
    links.forEach((link) => host.append(documentationFields(link)));
  }
  function readDocumentationLinks() {
    return [...$('#documentationLinks').children].map((wrapper) => ({
      label: wrapper.querySelector('.documentation-label').value,
      url: wrapper.querySelector('.documentation-url').value,
      ...(wrapper.dataset.checkStatus ? { checkStatus: wrapper.dataset.checkStatus, checkedAt: wrapper.dataset.checkedAt, checkMessage: wrapper.dataset.checkMessage } : {}),
    }));
  }
  function appendDocumentationLinks(host, links = []) {
    links.forEach((link) => {
      const anchor = document.createElement('a');
      anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      anchor.textContent = link.label;
      const row = node('p'); row.append(anchor);
      if (link.checkStatus === 'failed') row.append(node('span', ` · Link check error: ${link.checkMessage || 'not reachable'}`, 'error'));
      else if (link.checkStatus === 'passed') row.append(node('span', ' · Link checked', 'muted'));
      host.append(row);
    });
  }
  function data() {
    return {
      title: $('#project-title').value,
      lead: $('#project-lead').value,
      contact: $('#project-contact').value,
      team: $('#project-team').value,
      description: $('#project-description').value,
      documentationLinks: readDocumentationLinks(),
      stage: $('#project-stage').value,
      estimate: { amount: $('#estimate-amount').value, currency: $('#estimate-currency').value, confidence: $('#estimate-confidence').value, basis: $('#estimate-basis').value },
      nonItemCost: $('#non-item-cost').value,
      lineItems: [...$('#lineItems').children].map(readItem),
    };
  }
  function reviewSection(title) {
    const section = node('section', '', 'project-review-section');
    section.append(node('h3', title));
    return section;
  }
  function reviewLine(section, label, value) {
    const line = node('p');
    line.append(node('strong', `${label}: `), node('span', value || 'Not provided'));
    section.append(line);
  }
  function reviewOptionalNote(section, text) {
    section.append(node('p', text, 'project-review-note'));
  }
  function showReview() {
    if (editingProjectId) return;
    updateReadiness();
    const project = data();
    const content = $('#projectReviewContent');
    content.replaceChildren();
    content.append(node('h2', 'Review project request'), node('p', 'Confirm these details before sending your request to Treasury.', 'hint'));
    const projectSection = reviewSection('Project');
    reviewLine(projectSection, 'Project name', project.title);
    reviewLine(projectSection, 'Stage', statusLabel(project.stage));
    reviewLine(projectSection, 'Project lead', project.lead);
    reviewLine(projectSection, 'Contact', project.contact);
    reviewLine(projectSection, 'Description', project.description);
    if (project.team) reviewLine(projectSection, 'Team', project.team);
    else reviewOptionalNote(projectSection, 'Adding team members or roles can help Treasury understand who will carry the project forward.');
    content.append(projectSection);
    const estimateSection = reviewSection('Budget estimate');
    reviewLine(estimateSection, 'Requested total', money(project.estimate));
    reviewLine(estimateSection, 'Confidence', statusLabel(project.estimate.confidence));
    reviewLine(estimateSection, 'Estimate basis', project.estimate.basis);
    if (project.nonItemCost && Number(project.nonItemCost) !== 0)
      reviewLine(estimateSection, 'Additional non-item cost', `${project.nonItemCost} ${project.estimate.currency || 'USD'}`);
    content.append(estimateSection);
    const documentationSection = reviewSection('Supporting documentation');
    appendDocumentationLinks(documentationSection, project.documentationLinks);
    if (!project.documentationLinks.length) reviewOptionalNote(documentationSection, 'A proposal, design file, or other supporting link can give reviewers useful context.');
    content.append(documentationSection);
    const purchasesSection = reviewSection('Purchase list');
    if (project.lineItems.length) {
      const purchases = node('ul', '', 'project-review-purchases');
      project.lineItems.forEach((item) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const total = Number.isFinite(quantity) && Number.isFinite(unitPrice) ? (quantity * unitPrice).toFixed(2) : 'Not specified';
        purchases.append(node('li', `${item.name || 'Unnamed item'} — ${item.quantity || '?'} ${item.unit || ''} × ${item.unitPrice || '?'} = ${total} ${project.estimate.currency || 'USD'}`));
      });
      purchasesSection.append(purchases);
    } else reviewOptionalNote(purchasesSection, project.stage === 'procurement-ready'
      ? 'A complete purchase item is required before a Procurement-ready request can be submitted.'
      : 'Purchase items are optional at this stage, but can make the request easier to review.');
    content.append(purchasesSection);
    const readinessSection = reviewSection('Request readiness');
    readinessSection.append(node('p', 'Required items are enforced when you submit. Recommendations remain optional.', 'hint'));
    [['Required to submit', '#readinessRequired'], ['Recommended for review', '#readinessRecommended']].forEach(([title, selector]) => {
      readinessSection.append(node('h4', title));
      const list = $(selector).cloneNode(true);
      list.removeAttribute('id');
      readinessSection.append(list);
    });
    content.append(readinessSection);
    $('#projectFeedback').textContent = '';
    $('#projectReviewFeedback').textContent = '';
    $('#projectEditorCard').hidden = true;
    $('#projectReviewCard').hidden = false;
    $('#projectReviewCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function subtotal() {
    let total = 0;
    for (const wrapper of $('#lineItems').children) {
      const quantity = Number(wrapper.querySelector('.item-quantity').value);
      const price = Number(wrapper.querySelector('.item-price').value);
      if (Number.isFinite(quantity) && Number.isFinite(price)) total += quantity * price;
    }
    const extra = Number($('#non-item-cost').value);
    if (Number.isFinite(extra)) total += extra;
    $('#itemSubtotal').textContent = $('#lineItems').children.length ? `Itemized planning subtotal: ${total.toFixed(2)} ${$('#estimate-currency').value.toUpperCase() || 'USD'}. Confirm that your total estimate includes all costs.` : '';
    updateReadiness();
  }
  function saveDraft() {
    if (editingProjectId) return;
    try { localStorage.setItem(savedKey, JSON.stringify(data())); } catch {}
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(savedKey));
      if (!saved) return;
      const fields = [['title', '#project-title'], ['lead', '#project-lead'], ['contact', '#project-contact'], ['team', '#project-team'], ['description', '#project-description'], ['stage', '#project-stage'], ['nonItemCost', '#non-item-cost']];
      fields.forEach(([key, selector]) => { if (saved[key] !== undefined) $(selector).value = saved[key]; });
      const documentationLinks = saved.documentationLinks || (saved.documentationUrl ? [{ label: 'Supporting documentation', url: saved.documentationUrl }] : []);
      renderDocumentationLinks(documentationLinks.length ? documentationLinks : [{}]);
      Object.entries(saved.estimate || {}).forEach(([key, value]) => { const input = $('#estimate-' + key); if (input) input.value = value; });
      (saved.lineItems || []).forEach((item) => { const wrapper = itemFields(); $('#lineItems').append(wrapper); Object.entries(item).forEach(([key, value]) => { const input = wrapper.querySelector(itemFieldSelector(key)); if (input) input.value = value ?? ''; }); if (item.inventoryItemId) { wrapper.dataset.inventoryItemId = item.inventoryItemId; loadSelectedInventoryContext(wrapper); } });
      restoredDraft = true;
      setStatus('Recovered this browser’s unfinished project request.');
    } catch {}
  }
  $('#addItem').addEventListener('click', () => { $('#lineItems').append(itemFields()); subtotal(); });
  $('#addDocumentationLink').addEventListener('click', () => { $('#documentationLinks').append(documentationFields()); saveDraft(); });
  $('#newProject').addEventListener('click', () => {
    if (editingProjectId && !confirm('Leave this project without saving the edits? Your saved project will not change.')) return;
    if (editingProjectId) {
      editingProjectId = null;
      selectedProject = null;
      emptyEditorFields();
      if (restoredDraft) restore();
    } else if (!restoredDraft) clearNewProjectForm();
    editingProjectId = null;
    setEditorVisible(true, true);
  });
  $('#backToProjects').addEventListener('click', () => {
    setEditorVisible(false);
    if (selectedProject) showProjectDetail(selectedProject);
    else showProjectList();
  });
  $('#backToProjectList').addEventListener('click', showProjectList);
  $('#editProjectRequest').addEventListener('click', () => {
    setEditorVisible(true, true);
  });
  $('#clearProject').addEventListener('click', () => {
    if (editingProjectId) {
      if (!confirm('Discard unsaved edits and restore the saved project?')) return;
      const saved = projects.find((project) => project.projectId === editingProjectId);
      if (saved) loadProject(saved);
      return;
    }
    if (!confirm('Clear this unfinished project request?')) return;
    clearNewProjectForm();
  });
  form.addEventListener('input', () => { subtotal(); saveDraft(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingProjectId) {
      showReview();
      return;
    }
    const feedback = $('#projectFeedback'); feedback.textContent = '';
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      await request('/api/projects/' + encodeURIComponent(editingProjectId), 'PUT', { project: data() });
      clearNewProjectForm();
      setStatus('Project changes saved.');
      await loadMine();
    } catch (error) { feedback.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('#submitProjectRequest').addEventListener('click', async () => {
    const feedback = $('#projectReviewFeedback'); feedback.textContent = '';
    const submit = $('#submitProjectRequest'); submit.disabled = true;
    try {
      const result = await request('/api/projects', 'POST', { project: data(), operationId: 'project-' + id() });
      clearNewProjectForm();
      setStatus(`Project request submitted. Receipt: ${result.projectId}. The project is now at the top of your dashboard.`);
      await loadMine();
    } catch (error) { feedback.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  let signup = false;
  $('#accountAuth').addEventListener('click', async () => {
    if (member) { await request('/api/logout', 'POST', {}); await session(); return; }
    $('#accountDialog').showModal();
  });
  $('#cancelAccount').addEventListener('click', () => $('#accountDialog').close());
  $('#changePassword').addEventListener('click', () => {
    $('#currentPassword').value = ''; $('#newPassword').value = ''; $('#confirmPassword').value = ''; $('#passwordError').textContent = '';
    $('#passwordDialog').showModal(); $('#currentPassword').focus();
  });
  $('#cancelPassword').addEventListener('click', () => $('#passwordDialog').close());
  $('#accountMode').addEventListener('click', () => {
    signup = !signup; $('#accountTitle').textContent = signup ? 'Create member account' : 'Sign in';
    $('#accountNameField').hidden = !signup; $('#accountName').required = signup;
    $('#accountMode').textContent = signup ? 'Use existing account' : 'Create account';
    $('#accountForm').querySelector('[type=submit]').textContent = signup ? 'Create account' : 'Sign in';
    $('#accountError').textContent = '';
  });
  $('#accountForm').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#accountError').textContent = '';
    try {
      await request(signup ? '/api/account/signup' : '/api/account/login', 'POST', { name: $('#accountName').value, email: $('#accountEmail').value, password: $('#accountPassword').value });
      $('#accountPassword').value = ''; $('#accountDialog').close(); await session(); saveDraft(); await loadMine();
    } catch (error) { $('#accountError').textContent = error.message; }
  });
  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#passwordError'); error.textContent = '';
    if ($('#newPassword').value !== $('#confirmPassword').value) {
      error.textContent = 'New password confirmation does not match.';
      return;
    }
    try {
      await request('/api/account/password', 'POST', { currentPassword: $('#currentPassword').value, newPassword: $('#newPassword').value });
      $('#passwordDialog').close(); await session(); setStatus('Password changed. Sign in again with your new password.');
    } catch (failure) { error.textContent = failure.message; }
  });
  renderDocumentationLinks([{}]); restore(); subtotal();
  const initialSession = request('/api/session');
  // The member-project request uses the same cookie as the session check, so
  // it can load in parallel. A visitor's expected 401 is ignored.
  const initialProjects = request('/api/projects/mine').catch((error) => error.status === 401 ? null : Promise.reject(error));
  Promise.all([initialSession, initialProjects]).then(async ([state, response]) => {
    rememberSession(state);
    applyMember(state);
    await loadMine(response);
  }).catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

function setupTreasury() {
  let overview = null, selected = null, messageProject = null, officer = false, president = false, treasurer = false;
  const section = new URLSearchParams(window.location.search).get('section');
  const projectWorkspace = section === 'projects';
  const budgetWorkspace = section === 'budget';
  const workspaceTitle = projectWorkspace ? 'PROJECT MANAGEMENT' : (budgetWorkspace ? 'ITR BUDGET' : 'ADMIN DASHBOARD');
  const workspaceSubtitle = projectWorkspace ? 'Review and manage member project requests.' : (budgetWorkspace ? 'Spring 2027 official-budget workspace.' : 'Choose a project-management or budget workspace.');
  $('#dashboardTitle').textContent = workspaceTitle;
  $('#dashboardSubtitle').textContent = workspaceSubtitle;
  document.querySelectorAll('#adminLanding .launch-button').forEach((button) => {
    const center = () => { button.style.setProperty('--mx', '50%'); button.style.setProperty('--my', '50%'); };
    const track = (event) => {
      const bounds = button.getBoundingClientRect();
      button.style.setProperty('--mx', `${Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * 100}%`);
      button.style.setProperty('--my', `${Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) * 100}%`);
    };
    center(); button.addEventListener('pointerenter', track); button.addEventListener('pointermove', track); button.addEventListener('pointerleave', center); button.addEventListener('focus', center);
  });
  function selectBudgetTab(name) {
    document.querySelectorAll('[data-budget-tab]').forEach((tab) => {
      const selected = tab.dataset.budgetTab === name;
      tab.setAttribute('aria-selected', String(selected));
      $('#' + tab.getAttribute('aria-controls')).hidden = !selected;
    });
  }
  function setTreasuryLoading(loading) {
    $('#treasuryLoading').hidden = !loading;
    $('#treasuryWorkspace').hidden = loading;
  }
  let labTerms = [], labTermId = '', labRows = [], labRevision = 0, labLoaded = false, labReadOnly = false, budgetAccess = false, budgetBootstrap = null;
  let labSaveTimer = null, labSaving = false, labSaveQueued = false, labGeneration = 0;
  const blankLabRow = () => ({ category: 'lab-consumables', currency: 'USD', name: '', link: '', unitPrice: '', quantity: '', vendor: '', notes: '' });
  const labRowEmpty = (row) => ['name', 'link', 'unitPrice', 'quantity', 'vendor', 'notes'].every((field) => !String(row[field] || '').trim());
  const populatedLabRows = () => labRows.filter((row) => !labRowEmpty(row));
  function normalizeLabRows() {
    labRows = populatedLabRows();
    labRows.forEach((row) => { row.category = 'lab-consumables'; row.currency = 'USD'; });
    labRows.push(blankLabRow());
  }
  function labMissing(row) {
    const missing = [];
    if (!String(row.name || '').trim()) missing.push('line item name');
    if (!row.category) missing.push('category');
    if (!String(row.vendor || '').trim()) missing.push('vendor');
    if (!String(row.unitPrice || '').trim()) missing.push('unit price');
    if (!String(row.quantity || '').trim()) missing.push('quantity');
    return missing;
  }
  function displayLabTotal(row) {
    if (row.totalCost !== null && row.totalCost !== undefined && row.totalCost !== '') return `USD ${Number(row.totalCost).toFixed(2)}`;
    const price = Number(row.unitPrice), quantity = Number(row.quantity);
    return Number.isFinite(price) && Number.isFinite(quantity) && price >= 0 && quantity > 0 ? `USD ${(price * quantity).toFixed(2)}` : '—';
  }
  function setLabSaveState(text, error = false) {
    $('#labBudgetSaveState').textContent = text;
    $('#labBudgetSaveState').classList.toggle('error', error);
  }
  function renderLabWarnings() {
    const warnings = populatedLabRows().map((row, index) => ({ position: index + 1, missing: labMissing(row) })).filter((warning) => warning.missing.length);
    const host = $('#labBudgetWarnings');
    host.replaceChildren();
    if (!warnings.length) { host.hidden = true; return; }
    host.hidden = false;
    host.append(node('strong', 'Before entering these rows in 312:'), node('p', 'Complete the missing details below. Draft rows still save automatically.', 'hint'));
    const list = node('ul');
    warnings.forEach((warning) => list.append(node('li', `Row ${warning.position}: ${warning.missing.join(', ')}.`)));
    host.append(list);
  }
  function renderLabTotals() {
    const totals = {};
    populatedLabRows().forEach((row) => {
      const total = Number(row.totalCost ?? (Number(row.unitPrice) * Number(row.quantity)));
      if (Number.isFinite(total)) totals[row.currency || 'USD'] = (totals[row.currency || 'USD'] || 0) + total;
    });
    const host = $('#labBudgetTotals'); host.replaceChildren();
    Object.entries(totals).forEach(([currency, total]) => host.append(node('strong', `${currency} ${total.toFixed(2)}`)));
    if (!Object.keys(totals).length) host.append(node('span', 'No complete totals yet.', 'hint'));
  }
  function copyLabValue(index, field) {
    const source = labRows[index]; const destinations = labRows.slice(index + 1, -1);
    if (!source || !String(source[field] || '').trim() || !destinations.length) return;
    const overwrite = destinations.some((row) => String(row[field] || '').trim() && row[field] !== source[field]);
    if (overwrite && !confirm(`Copy this ${field === 'unitPrice' ? 'unit price' : field} into rows below and replace existing values?`)) return;
    destinations.forEach((row) => { row[field] = source[field]; });
    labGeneration += 1; renderLabBudget(); scheduleLabSave();
  }
  function budgetDeleteCell(label, disabled, remove) {
    const cell = node('td', '', 'budget-row-action');
    const button = node('button', '×', 'budget-row-delete'); button.type = 'button'; button.disabled = disabled;
    button.title = `Remove ${label}`; button.setAttribute('aria-label', `Remove ${label}`); button.addEventListener('click', remove); cell.append(button);
    return cell;
  }
  function deleteLabRow(index) {
    const row = labRows[index]; if (!row || labRowEmpty(row) || labReadOnly) return;
    if (!confirm(`Remove Lab Items row ${index + 1}?`)) return;
    labRows.splice(index, 1); labGeneration += 1; normalizeLabRows(); renderLabBudget(); scheduleLabSave();
  }
  function labInput(index, field, value) {
    const row = labRows[index]; if (!row) return;
    row[field] = value;
    labGeneration += 1;
    const focusRow = row;
    normalizeLabRows();
    renderLabBudget({ row: focusRow, field });
    if (field === 'vendor') void budgetVendorSuggestions('lab', labRows.indexOf(focusRow), value);
    scheduleLabSave();
  }
  async function budgetVendorSuggestions(table, index, value) {
    const query = value.trim(); if (query.length < 2) return;
    const host = document.querySelector(`[data-${table}-vendor-suggestions="${index}"]`); if (!host) return;
    host.replaceChildren(node('small', 'Searching vendors…', 'vendor-searching'));
    try {
      const data = await request('/api/vendors?q=' + encodeURIComponent(query));
      const rows = table === 'lab' ? labRows : capitalRows;
      if (!host.isConnected || rows[index]?.vendor !== value) return;
      host.replaceChildren();
      if (!data.vendors.length) { host.append(node('small', 'No approved vendor matches.', 'hint')); return; }
      data.vendors.forEach((vendor) => {
        const button = node('button', vendor, 'suggestion'); button.type = 'button';
        button.addEventListener('click', () => table === 'lab' ? labInput(index, 'vendor', vendor) : capitalInput(index, 'vendor', vendor)); host.append(button);
      });
    } catch (error) { if (host.isConnected) host.replaceChildren(node('small', error.message, 'error')); }
  }
  function labEditor(index, row, field, label, type = 'text') {
    const cell = node('td'); const wrap = node('div', '', 'budget-cell-editor');
    const control = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') control.type = type;
    control.value = row[field] || ''; control.dataset.labRow = String(index); control.dataset.labField = field;
    control.setAttribute('aria-label', `${label}, row ${index + 1}`);
    control.disabled = labReadOnly;
    if (field === 'unitPrice' || field === 'quantity') control.inputMode = 'decimal';
    if (type === 'textarea') control.rows = 2;
    control.addEventListener('input', () => labInput(index, field, control.value));
    wrap.append(control);
    if (field === 'vendor') { const matches = node('div', '', 'vendor-suggestions'); matches.dataset.labVendorSuggestions = String(index); matches.setAttribute('aria-live', 'polite'); wrap.append(matches); }
    if (!labRowEmpty(row)) {
      const copy = node('button', '↓', 'copy-down'); copy.type = 'button';
      copy.title = `Copy ${label} down`; copy.setAttribute('aria-label', `Copy ${label} from row ${index + 1} to rows below`);
      copy.disabled = labReadOnly || !String(row[field] || '').trim() || index >= labRows.length - 2;
      copy.addEventListener('click', () => copyLabValue(index, field)); wrap.append(copy);
    }
    cell.append(wrap); return cell;
  }
  function renderLabBudget(focus = null) {
    const host = $('#labBudgetRows'); host.replaceChildren();
    const header = host.closest('table').querySelector('thead tr');
    if (!header.querySelector('[data-budget-delete-column]')) { const heading = node('th', 'Remove'); heading.scope = 'col'; heading.dataset.budgetDeleteColumn = 'true'; header.append(heading); }
    labRows.forEach((row, index) => {
      const tr = document.createElement('tr'); if (labRowEmpty(row)) tr.className = 'budget-empty-row';
      tr.append(labEditor(index, row, 'name', 'Line item name'), (() => {
        const cell = node('td'); const select = document.createElement('select'); select.disabled = true; select.setAttribute('aria-label', `Category, row ${index + 1}`);
        select.append(new Option('Lab Consumables', 'lab-consumables', true, true)); cell.append(select); return cell;
      })(), labEditor(index, row, 'link', 'Link', 'url'), labEditor(index, row, 'unitPrice', 'Unit price'), labEditor(index, row, 'quantity', 'Quantity'), labEditor(index, row, 'vendor', 'Vendor'), node('td', displayLabTotal(row), 'budget-total-cell'), labEditor(index, row, 'notes', 'Description / notes', 'textarea'));
      tr.append(labRowEmpty(row) ? node('td', '', 'budget-row-action') : budgetDeleteCell(`Lab Items row ${index + 1}`, labReadOnly, () => deleteLabRow(index)));
      host.append(tr);
    });
    renderLabWarnings(); renderLabTotals();
    if (focus?.row) {
      const index = labRows.indexOf(focus.row);
      const target = index >= 0 && [...host.querySelectorAll('[data-lab-row]')].find((control) => Number(control.dataset.labRow) === index && control.dataset.labField === focus.field);
      if (target) { target.focus(); target.setSelectionRange?.(target.value.length, target.value.length); }
    }
  }
  function scheduleLabSave() {
    if (!labLoaded || labReadOnly) return;
    clearTimeout(labSaveTimer); setLabSaveState('Saving…');
    labSaveTimer = setTimeout(saveLabBudget, 550);
  }
  async function saveLabBudget() {
    clearTimeout(labSaveTimer);
    if (labSaving) { labSaveQueued = true; return; }
    labSaving = true; labSaveQueued = false;
    const generation = labGeneration, sentRows = populatedLabRows();
    try {
      const result = await request('/api/budget/lab-items/' + encodeURIComponent(labTermId), 'PUT', { revision: labRevision, rows: sentRows });
      labRevision = result.record.revision;
      result.record.rows.forEach((saved, index) => {
        // A response can arrive after the Officer has edited another cell.
        // Keep only the new durable ID in that case; copying the older server
        // snapshot over the live object would erase the newer local edit.
        if (sentRows[index] && !sentRows[index].id) sentRows[index].id = saved.id;
        if (generation === labGeneration && sentRows[index]) Object.assign(sentRows[index], saved);
      });
      if (generation === labGeneration) { labRows = result.record.rows || []; normalizeLabRows(); renderLabBudget(); }
      setLabSaveState('Saved automatically.'); $('#labBudgetFeedback').textContent = '';
    } catch (error) {
      const feedback = $('#labBudgetFeedback'); feedback.textContent = error.status === 409
        ? 'Another officer saved changes first. Reload the page before making more edits so no work is overwritten.' : error.message;
      setLabSaveState('Could not save.', true);
    } finally {
      labSaving = false;
      if (labSaveQueued || generation !== labGeneration) saveLabBudget();
    }
  }
  async function loadLabBudget(termId = '', bootstrap = null) {
    if (!budgetAccess) return;
    setLabSaveState('Loading Lab Items…'); $('#labBudgetFeedback').textContent = '';
    try {
      if (bootstrap && !termId) labTerms = bootstrap.terms || [];
      else if (!labTerms.length) labTerms = (await request('/api/budget/terms')).terms || [];
      labTermId = termId || labTermId || labTerms.find((term) => term.id === 'SPRING-2027')?.id || labTerms[0]?.id || '';
      const picker = $('#labBudgetTerm'); picker.replaceChildren();
      labTerms.forEach((term) => picker.append(new Option(`${term.label}${term.state === 'closed' ? ' (closed)' : ''}`, term.id, term.id === labTermId, term.id === labTermId)));
      picker.disabled = !labTerms.length;
      if (!labTermId) throw new Error('No budget term is available.');
      const result = bootstrap && !termId && bootstrap.term?.id === labTermId
        ? { term: bootstrap.term, record: bootstrap.labItems }
        : await request('/api/budget/lab-items/' + encodeURIComponent(labTermId));
      labRevision = result.record.revision; labRows = result.record.rows || []; labReadOnly = result.term.state === 'closed'; normalizeLabRows(); labLoaded = true;
      renderLabBudget(); setLabSaveState(result.term.state === 'closed' ? 'This term is closed and read-only.' : 'Saved automatically.');
    } catch (error) { $('#labBudgetFeedback').textContent = error.message; setLabSaveState('Could not load Lab Items.', true); }
  }
  $('#labBudgetTerm').addEventListener('change', () => { labLoaded = false; loadLabBudget($('#labBudgetTerm').value); });
  const EVENT_ROW_LIMIT = 15, EVENT_BUDGET_LIMIT = 3000;
  let eventTerms = [], eventTermId = '', eventRows = [], eventRevision = 0, eventLoaded = false, eventReadOnly = false;
  let eventSaveTimer = null, eventSaving = false, eventSaveQueued = false, eventGeneration = 0;
  const eventTotal = () => eventRows.reduce((total, row) => total + (Number(row.unitPrice) || 0), 0);
  function setEventSaveState(text, error = false) { $('#eventsBudgetSaveState').textContent = text; $('#eventsBudgetSaveState').classList.toggle('error', error); }
  function renderEventTotal() { $('#eventsBudgetTotal').textContent = `USD ${eventTotal().toFixed(2)} / USD ${EVENT_BUDGET_LIMIT.toFixed(2)}`; }
  function eventInput(index, field, control) {
    const row = eventRows[index]; if (!row) return;
    if (field === 'name' && !control.value.trim()) { eventRows.splice(index, 1); eventGeneration += 1; renderEventsBudget(); scheduleEventsSave(); return; }
    if (field === 'unitPrice') {
      const otherTotal = eventRows.reduce((total, candidate, candidateIndex) => total + (candidateIndex === index ? 0 : (Number(candidate.unitPrice) || 0)), 0);
      const maximum = Math.max(0, EVENT_BUDGET_LIMIT - otherTotal);
      const requested = Number(control.value);
      const accepted = Number.isFinite(requested) && requested >= 0 ? Math.min(requested, maximum) : 0;
      row.unitPrice = String(accepted);
      if (requested !== accepted) { control.value = String(accepted); setEventSaveState(`The Events and Programming total cannot exceed USD ${EVENT_BUDGET_LIMIT.toFixed(2)}.`, true); }
      renderEventTotal();
    } else row[field] = control.value;
    eventGeneration += 1; scheduleEventsSave();
  }
  function deleteEventRow(index) {
    if (!eventRows[index] || eventReadOnly) return;
    if (!confirm(`Remove event row ${index + 1}?`)) return;
    eventRows.splice(index, 1); eventGeneration += 1; renderEventsBudget(); scheduleEventsSave();
  }
  function renderEventsBudget() {
    const host = $('#eventsBudgetRows'); host.replaceChildren();
    if (!eventRows.length) { const tr = node('tr'), cell = node('td', 'All event rows were removed.', 'hint'); cell.colSpan = 3; tr.append(cell); host.append(tr); }
    eventRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      [['name', 'Event name', 'text'], ['notes', 'Description', 'text'], ['unitPrice', 'Budget amount (USD)', 'number']].forEach(([field, label, type]) => {
        const cell = node('td'), input = document.createElement('input'); input.type = type; input.value = row[field] || '';
        input.disabled = eventReadOnly; input.dataset.eventsField = field; input.dataset.eventsRow = String(index); input.setAttribute('aria-label', `${label}, row ${index + 1}`);
        if (field === 'unitPrice') { input.min = '0'; input.step = '0.01'; input.inputMode = 'decimal'; }
        input.addEventListener('input', () => eventInput(index, field, input)); cell.append(input); tr.append(cell);
      }); tr.append(budgetDeleteCell(`event row ${index + 1}`, eventReadOnly, () => deleteEventRow(index))); host.append(tr);
    });
    renderEventTotal();
  }
  function scheduleEventsSave() { if (!eventLoaded || eventReadOnly) return; clearTimeout(eventSaveTimer); if (!$('#eventsBudgetSaveState').classList.contains('error')) setEventSaveState('Saving…'); eventSaveTimer = setTimeout(saveEventsBudget, 550); }
  async function saveEventsBudget() {
    clearTimeout(eventSaveTimer); if (eventSaving) { eventSaveQueued = true; return; } eventSaving = true; eventSaveQueued = false;
    const generation = eventGeneration, sentRows = eventRows;
    try {
      const result = await request('/api/budget/events/' + encodeURIComponent(eventTermId), 'PUT', { revision: eventRevision, rows: sentRows }); eventRevision = result.record.revision;
      if (generation === eventGeneration) { eventRows = result.record.rows || []; renderEventsBudget(); }
      setEventSaveState('Saved automatically.'); $('#eventsBudgetFeedback').textContent = '';
    } catch (error) { const feedback = $('#eventsBudgetFeedback'); feedback.textContent = error.status === 409 ? 'Another officer saved changes first. Reload the page before making more edits so no work is overwritten.' : error.message; setEventSaveState('Could not save.', true); }
    finally { eventSaving = false; if (eventSaveQueued || generation !== eventGeneration) saveEventsBudget(); }
  }
  async function loadEventsBudget(termId = '', bootstrap = null) {
    if (!budgetAccess) return; setEventSaveState('Loading Events and Programming…'); $('#eventsBudgetFeedback').textContent = '';
    try {
      if (bootstrap && !termId) eventTerms = bootstrap.terms || [];
      else if (!eventTerms.length) eventTerms = (await request('/api/budget/terms')).terms || [];
      eventTermId = termId || eventTermId || eventTerms.find((term) => term.id === 'SPRING-2027')?.id || eventTerms[0]?.id || '';
      const picker = $('#eventsBudgetTerm'); picker.replaceChildren(); eventTerms.forEach((term) => picker.append(new Option(`${term.label}${term.state === 'closed' ? ' (closed)' : ''}`, term.id, term.id === eventTermId, term.id === eventTermId))); picker.disabled = !eventTerms.length;
      if (!eventTermId) throw new Error('No budget term is available.'); const result = bootstrap && !termId && bootstrap.term?.id === eventTermId && bootstrap.events ? { term: bootstrap.term, record: bootstrap.events } : await request('/api/budget/events/' + encodeURIComponent(eventTermId)); eventRevision = result.record.revision; eventRows = result.record.rows || []; eventReadOnly = result.term.state === 'closed'; eventLoaded = true; renderEventsBudget(); setEventSaveState(eventReadOnly ? 'This term is closed and read-only.' : 'Saved automatically.');
    } catch (error) { $('#eventsBudgetFeedback').textContent = error.message; setEventSaveState('Could not load Events and Programming.', true); }
  }
  function setupEventsPanel() {
    document.querySelector('[data-budget-tab="events"]').textContent = 'Events and Programming';
    const panel = $('#budget-events'); panel.replaceChildren();
    const heading = node('div', '', 'card-heading'), copy = node('div'); copy.append(node('h2', 'Events and Programming'), node('p', 'Up to 15 events. Clear an Event Name to remove that row. The combined requested budget cannot exceed USD 3,000.00.', 'hint'));
    const term = node('label', '', 'field budget-term-field'); term.append('Budget term'); const picker = document.createElement('select'); picker.id = 'eventsBudgetTerm'; picker.setAttribute('aria-label', 'Events and Programming budget term'); term.append(picker); heading.append(copy, term);
    const tableWrap = node('div', '', 'budget-table-wrap'), table = node('table', '', 'budget-table'); table.innerHTML = '<thead><tr><th scope="col">Event Name</th><th scope="col">Description</th><th scope="col">Budget Amount (USD)</th><th scope="col">Remove</th></tr></thead><tbody id="eventsBudgetRows"></tbody>'; tableWrap.append(table);
    const footer = node('div', '', 'budget-table-footer'); footer.append(node('p', '', 'hint')); footer.lastChild.id = 'eventsBudgetSaveState'; footer.lastChild.setAttribute('role', 'status'); const total = node('strong', '', 'budget-subtotals'); total.id = 'eventsBudgetTotal'; footer.append(total);
    panel.append(heading, tableWrap, footer, node('p', '', 'error')); panel.lastChild.id = 'eventsBudgetFeedback'; panel.lastChild.setAttribute('role', 'alert');
    picker.addEventListener('change', () => { eventLoaded = false; loadEventsBudget(picker.value); });
  }
  setupEventsPanel();
  let totalTerms = [], totalTermId = '', totalLoading = false;
  function moneyTotalNodes(totals) {
    const values = Object.entries(totals || {});
    if (!values.length) return [node('p', 'No completed totals yet.', 'hint')];
    return values.map(([currency, amount]) => node('strong', `${currency} ${Number(amount).toFixed(2)}`, 'budget-total-amount'));
  }
  function renderBudgetTotal(summary) {
    const cards = $('#budgetTotalCards'); cards.replaceChildren();
    (summary.sections || []).forEach((section) => {
      const card = node('section', '', 'budget-total-card');
      card.append(node('h3', section.label), ...moneyTotalNodes(section.totals)); cards.append(card);
    });
    const overall = $('#budgetOverall'); overall.replaceChildren(node('h2', 'Overall total'), ...moneyTotalNodes(summary.overall));
  }
  async function loadBudgetTotal() {
    if (!budgetAccess || totalLoading) return; totalLoading = true;
    const status = $('#budgetTotalStatus'); status.textContent = 'Loading totals…'; status.classList.remove('error');
    try {
      totalTerms = budgetBootstrap?.terms || totalTerms;
      if (!totalTerms.length) totalTerms = (await request('/api/budget/terms')).terms || [];
      totalTermId = totalTermId || totalTerms.find((term) => term.id === 'SPRING-2027')?.id || totalTerms[0]?.id || '';
      if (!totalTermId) throw new Error('No budget term is available.');
      const summary = await request('/api/budget/total/' + encodeURIComponent(totalTermId));
      renderBudgetTotal(summary); status.textContent = `${summary.term.label} budget totals`;
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { totalLoading = false; }
  }
  function setupBudgetTotalPanel() {
    const panel = $('#budget-total'); panel.replaceChildren();
    const status = node('p', 'Open this tab to calculate the current budget totals.', 'hint'); status.id = 'budgetTotalStatus'; status.setAttribute('role', 'status');
    const cards = node('div', '', 'budget-total-cards'); cards.id = 'budgetTotalCards';
    const overall = node('section', '', 'budget-total-overall'); overall.id = 'budgetOverall';
    panel.append(node('h2', 'Total'), status, cards, overall);
  }
  setupBudgetTotalPanel();
  const CONFERENCE_LIMIT = 10, MILEAGE_RATE = 0.76;
  let conferenceTerms = [], conferenceTermId = '', conferenceEntries = [], conferenceRevision = 0, conferencesLoaded = false, conferencesReadOnly = false;
  const conferenceTotal = () => conferenceEntries.reduce((total, entry) => total + ['registrationCost', 'transportationCost', 'lodgingCost'].reduce((subtotal, field) => subtotal + (Number(entry[field]) || 0), 0), 0);
  function conferenceStatus(text, error = false) { $('#conferenceFeedback').textContent = text; $('#conferenceFeedback').classList.toggle('error', error); }
  function conferenceEntryTotal(entry) { return ['registrationCost', 'transportationCost', 'lodgingCost'].reduce((total, field) => total + (Number(entry[field]) || 0), 0); }
  function refreshConferenceTotals() {
    conferenceEntries.forEach((entry) => { const total = $('#conferenceTotal-' + entry.id); if (total) total.textContent = `Conference total: USD ${conferenceEntryTotal(entry).toFixed(2)}`; const guidance = $('#conferenceGuidance-' + entry.id); if (guidance) { const miles = Number(entry.travelDistance); guidance.textContent = entry.travelMethod && Number.isFinite(miles) ? `Estimated mileage reimbursement: USD ${(miles * MILEAGE_RATE).toFixed(2)} at USD ${MILEAGE_RATE.toFixed(2)}/mile. This is guidance only.` : 'Optional transportation guidance: enter both travel method and miles for a mileage estimate.'; } });
    const total = $('#conferenceOverallTotal'); if (total) total.textContent = `Total: USD ${conferenceTotal().toFixed(2)}`;
  }
  function updateConferenceEntry(entry, field, control, summary) { entry[field] = control.value; if (field === 'description') summary.textContent = control.value.trim() || 'Unnamed'; refreshConferenceTotals(); }
  function conferenceField(entry, field, label, type, summary, optional = false) {
    const wrap = node('label', '', 'field'), control = document.createElement(type === 'textarea' ? 'textarea' : 'input'); wrap.append(`${label}${optional ? ' (optional)' : ''}`);
    if (type !== 'textarea') control.type = type; else control.rows = 3;
    control.value = entry[field] || ''; control.disabled = conferencesReadOnly; if (!optional) control.required = true;
    if (type === 'number') { control.min = '0'; control.step = field.includes('Cost') || field === 'travelDistance' ? '0.01' : '1'; control.inputMode = 'decimal'; }
    control.addEventListener('input', () => updateConferenceEntry(entry, field, control, summary)); wrap.append(control); return wrap;
  }
  function renderConferences() {
    const host = $('#conferenceForms'); host.replaceChildren();
    conferenceEntries.forEach((entry, index) => {
      const details = document.createElement('details'); details.className = 'conference-entry'; details.open = Boolean(entry.open); const summary = node('summary', entry.description || 'Unnamed'); details.append(summary);
      details.addEventListener('toggle', () => { entry.open = details.open; });
      const form = node('div', '', 'conference-form');
      form.append(conferenceField(entry, 'description', 'Description of Conference', 'text', summary), conferenceField(entry, 'selectionProcess', 'Selection process', 'textarea', summary), conferenceField(entry, 'date', 'Date of Conference', 'date', summary), conferenceField(entry, 'commitment', 'Commitment Made', 'textarea', summary), conferenceField(entry, 'conferenceType', 'Type of Conference', 'text', summary), conferenceField(entry, 'peopleCount', 'Number of People Going', 'number', summary), conferenceField(entry, 'executiveCount', 'Executive-board attendees', 'number', summary), conferenceField(entry, 'presentation', 'Presenting / presentation details', 'textarea', summary), conferenceField(entry, 'registrationCost', 'Registration Cost (USD)', 'number', summary), conferenceField(entry, 'registrationDocument', 'Registration supporting document', 'url', summary), conferenceField(entry, 'transportationCost', 'Transportation Cost (USD)', 'number', summary), conferenceField(entry, 'transportationDocument', 'Transportation supporting document', 'url', summary), conferenceField(entry, 'lodgingCost', 'Lodging Cost (USD)', 'number', summary), conferenceField(entry, 'travelMethod', 'Travel method', 'text', summary, true), conferenceField(entry, 'travelDistance', 'Travel distance (miles)', 'number', summary, true));
      const guidance = node('p', '', 'hint'); guidance.id = 'conferenceGuidance-' + entry.id; const total = node('strong', '', 'conference-total'); total.id = 'conferenceTotal-' + entry.id;
      const remove = node('button', 'Remove competition', 'danger'); remove.type = 'button'; remove.disabled = conferencesReadOnly; remove.addEventListener('click', () => { if (!confirm(`Remove “${entry.description || 'Unnamed'}”?`)) return; conferenceEntries.splice(index, 1); renderConferences(); });
      form.append(guidance, total, remove); details.append(form); host.append(details);
    });
    $('#addCompetition').disabled = conferencesReadOnly || conferenceEntries.length >= CONFERENCE_LIMIT;
    $('#conferenceFooter').hidden = !conferenceEntries.length; refreshConferenceTotals();
  }
  function addConference() { if (conferenceEntries.length >= CONFERENCE_LIMIT || conferencesReadOnly) return; conferenceEntries.push({ id: 'CC-' + id(), open: true }); renderConferences(); }
  async function saveConferences() {
    const button = $('#saveConferences'); if (button.disabled || conferencesReadOnly) return; button.disabled = true; conferenceStatus('');
    try { const result = await request('/api/budget/conferences/' + encodeURIComponent(conferenceTermId), 'PUT', { revision: conferenceRevision, entries: conferenceEntries }); conferenceRevision = result.record.revision; conferenceEntries = result.record.entries || []; conferenceEntries.forEach((entry) => { entry.open = false; }); renderConferences(); conferenceStatus('Saved.'); }
    catch (error) { conferenceStatus(error.message, true); }
    finally { button.disabled = false; }
  }
  async function loadConferences() {
    if (!budgetAccess) return; conferenceStatus('Loading…');
    try { conferenceTerms = budgetBootstrap?.terms || conferenceTerms; if (!conferenceTerms.length) conferenceTerms = (await request('/api/budget/terms')).terms || []; conferenceTermId = conferenceTermId || conferenceTerms.find((term) => term.id === 'SPRING-2027')?.id || conferenceTerms[0]?.id || ''; if (!conferenceTermId) throw new Error('No budget term is available.'); const result = await request('/api/budget/conferences/' + encodeURIComponent(conferenceTermId)); conferenceRevision = result.record.revision; conferenceEntries = result.record.entries || []; conferenceEntries.forEach((entry) => { entry.open = false; }); conferencesReadOnly = result.term.state === 'closed'; conferencesLoaded = true; renderConferences(); conferenceStatus(''); }
    catch (error) { conferenceStatus(error.message, true); }
  }
  function setupConferencePanel() {
    const panel = $('#budget-conferences'); panel.replaceChildren(); const add = node('button', 'Add competition', 'primary'); add.type = 'button'; add.id = 'addCompetition'; add.addEventListener('click', addConference); const forms = node('div', '', 'conference-forms'); forms.id = 'conferenceForms'; const footer = node('div', '', 'budget-table-footer'); footer.id = 'conferenceFooter'; footer.hidden = true; const total = node('strong', '', 'budget-subtotals'); total.id = 'conferenceOverallTotal'; const save = node('button', 'Save competitions'); save.type = 'button'; save.id = 'saveConferences'; save.addEventListener('click', saveConferences); footer.append(total, save); const feedback = node('p', '', 'error'); feedback.id = 'conferenceFeedback'; feedback.setAttribute('role', 'alert'); panel.append(add, forms, footer, feedback);
  }
  setupConferencePanel();
  let capitalTerms = [], capitalTermId = '', capitalRows = [], capitalRevision = 0, capitalLoaded = false, capitalReadOnly = false, capitalPreviewLoading = false;
  let capitalSaveTimer = null, capitalSaving = false, capitalSaveQueued = false, capitalGeneration = 0;
  const capitalCategories = [
    ['raw-material', 'Raw Material'], ['mechanism-components', 'Mechanism Components'],
    ['primitive-electrical-components', 'Primitive Electrical Components'],
    ['motion-electrical-components', 'Motion Electrical Components'],
    ['computing-and-sensing-components', 'Computing and Sensing Components'],
  ];
  const blankCapitalRow = () => ({ category: '', currency: 'USD', name: '', link: '', unitPrice: '', quantity: '', vendor: '', notes: '' });
  const capitalRowEmpty = (row) => ['name', 'link', 'unitPrice', 'quantity', 'vendor', 'notes'].every((field) => !String(row[field] || '').trim()) && !row.category;
  const populatedCapitalRows = () => capitalRows.filter((row) => !capitalRowEmpty(row));
  function normalizeCapitalRows() { capitalRows = populatedCapitalRows(); capitalRows.forEach((row) => { row.currency = 'USD'; }); capitalRows.push(blankCapitalRow()); }
  function capitalMissing(row) {
    const missing = [];
    if (!String(row.projectName || '').trim()) missing.push('project name');
    if (!String(row.name || '').trim()) missing.push('line item name');
    if (!row.category) missing.push('category');
    if (!String(row.link || '').trim()) missing.push('link');
    if (!String(row.vendor || '').trim()) missing.push('vendor');
    if (!String(row.unitPrice || '').trim()) missing.push('unit price');
    if (!String(row.quantity || '').trim()) missing.push('quantity');
    return missing;
  }
  function readableList(values) {
    if (values.length < 2) return values[0] || '';
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
  }
  function groupedReadinessWarnings(warnings) {
    return warnings.reduce((groups, warning) => {
      const previous = groups.at(-1);
      const sameMissing = previous && previous.missing.length === warning.missing.length
        && previous.missing.every((field, index) => field === warning.missing[index]);
      if (sameMissing && previous.last + 1 === warning.position) previous.last = warning.position;
      else groups.push({ first: warning.position, last: warning.position, missing: warning.missing });
      return groups;
    }, []);
  }
  function readinessWarningText(warning) {
    const multiple = warning.first !== warning.last;
    const itemLabel = multiple ? `Line items ${warning.first}-${warning.last}` : `Line item ${warning.first}`;
    return `${itemLabel} ${multiple ? 'need' : 'needs'} ${readableList(warning.missing)}.`;
  }
  function displayCapitalTotal(row) {
    if (row.totalCost !== null && row.totalCost !== undefined && row.totalCost !== '') return `USD ${Number(row.totalCost).toFixed(2)}`;
    const price = Number(row.unitPrice), quantity = Number(row.quantity);
    return Number.isFinite(price) && Number.isFinite(quantity) && price >= 0 && quantity > 0 ? `USD ${(price * quantity).toFixed(2)}` : '—';
  }
  function setCapitalSaveState(text, error = false) { $('#projectsCapitalBudgetSaveState').textContent = text; $('#projectsCapitalBudgetSaveState').classList.toggle('error', error); }
  function renderCapitalPreview(projects) {
    const host = $('#projectImportPreviewRows'); host.replaceChildren();
    if (!projects.length) {
      host.append(node('p', 'No fully approved Project Management submissions are assigned to this budget term.', 'hint'));
      return;
    }
    projects.forEach((project) => {
      const card = node('article', '', 'project-import-preview-card');
      card.append(node('h4', project.title), node('p', `${project.lead} · Requested: ${money(project.estimate?.amount, project.estimate?.currency)}`), node('p', project.description, 'hint'), node('p', 'Read-only project-derived preview · Not added to ITR Budget.', 'hint'));
      const decisions = Object.values(project.approvals?.decisions || {}).filter((decision) => isBudgetApproved(decision.status));
      if (decisions.length) card.append(node('p', `Budget approval: ${decisions.map((decision) => `${actorLabel(decision.role, decision.actorName)}${decision.approvedAmount ? ` (${money(decision.approvedAmount, decision.currency)})` : ''}`).join('; ')}`, 'hint'));
      (project.documentationLinks || []).forEach((link) => {
        const documentation = document.createElement('a'); documentation.href = link.url; documentation.target = '_blank'; documentation.rel = 'noopener noreferrer'; documentation.textContent = link.label;
        const row = node('p', 'Supporting documentation: ', 'hint'); row.append(documentation); card.append(row);
      });
      if (project.items?.length) {
        const list = node('ul', '', 'project-import-preview-items');
        project.items.forEach((item) => {
          const entry = node('li');
          entry.append(node('strong', item.name || `Purchase item ${item.position}`), node('span', ` · ${item.quantity || '?'} × ${item.unitPrice || '?'} ${project.estimate?.currency || 'USD'}`));
          if (item.vendor) entry.append(node('span', ` · ${item.vendor}`));
          if (item.warnings?.length) entry.append(node('small', ` ${item.warnings.join(' ')}`, 'hint'));
          list.append(entry);
        });
        card.append(list);
      } else card.append(node('p', 'No itemized purchase rows were submitted.', 'hint'));
      if (project.nonItemCost) card.append(node('p', `Additional non-item cost: ${money(project.nonItemCost, project.estimate?.currency)} · not converted into a budget row.`, 'hint'));
      const importButton = node('button', project.importable ? 'Import project rows' : 'Import needs item review');
      importButton.type = 'button'; importButton.disabled = capitalReadOnly || !project.importable;
      importButton.title = project.importable ? 'Append the shown purchase rows to the manual budget table.' : 'This project is already approved; its itemized rows need review before import.';
      importButton.addEventListener('click', () => { void importCapitalProject(project, importButton); });
      card.append(importButton);
      if (!project.importable) card.append(node('p', 'This project is already approved for the budget; review its itemized rows before importing.', 'hint'));
      host.append(card);
    });
  }
  async function importCapitalProject(project, button) {
    if (!project.importable || capitalReadOnly) return;
    if (!confirm(`Import ${project.items.length} project row${project.items.length === 1 ? '' : 's'} for “${project.title}” into the manual budget table?`)) return;
    button.disabled = true;
    const state = $('#projectImportPreviewState'); state.textContent = `Importing ${project.title}…`; state.classList.remove('error');
    try {
      const result = await request('/api/budget/projects-capital/' + encodeURIComponent(capitalTermId) + '/project-import/' + encodeURIComponent(project.projectId), 'POST', { revision: capitalRevision });
      capitalRevision = result.record.revision; capitalRows = result.record.rows || []; normalizeCapitalRows(); renderCapitalBudget();
      await loadCapitalPreview(result.imported ? `${project.title} was imported. It no longer appears in this term's preview.` : `${project.title} was already imported for this term.`);
    } catch (error) { state.textContent = error.status === 409 ? 'The manual table changed. Reload and review it before importing.' : error.message; state.classList.add('error'); button.disabled = false; }
  }
  async function loadCapitalPreview(successMessage = '') {
    if (!budgetAccess || !capitalTermId || capitalPreviewLoading) return;
    capitalPreviewLoading = true;
    const state = $('#projectImportPreviewState'); state.textContent = 'Loading read-only project preview…'; state.classList.remove('error');
    try {
      const result = await request('/api/budget/projects-capital/' + encodeURIComponent(capitalTermId) + '/project-preview');
      renderCapitalPreview(result.projects || []);
      state.textContent = successMessage || `Approved projects for ${result.term.label} are listed below.`;
    } catch (error) { $('#projectImportPreviewRows').replaceChildren(); state.textContent = error.message; state.classList.add('error'); }
    finally { capitalPreviewLoading = false; }
  }
  function renderCapitalWarnings() {
    const warnings = populatedCapitalRows().map((row, index) => ({ position: index + 1, missing: capitalMissing(row) })).filter((warning) => warning.missing.length);
    const disclosure = $('#projectsCapitalBudgetWarnings'); const host = disclosure.querySelector('.budget-disclosure-content'); host.replaceChildren();
    if (!warnings.length) { disclosure.hidden = true; return; }
    const grouped = groupedReadinessWarnings(warnings);
    disclosure.hidden = false;
    disclosure.querySelector('summary').textContent = `Budget readiness warnings (${grouped.length})`;
    host.append(node('strong', 'Before entering these rows in 312:'), node('p', 'Complete the missing details below. Draft rows still save automatically.', 'hint'));
    const list = node('ul'); grouped.forEach((warning) => list.append(node('li', readinessWarningText(warning)))); host.append(list);
  }
  function renderCapitalTotals() {
    const totals = {};
    populatedCapitalRows().forEach((row) => { const total = Number(row.totalCost ?? (Number(row.unitPrice) * Number(row.quantity))); if (Number.isFinite(total)) totals[row.currency || 'USD'] = (totals[row.currency || 'USD'] || 0) + total; });
    const host = $('#projectsCapitalBudgetTotals'); host.replaceChildren();
    Object.entries(totals).forEach(([currency, total]) => host.append(node('strong', `${currency} ${total.toFixed(2)}`)));
    if (!Object.keys(totals).length) host.append(node('span', 'No complete totals yet.', 'hint'));
  }
  function copyCapitalValue(index, field) {
    const source = capitalRows[index], destinations = capitalRows.slice(index + 1, -1);
    if (!source || !String(source[field] || '').trim() || !destinations.length) return;
    const overwrite = destinations.some((row) => String(row[field] || '').trim() && row[field] !== source[field]);
    if (overwrite && !confirm(`Copy this ${field === 'unitPrice' ? 'unit price' : field} into rows below and replace existing values?`)) return;
    destinations.forEach((row) => { row[field] = source[field]; }); capitalGeneration += 1; renderCapitalBudget(); scheduleCapitalSave();
  }
  function capitalInput(index, field, value) {
    const row = capitalRows[index]; if (!row) return;
    row[field] = value; capitalGeneration += 1; const focusRow = row; normalizeCapitalRows(); renderCapitalBudget({ row: focusRow, field }); if (field === 'vendor') void budgetVendorSuggestions('capital', capitalRows.indexOf(focusRow), value); scheduleCapitalSave();
  }
  function deleteCapitalRow(index) {
    const row = capitalRows[index]; if (!row || capitalRowEmpty(row) || capitalReadOnly) return;
    if (!confirm(`Remove Projects & Capital Items row ${index + 1}?`)) return;
    capitalRows.splice(index, 1); capitalGeneration += 1; normalizeCapitalRows(); renderCapitalBudget(); scheduleCapitalSave();
  }
  function capitalEditor(index, row, field, label, type = 'text') {
    const cell = node('td'), wrap = node('div', '', 'budget-cell-editor'); const control = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') control.type = type;
    control.value = row[field] || ''; control.dataset.capitalRow = String(index); control.dataset.capitalField = field; control.setAttribute('aria-label', `${label}, row ${index + 1}`); control.disabled = capitalReadOnly;
    if (field === 'unitPrice' || field === 'quantity') control.inputMode = 'decimal'; if (type === 'textarea') control.rows = 2;
    control.addEventListener('input', () => capitalInput(index, field, control.value)); wrap.append(control);
    if (field === 'vendor') { const matches = node('div', '', 'vendor-suggestions'); matches.dataset.capitalVendorSuggestions = String(index); matches.setAttribute('aria-live', 'polite'); wrap.append(matches); }
    if (!capitalRowEmpty(row)) { const copy = node('button', '↓', 'copy-down'); copy.type = 'button'; copy.title = `Copy ${label} down`; copy.setAttribute('aria-label', `Copy ${label} from row ${index + 1} to rows below`); copy.disabled = capitalReadOnly || !String(row[field] || '').trim() || index >= capitalRows.length - 2; copy.addEventListener('click', () => copyCapitalValue(index, field)); wrap.append(copy); }
    cell.append(wrap); return cell;
  }
  function capitalCategoryEditor(index, row) {
    const cell = node('td'), select = document.createElement('select'); select.disabled = capitalReadOnly; select.setAttribute('aria-label', `Category, row ${index + 1}`); select.append(new Option('Choose category', ''));
    capitalCategories.forEach(([value, label]) => select.append(new Option(label, value, false, row.category === value)));
    select.value = row.category || ''; select.addEventListener('change', () => capitalInput(index, 'category', select.value)); cell.append(select); return cell;
  }
  let capitalProjectBoundary = null;
  function clearCapitalDropIndicators() {
    $('#projectsCapitalBudgetRows')?.querySelectorAll('.budget-project-drop-target, .budget-project-drop-invalid').forEach((row) => row.classList.remove('budget-project-drop-target', 'budget-project-drop-invalid'));
  }
  function capitalDropTarget(event) {
    const host = $('#projectsCapitalBudgetRows'); if (!host) return null;
    const rows = [...host.querySelectorAll('tr[data-capital-row-index]')];
    const lastRealRow = rows.at(-2), table = host.closest('table');
    if (!lastRealRow || !table) return null;
    const tableBounds = table.getBoundingClientRect(), lastRealBounds = lastRealRow.getBoundingClientRect();
    if (event.clientX < tableBounds.left || event.clientX > tableBounds.right) return null;
    const hoveredRow = rows.find((row) => {
      const bounds = row.getBoundingClientRect();
      return event.clientY >= bounds.top && event.clientY < bounds.bottom;
    });
    if (hoveredRow) return Number(hoveredRow.dataset.capitalRowIndex);
    if (event.clientX >= tableBounds.left && event.clientX <= tableBounds.right && event.clientY >= lastRealBounds.bottom) return capitalRows.length - 1;
    return null;
  }
  function capitalProjectDropRange(target) {
    const source = capitalProjectBoundary, group = source && capitalProjectRange(source.index);
    if (!group) return null;
    target = Math.min(target, capitalRows.length - 2);
    if (source.edge === 'top') {
      if (target < group.first) return { first: target, last: group.last };
      if (target < group.last) return { first: target + 1, last: group.last };
    } else {
      if (target > group.last) return { first: group.first, last: target };
      if (target > group.first) return { first: group.first, last: target };
    }
    return { first: group.first, last: group.last };
  }
  function showCapitalDropTarget(target) {
    clearCapitalDropIndicators();
    if (target === null || target === undefined) return;
    const host = $('#projectsCapitalBudgetRows'), range = capitalProjectDropRange(target);
    if (range) for (let index = range.first; index <= range.last; index += 1) host?.querySelector(`[data-capital-row-index="${index}"]`)?.classList.add('budget-project-drop-target');
    if (target >= capitalRows.length - 1) host?.querySelector(`[data-capital-row-index="${target}"]`)?.classList.add('budget-project-drop-invalid');
  }
  function trackCapitalProjectDrag(event) {
    if (!capitalProjectBoundary) return;
    const target = capitalDropTarget(event);
    if (target === null) { clearCapitalDropIndicators(); return; }
    event.preventDefault(); showCapitalDropTarget(target);
  }
  function finishCapitalProjectDrag() {
    clearCapitalDropIndicators(); capitalProjectBoundary = null;
    document.removeEventListener('dragover', trackCapitalProjectDrag);
    document.removeEventListener('drop', dropCapitalProjectBoundary);
  }
  function dropCapitalProjectBoundary(event) {
    if (!capitalProjectBoundary) return;
    const target = capitalDropTarget(event);
    if (target === null) return;
    event.preventDefault(); clearCapitalDropIndicators(); moveCapitalProjectBoundary(target); finishCapitalProjectDrag();
  }
  function capitalProjectRange(index) {
    const name = String(capitalRows[index]?.projectName || '').trim();
    if (!name) return null;
    let first = index, last = index;
    while (first > 0 && String(capitalRows[first - 1].projectName || '').trim() === name) first -= 1;
    while (last + 1 < capitalRows.length - 1 && String(capitalRows[last + 1].projectName || '').trim() === name) last += 1;
    return { name, first, last };
  }
  function capitalProjectCell(index) {
    const group = capitalProjectRange(index); if (!group || group.first !== index) return null;
    const cell = node('td', '', 'budget-project-name'); cell.rowSpan = group.last - group.first + 1;
    cell.append(node('strong', group.name));
    if (!capitalReadOnly) {
      ['top', 'bottom'].forEach((edge) => {
        const handle = node('button', edge === 'top' ? '↥' : '↧', 'budget-project-boundary'); handle.type = 'button'; handle.draggable = true;
        handle.title = `Drag to adjust the ${edge} of ${group.name}`; handle.setAttribute('aria-label', handle.title);
        handle.addEventListener('dragstart', (event) => {
          capitalProjectBoundary = { index, edge }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.name);
          document.addEventListener('dragover', trackCapitalProjectDrag); document.addEventListener('drop', dropCapitalProjectBoundary);
        });
        handle.addEventListener('dragend', finishCapitalProjectDrag); cell.append(handle);
      });
    }
    return cell;
  }
  function capitalProjectPlaceholderCell(index, row) {
    const cell = node('td', '', 'budget-project-name budget-project-placeholder');
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 500;
    input.value = row.projectName || ''; input.placeholder = 'Project name';
    input.setAttribute('aria-label', `Project name, row ${index + 1}`); input.disabled = capitalReadOnly;
    input.addEventListener('change', () => capitalInput(index, 'projectName', input.value));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); }); cell.append(input);
    return cell;
  }
  function moveCapitalProjectBoundary(target) {
    const source = capitalProjectBoundary, group = source && capitalProjectRange(source.index);
    if (!group || target < 0) return;
    target = Math.min(target, capitalRows.length - 2);
    let changed = [];
    if (source.edge === 'top') {
      if (target < group.first) changed = capitalRows.slice(target, group.first);
      else if (target < group.last) changed = capitalRows.slice(group.first, target);
      else return;
    } else {
      if (target > group.last) changed = capitalRows.slice(group.last + 1, target + 1);
      else if (target > group.first) changed = capitalRows.slice(target + 1, group.last + 1);
      else return;
    }
    const replacing = changed.some((row) => row.projectName && row.projectName !== group.name);
    if (replacing && !confirm(`Move this project boundary and replace another project name?`)) return;
    const expanding = (source.edge === 'top' && target < group.first) || (source.edge === 'bottom' && target > group.last);
    changed.forEach((row) => { row.projectName = expanding ? group.name : ''; });
    capitalGeneration += 1; renderCapitalBudget(); scheduleCapitalSave();
  }
  function renderCapitalBudget(focus = null) {
    const host = $('#projectsCapitalBudgetRows'); host.replaceChildren();
    const header = host.closest('table').querySelector('thead tr');
    if (!header.querySelector('[data-project-name-column]')) { const heading = node('th', 'Project name'); heading.scope = 'col'; heading.dataset.projectNameColumn = 'true'; header.prepend(heading); }
    if (!header.querySelector('[data-budget-delete-column]')) { const heading = node('th', 'Remove'); heading.scope = 'col'; heading.dataset.budgetDeleteColumn = 'true'; header.append(heading); }
    capitalRows.forEach((row, index) => {
      const tr = document.createElement('tr'); tr.dataset.capitalRowIndex = String(index); if (capitalRowEmpty(row)) tr.className = 'budget-empty-row';
      const hasProjectName = Boolean(String(row.projectName || '').trim()); const projectCell = hasProjectName ? capitalProjectCell(index) : capitalProjectPlaceholderCell(index, row);
      if (projectCell) tr.append(projectCell);
      tr.append(capitalEditor(index, row, 'name', 'Line item name'), capitalCategoryEditor(index, row), capitalEditor(index, row, 'link', 'Link', 'url'), capitalEditor(index, row, 'unitPrice', 'Unit price'), capitalEditor(index, row, 'quantity', 'Quantity'), capitalEditor(index, row, 'vendor', 'Vendor'), node('td', displayCapitalTotal(row), 'budget-total-cell'), capitalEditor(index, row, 'notes', 'Description / notes', 'textarea'));
      tr.append(capitalRowEmpty(row) ? node('td', '', 'budget-row-action') : budgetDeleteCell(`Projects & Capital Items row ${index + 1}`, capitalReadOnly, () => deleteCapitalRow(index)));
      host.append(tr);
    });
    renderCapitalWarnings(); renderCapitalTotals();
    if (focus?.row) { const index = capitalRows.indexOf(focus.row); const target = index >= 0 && [...host.querySelectorAll('[data-capital-row]')].find((control) => Number(control.dataset.capitalRow) === index && control.dataset.capitalField === focus.field); if (target) { target.focus(); target.setSelectionRange?.(target.value.length, target.value.length); } }
  }
  function scheduleCapitalSave() { if (!capitalLoaded || capitalReadOnly) return; clearTimeout(capitalSaveTimer); setCapitalSaveState('Saving…'); capitalSaveTimer = setTimeout(saveCapitalBudget, 550); }
  async function saveCapitalBudget() {
    clearTimeout(capitalSaveTimer); if (capitalSaving) { capitalSaveQueued = true; return; } capitalSaving = true; capitalSaveQueued = false;
    const generation = capitalGeneration, sentRows = populatedCapitalRows();
    try {
      const result = await request('/api/budget/projects-capital/' + encodeURIComponent(capitalTermId), 'PUT', { revision: capitalRevision, rows: sentRows }); capitalRevision = result.record.revision;
      result.record.rows.forEach((saved, index) => { if (sentRows[index] && !sentRows[index].id) sentRows[index].id = saved.id; if (generation === capitalGeneration && sentRows[index]) Object.assign(sentRows[index], saved); });
      if (generation === capitalGeneration) { capitalRows = result.record.rows || []; normalizeCapitalRows(); renderCapitalBudget(); } setCapitalSaveState('Saved automatically.'); $('#projectsCapitalBudgetFeedback').textContent = '';
    } catch (error) { const feedback = $('#projectsCapitalBudgetFeedback'); feedback.textContent = error.status === 409 ? 'Another officer saved changes first. Reload the page before making more edits so no work is overwritten.' : error.message; setCapitalSaveState('Could not save.', true); }
    finally { capitalSaving = false; if (capitalSaveQueued || generation !== capitalGeneration) saveCapitalBudget(); }
  }
  async function loadCapitalBudget(termId = '', bootstrap = null) {
    if (!budgetAccess) return; setCapitalSaveState('Loading Projects & Capital Items…'); $('#projectsCapitalBudgetFeedback').textContent = '';
    try {
      if (bootstrap && !termId) capitalTerms = bootstrap.terms || [];
      else if (!capitalTerms.length) capitalTerms = (await request('/api/budget/terms')).terms || [];
      capitalTermId = termId || capitalTermId || capitalTerms.find((term) => term.id === 'SPRING-2027')?.id || capitalTerms[0]?.id || '';
      const picker = $('#projectsCapitalBudgetTerm'); picker.replaceChildren(); capitalTerms.forEach((term) => picker.append(new Option(`${term.label}${term.state === 'closed' ? ' (closed)' : ''}`, term.id, term.id === capitalTermId, term.id === capitalTermId))); picker.disabled = !capitalTerms.length;
      if (!capitalTermId) throw new Error('No budget term is available.'); const result = bootstrap && !termId && bootstrap.term?.id === capitalTermId ? { term: bootstrap.term, record: bootstrap.projectsCapital } : await request('/api/budget/projects-capital/' + encodeURIComponent(capitalTermId)); capitalRevision = result.record.revision; capitalRows = result.record.rows || []; capitalReadOnly = result.term.state === 'closed'; normalizeCapitalRows(); capitalLoaded = true; renderCapitalBudget(); setCapitalSaveState(result.term.state === 'closed' ? 'This term is closed and read-only.' : 'Saved automatically.'); void loadCapitalPreview();
    } catch (error) { $('#projectsCapitalBudgetFeedback').textContent = error.message; setCapitalSaveState('Could not load Projects & Capital Items.', true); }
  }
  function makeBudgetDisclosure(id, label) {
    const section = $('#' + id);
    if (!section || section.tagName === 'DETAILS') return section;
    const disclosure = document.createElement('details');
    disclosure.id = section.id; disclosure.className = section.className;
    [...section.attributes].forEach((attribute) => {
      if (attribute.name !== 'id' && attribute.name !== 'class') disclosure.setAttribute(attribute.name, attribute.value);
    });
    const summary = node('summary', label, 'budget-disclosure-summary');
    const content = node('div', '', 'budget-disclosure-content');
    while (section.firstChild) content.append(section.firstChild);
    disclosure.append(summary, content); section.replaceWith(disclosure);
    return disclosure;
  }
  const projectPreviewSection = document.querySelector('.project-import-preview');
  if (projectPreviewSection && !projectPreviewSection.id) projectPreviewSection.id = 'projectImportPreview';
  projectPreviewSection?.querySelector('#projectImportPreviewTitle')?.replaceChildren('Approve Projects');
  projectPreviewSection?.querySelector('#projectImportPreviewTitle + p')?.replaceChildren('List of approved projects from Project Management! If the projects have proper line items, they can be imported to the budget directly!');
  makeBudgetDisclosure('projectImportPreview', 'Approve Projects');
  makeBudgetDisclosure('projectsCapitalBudgetWarnings', 'Budget readiness warnings');
  $('#projectsCapitalBudgetTerm').addEventListener('change', () => { capitalLoaded = false; loadCapitalBudget($('#projectsCapitalBudgetTerm').value); });
  $('#refreshProjectImportPreview').addEventListener('click', () => { void loadCapitalPreview(); });
  document.querySelectorAll('[data-budget-tab]').forEach((tab) => tab.addEventListener('click', () => {
    selectBudgetTab(tab.dataset.budgetTab);
    if (tab.dataset.budgetTab === 'lab' && budgetAccess && !labLoaded) loadLabBudget('', budgetBootstrap);
    if (tab.dataset.budgetTab === 'events' && budgetAccess && !eventLoaded) loadEventsBudget('', budgetBootstrap);
    if (tab.dataset.budgetTab === 'conferences' && budgetAccess && !conferencesLoaded) loadConferences();
    if (tab.dataset.budgetTab === 'projects' && budgetAccess && !capitalLoaded) loadCapitalBudget();
    if (tab.dataset.budgetTab === 'total' && budgetAccess) loadBudgetTotal();
  }));
  function renderRoster(roster) {
    const host = $('#adminRosterList'); host.replaceChildren();
    if (!roster.length) { host.append(node('p', 'No active officer assignments are recorded.', 'hint')); return; }
    roster.forEach((person) => host.append(node('p', `${person.role[0].toUpperCase() + person.role.slice(1)}: ${person.name}, ${person.email}`)));
  }
  async function loadRoster() {
    const host = $('#adminRosterList'); host.replaceChildren(node('p', 'Loading officer roster…', 'hint'));
    try { renderRoster((await request('/api/admin/roster')).roster || []); }
    catch (error) { host.replaceChildren(node('p', error.message, 'error')); }
  }
  async function applyTreasurySession(state, loadData = false) {
    president = state.president; treasurer = state.treasurer;
    officer = !treasurer || president || state.role === 'admin';
    const access = state.officer;
    budgetAccess = access;
    $('#auth').textContent = state.member || state.admin ? 'Log out' : 'Sign in';
    $('#access').textContent = access ? `${state.username} · ${state.role.replaceAll('-', ' ')}` : (state.member ? `${state.username} · member (no officer access)` : 'Sign in to access the admin workspace');
    $('#officerManagement').hidden = !president;
    $('#leadershipHandoff').hidden = !(president || treasurer);
    $('#activityLog').hidden = !treasurer;
    $('#adminLanding').hidden = !access || projectWorkspace || budgetWorkspace;
    $('#budgetContent').hidden = !access || !budgetWorkspace;
    $('#treasuryContent').hidden = !access || !projectWorkspace;
    $('#treasuryEmpty').hidden = access;
    if (loadData && access && projectWorkspace) await load();
    if (loadData && access && budgetWorkspace) { await loadCapitalBudget('', budgetBootstrap); }
    if (loadData && access && !projectWorkspace && !budgetWorkspace) await loadRoster();
  }
  async function session() {
    const state = await request('/api/session');
    rememberSession(state);
    budgetBootstrap = budgetWorkspace && state.officer ? await request('/api/budget/bootstrap') : null;
    await applyTreasurySession(state, true);
  }
  const hintedTreasurySession = sessionHint();
  if (hintedTreasurySession?.officer) applyTreasurySession(hintedTreasurySession);
  function renderOfficers(officers) {
    const host = $('#officerList'); host.replaceChildren();
    if (!officers.length) {
      host.append(node('p', 'No individual officer assignments are active.', 'inventory-empty'));
      return;
    }
    officers.forEach((officerAccount) => {
      const card = node('article', '', 'treasury-card');
      card.append(node('h3', officerAccount.name), node('p', officerAccount.email));
      if (officerAccount.reason) card.append(node('p', officerAccount.reason, 'hint'));
      const revoke = node('button', 'Revoke officer access', 'danger'); revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        if (!confirm(`Revoke officer access for ${officerAccount.name}?`)) return;
        try { await request('/api/officers/' + encodeURIComponent(officerAccount.userId), 'DELETE', {}); await loadOfficers(); }
        catch (error) { $('#officerFeedback').textContent = error.message; }
      });
      card.append(revoke); host.append(card);
    });
  }
  async function loadOfficers() {
    const host = $('#officerList'); host.replaceChildren(node('p', 'Loading officer assignments…', 'hint'));
    try { renderOfficers((await request('/api/officers')).officers || []); }
    catch (error) { host.replaceChildren(node('p', error.message, 'error')); }
  }
  async function openOfficerDialog() {
    $('#officerEmail').value = ''; $('#officerReason').value = ''; $('#officerFeedback').textContent = '';
    $('#officerDialog').showModal(); await loadOfficers();
  }
  function openLeadershipDialog() {
    const role = $('#leadershipRole'); role.replaceChildren();
    if (president) role.append(new Option('President', 'president'));
    if (president || treasurer) role.append(new Option('Treasurer', 'treasurer'));
    $('#leadershipEmail').value = ''; $('#leadershipReason').value = ''; $('#leadershipFeedback').textContent = '';
    $('#leadershipDialog').showModal();
  }
  function money(value, currency) { return `${currency || ''} ${value ?? 'Not approved'}`.trim(); }
  function displayTreasuryMessages(comments) {
    const host = $('#treasuryMessagesList');
    host.replaceChildren();
    if (!comments.length) {
      return;
    }
    comments.forEach((comment) => {
      const entry = node('article', '', 'project-comment');
      const heading = node('div', '', 'project-comment-heading');
      heading.append(node('strong', actorLabel(comment.authorRole, comment.authorName)),
        node('span', displayDate(comment.createdAt), 'muted'));
      entry.append(heading, node('p', comment.text));
      host.append(entry);
    });
  }
  async function loadTreasuryMessages(project) {
    const host = $('#treasuryMessagesList');
    host.replaceChildren(node('p', 'Loading project messages…', 'hint'));
    try {
      const result = await request('/api/projects/' + encodeURIComponent(project.projectId) + '/comments');
      if (messageProject?.projectId !== project.projectId) return;
      displayTreasuryMessages(result.comments || []);
    } catch (error) { host.replaceChildren(node('p', error.message, 'error')); }
  }
  function activityLabel(event) {
    const labels = {
      project_submitted: 'Project submitted', owner_edit: 'Project details updated',
      documentation_changed: 'Supporting documentation changed', shared_comment: 'Shared project message posted',
      treasury_review: `Treasury review saved: ${event.payload?.status || 'status updated'}`,
      project_approval: `${actorLabel(event.actorRole, event.actorName)} ${event.payload?.status || 'updated'}${event.payload?.fullyApproved ? ' · Fully approved' : ''}`,
      private_notes_changed: 'Private treasury notes changed', project_deleted: 'Project deleted',
    };
    return labels[event.type] || 'Project activity updated';
  }
  async function openActivity() {
    const host = $('#treasuryActivityList');
    host.replaceChildren(node('li', 'Loading project activity…', 'hint'));
    $('#treasuryActivity').showModal();
    try {
      const result = await request('/api/treasury/activity');
      host.replaceChildren();
      if (!result.events?.length) host.append(node('li', 'No activity has been recorded yet.', 'hint'));
      result.events.forEach((event) => {
        const entry = node('li', '', 'project-timeline-event');
        entry.append(node('strong', activityLabel(event)), node('span', `Project: ${event.projectTitle}`, 'muted'), node('span', actorLabel(event.actorRole, event.actorName), 'muted'), node('time', displayDate(event.occurredAt), 'muted'));
        host.append(entry);
      });
    } catch (error) { host.replaceChildren(node('li', error.message, 'error')); }
  }
  async function load(response = null) {
    setTreasuryLoading(true);
    try { overview = response || await request('/api/treasury/overview'); render(); setStatus(`Loaded ${overview.projects.length} project requests.`); }
    catch (error) { setStatus(error.message, true); }
    finally { setTreasuryLoading(false); }
  }
  function render() {
    const totals = $('#treasuryTotals'); totals.replaceChildren();
    Object.entries(overview.totals).forEach(([currency, total]) => totals.append(node('div', `TOTAL PROJECT ${currency}: ${total}`, 'treasury-total')));
    const query = $('#treasurySearch').value.trim().toLowerCase(), filter = $('#treasuryFilter').value;
    const rows = overview.projects.filter((project) => (filter === 'all' || (project.treasury?.status || 'needs-review') === filter) && (!query || (project.title + ' ' + project.lead).toLowerCase().includes(query)));
    $('#treasuryCount').textContent = `${rows.length} project${rows.length === 1 ? '' : 's'} · treasury revision ${overview.revision}`;
    const host = $('#treasuryList'); host.replaceChildren();
    rows.forEach((project) => {
      const record = project.treasury || {};
      const card = node('article', '', 'treasury-card');
      const approvals = project.approvals || {}, decisions = approvals.decisions || {};
      const approvalLine = approvals.fullyApproved ? 'Fully approved for the budget' : (approvals.requiresDualApproval ? 'Awaiting Treasurer and President budget approval' : 'Awaiting one budget approval');
      card.append(node('h2', project.title), node('p', `${project.lead} · ${project.stage.replaceAll('-', ' ')} · ${project.projectStatus}`), node('strong', `Requested: ${money(project.estimate.amount, project.estimate.currency)}`), node('p', approvalLine));
      Object.values(decisions).forEach((decision) => card.append(node('p', `${actorLabel(decision.role, decision.actorName)}: ${budgetDecisionLabel(decision.status)}${decision.approvedAmount ? ' · ' + money(decision.approvedAmount, decision.currency) : ''}`, 'hint')));
      const actions = node('div', '', 'treasury-card-actions');
      const open = node('button', president || !officer ? 'Review project' : 'View project');
      open.addEventListener('click', () => president ? openPresidentReview(project) : openProject(project));
      actions.append(open);
      if (!officer || president) {
        const messages = node('button', 'Project messages');
        messages.type = 'button'; messages.addEventListener('click', () => openMessages(project));
        actions.append(messages);
      }
      if (!officer || president) {
        const remove = node('button', 'Delete project', 'danger');
        remove.type = 'button'; remove.addEventListener('click', () => deleteProject(project));
        actions.append(remove);
      }
      card.append(actions); host.append(card);
    });
    if (!rows.length) host.append(node('p', 'No projects match this filter.', 'inventory-empty'));
  }
  function openProject(project) {
    selected = project; const record = project.treasury || {};
    $('#detailTitle').textContent = project.title;
    const detail = $('#detailProject'); detail.replaceChildren();
    detail.append(node('p', `${project.lead} · ${project.contact}`), node('p', project.description), node('p', `Estimate: ${money(project.estimate.amount, project.estimate.currency)} · ${project.estimate.confidence}`), node('p', `Basis: ${project.estimate.basis}`));
    const documentationLinks = project.documentationLinks || (project.documentationUrl ? [{ label: 'Supporting documentation', url: project.documentationUrl }] : []);
    if (documentationLinks.length) {
      detail.append(node('p', 'Supporting documentation:'));
      documentationLinks.forEach((link) => {
        const documentation = document.createElement('a');
        documentation.href = link.url; documentation.target = '_blank'; documentation.rel = 'noopener noreferrer'; documentation.textContent = link.label;
        const row = node('p'); row.append(documentation);
        if (link.checkStatus === 'failed') row.append(node('span', ` · Link check error: ${link.checkMessage || 'not reachable'}`, 'error'));
        detail.append(row);
      });
    }
    if (project.lineItems.length) {
      const list = node('ul');
      project.lineItems.forEach((item) => {
        const entry = node('li', `${item.name}: ${item.quantity} ${item.unit} × ${item.unitPrice} = ${(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}`);
        if (item.inventoryItemId) {
          const context = node('div', 'Loading selected lab inventory location…', 'hint');
          entry.append(context);
          request('/api/inventory/items/' + encodeURIComponent(item.inventoryItemId) + '/context')
            .then((result) => context.replaceChildren(inventoryContextCard(result)))
            .catch(() => { context.textContent = 'Selected lab inventory item is no longer recorded.'; });
        }
        list.append(entry);
      });
      detail.append(list);
    }
    const legacyBudgetStatus = record.status === 'planned' ? 'approved-for-budget' : (record.status === 'approved' ? 'needs-review' : record.status);
    const legacyFundingStatus = record.status === 'approved' ? 'osl-funded' : (record.status === 'declined' ? 'declined' : 'not-requested');
    $('#reviewStatus').value = legacyBudgetStatus || 'needs-review'; $('#fundingStatus').value = record.fundingStatus || legacyFundingStatus; $('#planningPeriod').value = record.planningPeriod || ''; $('#approvedAmount').value = record.approvedAmount || ''; $('#fundingSource').value = record.fundingSource || 'IIT'; $('#treasuryNotes').value = officer ? '' : record.notes || ''; $('#reviewComment').value = ''; syncDecisionMessageRequirement(); $('#treasuryFeedback').textContent = ''; ['hr', 'h3', '.inventory-form-grid', '#treasuryFeedback', '#treasuryForm [type=submit]'].forEach((selector) => { const element = $('#treasuryForm').querySelector(selector); if (element) element.hidden = officer; }); $('#treasuryDetail').showModal();
  }
  function syncDecisionMessageRequirement() {
    const required = ['approved-for-budget', 'declined', 'needs-details'].includes($('#reviewStatus').value) || ['osl-funded', 'declined'].includes($('#fundingStatus').value);
    $('#reviewComment').required = required;
    $('#reviewMessageRequired').hidden = !required;
  }
  function openMessages(project) {
    messageProject = project;
    $('#messagesTitle').textContent = `Project messages: ${project.title}`;
    $('#treasuryMessageText').value = '';
    $('#treasuryMessageFeedback').textContent = '';
    $('#treasuryMessages').showModal();
    loadTreasuryMessages(project);
  }
  function openPresidentReview(project) {
    selected = project;
    const decision = project.approvals?.decisions?.president || {};
    $('#presidentReviewTitle').textContent = `President review: ${project.title}`;
    const detail = $('#presidentProject'); detail.replaceChildren();
    detail.append(node('p', `${project.lead} · ${project.contact}`), node('p', project.description),
      node('p', `Estimate: ${money(project.estimate.amount, project.estimate.currency)} · ${project.estimate.confidence}`),
      node('p', `Basis: ${project.estimate.basis}`));
    $('#presidentStatus').value = decision.status === 'planned' ? 'approved-for-budget' : (decision.status || 'needs-review');
    $('#presidentAmount').value = decision.approvedAmount || '';
    $('#presidentMessage').value = '';
    $('#presidentFeedback').textContent = '';
    $('#presidentReview').showModal();
  }
  async function deleteProject(project) {
    if (!project || !confirm(`Permanently delete project “${project.title}”? This cannot be undone.`)) return;
    try {
      await request('/api/treasury/projects/' + encodeURIComponent(project.projectId), 'DELETE', { projectsRevision: overview.projectsRevision, treasuryRevision: overview.revision });
      if (selected?.projectId === project.projectId) $('#treasuryDetail').close();
      await load();
    } catch (error) { setStatus(error.message, true); }
  }
  let treasurySignup = false;
  const treasuryLoginForm = $('#treasuryLoginForm'), treasuryLoginTitle = treasuryLoginForm.querySelector('h2'), treasuryLoginActions = treasuryLoginForm.querySelector('.actions');
  const treasuryNameField = document.createElement('label'); treasuryNameField.className = 'field'; treasuryNameField.hidden = true; treasuryNameField.textContent = 'Name';
  const treasuryName = document.createElement('input'); treasuryName.id = 'treasuryAccountName'; treasuryName.maxLength = 120; treasuryName.autocomplete = 'name'; treasuryNameField.append(treasuryName); treasuryLoginForm.insertBefore(treasuryNameField, $('#treasurerUsername').closest('label'));
  const treasuryAccountMode = node('button', 'Create account'); treasuryAccountMode.type = 'button'; treasuryLoginActions.insertBefore(treasuryAccountMode, $('#cancelLogin'));
  const updateTreasuryAccountMode = () => {
    treasuryLoginTitle.textContent = treasurySignup ? 'Create member account' : 'Sign in'; treasuryNameField.hidden = !treasurySignup; treasuryName.required = treasurySignup;
    treasuryAccountMode.textContent = treasurySignup ? 'Use existing account' : 'Create account'; treasuryLoginForm.querySelector('[type="submit"]').textContent = treasurySignup ? 'Create account' : 'Sign in'; $('#loginError').textContent = '';
  };
  treasuryAccountMode.addEventListener('click', () => { treasurySignup = !treasurySignup; updateTreasuryAccountMode(); }); updateTreasuryAccountMode();
  $('#auth').addEventListener('click', async () => {
    try {
      const state = await request('/api/session');
      if (state.member || state.admin) { await request('/api/logout', 'POST', {}); await session(); } else $('#treasuryLogin').showModal();
    } catch (error) { setStatus(error.message, true); }
  });
  $('#cancelLogin').addEventListener('click', () => $('#treasuryLogin').close());
  $('#treasuryLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await request(treasurySignup ? '/api/account/signup' : '/api/account/login', 'POST', { name: treasuryName.value, email: $('#treasurerUsername').value, password: $('#treasurerPassword').value }); $('#treasurerPassword').value = ''; $('#treasuryLogin').close(); await session(); }
    catch (error) { $('#loginError').textContent = error.message; }
  });
  $('#treasuryRefresh').addEventListener('click', load); $('#treasurySearch').addEventListener('input', render); $('#treasuryFilter').addEventListener('input', render);
  $('#reviewStatus').addEventListener('change', syncDecisionMessageRequirement);
  $('#fundingStatus').addEventListener('change', syncDecisionMessageRequirement);
  $('#closeTreasuryDetail').addEventListener('click', () => $('#treasuryDetail').close());
  $('#closeTreasuryMessages').addEventListener('click', () => $('#treasuryMessages').close());
  $('#closeTreasuryActivity').addEventListener('click', () => $('#treasuryActivity').close());
  $('#closePresidentReview').addEventListener('click', () => $('#presidentReview').close());
  $('#activityLog').addEventListener('click', openActivity);
  $('#officerManagement').addEventListener('click', openOfficerDialog);
  $('#closeOfficerDialog').addEventListener('click', () => $('#officerDialog').close());
  $('#leadershipHandoff').addEventListener('click', openLeadershipDialog);
  $('#closeLeadershipDialog').addEventListener('click', () => $('#leadershipDialog').close());
  $('#leadershipForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const feedback = $('#leadershipFeedback'); feedback.textContent = '';
    const role = $('#leadershipRole').value;
    if (!confirm(`Transfer the ${role} role immediately? The current holder will lose that role.`)) return;
    try {
      await request('/api/leadership-handoffs', 'POST', { role, email: $('#leadershipEmail').value, reason: $('#leadershipReason').value, confirmed: true });
      $('#leadershipDialog').close(); await session();
    } catch (error) { feedback.textContent = error.message; }
  });
  $('#officerForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const feedback = $('#officerFeedback'); feedback.textContent = '';
    try {
      const result = await request('/api/officers', 'POST', { email: $('#officerEmail').value, reason: $('#officerReason').value });
      if (!result.assigned) feedback.textContent = 'This account already has officer access.';
      $('#officerEmail').value = ''; $('#officerReason').value = ''; await loadOfficers();
    } catch (error) { feedback.textContent = error.message; }
  });
  $('#sendTreasuryMessage').addEventListener('click', async () => {
    if (!messageProject) return;
    const feedback = $('#treasuryMessageFeedback');
    const send = $('#sendTreasuryMessage');
    feedback.textContent = ''; send.disabled = true;
    try {
      await request('/api/projects/' + encodeURIComponent(messageProject.projectId) + '/comments', 'POST', { text: $('#treasuryMessageText').value });
      $('#treasuryMessageText').value = '';
      await loadTreasuryMessages(messageProject);
    } catch (error) { feedback.textContent = error.message; }
    finally { send.disabled = false; }
  });
  $('#treasuryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!selected) return;
    const feedback = $('#treasuryFeedback'), submit = $('#treasuryForm [type=submit]');
    if (submit.disabled) return;
    feedback.textContent = ''; submit.disabled = true;
    try {
      await request('/api/treasury/projects/' + encodeURIComponent(selected.projectId), 'POST', { revision: overview.revision, operationId: 'treasury-' + id(), reviewComment: $('#reviewComment').value, record: { status: $('#reviewStatus').value, fundingStatus: $('#fundingStatus').value, planningPeriod: $('#planningPeriod').value, approvedAmount: $('#approvedAmount').value, currency: 'USD', fundingSource: $('#fundingSource').value, notes: $('#treasuryNotes').value } });
      $('#treasuryDetail').close(); await load();
    } catch (error) { feedback.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('#presidentReviewForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!selected) return;
    const feedback = $('#presidentFeedback'); feedback.textContent = '';
    try {
      await request('/api/projects/' + encodeURIComponent(selected.projectId) + '/president-review', 'POST', {
        status: $('#presidentStatus').value, approvedAmount: $('#presidentAmount').value,
        currency: selected.estimate.currency || 'USD', message: $('#presidentMessage').value,
      });
      $('#presidentReview').close(); await load();
    } catch (error) { feedback.textContent = error.message; }
  });
  // Project Management receives session state and its overview together, so
  // authorization and all project approvals need only one server request.
  const initialProjectBootstrap = projectWorkspace
    ? request('/api/treasury/bootstrap')
    : Promise.resolve(null);
  const initialSession = projectWorkspace
    ? initialProjectBootstrap.then((bootstrap) => bootstrap.session)
    : request('/api/session');
  const initialBudgetBootstrap = budgetWorkspace
    ? request('/api/budget/bootstrap').catch((error) => error.status === 403 ? null : Promise.reject(error))
    : Promise.resolve(null);
  Promise.all([initialSession, initialProjectBootstrap, initialBudgetBootstrap]).then(async ([state, projectBootstrap, bootstrap]) => {
    rememberSession(state);
    budgetBootstrap = bootstrap;
    await applyTreasurySession(state);
    if (state.officer && projectWorkspace) await load(projectBootstrap?.overview);
    else if (state.officer && budgetWorkspace) await loadCapitalBudget('', budgetBootstrap);
    else if (state.officer && !budgetWorkspace) await loadRoster();
  }).catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

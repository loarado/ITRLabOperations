'use strict';
const dashboard = document.body.dataset.dashboard;
const $ = (selector) => document.querySelector(selector);
const node = (tag, text = '', className = '') => {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
};
async function request(path, method = 'GET', body, signal) {
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
    throw new Error('The site returned a web page instead of its API response. Use the local server (python3 lab_server.py) until the API is deployed separately.');
  }
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
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
      setEditorVisible(true);
      return;
    }
    if (!$('#project-lead').value.trim()) $('#project-lead').value = member.name;
    if (!$('#project-contact').value.trim()) $('#project-contact').value = member.email;
  }
  async function session() {
    applyMember(await request('/api/session'));
  }
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
    if (!member) return;
    response = response || await request('/api/projects/mine');
    projects = response.projects || [];
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
    wrapper.innerHTML = `<div class="card-heading"><h3>Purchase item ${itemNumber}</h3><button type="button" class="remove-item">Remove</button></div><div class="inventory-form-grid"><label class="field">Item name *<input class="item-name" maxlength="500" required></label><label class="field">Specification / part details<input class="item-specification" maxlength="2000"></label><label class="field">Quantity *<input class="item-quantity" inputmode="decimal" value="1" required></label><label class="field">Unit *<input class="item-unit" maxlength="100" value="each" required></label><label class="field">Unit price *<input class="item-price" inputmode="decimal" required></label><label class="field">Priority<select class="item-priority"><option value="needed">Needed</option><option value="critical">Critical</option><option value="nice-to-have">Nice to have</option></select></label><label class="field">Vendor<input class="item-vendor" maxlength="500"></label><label class="field">Product URL<input class="item-link" maxlength="2000" placeholder="https://…"></label></div><div class="selected-inventory" aria-live="polite"></div><div class="suggestions" aria-live="polite"></div>`;
    wrapper.querySelector('.remove-item').addEventListener('click', () => {
      suggestionState.get(wrapper)?.controller?.abort();
      suggestionState.delete(wrapper);
      wrapper.remove();
      subtotal();
      saveDraft();
    });
    const state = { controller: null, ticket: 0 };
    suggestionState.set(wrapper, state);
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
    wrapper.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', () => {
      subtotal();
      saveDraft();
    }));
    return wrapper;
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
  document.querySelectorAll('[data-budget-tab]').forEach((tab) => tab.addEventListener('click', () => selectBudgetTab(tab.dataset.budgetTab)));
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
  async function session() {
    const state = await request('/api/session');
    president = state.president; treasurer = state.treasurer;
    officer = !treasurer || president || state.role === 'admin';
    const access = state.officer;
    $('#auth').textContent = access ? 'Log out' : 'Sign in';
    $('#access').textContent = access ? `${state.username} · ${state.role.replaceAll('-', ' ')}` : 'Sign in to access the admin workspace';
    $('#officerManagement').hidden = !president;
    $('#leadershipHandoff').hidden = !(president || treasurer);
    $('#activityLog').hidden = !treasurer;
    $('#adminLanding').hidden = !access || projectWorkspace || budgetWorkspace;
    $('#budgetContent').hidden = !access || !budgetWorkspace;
    $('#treasuryContent').hidden = !access || !projectWorkspace;
    $('#treasuryEmpty').hidden = access;
    if (access && projectWorkspace) await load();
    if (access && !projectWorkspace && !budgetWorkspace) await loadRoster();
  }
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
  async function load() {
    try { overview = await request('/api/treasury/overview'); render(); setStatus(`Loaded ${overview.projects.length} project requests.`); }
    catch (error) { setStatus(error.message, true); }
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
  $('#auth').addEventListener('click', async () => {
    const state = await request('/api/session');
    if (state.officer) { await request('/api/logout', 'POST', {}); await session(); } else $('#treasuryLogin').showModal();
  });
  $('#cancelLogin').addEventListener('click', () => $('#treasuryLogin').close());
  $('#treasuryLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await request('/api/account/login', 'POST', { email: $('#treasurerUsername').value, password: $('#treasurerPassword').value }); $('#treasurerPassword').value = ''; $('#treasuryLogin').close(); await session(); }
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
    const feedback = $('#treasuryFeedback'); feedback.textContent = '';
    try {
      await request('/api/treasury/projects/' + encodeURIComponent(selected.projectId), 'POST', { revision: overview.revision, operationId: 'treasury-' + id(), reviewComment: $('#reviewComment').value, record: { status: $('#reviewStatus').value, fundingStatus: $('#fundingStatus').value, planningPeriod: $('#planningPeriod').value, approvedAmount: $('#approvedAmount').value, currency: 'USD', fundingSource: $('#fundingSource').value, notes: $('#treasuryNotes').value } });
      $('#treasuryDetail').close(); await load();
    } catch (error) { feedback.textContent = error.message; }
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
  session().catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

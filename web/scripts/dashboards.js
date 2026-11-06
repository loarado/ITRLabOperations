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

if (dashboard === 'projects') setupProjects();
if (dashboard === 'treasury') setupTreasury();

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
    checklistItem(required, 'Estimate amount, currency, confidence, and basis',
      filled('#estimate-amount') && filled('#estimate-currency') && filled('#estimate-confidence') && filled('#estimate-basis'));
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
    checklistItem(recommended, 'Supporting documentation or a design/proposal link', filled('#project-documentation-url'));
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
    $('#accountAuth').textContent = member ? 'Log out' : 'Log in / sign up';
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
  function displayComments(host, comments) {
    host.replaceChildren();
    if (!comments.length) {
      host.append(node('p', 'No shared comments yet.', 'hint'));
      return;
    }
    comments.forEach((comment) => {
      const entry = node('article', '', 'project-comment');
      const heading = node('div', '', 'project-comment-heading');
      heading.append(node('strong', comment.authorRole === 'treasurer' ? 'Treasury' : comment.authorName),
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
    if (project.documentationUrl) {
      const documentation = document.createElement('a');
      documentation.href = project.documentationUrl;
      documentation.target = '_blank';
      documentation.rel = 'noopener noreferrer';
      documentation.textContent = 'Open supporting documentation';
      summary.append(documentation);
    }
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
    else
      timelineEvent(timeline, 'Awaiting treasury review', 'A treasurer has not updated the review status yet.', null, true);
    detail.append(heading, summary, timelineHeading, timeline);
    const discussion = node('section', '', 'project-discussion');
    discussion.append(node('h4', 'Project messages'), node('p', 'Shared messages with Treasury.', 'hint'));
    const comments = node('div', '', 'project-comments');
    discussion.append(comments);
    const commentField = document.createElement('textarea');
    commentField.maxLength = 4000;
    commentField.rows = 3;
    commentField.placeholder = 'Reply to Treasury or add a project update.';
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
  async function loadMine() {
    if (!member) return;
    const response = await request('/api/projects/mine');
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
      ['description', '#project-description'], ['documentationUrl', '#project-documentation-url'],
      ['stage', '#project-stage'], ['nonItemCost', '#non-item-cost'],
    ];
    fields.forEach(([key, selector]) => { $(selector).value = project[key] || ''; });
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
      if (item.inventoryItemId) wrapper.dataset.inventoryItemId = item.inventoryItemId;
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
    wrapper.innerHTML = `<div class="card-heading"><h3>Purchase item ${itemNumber}</h3><button type="button" class="remove-item">Remove</button></div><div class="inventory-form-grid"><label class="field">Item name *<input class="item-name" maxlength="500" required></label><label class="field">Specification / part details<input class="item-specification" maxlength="2000"></label><label class="field">Quantity *<input class="item-quantity" inputmode="decimal" value="1" required></label><label class="field">Unit *<input class="item-unit" maxlength="100" value="each" required></label><label class="field">Unit price *<input class="item-price" inputmode="decimal" required></label><label class="field">Priority<select class="item-priority"><option value="needed">Needed</option><option value="critical">Critical</option><option value="nice-to-have">Nice to have</option></select></label><label class="field">Vendor<input class="item-vendor" maxlength="500"></label><label class="field">Product URL<input class="item-link" maxlength="2000" placeholder="https://…"></label></div><div class="suggestions" aria-live="polite"></div>`;
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
          host.replaceChildren(node('p', `Considering lab inventory: ${match.name}. ${details}`, 'hint'));
          saveDraft();
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
  function data() {
    return {
      title: $('#project-title').value,
      lead: $('#project-lead').value,
      contact: $('#project-contact').value,
      team: $('#project-team').value,
      description: $('#project-description').value,
      documentationUrl: $('#project-documentation-url').value,
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
    if (project.documentationUrl) {
      const documentation = document.createElement('a');
      documentation.href = project.documentationUrl;
      documentation.target = '_blank';
      documentation.rel = 'noopener noreferrer';
      documentation.textContent = 'Open supporting documentation';
      documentationSection.append(documentation);
    } else reviewOptionalNote(documentationSection, 'A proposal, design file, or other supporting link can give reviewers useful context.');
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
      const fields = [['title', '#project-title'], ['lead', '#project-lead'], ['contact', '#project-contact'], ['team', '#project-team'], ['description', '#project-description'], ['documentationUrl', '#project-documentation-url'], ['stage', '#project-stage'], ['nonItemCost', '#non-item-cost']];
      fields.forEach(([key, selector]) => { if (saved[key] !== undefined) $(selector).value = saved[key]; });
      Object.entries(saved.estimate || {}).forEach(([key, value]) => { const input = $('#estimate-' + key); if (input) input.value = value; });
      (saved.lineItems || []).forEach((item) => { const wrapper = itemFields(); $('#lineItems').append(wrapper); Object.entries(item).forEach(([key, value]) => { const input = wrapper.querySelector(itemFieldSelector(key)); if (input) input.value = value ?? ''; }); if (item.inventoryItemId) wrapper.dataset.inventoryItemId = item.inventoryItemId; });
      restoredDraft = true;
      setStatus('Recovered this browser’s unfinished project request.');
    } catch {}
  }
  $('#addItem').addEventListener('click', () => { $('#lineItems').append(itemFields()); subtotal(); });
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
  $('#accountMode').addEventListener('click', () => {
    signup = !signup; $('#accountTitle').textContent = signup ? 'Create member account' : 'Member login';
    $('#accountNameField').hidden = !signup; $('#accountName').required = signup;
    $('#accountMode').textContent = signup ? 'Use existing account' : 'Create account';
    $('#accountForm').querySelector('[type=submit]').textContent = signup ? 'Create account' : 'Log in';
    $('#accountError').textContent = '';
  });
  $('#accountForm').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#accountError').textContent = '';
    try {
      await request(signup ? '/api/account/signup' : '/api/account/login', 'POST', { name: $('#accountName').value, email: $('#accountEmail').value, password: $('#accountPassword').value });
      $('#accountPassword').value = ''; $('#accountDialog').close(); await session(); saveDraft(); await loadMine();
    } catch (error) { $('#accountError').textContent = error.message; }
  });
  restore(); subtotal(); session().then(loadMine).catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

function setupTreasury() {
  let overview = null, selected = null, messageProject = null;
  async function session() {
    const state = await request('/api/session');
    $('#auth').textContent = state.treasurer ? 'Log out' : 'Treasurer Login';
    $('#access').textContent = state.treasurer ? `${state.username} · ${state.role}` : 'Treasurer login required';
    $('#treasuryContent').hidden = !state.treasurer; $('#treasuryEmpty').hidden = state.treasurer;
    if (state.treasurer) await load();
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
      heading.append(node('strong', comment.authorRole === 'treasurer' ? 'Treasury' : comment.authorName),
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
  async function load() {
    try { overview = await request('/api/treasury/overview'); render(); setStatus(`Loaded ${overview.projects.length} project requests.`); }
    catch (error) { setStatus(error.message, true); }
  }
  function render() {
    const totals = $('#treasuryTotals'); totals.replaceChildren();
    Object.entries(overview.totals).forEach(([currency, total]) => totals.append(node('div', `${currency} ${total}`, 'treasury-total')));
    const query = $('#treasurySearch').value.trim().toLowerCase(), filter = $('#treasuryFilter').value;
    const rows = overview.projects.filter((project) => (filter === 'all' || (project.treasury?.status || 'needs-review') === filter) && (!query || (project.title + ' ' + project.lead).toLowerCase().includes(query)));
    $('#treasuryCount').textContent = `${rows.length} project${rows.length === 1 ? '' : 's'} · treasury revision ${overview.revision}`;
    const host = $('#treasuryList'); host.replaceChildren();
    rows.forEach((project) => {
      const record = project.treasury || {};
      const card = node('article', '', 'treasury-card');
      card.append(node('h2', project.title), node('p', `${project.lead} · ${project.stage.replaceAll('-', ' ')} · ${project.projectStatus}`), node('strong', `Requested: ${money(project.estimate.amount, project.estimate.currency)}`), node('p', `Treasury: ${record.status || 'needs review'}${record.approvedAmount ? ' · Approved ' + money(record.approvedAmount, record.currency) : ''}`));
      const actions = node('div', '', 'treasury-card-actions');
      const open = node('button', 'Review project');
      open.addEventListener('click', () => openProject(project));
      const messages = node('button', 'Project messages');
      messages.type = 'button';
      messages.addEventListener('click', () => openMessages(project));
      const remove = node('button', 'Delete project', 'danger');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteProject(project));
      actions.append(open, messages, remove);
      card.append(actions); host.append(card);
    });
    if (!rows.length) host.append(node('p', 'No projects match this filter.', 'inventory-empty'));
  }
  function openProject(project) {
    selected = project; const record = project.treasury || {};
    $('#detailTitle').textContent = project.title;
    const detail = $('#detailProject'); detail.replaceChildren();
    detail.append(node('p', `${project.lead} · ${project.contact}`), node('p', project.description), node('p', `Estimate: ${money(project.estimate.amount, project.estimate.currency)} · ${project.estimate.confidence}`), node('p', `Basis: ${project.estimate.basis}`));
    if (project.documentationUrl) {
      const documentation = document.createElement('a');
      documentation.href = project.documentationUrl;
      documentation.target = '_blank';
      documentation.rel = 'noopener noreferrer';
      documentation.textContent = 'Open supporting documentation';
      detail.append(node('p', 'Supporting documentation:'), documentation);
    }
    if (project.lineItems.length) { const list = node('ul'); project.lineItems.forEach((item) => list.append(node('li', `${item.name}: ${item.quantity} ${item.unit} × ${item.unitPrice} = ${(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}${item.inventoryItemId ? ' · lab inventory match selected' : ''}`))); detail.append(list); }
    $('#reviewStatus').value = record.status || 'needs-review'; $('#planningPeriod').value = record.planningPeriod || ''; $('#approvedAmount').value = record.approvedAmount || ''; $('#fundingSource').value = record.fundingSource || 'IIT'; $('#treasuryNotes').value = record.notes || ''; $('#reviewComment').value = ''; $('#treasuryFeedback').textContent = ''; $('#treasuryDetail').showModal();
  }
  function openMessages(project) {
    messageProject = project;
    $('#messagesTitle').textContent = `Project messages: ${project.title}`;
    $('#treasuryMessageText').value = '';
    $('#treasuryMessageFeedback').textContent = '';
    $('#treasuryMessages').showModal();
    loadTreasuryMessages(project);
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
    if (state.treasurer) { await request('/api/logout', 'POST', {}); await session(); } else $('#treasuryLogin').showModal();
  });
  $('#cancelLogin').addEventListener('click', () => $('#treasuryLogin').close());
  $('#treasuryLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await request('/api/account/login', 'POST', { email: $('#treasurerUsername').value, password: $('#treasurerPassword').value }); $('#treasurerPassword').value = ''; $('#treasuryLogin').close(); await session(); }
    catch (error) { $('#loginError').textContent = error.message; }
  });
  $('#treasuryRefresh').addEventListener('click', load); $('#treasurySearch').addEventListener('input', render); $('#treasuryFilter').addEventListener('input', render);
  $('#closeTreasuryDetail').addEventListener('click', () => $('#treasuryDetail').close());
  $('#closeTreasuryMessages').addEventListener('click', () => $('#treasuryMessages').close());
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
      await request('/api/treasury/projects/' + encodeURIComponent(selected.projectId), 'POST', { revision: overview.revision, operationId: 'treasury-' + id(), reviewComment: $('#reviewComment').value, record: { status: $('#reviewStatus').value, planningPeriod: $('#planningPeriod').value, approvedAmount: $('#approvedAmount').value, currency: 'USD', fundingSource: $('#fundingSource').value, notes: $('#treasuryNotes').value } });
      $('#treasuryDetail').close(); await load();
    } catch (error) { feedback.textContent = error.message; }
  });
  session().catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

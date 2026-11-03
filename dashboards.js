'use strict';
const dashboard = document.body.dataset.dashboard;
const $ = (selector) => document.querySelector(selector);
const node = (tag, text = '', className = '') => {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
};
async function request(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
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

if (dashboard === 'projects') setupProjects();
if (dashboard === 'treasury') setupTreasury();

function setupProjects() {
  const form = $('#projectForm');
  const savedKey = 'itr-project-request-draft';
  let itemNumber = 0;
  let member = null;
  function applyMember(state) {
    member = state.member ? state.user : null;
    $('#accountAccess').textContent = member ? `${member.name} · ${member.email}` : 'Member login required';
    $('#accountAuth').textContent = member ? 'Log out' : 'Log in / sign up';
    form.querySelector('[type=submit]').disabled = !member;
    if (member) {
      if (!$('#project-lead').value.trim()) $('#project-lead').value = member.name;
      if (!$('#project-contact').value.trim()) $('#project-contact').value = member.email;
    }
  }
  async function session() { applyMember(await request('/api/session')); }
  function itemFields() {
    itemNumber += 1;
    const wrapper = node('article', '', 'project-line-item');
    wrapper.innerHTML = `<div class="card-heading"><h3>Purchase item ${itemNumber}</h3><button type="button" class="remove-item">Remove</button></div><div class="inventory-form-grid"><label class="field">Item name *<input class="item-name" maxlength="500" required></label><label class="field">Specification / part details<input class="item-specification" maxlength="2000"></label><label class="field">Quantity *<input class="item-quantity" inputmode="decimal" value="1" required></label><label class="field">Unit *<input class="item-unit" maxlength="100" value="each" required></label><label class="field">Unit price *<input class="item-price" inputmode="decimal" required></label><label class="field">Priority<select class="item-priority"><option value="needed">Needed</option><option value="critical">Critical</option><option value="nice-to-have">Nice to have</option></select></label><label class="field">Vendor<input class="item-vendor" maxlength="500"></label><label class="field">Product URL<input class="item-link" maxlength="2000" placeholder="https://…"></label></div><div class="suggestions" aria-live="polite"></div>`;
    wrapper.querySelector('.remove-item').addEventListener('click', () => {
      wrapper.remove();
      subtotal();
      saveDraft();
    });
    let timer;
    wrapper.querySelector('.item-name').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => suggestions(wrapper), 250);
    });
    wrapper.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', () => {
      subtotal();
      saveDraft();
    }));
    return wrapper;
  }
  async function suggestions(wrapper) {
    const name = wrapper.querySelector('.item-name').value.trim();
    const host = wrapper.querySelector('.suggestions');
    host.replaceChildren();
    if (name.length < 2) return;
    try {
      const data = await request('/api/inventory/suggestions?q=' + encodeURIComponent(name));
      if (wrapper.querySelector('.item-name').value.trim() !== name || !data.results.length) return;
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
      host.append(node('small', error.message, 'error'));
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
  function data() {
    return {
      title: $('#project-title').value,
      lead: $('#project-lead').value,
      contact: $('#project-contact').value,
      team: $('#project-team').value,
      description: $('#project-description').value,
      stage: $('#project-stage').value,
      estimate: { amount: $('#estimate-amount').value, currency: $('#estimate-currency').value, confidence: $('#estimate-confidence').value, basis: $('#estimate-basis').value },
      nonItemCost: $('#non-item-cost').value,
      lineItems: [...$('#lineItems').children].map(readItem),
    };
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
  }
  function saveDraft() {
    try { localStorage.setItem(savedKey, JSON.stringify(data())); } catch {}
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(savedKey));
      if (!saved) return;
      const fields = [['title', '#project-title'], ['lead', '#project-lead'], ['contact', '#project-contact'], ['team', '#project-team'], ['description', '#project-description'], ['stage', '#project-stage'], ['nonItemCost', '#non-item-cost']];
      fields.forEach(([key, selector]) => { if (saved[key] !== undefined) $(selector).value = saved[key]; });
      Object.entries(saved.estimate || {}).forEach(([key, value]) => { const input = $('#estimate-' + key); if (input) input.value = value; });
      (saved.lineItems || []).forEach((item) => { const wrapper = itemFields(); $('#lineItems').append(wrapper); Object.entries(item).forEach(([key, value]) => { const input = wrapper.querySelector('.item-' + key.replace('productLink', 'link')); if (input) input.value = value ?? ''; }); if (item.inventoryItemId) wrapper.dataset.inventoryItemId = item.inventoryItemId; });
      setStatus('Recovered this browser’s unfinished project request.');
    } catch {}
  }
  $('#addItem').addEventListener('click', () => { $('#lineItems').append(itemFields()); });
  $('#clearProject').addEventListener('click', () => {
    if (!confirm('Clear this unfinished project request?')) return;
    form.reset(); $('#lineItems').replaceChildren(); localStorage.removeItem(savedKey); subtotal();
  });
  form.addEventListener('input', () => { subtotal(); saveDraft(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = $('#projectFeedback'); feedback.textContent = '';
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      const result = await request('/api/projects', 'POST', { project: data(), operationId: 'project-' + id() });
      localStorage.removeItem(savedKey); form.reset(); $('#lineItems').replaceChildren(); subtotal();
      setStatus(`Project request submitted. Receipt: ${result.projectId}. The project lead can use that ID when talking with the lab.`);
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
      $('#accountPassword').value = ''; $('#accountDialog').close(); await session(); saveDraft();
    } catch (error) { $('#accountError').textContent = error.message; }
  });
  restore(); subtotal(); session().catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

function setupTreasury() {
  let overview = null, selected = null;
  async function session() {
    const state = await request('/api/session');
    $('#auth').textContent = state.treasurer ? 'Log out' : 'Treasurer Login';
    $('#access').textContent = state.treasurer ? `${state.username} · ${state.role}` : 'Treasurer login required';
    $('#treasuryContent').hidden = !state.treasurer; $('#treasuryEmpty').hidden = state.treasurer;
    if (state.treasurer) await load();
  }
  function money(value, currency) { return `${currency || ''} ${value ?? 'Not approved'}`.trim(); }
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
      const open = node('button', 'Review project'); open.addEventListener('click', () => openProject(project)); card.append(open); host.append(card);
    });
    if (!rows.length) host.append(node('p', 'No projects match this filter.', 'inventory-empty'));
  }
  function openProject(project) {
    selected = project; const record = project.treasury || {};
    $('#detailTitle').textContent = project.title;
    const detail = $('#detailProject'); detail.replaceChildren();
    detail.append(node('p', `${project.lead} · ${project.contact}`), node('p', project.description), node('p', `Estimate: ${money(project.estimate.amount, project.estimate.currency)} · ${project.estimate.confidence}`), node('p', `Basis: ${project.estimate.basis}`));
    if (project.lineItems.length) { const list = node('ul'); project.lineItems.forEach((item) => list.append(node('li', `${item.name}: ${item.quantity} ${item.unit} × ${item.unitPrice} = ${(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}${item.inventoryItemId ? ' · lab inventory match selected' : ''}`))); detail.append(list); }
    $('#reviewStatus').value = record.status || 'needs-review'; $('#planningPeriod').value = record.planningPeriod || ''; $('#approvedAmount').value = record.approvedAmount || ''; $('#approvedCurrency').value = record.currency || project.estimate.currency; $('#fundingSource').value = record.fundingSource || ''; $('#treasuryNotes').value = record.notes || ''; $('#treasuryFeedback').textContent = ''; $('#deleteProject').textContent = `Delete “${project.title}”`; $('#treasuryDetail').showModal();
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
  $('#treasuryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!selected) return;
    const feedback = $('#treasuryFeedback'); feedback.textContent = '';
    try {
      await request('/api/treasury/projects/' + encodeURIComponent(selected.projectId), 'POST', { revision: overview.revision, operationId: 'treasury-' + id(), record: { status: $('#reviewStatus').value, planningPeriod: $('#planningPeriod').value, approvedAmount: $('#approvedAmount').value, currency: $('#approvedCurrency').value, fundingSource: $('#fundingSource').value, notes: $('#treasuryNotes').value } });
      $('#treasuryDetail').close(); await load();
    } catch (error) { feedback.textContent = error.message; }
  });
  $('#deleteProject').addEventListener('click', async () => {
    if (!selected || !confirm(`Permanently delete project “${selected.title}”? This cannot be undone.`)) return;
    const feedback = $('#treasuryFeedback'); feedback.textContent = '';
    try { await request('/api/treasury/projects/' + encodeURIComponent(selected.projectId), 'DELETE', { projectsRevision: overview.projectsRevision, treasuryRevision: overview.revision }); $('#treasuryDetail').close(); await load(); }
    catch (error) { feedback.textContent = error.message; }
  });
  session().catch((error) => { $('#fatal').hidden = false; $('#fatal').textContent = error.message; });
}

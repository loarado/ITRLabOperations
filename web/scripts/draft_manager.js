'use strict';
async function resetDeletedDraft() {
  removeRecovery(app.endpoint.slice(5));
  clearTimeout(saveTimer);
  await api(app.endpoint.replace('/api/', '/api/drafts/'));
  try {
    const saved = await api(app.endpoint);
    app.data = saved;
    history = [];
    future = [];
    dirty = false;
    draftPresent = false;
    generation++;
    app.clearClipboard?.();
    app.render();
    updateUndo();
    await app.onInventoryChanged?.();
    message('Draft deleted. Latest saved state loaded.');
  } catch (error) {
    if (error.status === 404) {
      allowNavigation = true;
      location.href = 'lab_overview.html';
    } else throw error;
  }
}
function setupDraftManager() {
  const toolbar = $('.editor-actions');
  if (!toolbar) return;
  const button = document.createElement('button');
  button.id = 'manageDrafts';
  button.textContent = 'Manage drafts';
  button.setAttribute('data-admin', '');
  toolbar.append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'draftManager';
  dialog.innerHTML =
    '<h2>Temporary drafts</h2><p class="hint">Working copies in this admin session, across tabs. Named Save Changes versions are managed separately and are never deleted here.</p><div id="draftList"></div><p id="draftError" role="alert"></p><button id="closeDrafts">Close</button>';
  const confirmation = document.createElement('dialog');
  confirmation.id = 'deleteDraftDialog';
  confirmation.innerHTML =
    '<h2>Delete draft?</h2><p id="deleteDraftDescription"></p><p>This cannot be undone. Saved versions and the committed lab will be kept.</p><div class="actions"><button id="cancelDeleteDraft">Cancel</button><button id="confirmDeleteDraft" class="danger destructive">Delete Draft</button></div>';
  document.body.append(dialog, confirmation);
  let target = null;
  async function refresh() {
    const result = await api('/api/drafts'),
      list = $('#draftList');
    list.replaceChildren();
    if (!result.drafts.length) {
      list.textContent = 'No temporary drafts.';
      return;
    }
    for (const draft of result.drafts) {
      draftEpochs.set(
        draft.instance + ':/api/drafts/' + draft.resource,
        draft.epoch,
      );
      const row = document.createElement('div');
      row.className = 'draft-row';
      row.dataset.instance = draft.instance;
      row.dataset.resource = draft.resource;
      const label = document.createElement('p'),
        remove = document.createElement('button');
      const active =
        draft.instance === editorInstance &&
        '/api/' + draft.resource === app.endpoint;
      label.textContent = `${draft.name} · ${draft.resource} · ${active ? 'Active editor' : draft.instance === editorInstance ? 'This tab' : 'Tab ' + draft.instance.slice(-8)} · ${draft.dirty ? 'Unsaved' : 'No unsaved changes'}`;
      remove.textContent = 'Delete Draft';
      remove.className = 'danger';
      remove.setAttribute('aria-label', 'Delete draft: ' + draft.name);
      remove.addEventListener('click', () => {
        target = draft;
        $('#deleteDraftDescription').textContent =
          `Delete “${draft.name}” (${draft.resource})?${active ? ' This editor will return to the saved state.' : ''}`;
        confirmation.showModal();
        $('#cancelDeleteDraft').focus();
      });
      row.append(label, remove);
      list.append(row);
    }
  }
  button.addEventListener('click', async () => {
    if (!isAdmin) return;
    if (saving) await savePromise;
    if (!(await cacheDraft())) return;
    $('#draftError').textContent = '';
    dialog.showModal();
    try {
      await refresh();
    } catch (error) {
      $('#draftError').textContent = error.message;
    }
  });
  $('#closeDrafts').addEventListener('click', () => dialog.close());
  $('#cancelDeleteDraft').addEventListener('click', () => {
    target = null;
    confirmation.close();
  });
  confirmation.addEventListener('cancel', () => {
    target = null;
  });
  $('#confirmDeleteDraft').addEventListener('click', async () => {
    if (!isAdmin || !target) return;
    const draft = target;
    target = null;
    const confirm = $('#confirmDeleteDraft');
    confirm.disabled = true;
    try {
      clearTimeout(saveTimer);
      await cacheQueue;
      if (saving) await savePromise;
      await api(
        '/api/drafts/' + draft.resource,
        'DELETE',
        undefined,
        draft.instance,
      );
      removeRecovery(draft.resource, draft.instance);
      if (
        draft.instance === editorInstance &&
        '/api/' + draft.resource === app.endpoint
      )
        await resetDeletedDraft();
      else await app.onInventoryChanged?.();
      confirmation.close();
      await refresh();
    } catch (error) {
      confirmation.close();
      $('#draftError').textContent = error.message;
    } finally {
      confirm.disabled = false;
    }
  });
}

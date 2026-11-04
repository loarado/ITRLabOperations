'use strict';
// A browser safety copy of the same temporary draft, never a committed version.
let recoveryContext = null,
  recoveryReady = false,
  recoveryNotice = '';
const recoveryFormat = 1,
  recoveryLifetime = 8 * 60 * 60 * 1000;
function recoveryPrefix() {
  return recoveryContext
    ? 'itr-recovery:v1:' + recoveryContext.scope + ':'
    : null;
}
function recoveryKey(
  resource = app?.endpoint.slice(5),
  instance = editorInstance,
) {
  return recoveryPrefix() + instance + ':' + resource;
}
function recoveryKeys(prefix) {
  const keys = [];
  if (!prefix) return keys;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {}
  return keys;
}
function removeRecovery(resource, instance = editorInstance) {
  try {
    localStorage.removeItem(recoveryKey(resource, instance));
  } catch {}
}
function clearRecoveryScope() {
  for (const key of recoveryKeys(recoveryPrefix()))
    try {
      localStorage.removeItem(key);
    } catch {}
  recoveryReady = false;
  recoveryContext = null;
}
function readRecovery(resource) {
  try {
    const raw = localStorage.getItem(recoveryKey(resource));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (
      !record ||
      record.format !== recoveryFormat ||
      record.scope !== recoveryContext.scope ||
      record.instance !== editorInstance ||
      record.resource !== resource ||
      !Number.isFinite(record.timestamp) ||
      record.timestamp > Date.now() + 60000 ||
      Date.now() - record.timestamp > recoveryLifetime ||
      !Number.isInteger(record.baseLabRevision) ||
      !Number.isInteger(record.epoch) ||
      typeof record.pending !== 'boolean' ||
      typeof record.state?.dirty !== 'boolean' ||
      !record.state.data ||
      typeof record.state.data !== 'object' ||
      !Number.isInteger(record.state.data.revision)
    )
      throw new Error('Invalid recovery record');
    return record;
  } catch {
    removeRecovery(resource);
    recoveryNotice = 'Invalid or expired recovery data was ignored.';
    return null;
  }
}
function recoveryUI() {
  return {
    ...app.getRecoveryUI?.(),
    groups: Object.fromEntries(groupExpansion),
    scroll: $('#viewport')
      ? [$('#viewport').scrollLeft, $('#viewport').scrollTop]
      : [0, 0],
  };
}
function storeRecovery(pending = true) {
  if (!isAdmin || !recoveryReady || !recoveryContext || !app?.data) return;
  const resource = app.endpoint.slice(5),
    key = recoveryKey(resource),
    old = readRecovery(resource);
  const record = {
    format: recoveryFormat,
    scope: recoveryContext.scope,
    instance: editorInstance,
    resource,
    timestamp: Date.now(),
    baseLabRevision: recoveryContext.labRevision,
    epoch: draftEpochs.get(editorInstance + ':/api/drafts/' + resource) ?? 0,
    pending: pending || !!old?.pending,
    state: { data: clone(app.data), history: [], future: [], dirty },
    ui: recoveryUI(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    message(
      'Browser recovery storage is unavailable or full. Keep this tab open until your draft reaches the server, or export a copy.',
      true,
    );
  }
}
function acknowledgeRecovery(resource, state) {
  if (!recoveryContext) return;
  const record = readRecovery(resource);
  if (
    record &&
    JSON.stringify(record.state.data) === JSON.stringify(state.data) &&
    record.state.dirty === state.dirty
  ) {
    record.pending = false;
    record.epoch =
      draftEpochs.get(editorInstance + ':/api/drafts/' + resource) ?? 0;
    try {
      localStorage.setItem(recoveryKey(resource), JSON.stringify(record));
    } catch {}
  }
}
async function prepareRecovery() {
  recoveryReady = false;
  recoveryNotice = '';
  recoveryContext = await api('/api/recovery-context');
  const prefix = recoveryPrefix() + editorInstance + ':';
  const resources = recoveryKeys(prefix)
    .map((key) => key.slice(prefix.length))
    .filter((resource) =>
      /^(lab|shelves\/[A-Za-z0-9_-]{1,64})$/.test(resource),
    );
  // The map must recover first: its draft authorizes newly created shelf files.
  resources.sort((a, b) =>
    a === 'lab' ? -1 : b === 'lab' ? 1 : a.localeCompare(b),
  );
  for (const resource of resources) {
    const record = readRecovery(resource);
    if (!record) continue;
    if (record.baseLabRevision !== recoveryContext.labRevision) {
      removeRecovery(resource);
      recoveryNotice =
        'A newer saved version is available; older browser recovery was ignored.';
      continue;
    }
    const path = '/api/drafts/' + resource,
      cached = await api(path),
      epoch = draftEpochs.get(editorInstance + ':' + path) ?? 0;
    if (record.epoch !== epoch) {
      removeRecovery(resource);
      continue;
    }
    if (!record.state.dirty || (cached && !record.pending)) continue;
    try {
      const saved = await api('/api/' + resource);
      if (record.state.data.revision !== saved.revision) {
        removeRecovery(resource);
        continue;
      }
      // Reuse server draft validation, including inventory restore references.
      // Only a fully validated record can replace the working copy.
      await api(path, 'PUT', record.state);
      acknowledgeRecovery(resource, record.state);
      recoveryNotice = 'Recovered unsaved editing work from this browser.';
    } catch (error) {
      if ([400, 404, 409].includes(error.status)) {
        removeRecovery(resource);
        recoveryNotice =
          'Invalid, deleted, or stale recovery data was ignored.';
      } else throw error;
    }
  }
}
function restoreRecoveryUI() {
  const record = readRecovery(app.endpoint.slice(5)),
    ui = record?.ui;
  if (ui && typeof ui === 'object') {
    app.restoreRecoveryUI?.(ui);
    if (ui.groups && typeof ui.groups === 'object')
      for (const [key, open] of Object.entries(ui.groups)) {
        if (typeof open !== 'boolean') continue;
        groupExpansion.set(key, open);
        const section = Array.from(
          document.querySelectorAll('.editor-group'),
        ).find((el) => el.dataset.group === key);
        if (section) {
          section
            .querySelector('.group-heading')
            .setAttribute('aria-expanded', String(open));
          section
            .querySelector('.group-body')
            .classList.toggle('collapsed', !open);
          section.querySelector('.group-content').inert = !open;
        }
      }
    if (
      Array.isArray(ui.scroll) &&
      ui.scroll.length === 2 &&
      ui.scroll.every(Number.isFinite)
    )
      requestAnimationFrame(() => $('#viewport')?.scrollTo(...ui.scroll));
  }
  recoveryReady = true;
}
function recoveryAfterSave(labRevision) {
  // The commit includes this tab's shelf drafts. Old copies must not replay them.
  for (const key of recoveryKeys(recoveryPrefix() + editorInstance + ':'))
    try {
      localStorage.removeItem(key);
    } catch {}
  // Use the successful commit's revision; no second request can turn a
  // successful save into an apparent failure or delay protecting newer edits.
  if (recoveryContext)
    recoveryContext.labRevision = Number.isInteger(labRevision)
      ? labRevision
      : app.endpoint === '/api/lab'
        ? app.data.revision
        : recoveryContext.labRevision + 1;
  if (dirty) storeRecovery(true);
}
function setupRecoveryEvents() {
  const pendingFields = new WeakSet();
  document.addEventListener('input', (event) => {
    if (event.target.matches('input[data-admin],textarea[data-admin]'))
      pendingFields.add(event.target);
  });
  document.addEventListener(
    'change',
    (event) => pendingFields.delete(event.target),
    true,
  );
  window.addEventListener('pagehide', () => storeRecovery(false));
  window.addEventListener('beforeunload', () => {
    const field = document.activeElement;
    if (isAdmin && field && pendingFields.has(field))
      field.dispatchEvent(new Event('change', { bubbles: true }));
    storeRecovery(false);
  });
  window.addEventListener('storage', async (event) => {
    if (
      !isAdmin ||
      !recoveryReady ||
      !recoveryContext ||
      event.key !== recoveryKey() ||
      event.newValue !== null
    )
      return;
    // A sibling tab may have explicitly deleted this working copy or logged out.
    try {
      const session = await api('/api/session');
      if (!session.admin) {
        clearRecoveryScope();
        await showCommittedVisitor();
        return;
      }
      const oldEpoch =
        draftEpochs.get(
          editorInstance + ':/api/drafts/' + app.endpoint.slice(5),
        ) ?? 0;
      await api(app.endpoint.replace('/api/', '/api/drafts/'));
      if (
        oldEpoch !==
        (draftEpochs.get(
          editorInstance + ':/api/drafts/' + app.endpoint.slice(5),
        ) ?? 0)
      )
        await resetDeletedDraft();
    } catch (error) {
      message(error.message, true);
    }
  });
}

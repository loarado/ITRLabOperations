'use strict';
let inventoryState = null,
  inventoryTicket = 0,
  inventoryEntry = null,
  inventoryEntryDirty = false,
  inventoryDetailId = null,
  inventoryTransferEntry = null,
  inventoryTransferDirty = false;
const itemInputKeys = [
  'name',
  'category',
  'keywords',
  'description',
  'productLink',
  'vendor',
  'unitPrice',
  'currency',
  'priceUnit',
  'notes',
];
const stockInputKeys = [
  'tracking',
  'quantity',
  'availability',
  'unit',
  'notes',
];
function inventoryNode(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function inventoryButton(text, action) {
  const button = inventoryNode('button', text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}
function inventoryLocation(stock) {
  const key = stock.shelfId
    ? stock.shelfId + (stock.binId ? '/' + stock.binId : '')
    : '';
  const location = inventoryState?.locations[key];
  return {
    key,
    location,
    label: stock.shelfId
      ? location?.label || stock.locationLabel || stock.shelfId
      : 'Unassigned',
    mapped: !!location?.mapped,
    hidden: !!location?.hidden,
  };
}
function inventoryStockText(stock) {
  return stock.tracking === 'exact'
    ? `${stock.quantity === null ? 'Quantity unknown' : stock.quantity} ${stock.unit}`
    : stock.tracking === 'availability'
      ? `${stock.availability.replaceAll('-', ' ')} · ${stock.unit}`
      : 'Present';
}
async function refreshInventory() {
  const ticket = ++inventoryTicket;
  try {
    const state = await api('/api/inventory');
    if (ticket !== inventoryTicket) return;
    inventoryState = state;
    document.querySelectorAll('[data-stock-shelf]').forEach((host) => {
      inventoryLocationPanel(
        host,
        host.dataset.stockShelf,
        host.dataset.stockBin || null,
        host.dataset.stockAll === 'true',
      );
    });
    if (inventoryDetailId && $('#inventoryDetails').open) {
      if (inventoryState.items[inventoryDetailId])
        showInventoryDetails(inventoryDetailId);
      else {
        $('#inventoryDetails').close();
        inventoryDetailId = null;
      }
    }
    document.dispatchEvent(new Event('inventory-updated'));
    return true;
  } catch (error) {
    message('Inventory could not load: ' + error.message, true);
    return false;
  }
}
function quickInventoryEntry(shelfId, binId = null) {
  const form = inventoryNode('form', '', 'inventory-quick');
  const input = document.createElement('input');
  input.placeholder = 'Add inventory…';
  input.setAttribute('aria-label', 'Add inventory at this location');
  input.maxLength = 500;
  const add = inventoryNode('button', 'Add');
  add.type = 'submit';
  const feedback = inventoryNode('small', '');
  feedback.setAttribute('role', 'status');
  form.append(input, add, feedback);
  let pending = false,
    operation = null,
    lastName = null,
    revision = null,
    composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  input.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      (event.isComposing || composing || event.keyCode === 229)
    )
      event.preventDefault();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (pending || composing || !name || !isAdmin) return;
    if (name !== lastName) {
      operation = 'op-' + uniqueId();
      revision = inventoryState.revision;
      lastName = name;
    }
    pending = true;
    input.disabled = add.disabled = true;
    feedback.textContent = 'Saving…';
    try {
      const result = await api('/api/inventory', 'POST', {
        action: 'quick',
        item: { name },
        stock: { shelfId, binId, unit: 'each' },
        operationId: operation,
        revision,
      });
      if (result.item && result.stock) {
        inventoryState.items[result.itemId] ??= result.item;
        inventoryState.stocks[result.stockId] ??= result.stock;
        inventoryState.revision = Math.max(
          inventoryState.revision,
          result.revision,
        );
        const host = form.closest('.stock-panel');
        if (host) inventoryLocationPanel(host, shelfId, binId);
        document.dispatchEvent(new Event('inventory-updated'));
      }
      input.value = '';
      lastName = null;
      feedback.textContent = result.existing
        ? 'Already recorded here · details unchanged.'
        : 'Added';
      await refreshInventory();
      try {
        localStorage.setItem('itr-inventory-changed', String(Date.now()));
      } catch {}
    } catch (error) {
      feedback.textContent = error.message;
      if (error.status === 409) {
        const refreshed = await refreshInventory();
        if (!refreshed) return;
        revision = inventoryState.revision;
        operation = 'op-' + uniqueId();
        feedback.textContent +=
          ' Inventory refreshed; press Add again to retry your retained name.';
      }
    } finally {
      pending = false;
      input.disabled = add.disabled = !isAdmin;
      if (isAdmin && input.isConnected) input.focus();
    }
  });
  return form;
}
function meaningfulInventoryValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== 'string' ||
      (!!value.trim() && !/^no details[.!]?$/i.test(value.trim())))
  );
}
function hasInventoryDetails(item, stocks = []) {
  return (
    [
      'category',
      'keywords',
      'description',
      'vendor',
      'productLink',
      'unitPrice',
      'notes',
    ].some((key) => meaningfulInventoryValue(item[key])) ||
    stocks.some(
      (stock) =>
        meaningfulInventoryValue(stock.quantity) ||
        meaningfulInventoryValue(stock.notes) ||
        (!!stock.unit && stock.unit !== 'each') ||
        (stock.tracking === 'availability' &&
          meaningfulInventoryValue(stock.availability)),
    )
  );
}
function inventoryDetailsContent(itemId, stocks) {
  const item = inventoryState.items[itemId];
  const content = inventoryNode('div', '', 'stock-detail-content');
  for (const [key, title] of [
    ['category', 'Category'],
    ['vendor', 'Vendor'],
    ['description', 'Description'],
    ['keywords', 'Keywords'],
    ['notes', 'Notes'],
  ])
    if (meaningfulInventoryValue(item[key]))
      content.append(inventoryNode('p', title + ': ' + item[key]));
  if (meaningfulInventoryValue(item.unitPrice))
    content.append(
      inventoryNode(
        'p',
        `${item.currency} ${item.unitPrice} / ${item.priceUnit}`,
      ),
    );
  if (meaningfulInventoryValue(item.productLink)) {
    const link = inventoryNode('a', 'Product link');
    link.href = item.productLink;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
  for (const stock of stocks) {
    content.append(inventoryNode('strong', inventoryLocation(stock).label));
    const place = inventoryLocation(stock);
    if (stock.archived) content.append(inventoryNode('small', 'Archived'));
    if (!place.mapped)
      content.append(
        inventoryNode(
          'small',
          stock.shelfId ? 'Unmapped location' : 'Unassigned',
        ),
      );
    if (place.hidden)
      content.append(inventoryNode('small', 'Bin hidden by Simple mode'));
    if (stock.tracking !== 'presence')
      content.append(inventoryNode('p', inventoryStockText(stock)));
    else if (stock.unit && stock.unit !== 'each')
      content.append(inventoryNode('p', 'Unit: ' + stock.unit));
    if (meaningfulInventoryValue(stock.notes))
      content.append(inventoryNode('p', stock.notes));
  }
  content.append(
    inventoryButton('All locations', () => showInventoryDetails(itemId)),
  );
  return content;
}
function compactInventoryEntry(itemId, entries, options = {}) {
  const item = inventoryState.items[itemId];
  const row = inventoryNode('article', '', 'stock-row compact-entry');
  row.dataset.inventoryItem = itemId;
  row.dataset.stockId = entries[0]?.[0] || '';
  const stocks = entries.map(([, stock]) => stock);
  const meaningful = hasInventoryDetails(item, stocks);
  let details;
  const name = inventoryButton(item.name, () => {
    if (options.onName) options.onName(itemId, entries, meaningful);
    else if (details) details.open = !details.open;
  });
  name.className = 'inventory-name';
  row.append(name);
  if (isAdmin) {
    const edit = inventoryButton('✎', () =>
      openInventoryEditor(
        options.editStock
          ? { itemId, stockId: entries[0]?.[0] }
          : { itemId, itemOnly: true },
      ),
    );
    edit.className = 'inventory-pencil';
    edit.setAttribute('aria-label', 'Edit ' + item.name);
    row.append(edit);
  }
  if (meaningful) {
    details = inventoryNode('details', '', 'stock-details');
    const summary = inventoryNode('summary', 'Details');
    summary.setAttribute('aria-label', 'Details for ' + item.name);
    details.append(summary, inventoryDetailsContent(itemId, stocks));
    row.append(details);
  }
  return row;
}
function compactInventoryRow(stockId, stock, includeName = true) {
  const row = compactInventoryEntry(stock.itemId, [[stockId, stock]], {
    editStock: true,
  });
  if (!includeName) row.querySelector('.inventory-name').remove();
  return row;
}
function inventoryLocationPanel(
  host,
  shelfId,
  binId = null,
  includeBins = false,
  options = null,
) {
  if (options) host._inventoryOptions = options;
  options = host._inventoryOptions || {};
  const quick = host.querySelector('.inventory-quick');
  const expanded = new Set(
    Array.from(host.querySelectorAll('.stock-row'))
      .filter((row) => row.querySelector('details')?.open)
      .map((row) => row.dataset.inventoryItem),
  );
  const same =
    host.dataset.stockShelf === shelfId &&
    host.dataset.stockBin === (binId || '');
  Object.assign(host.dataset, {
    stockShelf: shelfId,
    stockBin: binId || '',
    stockAll: String(includeBins),
  });
  host.classList.add('stock-panel');
  host.replaceChildren(
    inventoryNode('h3', binId ? 'Selected Inventory' : 'Inventory'),
  );
  if (binId && options.binName) {
    const context = inventoryNode('div', '', 'inventory-bin-context');
    context.append(
      inventoryNode('span', options.binName),
      inventoryButton('Clear bin', options.onClear),
    );
    host.append(context);
  }
  if (!inventoryState) {
    host.append(inventoryNode('p', 'Loading inventory…'));
    return;
  }
  const entries = Object.entries(inventoryState.stocks).filter(
    ([, stock]) =>
      !stock.archived &&
      stock.shelfId === shelfId &&
      (includeBins || (stock.binId || null) === binId),
  );
  const groups = new Map();
  for (const entry of entries) {
    const id = entry[1].itemId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  const grid = inventoryNode('div', '', 'compact-inventory');
  for (const [itemId, stocks] of groups) {
    const row = compactInventoryEntry(itemId, stocks, {
      onName: options.onName,
      editStock: stocks.length === 1,
    });
    const details = row.querySelector('details');
    if (details)
      details.open = expanded.has(itemId) || options.expandItem === itemId;
    grid.append(row);
  }
  host.append(grid);
  if (!entries.length)
    host.append(inventoryNode('p', 'No inventory recorded here.', 'hint'));
  if (isAdmin) {
    const location =
      inventoryState.locations[shelfId + (binId ? '/' + binId : '')];
    if (location?.saved && location?.mapped)
      host.append(same && quick ? quick : quickInventoryEntry(shelfId, binId));
    else
      host.append(
        inventoryNode(
          'p',
          'Save this location in a named layout before recording inventory.',
          'hint',
        ),
      );
  }
}
function showInventoryDetails(itemId) {
  const item = inventoryState?.items[itemId];
  if (!item) return;
  inventoryDetailId = itemId;
  const host = $('#inventoryDetailContent');
  host.replaceChildren(inventoryNode('h2', item.name));
  for (const [key, title] of [
    ['category', 'Category'],
    ['keywords', 'Keywords'],
    ['description', 'Description'],
    ['vendor', 'Vendor'],
    ['notes', 'Item notes'],
  ]) {
    if (item[key])
      host.append(inventoryNode('h3', title), inventoryNode('p', item[key]));
  }
  if (item.productLink) {
    const link = inventoryNode('a', 'Product link');
    link.href = item.productLink;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    host.append(link);
  }
  host.append(
    inventoryNode(
      'p',
      item.unitPrice === null
        ? 'Unit price unknown'
        : `${item.currency} ${item.unitPrice} per ${item.priceUnit}`,
    ),
  );
  if (isAdmin)
    host.append(
      inventoryButton('Edit item details', () =>
        openInventoryEditor({ itemId, itemOnly: true }),
      ),
      inventoryButton('Add this item to another location', () =>
        openInventoryEditor({ itemId }),
      ),
    );
  host.append(inventoryNode('h3', 'All recorded locations'));
  const entries = Object.entries(inventoryState.stocks).filter(
    ([, stock]) => stock.itemId === itemId,
  );
  if (!entries.length)
    host.append(inventoryNode('p', 'No stock recorded yet.'));
  for (const [stockId, stock] of entries) {
    const card = inventoryNode('article', '', 'inventory-card');
    const place = inventoryLocation(stock);
    card.append(
      inventoryNode('h4', place.label + (stock.archived ? ' · Archived' : '')),
      inventoryNode('p', inventoryStockText(stock)),
    );
    if (!place.mapped)
      card.append(
        inventoryNode(
          'p',
          stock.shelfId
            ? 'Unmapped location · stock is preserved and can be relocated.'
            : 'Unassigned · choose a location when known.',
          'hint',
        ),
      );
    else {
      if (place.hidden)
        card.append(
          inventoryNode(
            'p',
            'This bin is retained but hidden by Simple shelf mode.',
            'hint',
          ),
        );
      card.append(
        inventoryButton('Show on map', () => navigateInventoryLocation(stock)),
      );
    }
    if (stock.notes) card.append(inventoryNode('p', stock.notes));
    if (stock.estimatedValue)
      card.append(
        inventoryNode(
          'p',
          `Estimated inventory value: ${stock.estimatedValue.currency} ${stock.estimatedValue.amount}`,
        ),
      );
    if (isAdmin) {
      card.append(
        inventoryButton('Edit stock / relocate', () =>
          openInventoryEditor({ itemId, stockId }),
        ),
      );
      if (
        !stock.archived &&
        stock.tracking === 'exact' &&
        stock.quantity !== null
      )
        card.append(
          inventoryButton('Transfer quantity', () =>
            openStockTransfer(stockId),
          ),
        );
      card.append(
        inventoryButton(
          stock.archived ? 'Reactivate entry' : 'Archive entry',
          async () => {
            if (
              !confirm(
                stock.archived
                  ? 'Reactivate this preserved stock entry?'
                  : 'Archive this entry? Its quantity and history remain recorded and visible in item details.',
              )
            )
              return;
            await inventoryMutation({
              action: stock.archived ? 'reactivate' : 'archive',
              stockId,
            });
          },
        ),
      );
    }
    host.append(card);
  }
  if (!$('#inventoryDetails').open) $('#inventoryDetails').showModal();
}
async function navigateInventoryLocation(stock) {
  const itemId = typeof stock === 'string' ? stock : stock.itemId;
  const mapped = Object.values(inventoryState.stocks).some(
    (entry) =>
      entry.itemId === itemId &&
      !entry.archived &&
      inventoryLocation(entry).mapped,
  );
  if (!mapped) {
    message(
      'This item has no location on the current map. Its inventory remains recorded.',
      true,
    );
    return;
  }
  $('#inventoryDetails').close();
  if (app?.highlightInventoryItem) await app.highlightInventoryItem(itemId);
  else
    await leaveEditor('lab_overview.html?item=' + encodeURIComponent(itemId));
}
function locationOptions(select, stock = {}) {
  select.replaceChildren(new Option('Unassigned', ''));
  Object.entries(inventoryState.locations)
    .filter(([, loc]) => loc.mapped && loc.saved)
    .forEach(([key, loc]) =>
      select.add(
        new Option(loc.label + (loc.hidden ? ' (hidden bin)' : ''), key),
      ),
    );
  const key = stock.shelfId
    ? stock.shelfId + (stock.binId ? '/' + stock.binId : '')
    : '';
  if (key && !Array.from(select.options).some((o) => o.value === key))
    select.add(new Option((stock.locationLabel || key) + ' (unmapped)', key));
  select.value = key;
}
let inventoryPickerTicket = 0;
function inventoryDestinationChanged(key) {
  $('#inv-location').value = key;
  $('#inv-destination').textContent =
    'Destination: ' +
    ($('#inv-location').selectedOptions[0]?.textContent || 'Unassigned');
  $('#inv-location').dispatchEvent(new Event('input', { bubbles: true }));
}
async function renderInventoryPicker() {
  const host = $('#inv-map');
  const ticket = ++inventoryPickerTicket;
  host._disposeShelfGrid?.();
  host.replaceChildren();
  host.hidden = !!inventoryEntry?.itemOnly;
  $('#inv-destination').hidden = !!inventoryEntry?.itemOnly;
  if (host.hidden) return;
  $('#inv-destination').textContent =
    'Destination: ' +
    ($('#inv-location').selectedOptions[0]?.textContent || 'Unassigned');
  try {
    const data = await api('/api/lab');
    if (ticket !== inventoryPickerTicket) return;
    const choose = async (item) => {
      if (item.kind !== 'shelf') {
        inventoryDestinationChanged(item.id);
        mark();
        return;
      }
      try {
        const shelf = await api('/api/shelves/' + encodeURIComponent(item.id));
        if (ticket !== inventoryPickerTicket) return;
        if (shelf.mode === 'simple') {
          inventoryDestinationChanged(item.id);
          mark();
          return;
        }
        host.replaceChildren(
          inventoryNode('h3', shelf.name || item.name),
          inventoryButton('Back to lab map', renderInventoryPicker),
          inventoryButton('Use this shelf', () =>
            inventoryDestinationChanged(item.id),
          ),
        );
        readOnlyShelfGrid(host, shelf, null, (bin) =>
          inventoryDestinationChanged(item.id + '/' + bin.id),
        );
      } catch (error) {
        $('#inv-feedback').textContent = error.message;
      }
    };
    const map = inventoryNode('div', '', 'inventory-location-map');
    map.style.aspectRatio = data.cols + '/' + data.rows;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${data.cols} ${data.rows}`);
    svg.setAttribute('aria-hidden', 'true');
    const draw = (tag, attributes) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attributes).forEach(([key, value]) =>
        node.setAttribute(key, value),
      );
      svg.append(node);
    };
    draw('polygon', {
      points: data.outline.map((p) => p.join(',')).join(' '),
      fill: '#eef2f6',
      stroke: '#546273',
      'stroke-width': 0.3,
    });
    for (const wall of data.walls || [])
      draw('line', {
        x1: wall.a[0],
        y1: wall.a[1],
        x2: wall.b[0],
        y2: wall.b[1],
        stroke: '#344356',
        'stroke-width': wall.thickness,
      });
    for (const route of data.routes || [])
      draw('polyline', {
        points: route.map((p) => p.join(',')).join(' '),
        fill: 'none',
        stroke: '#b1bec8',
        'stroke-width': 0.2,
      });
    map.append(svg);
    for (const item of data.items) {
      const physical = ['shelf', 'table', 'cart', 'machine'].includes(
        item.kind,
      );
      const node = physical
        ? inventoryButton(item.name, () => choose(item))
        : inventoryNode('span', item.name);
      node.className =
        'inventory-map-object ' +
        (physical ? 'destination-object' : 'map-structure');
      node.dataset.locationObject = item.id;
      node.style.cssText = `left:${((item.x - 1) / data.cols) * 100}%;top:${((item.y - 1) / data.rows) * 100}%;width:${(item.w / data.cols) * 100}%;height:${(item.h / data.rows) * 100}%;background:${item.background};color:${item.color}`;
      if (physical)
        node.setAttribute('aria-label', item.name + ' · ' + item.kind);
      map.append(node);
    }
    function mark() {
      const id = $('#inv-location').value.split('/')[0];
      map.querySelectorAll('.destination-object').forEach((node) => {
        node.classList.toggle(
          'inventory-target',
          node.dataset.locationObject === id,
        );
        node.setAttribute(
          'aria-pressed',
          String(node.dataset.locationObject === id),
        );
      });
    }
    mark();
    const viewport = inventoryNode('div', '', 'inventory-map-viewport');
    viewport.append(map);
    let scale = 1;
    const zoom = (factor) => {
      scale = Math.max(1, Math.min(6, scale * factor));
      map.style.width = scale * 100 + '%';
    };
    const controls = inventoryNode('div', '', 'toolbar');
    controls.append(
      inventoryButton('Zoom location map out', () => zoom(1 / 1.5)),
      inventoryButton('Zoom location map in', () => zoom(1.5)),
      inventoryButton('Fit location map', () => {
        scale = 1;
        zoom(1);
        viewport.scrollTo(0, 0);
      }),
    );
    host.append(controls);
    host.append(
      inventoryNode(
        'p',
        'Choose a shelf, table, cart or machine on the map.',
        'hint',
      ),
      viewport,
    );
  } catch (error) {
    host.append(inventoryNode('p', 'Map could not load: ' + error.message));
  }
}
function readInventoryForm() {
  const item = {},
    stock = {};
  itemInputKeys.forEach((key) => {
    item[key] = $('#inv-item-' + key).value;
  });
  stockInputKeys.forEach((key) => {
    stock[key] = $('#inv-stock-' + key).value;
  });
  const [shelfId, binId] = $('#inv-location').value.split('/');
  stock.shelfId = shelfId || null;
  stock.binId = binId || null;
  return {
    ...inventoryEntry,
    item,
    ...(!inventoryEntry.itemOnly ? { stock } : {}),
    reason: $('#inv-reason').value || 'Inventory correction / entry',
  };
}
function fillInventoryForm(entry) {
  itemInputKeys.forEach((key) => {
    $('#inv-item-' + key).value =
      entry.item?.[key] ??
      (key === 'currency' ? 'USD' : key === 'priceUnit' ? 'each' : '');
  });
  stockInputKeys.forEach((key) => {
    $('#inv-stock-' + key).value =
      entry.stock?.[key] ??
      ({ tracking: 'presence', availability: 'available', unit: 'each' }[key] ||
        '');
  });
  locationOptions($('#inv-location'), entry.stock);
  $('#inv-reason').value = entry.reason || '';
  $('#inv-stock-fields').hidden = !!entry.itemOnly;
  $('#inv-location').closest('label').hidden = !!entry.itemOnly;
  updateInventoryTracking();
  renderInventoryPicker();
}
function updateInventoryTracking() {
  $('#inv-quantity-field').hidden = $('#inv-stock-tracking').value !== 'exact';
  $('#inv-availability-field').hidden =
    $('#inv-stock-tracking').value !== 'availability';
}
function inventoryEntryKey() {
  return recoveryContext ? recoveryKey('inventory-entry') : null;
}
function stashInventoryEntry() {
  if (!inventoryEntry || !inventoryEntryDirty || !recoveryContext) return;
  try {
    localStorage.setItem(
      inventoryEntryKey(),
      JSON.stringify({
        format: 1,
        timestamp: Date.now(),
        entry: readInventoryForm(),
      }),
    );
  } catch {
    $('#inv-feedback').textContent =
      'Browser recovery storage is unavailable. Keep this entry open until saved.';
  }
}
function clearInventoryEntry() {
  try {
    if (inventoryEntryKey()) localStorage.removeItem(inventoryEntryKey());
  } catch {}
  inventoryEntryDirty = false;
  inventoryEntry = null;
}
function dialogOptionalReset() {
  $('#inventoryEditor .inventory-optional').open = false;
}
function openInventoryEditor(options = {}, recovered = null) {
  if (!isAdmin || !inventoryState) return;
  const stock = inventoryState.stocks[options.stockId];
  const itemId = stock?.itemId || options.itemId || null;
  inventoryEntry = recovered || {
    action: 'save',
    revision: inventoryState.revision,
    operationId: 'op-' + uniqueId(),
    itemId,
    stockId: options.stockId || null,
    itemOnly: !!options.itemOnly,
  };
  $('#inv-delete').hidden = !inventoryEntry.itemId;
  $('#inv-remove-location').hidden = !inventoryEntry.stockId;
  $('#inv-archive').hidden = !inventoryEntry.stockId;
  $('#inv-manage-locations').hidden = !inventoryEntry.itemId;
  const existing = $('#inv-existing');
  existing.replaceChildren(new Option('Create a new, distinct item', ''));
  Object.entries(inventoryState.items)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, item]) => existing.add(new Option(item.name, id)));
  existing.value = inventoryEntry.itemId || '';
  existing.disabled = !!inventoryEntry.stockId || inventoryEntry.itemOnly;
  const entry = recovered || {
    ...inventoryEntry,
    item: inventoryState.items[itemId],
    stock: stock || {
      shelfId: options.shelfId || null,
      binId: options.binId || null,
    },
  };
  fillInventoryForm(entry);
  inventoryEntryDirty = !!recovered;
  $('#inv-feedback').textContent = recovered
    ? 'Recovered unsaved entry. Review it, then Save inventory.'
    : '';
  $('#inv-conflict').hidden = true;
  if (!$('#inventoryEditor').open) $('#inventoryEditor').showModal();
  dialogOptionalReset();
  $('#inv-item-name').focus();
}
async function inventoryMutation(body) {
  try {
    const result = await api('/api/inventory', 'POST', {
      revision: inventoryState.revision,
      operationId: 'op-' + uniqueId(),
      ...body,
    });
    await refreshInventory();
    try {
      localStorage.setItem('itr-inventory-changed', String(Date.now()));
    } catch {}
    message('Inventory saved · layout history unchanged');
    return result;
  } catch (error) {
    message(error.message, true);
    return null;
  }
}
function openStockTransfer(stockId, recovered = null) {
  inventoryTransferEntry = recovered || {
    operationId: 'op-' + uniqueId(),
    stockId,
    revision: inventoryState.revision,
  };
  inventoryTransferDirty = !!recovered;
  $('#transfer-stock').value = stockId;
  $('#transfer-amount').value = recovered?.amount || '';
  $('#transfer-feedback').textContent = '';
  locationOptions($('#transfer-location'), recovered || {});
  $('#transfer-revision').value = inventoryTransferEntry.revision;
  $('#inventoryTransfer').showModal();
}
async function inventoryAuthChanged(admin) {
  if (!admin) {
    inventoryEntryDirty = false;
    inventoryEntry = null;
    inventoryTransferDirty = false;
    inventoryTransferEntry = null;
    $('#inventoryEditor')?.close();
    $('#inventoryTransfer')?.close();
    $('#inventoryDetails')?.close();
    $('#reportReviewDialog')?.close();
    if ($('#reportReviewButton')) $('#reportReviewButton').hidden = true;
    reportReviewState = null;
  }
  await refreshInventory();
  await refreshReportIndicator();
  if (!admin) {
    reportReviewState = null;
    $('#reportReviewDialog')?.close();
  }
  if (admin && recoveryContext && !inventoryEntry) {
    try {
      const raw = localStorage.getItem(inventoryEntryKey());
      const record = raw && JSON.parse(raw);
      if (
        record?.format === 1 &&
        Number.isFinite(record.timestamp) &&
        Date.now() - record.timestamp < recoveryLifetime &&
        record.timestamp <= Date.now() + 60000 &&
        record.entry?.action === 'save' &&
        Number.isInteger(record.entry.revision)
      )
        openInventoryEditor({}, record.entry);
    } catch {
      message('Could not recover the unsaved inventory entry.', true);
    }
  }
  if (admin && recoveryContext && !inventoryEntry && !inventoryTransferEntry) {
    try {
      const raw = localStorage.getItem(recoveryKey('inventory-transfer'));
      const record = raw && JSON.parse(raw);
      if (
        record?.entry?.action === 'transfer' &&
        Date.now() - record.timestamp < recoveryLifetime &&
        record.timestamp <= Date.now() + 60000
      )
        openStockTransfer(record.entry.stockId, record.entry);
    } catch {
      message('Could not recover the unsaved stock transfer.', true);
    }
  }
}
function readTransferForm() {
  const [shelfId, binId] = $('#transfer-location').value.split('/');
  return {
    ...inventoryTransferEntry,
    action: 'transfer',
    amount: $('#transfer-amount').value,
    shelfId: shelfId || null,
    binId: binId || null,
  };
}
function stashTransfer() {
  if (!inventoryTransferEntry || !recoveryContext) return;
  try {
    localStorage.setItem(
      recoveryKey('inventory-transfer'),
      JSON.stringify({ timestamp: Date.now(), entry: readTransferForm() }),
    );
  } catch {
    $('#transfer-feedback').textContent =
      'Browser recovery storage is unavailable. Keep this transfer open until saved.';
  }
}
function clearTransfer() {
  inventoryTransferDirty = false;
  inventoryTransferEntry = null;
  try {
    localStorage.removeItem(recoveryKey('inventory-transfer'));
  } catch {}
}
function setupInventoryEditor() {
  const dialog = document.createElement('dialog');
  dialog.id = 'inventoryEditor';
  dialog.className = 'inventory-dialog';
  const labels = {
    name: 'Item name *',
    category: 'Category',
    keywords: 'Keywords',
    description: 'Description',
    productLink: 'Product link',
    vendor: 'Vendor',
    unitPrice: 'Unit price (blank = unknown)',
    currency: 'Currency',
    priceUnit: 'Price per unit (each / pack)',
    notes: 'Item notes',
  };
  const fields = itemInputKeys
    .map(
      (key) =>
        `<label class="field">${labels[key]}<${['description', 'notes'].includes(key) ? 'textarea' : 'input'} id="inv-item-${key}" ${key === 'name' ? 'required maxlength="500"' : ''}${['unitPrice'].includes(key) ? ' inputmode="decimal"' : ''}>${['description', 'notes'].includes(key) ? '</textarea>' : ''}</label>`,
    )
    .join('');
  dialog.innerHTML = `<form id="inventoryForm"><h2>Inventory entry</h2><p class="hint">Save inventory writes shared item and stock records immediately. It does not save or restore a map version. Blank quantity or price stays unknown.</p><label class="field">Item identity<select id="inv-existing"></select></label><p class="hint">Choose an existing item to keep the same identity across locations. Editing its details updates every location. Similar names are never merged automatically.</p><div class="inventory-form-grid">${fields}</div><fieldset id="inv-stock-fields"><legend>Stock at this location</legend><label class="field">Location<select id="inv-location"></select></label><label class="field">Tracking<select id="inv-stock-tracking"><option value="presence">Presence only (no counts)</option><option value="exact">Exact quantity (or unknown)</option><option value="availability">Approximate availability</option></select></label><label class="field" id="inv-quantity-field">Quantity (blank = unknown)<input id="inv-stock-quantity" inputmode="decimal"></label><label class="field" id="inv-availability-field">Availability<select id="inv-stock-availability"><option value="available">Available</option><option value="low">Low</option><option value="out-of-stock">Out of stock</option></select></label><label class="field">Unit of measure *<input id="inv-stock-unit" value="each"></label><p class="hint">Use “each” for individual pieces or “pack” for packages. A quantity of 3 packs is not 3 individual pieces. Estimated value is shown only when stock and priced units match.</p><label class="field">Stock notes<textarea id="inv-stock-notes"></textarea></label></fieldset><label class="field">Correction / movement note<input id="inv-reason" maxlength="500"></label><div id="inv-conflict" hidden><h3>Latest saved record</h3><pre id="inv-latest"></pre><button id="inv-reconcile" type="button">I reviewed the latest record; keep my correction</button><button id="inv-use-latest" type="button">Use latest saved values</button></div><p id="inv-feedback" role="alert"></p><div class="actions"><button class="primary" id="inv-save" type="submit">Save inventory</button><button id="inv-cancel" type="button">Cancel</button><button id="inv-manage-locations" type="button" hidden>Manage locations</button><button id="inv-archive" type="button" hidden>Archive this entry</button><button id="inv-remove-location" type="button" hidden>Remove from this location</button><button id="inv-delete" class="danger" type="button" hidden>Delete permanently</button></div></form>`;
  const details = document.createElement('dialog');
  details.id = 'inventoryDetails';
  details.className = 'inventory-dialog';
  details.innerHTML =
    '<div id="inventoryDetailContent"></div><button id="inventoryDetailClose">Close item details</button>';
  const transfer = document.createElement('dialog');
  transfer.id = 'inventoryTransfer';
  transfer.innerHTML =
    '<form id="transferForm"><h2>Transfer quantity</h2><p class="hint">Moves stock in the same unit. The source decreases and destination increases together.</p><input id="transfer-stock" type="hidden"><input id="transfer-revision" type="hidden"><label class="field">Amount<input id="transfer-amount" inputmode="decimal" required></label><label class="field">Destination<select id="transfer-location"></select></label><p id="transfer-feedback" role="alert"></p><div class="actions"><button class="primary" type="submit">Transfer stock</button><button id="transfer-cancel" type="button">Cancel</button></div></form>';
  document.body.append(dialog, details, transfer);
  $('#inv-manage-locations').addEventListener('click', () => {
    dialog.close();
    showInventoryDetails(inventoryEntry.itemId);
  });
  for (const [id, action] of [
    ['inv-delete', 'delete-item'],
    ['inv-remove-location', 'remove-location'],
    ['inv-archive', 'archive'],
  ]) {
    $('#' + id).addEventListener('click', async () => {
      if (!isAdmin || !inventoryEntry) return;
      const entry = inventoryEntry;
      const item = inventoryState.items[entry.itemId];
      if (!item) return;
      const stock = inventoryState.stocks[entry.stockId];
      const locations = [
        ...new Set(
          Object.values(inventoryState.stocks)
            .filter((stock) => stock.itemId === entry.itemId)
            .map((stock) => inventoryLocation(stock).label),
        ),
      ];
      const question =
        action === 'delete-item'
          ? `Delete “${item.name}” permanently and remove ALL its assignments at ${locations.length} location(s) (${locations.join('; ') || 'no locations'})? Audit history is retained.`
          : action === 'remove-location'
            ? `Remove “${item.name}” from ${inventoryLocation(stock).label}? Other locations and the item are kept.`
            : `Archive “${item.name}” at ${inventoryLocation(stock).label}? Its stock and history are kept.`;
      if (!confirm(question)) return;
      const result = await inventoryMutation({
        action,
        itemId: entry.itemId,
        stockId: entry.stockId,
        revision: entry.revision,
      });
      if (result) {
        clearInventoryEntry();
        dialog.close();
      } else
        $('#inv-feedback').textContent =
          'Action could not be saved. Your form is retained; refresh inventory and review the latest record before retrying.';
    });
  }
  const optional = inventoryNode('details', '', 'inventory-optional');
  optional.append(inventoryNode('summary', 'Optional details'));
  const nameField = $('#inv-item-name').closest('label');
  const fieldsGrid = dialog.querySelector('.inventory-form-grid');
  fieldsGrid.before(nameField);
  optional.append(fieldsGrid);
  const identity = $('#inv-existing').closest('label');
  identity.nextElementSibling?.remove();
  optional.append(identity);
  const stockFields = $('#inv-stock-fields');
  const locationField = $('#inv-location').closest('label');
  stockFields.before(locationField);
  optional.append(stockFields, $('#inv-reason').closest('label'));
  const map = inventoryNode('section', '');
  map.id = 'inv-map';
  const destination = inventoryNode('p', '');
  destination.id = 'inv-destination';
  destination.setAttribute('role', 'status');
  locationField.after(map, destination, optional);
  optional.append(locationField);
  $('#inv-location').addEventListener('change', () =>
    inventoryDestinationChanged($('#inv-location').value),
  );
  dialog.querySelector('h2 + p')?.remove();
  $('#inventoryDetailClose').addEventListener('click', () => {
    inventoryDetailId = null;
    details.close();
  });
  const cancel = (event) => {
    event?.preventDefault();
    if (
      inventoryEntryDirty &&
      !confirm('Discard this unsaved inventory entry?')
    )
      return;
    clearInventoryEntry();
    dialog.close();
  };
  $('#inv-cancel').addEventListener('click', cancel);
  dialog.addEventListener('cancel', cancel);
  $('#inventoryForm').addEventListener('input', () => {
    inventoryEntryDirty = true;
    inventoryEntry.operationId = 'op-' + uniqueId();
    updateInventoryTracking();
    stashInventoryEntry();
  });
  $('#inventoryForm').addEventListener('change', stashInventoryEntry);
  $('#inv-existing').addEventListener('change', () => {
    inventoryEntry.itemId = $('#inv-existing').value || null;
    itemInputKeys.forEach((key) => {
      $('#inv-item-' + key).value =
        inventoryState.items[inventoryEntry.itemId]?.[key] ??
        (key === 'currency' ? 'USD' : key === 'priceUnit' ? 'each' : '');
    });
    inventoryEntryDirty = true;
    stashInventoryEntry();
  });
  $('#inventoryForm').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
      event.preventDefault();
  });
  $('#inventoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#inv-save').disabled) return;
    const body = readInventoryForm();
    inventoryEntryDirty = true;
    stashInventoryEntry();
    $('#inv-save').disabled = true;
    $('#inventoryForm').inert = true;
    try {
      await api('/api/inventory', 'POST', body);
      clearInventoryEntry();
      dialog.close();
      await refreshInventory();
      try {
        localStorage.setItem('itr-inventory-changed', String(Date.now()));
      } catch {}
      message('Inventory saved · layout history unchanged');
    } catch (error) {
      $('#inv-feedback').textContent =
        error.message +
        (!error.status || error.status >= 500
          ? ' Entry retained. Retry without changing the form to check whether the save committed.'
          : '');
      if (error.status === 409) {
        await refreshInventory();
        const latestItem = inventoryState.items[body.itemId],
          latestStock = inventoryState.stocks[body.stockId];
        const details = [
          `Saved inventory revision ${inventoryState.revision}`,
          inventoryState.lastChange?.reason || '',
        ];
        if (latestItem)
          itemInputKeys.forEach((key) =>
            details.push(
              `${key === 'name' ? 'Item name' : key}: ${latestItem[key] ?? 'Unknown'}`,
            ),
          );
        else
          details.push(
            'Recorded items: ' +
              Object.values(inventoryState.items)
                .map((item) => item.name)
                .join(', '),
          );
        if (latestStock)
          details.push(
            'Location: ' + inventoryLocation(latestStock).label,
            'Stock: ' + inventoryStockText(latestStock),
            'Stock notes: ' + (latestStock.notes || ''),
          );
        $('#inv-latest').textContent = details.filter(Boolean).join('\n');
        Object.entries(inventoryState.items).forEach(([id, item]) => {
          if (
            !Array.from($('#inv-existing').options).some(
              (option) => option.value === id,
            )
          )
            $('#inv-existing').add(new Option(item.name, id));
        });
        $('#inv-conflict').hidden = false;
      }
    } finally {
      $('#inv-save').disabled = !isAdmin;
      $('#inventoryForm').inert = false;
    }
  });
  $('#inv-reconcile').addEventListener('click', () => {
    inventoryEntry.revision = inventoryState.revision;
    inventoryEntry.operationId = 'op-' + uniqueId();
    $('#inv-conflict').hidden = true;
    $('#inv-feedback').textContent =
      'Correction kept after review. Save inventory to apply it.';
    stashInventoryEntry();
  });
  $('#inv-use-latest').addEventListener('click', () =>
    openInventoryEditor(inventoryEntry),
  );
  const cancelTransfer = (event) => {
    event?.preventDefault();
    if (inventoryTransferDirty && !confirm('Discard this unsaved transfer?'))
      return;
    clearTransfer();
    transfer.close();
  };
  $('#transfer-cancel').addEventListener('click', cancelTransfer);
  transfer.addEventListener('cancel', cancelTransfer);
  $('#transferForm').addEventListener('input', () => {
    inventoryTransferDirty = true;
    inventoryTransferEntry.operationId = 'op-' + uniqueId();
    stashTransfer();
  });
  $('#transferForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    inventoryTransferDirty = true;
    stashTransfer();
    const submit = event.submitter;
    submit.disabled = true;
    $('#transferForm').inert = true;
    const result = await inventoryMutation(readTransferForm());
    submit.disabled = !isAdmin;
    $('#transferForm').inert = false;
    if (result) {
      clearTransfer();
      transfer.close();
    } else
      $('#transfer-feedback').textContent =
        $('#status').textContent +
        ' Retry the same transfer to check a failed save; after a conflict, cancel and reopen using current stock.';
  });
  window.addEventListener('beforeunload', (event) => {
    if (inventoryEntryDirty || inventoryTransferDirty) {
      stashInventoryEntry();
      if (inventoryTransferDirty) stashTransfer();
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'itr-inventory-changed') refreshInventory();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshInventory();
  });
}
setupInventoryEditor();

const sectionNavigation = document.createElement('nav');
sectionNavigation.className = 'section-navigation';
sectionNavigation.setAttribute('aria-label', 'Lab sections');
const currentSectionPage = location.pathname.split('/').pop() || 'lab_overview.html';
for (const [name, target] of [
  ['LAB MAP', 'lab_overview.html'],
  ['LAB INVENTORY', 'lab_inventory.html'],
  ['PROJECT DASHBOARD', 'project_dashboard.html'],
  ['ADMIN DASHBOARD', 'treasury_dashboard.html'],
]) {
  const link = inventoryNode('a', name, 'button');
  link.href = target;
  if (target === currentSectionPage) link.setAttribute('aria-current', 'page');
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    await leaveEditor(target);
  });
  sectionNavigation.append(link);
}
$('header').after(sectionNavigation);
document.querySelectorAll('[data-home]').forEach((link) => {
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    await leaveEditor('/');
  });
});

let shelfReportDraft = null,
  reportReviewState = null;
function shelfReportAction(shelfId, binContext = () => null) {
  const action = inventoryButton('Report incorrect information', () => {
    const binId = binContext();
    shelfReportDraft = { shelfId, binId, operationId: 'report-' + uniqueId() };
    $('#report-submit').hidden = false;
    $('#report-text').value = '';
    $('#report-feedback').textContent = '';
    $('#report-context').checked = !!binId;
    $('#report-context').closest('label').hidden = !binId;
    $('#report-destination').textContent =
      inventoryState?.locations[shelfId]?.label || shelfId;
    $('#shelfReportDialog').showModal();
    $('#report-text').focus();
  });
  action.classList.add('shelf-report-action');
  return action;
}
async function refreshReportIndicator() {
  const button = $('#reportReviewButton');
  button.hidden = !isAdmin;
  if (!isAdmin) return;
  try {
    const state = await api('/api/reports');
    if (!isAdmin) return;
    reportReviewState = state;
    const pending = Object.values(state.reports).filter(
      (report) => report.status === 'pending',
    ).length;
    button.textContent = `Shelf reports · ${pending} pending`;
    button.classList.toggle('primary', pending > 0);
  } catch (error) {
    button.textContent = 'Shelf reports · refresh needed';
  }
}
async function openReportReview() {
  await refreshReportIndicator();
  if (!isAdmin || !reportReviewState) return;
  const host = $('#reportReviewList');
  host.replaceChildren();
  const entries = Object.entries(reportReviewState.reports).sort(
    (a, b) =>
      (a[1].status !== 'pending') - (b[1].status !== 'pending') ||
      b[1].submittedAt.localeCompare(a[1].submittedAt),
  );
  if (!entries.length) host.append(inventoryNode('p', 'No shelf reports.'));
  for (const [rid, report] of entries) {
    const row = inventoryNode('article', '', 'inventory-card');
    row.append(
      inventoryNode('h3', report.currentLocation || report.shelfLabel),
      inventoryNode(
        'small',
        `${report.status} · ${new Date(report.submittedAt).toLocaleString()}`,
      ),
    );
    if (report.binLabel || report.itemLabel)
      row.append(
        inventoryNode(
          'p',
          [report.binLabel, report.itemLabel].filter(Boolean).join(' · '),
        ),
      );
    row.append(inventoryNode('p', report.text));
    if (report.mapped)
      row.append(
        inventoryButton('Open location / editing controls', async () => {
          $('#reportReviewDialog').close();
          if (app?.showInventoryLocation)
            await app.showInventoryLocation(report.shelfId, report.binId);
          else
            await leaveEditor(
              'lab_overview.html?shelf=' +
                encodeURIComponent(report.shelfId) +
                (report.binId
                  ? '&bin=' + encodeURIComponent(report.binId)
                  : ''),
            );
        }),
      );
    else
      row.append(
        inventoryNode(
          'p',
          'Location removed or unmapped · original context preserved.',
          'hint',
        ),
      );
    for (const [label, status] of [
      ['Resolve', 'resolved'],
      ['Dismiss', 'dismissed'],
    ]) {
      if (report.status !== 'pending') continue;
      row.append(
        inventoryButton(label, async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await api('/api/reports/' + rid, 'POST', {
              status,
              revision: reportReviewState.revision,
            });
            await openReportReview();
          } catch (error) {
            message(error.message, true);
            await refreshReportIndicator();
            button.disabled = false;
          }
        }),
      );
    }
    host.append(row);
  }
  if (!$('#reportReviewDialog').open) $('#reportReviewDialog').showModal();
}
function setupShelfReports() {
  const dialog = inventoryNode('dialog', '', 'inventory-dialog');
  dialog.id = 'shelfReportDialog';
  dialog.innerHTML =
    '<form id="shelfReportForm"><h2>Report incorrect information</h2><p id="report-destination"></p><label class="field">What is incorrect?<textarea id="report-text" required maxlength="2000" rows="5"></textarea></label><label class="check"><input type="checkbox" id="report-context">Include selected bin as context</label><p id="report-feedback" role="status"></p><div class="actions"><button type="submit" id="report-submit" class="primary">Submit report</button><button type="button" id="report-close">Close</button></div></form>';
  const review = inventoryNode('dialog', '', 'inventory-dialog');
  review.id = 'reportReviewDialog';
  review.innerHTML =
    '<h2>Shelf reports</h2><div id="reportReviewList"></div><button id="reportReviewRefresh">Refresh reports</button><button id="reportReviewClose">Close review</button>';
  document.body.append(dialog, review);
  const button = inventoryButton('Shelf reports', openReportReview);
  button.id = 'reportReviewButton';
  button.hidden = true;
  button.setAttribute('aria-live', 'polite');
  $('header .actions')?.append(button);
  $('#reportReviewClose').addEventListener('click', () => review.close());
  $('#reportReviewRefresh').addEventListener('click', openReportReview);
  $('#report-close').addEventListener('click', () => dialog.close());
  $('#shelfReportForm').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
      event.preventDefault();
  });
  $('#shelfReportForm').addEventListener('input', () => {
    shelfReportDraft.operationId = 'report-' + uniqueId();
    $('#report-submit').hidden = false;
  });
  $('#shelfReportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#report-submit');
    if (submit.disabled || submit.hidden || !$('#report-text').value.trim())
      return;
    submit.disabled = true;
    $('#shelfReportForm').inert = true;
    try {
      await api('/api/reports', 'POST', {
        ...shelfReportDraft,
        binId: $('#report-context').checked ? shelfReportDraft.binId : null,
        text: $('#report-text').value,
      });
      $('#report-feedback').textContent =
        'Report submitted. An admin will review it.';
      submit.hidden = true;
      await refreshReportIndicator();
    } catch (error) {
      $('#report-feedback').textContent =
        error.message + ' Your text is retained.';
    } finally {
      submit.disabled = false;
      $('#shelfReportForm').inert = false;
    }
  });
  window.addEventListener('focus', refreshReportIndicator);
  setInterval(() => {
    if (isAdmin) refreshReportIndicator();
  }, 30000);
}
setupShelfReports();

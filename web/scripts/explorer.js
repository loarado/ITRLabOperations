'use strict';
let explorerRequest = 0,
  explorerCloseTimer;
function renderShelfInformation(
  host,
  data,
  fallbackName = 'Shelf',
  targetBin = null,
  matchingBins = [],
) {
  host._disposeShelfGrid?.();
  host._disposeShelfGrid = null;
  const shelf = normalizeShelf(data, fallbackName);
  delete host.dataset.reportBin;
  host.replaceChildren(inventoryNode('h2', shelf.name || fallbackName));
  const stockPanel = inventoryNode('section', '', 'selected-bin-panel');
  let selectedBin = null;
  const markBins = (ids, selected = null) => {
    host.querySelectorAll('.readonly-bin').forEach((node) => {
      node.classList.toggle(
        'inventory-match',
        ids.includes(node.dataset.binId),
      );
      node.classList.toggle(
        'inventory-target',
        selected === node.dataset.binId,
      );
      node.setAttribute(
        'aria-pressed',
        String(selected === node.dataset.binId),
      );
    });
  };
  const displayInventory = (expandItem = null) => {
    inventoryLocationPanel(
      stockPanel,
      shelf.id,
      selectedBin?.id || null,
      !selectedBin,
      {
        binName: selectedBin
          ? binDisplayName(selectedBin, shelf.id, shelf)
          : null,
        onClear: () => {
          selectedBin = null;
          delete host.dataset.reportBin;
          markBins(matchingBins);
          displayInventory();
        },
        expandItem,
        onName: (itemId, entries, meaningful) => {
          if (selectedBin) {
            const row = Array.from(
              stockPanel.querySelectorAll('.compact-entry'),
            ).find((node) => node.dataset.inventoryItem === itemId);
            const details = row?.querySelector('details');
            if (details) details.open = !details.open;
            return;
          }
          const destinations = [
            ...new Set(entries.map(([, stock]) => stock.binId || '')),
          ];
          markBins(destinations.filter(Boolean));
          if (destinations.length === 1) {
            if (destinations[0]) {
              const bin = shelfBins(shelf).find(
                ({ bin }) => bin.id === destinations[0],
              )?.bin;
              if (bin) selectBin(bin, meaningful ? itemId : null);
              else
                message(
                  'This bin is unavailable on the current shelf map. Its inventory remains recorded.',
                  true,
                );
            } else {
              const row = Array.from(
                stockPanel.querySelectorAll('.compact-entry'),
              ).find((node) => node.dataset.inventoryItem === itemId);
              const details = row?.querySelector('details');
              if (details) details.open = !details.open;
            }
          } else {
            stockPanel.querySelector('.inventory-choice')?.remove();
            const choices = inventoryNode('div', '', 'inventory-choice');
            choices.append(inventoryNode('span', 'Choose location:'));
            for (const bid of destinations) {
              const bin = shelfBins(shelf).find(
                ({ bin }) => bin.id === bid,
              )?.bin;
              choices.append(
                inventoryButton(
                  bin
                    ? binDisplayName(bin, shelf.id, shelf)
                    : bid
                      ? 'Unavailable bin'
                      : 'Shelf',
                  () => {
                    if (bin) selectBin(bin, meaningful ? itemId : null);
                    else if (bid)
                      message(
                        'This bin is unavailable on the current shelf map. Its inventory remains recorded.',
                        true,
                      );
                    else {
                      choices.remove();
                      displayInventory(meaningful ? itemId : null);
                    }
                  },
                ),
              );
            }
            stockPanel.append(choices);
          }
        },
      },
    );
  };
  const selectBin = (bin, expandItem = null) => {
    if (!bin) return;
    selectedBin = bin;
    host.dataset.reportBin = bin.id;
    markBins(matchingBins, bin.id);
    displayInventory(expandItem);
  };
  if (shelf.mode === 'complex' || shelf.decor.length || targetBin)
    readOnlyShelfGrid(
      host,
      targetBin ? { ...shelf, mode: 'complex' } : shelf,
      targetBin,
      selectBin,
      matchingBins,
    );
  if (shelf.mode === 'complex' || targetBin)
    host.append(inventoryNode('p', 'Select a bin to view contents.', 'hint'));
  host.append(stockPanel);
  displayInventory();
  const bin = shelfBins(shelf).find(({ bin }) => bin.id === targetBin)?.bin;
  if (bin) selectBin(bin);
  else if (targetBin)
    host.append(
      inventoryNode(
        'p',
        'This bin is unavailable on the current shelf map. Its inventory remains recorded.',
        'hint',
      ),
    );
  const notes = [shelf.contents, shelf.keywords]
    .filter((value) => value?.trim())
    .join(' · ');
  if (notes) host.append(infoField('Keywords / Notes', notes));
  host.append(
    shelfReportAction(shelf.id, () => host.dataset.reportBin || null),
  );
}
let mapPreviewTicket = 0;
async function renderMapInventoryPreview(item) {
  const host = $('#mapStockPanel');
  if (host.dataset.previewId === item.id) return;
  const ticket = ++mapPreviewTicket;
  host._disposeShelfGrid?.();
  host.replaceChildren(inventoryNode('p', 'Loading inventory…'));
  host.dataset.previewId = item.id;
  try {
    if (item.kind === 'shelf') {
      if (isAdmin && !inventoryState?.locations[item.id]?.saved) {
        await Promise.resolve();
        if (!(await cacheDraft()))
          throw new Error(
            'Save or recover the lab draft before previewing this shelf.',
          );
      }
      const draft = isAdmin
        ? await api('/api/drafts/shelves/' + encodeURIComponent(item.id))
        : null;
      const data =
        draft?.data ||
        (await api('/api/shelves/' + encodeURIComponent(item.id)));
      if (ticket !== mapPreviewTicket || host.dataset.previewId !== item.id)
        return;
      const matches = app?.inventoryMatches?.(item.id) || [];
      renderShelfInformation(
        host,
        data,
        item.name,
        matches.length === 1 ? matches[0] : null,
        matches,
      );
    } else {
      host.replaceChildren(inventoryNode('h2', item.name));
      const inventory = inventoryNode('section', '');
      inventoryLocationPanel(inventory, item.id);
      host.append(inventory);
    }
    host.append(infoField('Location ID', item.locationId || item.id));
  } catch (error) {
    if (ticket === mapPreviewTicket) {
      delete host.dataset.previewId;
      host.textContent = error.message;
    }
  }
}
function closeExplorer(immediate = false) {
  const panel = $('#explorerPanel');
  if (!panel) return;
  explorerRequest++;
  document.body.classList.remove('map-panel-open');
  const mapViewport = $('#viewport');
  if (mapViewport) {
    mapViewport.style.height = '';
    mapViewport.style.maxHeight = '';
    mapViewport.style.minHeight = '';
  }
  clearTimeout(explorerCloseTimer);
  $('#explorerContent')._disposeShelfGrid?.();
  if (immediate) {
    panel.close();
    panel.classList.remove('closing');
    return;
  }
  panel.classList.add('closing');
  explorerCloseTimer = setTimeout(() => {
    panel.close();
    panel.classList.remove('closing');
  }, 180);
}
function openExplorer() {
  const panel = $('#explorerPanel');
  clearTimeout(explorerCloseTimer);
  panel.classList.remove('closing');
  document.body.classList.add('map-panel-open');
  if (!panel.open) panel.show();
}
async function inspectShelf(item, targetBin = null, allowEditor = false) {
  if (isAdmin && !allowEditor) return;
  const admin = isAdmin;
  const ticket = ++explorerRequest;
  $('#explorerContent').textContent = 'Loading shelf…';
  openExplorer();
  try {
    const cached = admin
      ? await api('/api/drafts/shelves/' + encodeURIComponent(item.id))
      : null;
    const data =
      cached?.data ||
      (await api(`/api/shelves/${encodeURIComponent(item.id)}`));
    if (ticket !== explorerRequest || isAdmin !== admin) return;
    renderShelfInformation(
      $('#explorerContent'),
      data,
      item.name,
      targetBin,
      app?.inventoryMatches?.(item.id) || [],
    );
    $('#explorerContent').append(
      infoField('Location ID', item.locationId || item.id),
    );
    if (admin) {
      const edit = inventoryButton('Open shelf editor', () =>
        leaveEditor(
          'shelf_editor.html?id=' +
            encodeURIComponent(item.id) +
            (targetBin ? '&bin=' + encodeURIComponent(targetBin) : ''),
        ),
      );
      $('#explorerContent').append(edit);
    }
  } catch (error) {
    if (ticket === explorerRequest)
      $('#explorerContent').textContent = error.message;
  }
}
if ($('#explorerPanel')) {
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      $('#explorerPanel').open &&
      !document.querySelector('dialog:modal')
    )
      closeExplorer();
  });
  $('#closeExplorer').addEventListener('click', () => closeExplorer());
  $('#explorerPanel').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeExplorer();
  });
  $('#explorerPanel').addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.target === event.currentTarget &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      closeExplorer();
  });
}
function inspectSection(section) {
  if (isAdmin) return;
  explorerRequest++;
  const host = $('#explorerContent');
  host.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = section.name;
  const contained = lab.data.items.filter(
    (item) =>
      item.kind !== 'section' && sectionFor(item, lab.data)?.id === section.id,
  );
  host.append(
    title,
    infoField('Area', section.name),
    infoField(
      'Access',
      section.restricted ? 'No access — restricted area' : 'Lab section',
    ),
    infoField(
      'In this section',
      contained.length
        ? contained.map((item) => item.name).join('\n')
        : 'No listed items.',
    ),
  );
  openExplorer();
}
function inspectItem(item, allowEditor = false) {
  if (isAdmin && !allowEditor) return;
  explorerRequest++;
  const host = $('#explorerContent');
  host.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = item.name;
  host.append(
    title,
    infoField('Type', item.kind),
    infoField('Area', itemArea(item, lab.data)),
    infoField('Location ID', item.locationId || item.id),
  );
  if (['table', 'cart', 'machine'].includes(item.kind)) {
    const stock = inventoryNode('section', '');
    inventoryLocationPanel(stock, item.id);
    host.append(stock);
  }
  openExplorer();
}
function renderExplorerResults(items, query) {
  const host = $('#explorerResults');
  host.replaceChildren();
  host.hidden = isAdmin || !query;
  if (host.hidden) return;
  if (!items.length) {
    host.textContent = 'No matching shelves or items.';
    return;
  }
  items.forEach((item) => {
    for (const destination of searchDestinations(item, query)) {
      const button = inventoryButton(destination.label, () => {
        if (
          item.kind === 'shelf' ||
          ['table', 'cart', 'machine'].includes(item.kind)
        )
          lab.showInventoryLocation(item.id, destination.binId);
        else choose(item.id);
      });
      host.append(button);
    }
  });
}
function searchDestinations(item, query) {
  const shelf = shelfIndex[item.id];
  if (shelf?.destinations) {
    return shelf.destinations
      .filter((destination) => destination.searchText.includes(query))
      .map((destination) => ({
        binId: destination.binId,
        label: destination.binId
          ? (shelf.name || item.name) + ' · ' + destination.name
          : shelf.name || item.name,
      }));
  }
  const terms = [item.name, item.locationId, item.id, itemArea(item, lab.data)];
  for (const stock of Object.values(inventoryState?.stocks || {})) {
    if (stock.shelfId === item.id && !stock.archived) {
      const record = inventoryState.items[stock.itemId];
      terms.push(
        record.name,
        record.description,
        record.keywords,
        record.vendor,
        record.notes,
        stock.notes,
      );
    }
  }
  return terms.join(' ').toLowerCase().includes(query)
    ? [{ binId: null, label: item.name }]
    : [];
}

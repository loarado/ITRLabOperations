'use strict';
const inventoryController = {
  data: null,
  endpoint: '/api/lab',
  filename: 'lab.json',
  inventoryOnly: true,
  render: renderInventoryList,
};
function renderInventoryList() {
  const host = $('#inventoryList');
  const expanded = new Set(
    Array.from(host.querySelectorAll('.stock-row'))
      .filter((row) => row.querySelector('details')?.open)
      .map((row) => row.dataset.inventoryItem),
  );
  ['inventoryAdd', 'inventoryAudit', 'inventoryBackup'].forEach((id) => {
    $('#' + id).hidden = !isAdmin;
  });
  if (!inventoryState) {
    host.textContent = 'Loading recorded inventory…';
    return;
  }
  const query = $('#inventorySearch').value.trim().toLowerCase(),
    filter = $('#inventoryFilter').value;
  const entries = Object.entries(inventoryState.items)
    .filter(([id, item]) => {
      const stocks = Object.values(inventoryState.stocks).filter(
        (stock) => stock.itemId === id,
      );
      const terms = [
        item.name,
        item.category,
        item.keywords,
        item.description,
        item.vendor,
        item.notes,
        item.productLink,
        ...stocks.map(
          (stock) => stock.notes + ' ' + inventoryLocation(stock).label,
        ),
      ]
        .join(' ')
        .toLowerCase();
      const matchesFilter =
        filter === 'all' ||
        stocks.some((stock) =>
          filter === 'archived'
            ? stock.archived
            : !stock.archived &&
              (filter === 'mapped'
                ? inventoryLocation(stock).mapped
                : !inventoryLocation(stock).mapped),
        );
      return terms.includes(query) && matchesFilter;
    })
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  host.replaceChildren();
  $('#inventoryCount').textContent =
    `${entries.length} items · inventory revision ${inventoryState.revision}`;
  if (!entries.length) {
    host.append(
      inventoryNode(
        'p',
        Object.keys(inventoryState.items).length
          ? 'No matching inventory. Try another search or location filter.'
          : 'No inventory recorded yet. Sign in and add an item here or from a location on LAB MAP.',
        'inventory-empty',
      ),
    );
  }
  for (const [itemId] of entries) {
    const stocks = Object.entries(inventoryState.stocks).filter(
      ([, stock]) => stock.itemId === itemId,
    );
    const card = compactInventoryEntry(itemId, stocks, {
      onName: () => navigateInventoryLocation(itemId),
    });
    const details = card.querySelector('details');
    if (details) details.open = expanded.has(itemId);
    host.append(card);
  }
}
$('#inventorySearch').addEventListener('input', renderInventoryList);
$('#inventoryFilter').addEventListener('change', renderInventoryList);
$('#inventoryAdd').addEventListener('click', () => openInventoryEditor());
$('#inventoryRefresh').addEventListener('click', refreshInventory);
$('#inventoryBackup').addEventListener('click', async () => {
  try {
    download(await api('/api/backup'), 'itr-full-lab-backup.json');
    message(
      'Full saved lab backup downloaded · includes layout, shelves, inventory, audit/history and defaults; excludes private drafts',
    );
  } catch (error) {
    message(error.message, true);
  }
});
$('#inventoryAudit').addEventListener('click', async () => {
  try {
    const entries = await api('/api/inventory/history');
    const migration = await api('/api/inventory/migration');
    const host = $('#inventoryAuditList');
    host.replaceChildren();
    host.append(
      inventoryNode(
        'p',
        `Bin migration: ${migration.converted} converted · ${migration.skippedDuplicates} duplicates skipped · ${migration.needsReview} needing review`,
      ),
      inventoryButton('Download migration sources / review cases', () =>
        download(migration, 'bin-contents-migration.json'),
      ),
    );
    if (!entries.length)
      host.append(inventoryNode('p', 'No inventory changes yet.'));
    for (const entry of entries) {
      const row = inventoryNode('article', '', 'inventory-card');
      row.append(
        inventoryNode(
          'p',
          `Revision ${entry.revision} · ${entry.reason || 'Initial inventory'} · ${entry.savedAt ? new Date(entry.savedAt).toLocaleString() : ''}`,
        ),
      );
      row.append(
        inventoryButton('Download audit snapshot', async () => {
          try {
            download(
              await api('/api/inventory/history/' + entry.revision),
              `inventory-audit-${entry.revision}.json`,
            );
            message(
              'Audit reference downloaded. Full lab backup is required for complete recovery.',
            );
          } catch (error) {
            message(error.message, true);
          }
        }),
      );
      host.append(row);
    }
    $('#inventoryAuditDialog').showModal();
  } catch (error) {
    message(error.message, true);
  }
});
$('#inventoryAuditClose').addEventListener('click', () =>
  $('#inventoryAuditDialog').close(),
);
document.addEventListener('inventory-updated', renderInventoryList);
startApp(inventoryController);

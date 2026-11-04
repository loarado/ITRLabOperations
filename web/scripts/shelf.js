'use strict';
const shelfId = new URLSearchParams(location.search).get('id');
const shelfTargetBin = new URLSearchParams(location.search).get('bin');
const shelf = {
  data: null,
  endpoint: `/api/shelves/${encodeURIComponent(shelfId || '')}`,
  filename: `${shelfId || 'shelf'}.json`,
  render,
};
const grid = $('#shelfGrid');
let selection = null,
  cellSize = 22;
function binAt() {
  return shelf.data?.mode === 'simple' || !selection
    ? null
    : bins().find((p) => p.r === selection.r && p.c === selection.c)?.bin;
}
function bins() {
  return shelfBins(shelf.data);
}
function owner(r, c) {
  return bins().find(
    (p) => r >= p.r && r < p.r + p.bin.h && c >= p.c && c < p.c + p.bin.w,
  );
}
function fits(bin, r, c, ignore = selection) {
  return shelfBinFits(shelf.data, bin, r, c, ignore);
}
function choose(r, c) {
  selectedDecor = null;
  selection = { r, c };
  render();
}
function renderGrid() {
  grid.replaceChildren();
  configureShelfGrid(grid, shelf.data, cellSize);
  grid.classList.toggle('decor-only', shelf.data.mode === 'simple');
  renderShelfDecor(grid, shelf.data, bindShelfDecor);
  if (shelf.data.mode === 'simple') {
    requestAnimationFrame(() => fitLabels(grid));
    return;
  }
  const occupied = new Set();
  bins().forEach(({ bin, r, c }) => {
    for (let rr = r; rr < r + bin.h; rr += 0.5)
      for (let cc = c; cc < c + bin.w; cc += 0.5) occupied.add(`${rr},${cc}`);
  });
  for (let r = 0; r < shelf.data.rows; r += 0.5)
    for (let c = 0; c < shelf.data.cols; c += 0.5) {
      if (occupied.has(`${r},${c}`)) continue;
      const cell = document.createElement('button');
      cell.className =
        'shelf-cell' +
        (selection?.r === r && selection?.c === c ? ' selected' : '');
      cell.setAttribute(
        'aria-label',
        `Empty cell, row ${r + 1}, column ${c + 1}`,
      );
      cell.style.gridArea = `${r * 2 + 1} / ${c * 2 + 1}`;
      cell.addEventListener('click', () => choose(r, c));
      grid.append(cell);
    }
  const query = $('#search').value.trim().toLowerCase();
  bins().forEach(({ bin, r, c }) => {
    const el = document.createElement('button');
    el.className =
      'grid-item shelf-bin' +
      (isAdmin ? ' editable' : '') +
      (selection?.r === r && selection?.c === c ? ' selected' : '');
    if (
      query &&
      !`${bin.name} ${Object.values(inventoryState?.stocks || {})
        .filter(
          (stock) =>
            stock.shelfId === shelfId &&
            stock.binId === bin.id &&
            !stock.archived,
        )
        .map((stock) => inventoryState.items[stock.itemId].name)
        .join(' ')}`
        .toLowerCase()
        .includes(query)
    )
      el.classList.add('match-dim');
    positionShelfBin(el, bin, r, c);
    el.style.backgroundColor = bin.background;
    el.style.setProperty('--bg', bin.background);
    el.title = binDisplayName(bin, shelfId, shelf.data);
    el.setAttribute(
      'aria-label',
      `${binDisplayName(bin, shelfId, shelf.data)}, row ${r + 1}, column ${c + 1}`,
    );
    el.append(
      labelFor({ ...bin, name: binDisplayName(bin, shelfId, shelf.data) }),
    );
    el.dataset.binId = bin.id;
    el.addEventListener('click', () => {
      if (!el._completedDrag) choose(r, c);
    });
    el.addEventListener('pointerdown', (event) => {
      if (!isAdmin || event.button !== 0) return;
      el._completedDrag = false;
      const startX = event.clientX,
        startY = event.clientY;
      let target = { r, c },
        moved = false;
      el.setPointerCapture(event.pointerId);
      const move = (e) => {
        target = {
          r: r + snapHalf((e.clientY - startY) / (cellSize + 1)),
          c: c + snapHalf((e.clientX - startX) / (cellSize + 1)),
        };
        moved = target.r !== r || target.c !== c;
        if (moved && fits(bin, target.r, target.c, { r, c })) {
          positionShelfBin(el, bin, target.r, target.c);
          el.classList.add('dragging');
        }
      };
      const cleanup = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', cancel);
      };
      const end = () => {
        cleanup();
        el._completedDrag = moved;
        if (!moved) return;
        selectedDecor = null;
        selection = { r, c };
        if (moved && fits(bin, target.r, target.c, { r, c })) {
          checkpoint();
          setShelfBin(shelf.data, r, c, null);
          setShelfBin(shelf.data, target.r, target.c, bin);
          selection = target;
          changed();
        } else if (moved)
          message('Bins cannot overlap or extend outside this shelf.', true);
        render();
      };
      const cancel = () => {
        cleanup();
        render();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', cancel);
    });
    grid.append(el);
  });
  requestAnimationFrame(() => fitLabels(grid));
}
const fields = [
  'name',
  'x',
  'y',
  'w',
  'h',
  'background',
  'color',
  'fontSize',
  'fontFamily',
  'bold',
];
function renderDetails() {
  const bin = binAt();
  $('#empty').hidden = !!selection;
  $('#details').hidden = !selection;
  if (!selection) return;
  $('#selectionId').textContent =
    `Row ${selection.r + 1} · Column ${selection.c + 1}`;
  $('#selectionTitle').textContent = bin
    ? binDisplayName(bin, shelfId, shelf.data)
    : 'Empty cell';
  $('#emptyCell').hidden = !!bin;
  $('#binFields').hidden = !bin;
  if (bin)
    fields.forEach((key) => {
      const el = $('#' + key);
      if (el.type === 'checkbox') el.checked = bin[key];
      else
        el.value =
          key === 'x'
            ? selection.c + 1
            : key === 'y'
              ? selection.r + 1
              : bin[key];
      el.disabled = !isAdmin;
    });
}
function render() {
  if (!shelf.data) return;
  shelf.data = normalizeShelf(shelf.data);
  $('h1').textContent = isAdmin ? 'Shelf Editor' : 'Lab Explorer';
  $('#shelfReadOnly').hidden =
    isAdmin && !(shelfTargetBin && shelf.data.mode === 'simple');
  $('#shelfStockPanel').hidden = !isAdmin;
  let report = $('#shelfEditorReport');
  if (!report) {
    report = shelfReportAction(shelfId, () => binAt()?.id || null);
    report.id = 'shelfEditorReport';
    $('#shelfStockPanel').after(report);
  }
  report.hidden = !isAdmin;
  if (!isAdmin) {
    renderShelfInformation(
      $('#shelfReadOnly'),
      shelf.data,
      shelfId,
      shelfTargetBin,
    );
    $('.shelf-viewport').hidden = true;
    ['search', 'zoomIn', 'zoomOut', 'gridHint'].forEach(
      (id) => ($('#' + id).hidden = true),
    );
    $('#count').textContent =
      shelf.data.mode === 'simple' ? 'Simple shelf' : `${bins().length} bins`;
    return;
  }
  if (shelfTargetBin && shelf.data.mode === 'simple')
    renderShelfInformation(
      $('#shelfReadOnly'),
      shelf.data,
      shelfId,
      shelfTargetBin,
    );
  const simple = shelf.data.mode === 'simple';
  document.body.classList.toggle('simple-shelf', simple);
  $('#shelfMode').value = shelf.data.mode;
  $('#shelfModeLabel').textContent = simple ? 'Simple shelf' : 'Complex shelf';
  ['shelfName', 'shelfContents', 'shelfKeywords'].forEach(
    (id, index) =>
      ($('#' + id).value = shelf.data[['name', 'contents', 'keywords'][index]]),
  );
  ['search', 'gridHint'].forEach((id) => ($('#' + id).hidden = simple));
  ['zoomIn', 'zoomOut'].forEach((id) => ($('#' + id).hidden = false));
  $('.shelf-viewport').hidden = false;
  renderDecorControls();
  if (
    selection &&
    (selection.r >= shelf.data.rows || selection.c >= shelf.data.cols)
  )
    selection = null;
  renderGrid();
  renderDetails();
  inventoryLocationPanel(
    $('#shelfStockPanel'),
    shelfId,
    binAt()?.id || null,
    false,
  );
  $('#rows').value = shelf.data.rows;
  $('#cols').value = shelf.data.cols;
  $('#count').textContent =
    `${bins().length} bins · ${shelf.data.rows} rows × ${shelf.data.cols} columns`;
}
$('#addBin').addEventListener('click', () => {
  if (!isAdmin || shelf.data.mode !== 'complex' || !selection || binAt())
    return;
  const bin = {
    ...defaults(),
    id: 'B-' + uniqueId(),
    name: 'New bin',
    w: 2,
    h: 2,
  };
  if (!fits(bin, selection.r, selection.c)) bin.w = bin.h = 1;
  if (!fits(bin, selection.r, selection.c)) {
    message('No room for a bin here.', true);
    return;
  }
  checkpoint();
  setShelfBin(shelf.data, selection.r, selection.c, bin);
  render();
  changed();
});
fields.forEach((key) =>
  $('#' + key).addEventListener('change', () => {
    const bin = binAt();
    if (!isAdmin || !bin) return;
    const el = $('#' + key),
      value =
        el.type === 'checkbox'
          ? el.checked
          : el.type === 'number'
            ? Number(el.value)
            : el.value;
    const candidate = { ...bin },
      target = { ...selection };
    if (key === 'x') target.c = value - 1;
    else if (key === 'y') target.r = value - 1;
    else candidate[key] = value;
    if (!fits(candidate, target.r, target.c)) {
      message('Bins cannot overlap or extend outside this shelf.', true);
      renderDetails();
      return;
    }
    if (
      key === 'fontSize' &&
      (!Number.isInteger(value) || value < 6 || value > 96)
    ) {
      message('Font size must be 6–96 pixels.', true);
      renderDetails();
      return;
    }
    checkpoint();
    setShelfBin(shelf.data, selection.r, selection.c, null);
    setShelfBin(shelf.data, target.r, target.c, candidate);
    selection = target;
    render();
    changed();
  }),
);
$('#delete').addEventListener('click', async () => {
  const bin = binAt();
  if (!isAdmin || !bin) return;
  if (!(await confirmInventoryRemoval(shelfId, bin.id))) return;
  if (!isAdmin || binAt()?.id !== bin.id) return;
  checkpoint();
  setShelfBin(shelf.data, selection.r, selection.c, null);
  render();
  changed();
});
$('#resize').addEventListener('click', () => {
  if (!isAdmin) return;
  const rows = Number($('#rows').value),
    cols = Number($('#cols').value);
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows < 1 ||
    rows > 60 ||
    cols < 1 ||
    cols > 60
  ) {
    message('Rows and columns must be integers from 1 to 60.', true);
    return;
  }
  if (
    bins().some((p) => p.r + p.bin.h > rows || p.c + p.bin.w > cols) ||
    shelf.data.decor.some(
      (shape) => shape.x + shape.w > cols || shape.y + shape.h > rows,
    )
  ) {
    message(
      'Move or delete bins and decor outside the requested size first. Nothing was removed.',
      true,
    );
    return;
  }
  checkpoint();
  shelf.data.matrix = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => shelf.data.matrix[r]?.[c] ?? null),
  );
  shelf.data.rows = rows;
  shelf.data.cols = cols;
  render();
  changed();
});
function validateImport(data) {
  if (
    !data ||
    !Number.isInteger(data.rows) ||
    !Number.isInteger(data.cols) ||
    data.rows < 1 ||
    data.rows > 60 ||
    data.cols < 1 ||
    data.cols > 60 ||
    !Array.isArray(data.matrix) ||
    data.matrix.length !== data.rows
  )
    throw new Error('Expected rows, cols, and a matrix (1–60 rows/columns).');
  if (data.mode !== undefined && !['simple', 'complex'].includes(data.mode))
    throw new Error('Shelf mode must be simple or complex.');
  for (const [key, limit] of [
    ['name', 500],
    ['contents', 10000],
    ['keywords', 2000],
  ])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== 'string' || data[key].length > limit)
    )
      throw new Error('Invalid shelf metadata.');
  if (
    !Array.isArray(data.decor ?? []) ||
    (data.decor ?? []).length > 200 ||
    new Set((data.decor ?? []).map((d) => d?.id)).size !==
      (data.decor ?? []).length ||
    (data.decor ?? []).some((d) => !validShelfDecor(d, data))
  )
    throw new Error('Invalid Shelf Decor.');
  const used = [],
    binIds = new Set();
  data.matrix.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== data.cols)
      throw new Error('Every matrix row must contain cols cells.');
    row.forEach((bin, c) => {
      if (bin === null) return;
      if (bin.id !== undefined) {
        if (
          typeof bin.id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(bin.id) ||
          binIds.has(bin.id)
        )
          throw new Error('Bin IDs must be unique.');
        binIds.add(bin.id);
      }
      if (
        typeof bin !== 'object' ||
        typeof bin.name !== 'string' ||
        !['contents', 'keywords'].every(
          (k) => bin[k] === undefined || typeof bin[k] === 'string',
        ) ||
        bin.name.length > 500 ||
        (bin.contents || '').length > 10000 ||
        (bin.keywords || '').length > 2000 ||
        !halfStep(bin.w) ||
        !halfStep(bin.h) ||
        bin.w < 1 ||
        bin.h < 1 ||
        r + (bin.offsetY || 0) + bin.h > data.rows ||
        c + (bin.offsetX || 0) + bin.w > data.cols ||
        !Number.isInteger(bin.fontSize) ||
        bin.fontSize < 6 ||
        bin.fontSize > 96 ||
        !/^#[0-9a-f]{6}$/i.test(bin.background) ||
        !/^#[0-9a-f]{6}$/i.test(bin.color) ||
        !['system-ui', 'Arial', 'Georgia', 'monospace'].includes(
          bin.fontFamily,
        ) ||
        typeof bin.bold !== 'boolean'
      )
        throw new Error('Invalid bin data, dimensions, or style.');
      if (
        ![undefined, 0, 0.5].includes(bin.offsetX) ||
        ![undefined, 0, 0.5].includes(bin.offsetY)
      )
        throw new Error('Bin offsets must be 0 or 0.5.');
      const rect = {
        x: c + (bin.offsetX || 0),
        y: r + (bin.offsetY || 0),
        w: bin.w,
        h: bin.h,
      };
      if (used.some((other) => overlaps(rect, other)))
        throw new Error('Imported bins overlap.');
      used.push(rect);
    });
  });
}
$('#import').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!isAdmin || !file) return;
  try {
    if (file.size > 4_000_000)
      throw new Error('File is too large (maximum 4 MB).');
    const data = JSON.parse(await file.text());
    validateImport(data);
    if (!(await confirmInventoryRemoval(shelfId))) return;
    shelfBins(data).forEach(({ bin }) => {
      bin.id = 'B-' + uniqueId();
    });
    delete data.items;
    delete data.stocks;
    delete data.inventory;
    checkpoint();
    shelf.data = normalizeShelf({
      ...shelf.data,
      ...data,
      mode: data.mode ?? normalizeShelf(data).mode,
      id: shelfId,
      revision: shelf.data.revision,
    });
    selection = null;
    render();
    changed();
  } catch (error) {
    message(error.message, true);
  }
  event.target.value = '';
});
$('#back').addEventListener('click', async (event) => {
  event.preventDefault();
  await leaveEditor('lab_overview.html');
});
$('#search').addEventListener('input', () => shelf.data && renderGrid());
function zoom(value) {
  cellSize = Math.min(50, Math.max(14, value));
  if (shelf.data) renderGrid();
  $('#zoomOut').disabled = cellSize === 14;
  $('#zoomIn').disabled = cellSize === 50;
}
$('#zoomIn').addEventListener('click', () => zoom(cellSize + 4));
$('#zoomOut').addEventListener('click', () => zoom(cellSize - 4));
document.addEventListener('keydown', (event) => {
  if (
    !isAdmin ||
    document.querySelector('dialog[open]') ||
    document.activeElement.isContentEditable ||
    event.ctrlKey ||
    event.metaKey ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
  )
    return;
  const bin = binAt(),
    delta = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    }[event.key];
  if (!bin || !delta) return;
  event.preventDefault();
  const r = selection.r + delta[0] * 0.5,
    c = selection.c + delta[1] * 0.5;
  if (fits(bin, r, c)) {
    checkpoint();
    setShelfBin(shelf.data, selection.r, selection.c, null);
    setShelfBin(shelf.data, r, c, bin);
    selection = { r, c };
    render();
    changed();
  } else
    message('That matrix position is occupied or outside the shelf.', true);
});
setupShelfDecor();
[
  ['shelfMetadata', 'Shelf information'],
  ['details', 'Bin properties'],
  ['matrixPanel', 'Matrix dimensions'],
  ['filePanel', 'Inventory file'],
].forEach(([id, title]) => mountEditorGroup(id, title));
if (!shelfId || !/^[A-Za-z0-9_-]{1,64}$/.test(shelfId)) {
  $('#fatal').hidden = false;
  $('#fatal').textContent = 'Choose a shelf from the lab editor first.';
  message('No valid shelf selected.', true);
  document
    .querySelectorAll('[data-admin]')
    .forEach((el) => (el.disabled = true));
} else {
  $('#subtitle').textContent = `${shelfId} · Independent shelf matrix`;
  $('#file').textContent = `data/shelves/${shelfId}.json`;
  startApp(shelf).then(() => {
    const binId = new URLSearchParams(location.search).get('bin');
    if (!binId) return;
    const target = bins().find(({ bin }) => bin.id === binId);
    if (!target) {
      message(
        'This bin is unavailable; its stock is retained in LAB INVENTORY.',
        true,
      );
      return;
    }
    if (isAdmin && shelf.data.mode === 'complex') {
      choose(target.r, target.c);
      grid
        .querySelector('.shelf-bin.selected')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else
      renderShelfInformation($('#shelfReadOnly'), shelf.data, shelfId, binId);
  });
  api('/api/lab')
    .then((data) => {
      const item = data.items.find((i) => i.id === shelfId);
      if (item)
        $('#subtitle').textContent =
          `${item.name} · ${item.locationId || shelfId} · ${itemArea(item, data)}`;
    })
    .catch(() => {});
}

[
  ['shelfName', 'name'],
  ['shelfContents', 'contents'],
  ['shelfKeywords', 'keywords'],
].forEach(([id, key]) =>
  $('#' + id).addEventListener('change', () => {
    if (!isAdmin || !shelf.data) return;
    checkpoint();
    shelf.data[key] = $('#' + id).value;
    render();
    changed();
  }),
);

$('#applyShelfMode').addEventListener('click', () => {
  if (!isAdmin || !shelf.data) return;
  const mode = $('#shelfMode').value;
  if (!['simple', 'complex'].includes(mode) || mode === shelf.data.mode) return;
  checkpoint();
  shelf.data.mode = mode;
  selection = null;
  render();
  changed();
});

let binClipboard = null;
let decorClipboard = null;
shelf.clipboardContext = () =>
  !!currentDecor() ||
  (shelf.data?.mode === 'complex' && !!binAt()) ||
  !!decorClipboard;
shelf.copySelection = () => {
  if (currentDecor()) {
    decorClipboard = clone(currentDecor());
    binClipboard = null;
    message('Shelf Decor copied · Ctrl/Cmd+V to paste');
    return;
  }
  decorClipboard = null;
  binClipboard = { bin: clone(binAt()), ...selection };
  message('Bin copied · Ctrl/Cmd+V to paste');
};
shelf.pasteSelection = () => {
  if (isAdmin && decorClipboard) {
    pasteShelfDecor(decorClipboard);
    return;
  }
  if (!isAdmin || shelf.data.mode !== 'complex' || !binClipboard) return;
  const { bin, r, c } = binClipboard,
    target = nearbyPositions(
      c,
      r,
      bin.w,
      bin.h,
      shelf.data.cols,
      shelf.data.rows,
      0.5,
    ).find((p) => fits(bin, p.y, p.x, null));
  if (!target) {
    message('No clear space for the copied bin.', true);
    return;
  }
  checkpoint();
  setShelfBin(shelf.data, target.y, target.x, {
    ...clone(bin),
    id: 'B-' + uniqueId(),
  });
  selection = { r: target.y, c: target.x };
  render();
  changed();
  message(
    'Bin structure pasted · descriptive notes copied; inventory excluded',
  );
};

shelf.clearClipboard = () => {
  binClipboard = null;
  decorClipboard = null;
  selection = null;
  selectedDecor = null;
};

shelf.getRecoveryUI = () => ({ cellSize });
shelf.restoreRecoveryUI = (ui) => {
  if (Number.isFinite(ui.cellSize)) zoom(ui.cellSize);
};

document.addEventListener('inventory-updated', () => {
  if (!shelf.data || !isAdmin) return;
  grid.querySelectorAll('.shelf-bin').forEach((node) => {
    const position = bins().find(({ bin }) => bin.id === node.dataset.binId);
    if (!position) return;
    const label = binDisplayName(position.bin, shelfId, shelf.data);
    node.querySelector('.fit-label').textContent = label;
    node.setAttribute(
      'aria-label',
      `${label}, row ${position.r + 1}, column ${position.c + 1}`,
    );
  });
  fitLabels(grid);
});

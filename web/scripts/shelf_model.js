'use strict';
function normalizeShelf(data, fallbackName = '') {
  const hasBins = data.matrix?.some((row) => row.some((cell) => cell !== null));
  return {
    ...data,
    schemaVersion: data.schemaVersion ?? 2,
    mode: data.mode ?? (hasBins ? 'complex' : 'simple'),
    name: data.name ?? fallbackName,
    contents: data.contents ?? '',
    keywords: data.keywords ?? '',
    decor: data.decor ?? [],
  };
}

// Decor uses shelf-cell coordinates, independent of the inventory matrix.
function validShelfDecor(shape, data) {
  return (
    !!shape &&
    typeof shape.id === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(shape.id) &&
    ['rectangle', 'ellipse', 'triangle'].includes(shape.shape) &&
    typeof shape.text === 'string' &&
    shape.text.length <= 500 &&
    ['x', 'y', 'w', 'h'].every(
      (k) => Number.isFinite(shape[k]) && Number.isInteger(shape[k] * 4),
    ) &&
    shape.x >= 0 &&
    shape.y >= 0 &&
    shape.w >= 0.25 &&
    shape.h >= 0.25 &&
    shape.x + shape.w <= data.cols &&
    shape.y + shape.h <= data.rows &&
    Number.isInteger(shape.outlineWidth) &&
    shape.outlineWidth >= 0 &&
    shape.outlineWidth <= 20 &&
    ['outlineColor', 'fillColor', 'textColor'].every((k) =>
      /^#[0-9a-f]{6}$/i.test(shape[k]),
    )
  );
}
function positionShelfDecor(el, shape, data) {
  Object.assign(el.style, {
    left: (shape.x / data.cols) * 100 + '%',
    top: (shape.y / data.rows) * 100 + '%',
    width: (shape.w / data.cols) * 100 + '%',
    height: (shape.h / data.rows) * 100 + '%',
  });
}
function renderShelfDecor(grid, data, editing = null) {
  const layer = document.createElement('div');
  layer.className = 'shelf-decor-layer';
  grid.append(layer);
  for (const shape of data.decor || []) {
    const el = document.createElement('div');
    el.className = 'shelf-decor';
    el.dataset.decorId = shape.id;
    positionShelfDecor(el, shape, data);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const art = document.createElementNS(
      svg.namespaceURI,
      { rectangle: 'rect', ellipse: 'ellipse', triangle: 'polygon' }[
        shape.shape
      ],
    );
    const attrs =
      shape.shape === 'rectangle'
        ? { x: 0, y: 0, width: 100, height: 100 }
        : shape.shape === 'ellipse'
          ? { cx: 50, cy: 50, rx: 50, ry: 50 }
          : { points: '50,0 100,100 0,100' };
    Object.entries({
      ...attrs,
      fill: shape.fillColor,
      stroke: shape.outlineColor,
      'stroke-width': shape.outlineWidth * 2,
      'vector-effect': 'non-scaling-stroke',
      'stroke-linejoin': 'round',
    }).forEach(([k, v]) => art.setAttribute(k, v));
    svg.append(art);
    el.append(svg);
    if (shape.text)
      el.append(
        labelFor({
          name: shape.text,
          fontSize: 14,
          fontFamily: 'system-ui',
          bold: false,
          color: shape.textColor,
        }),
      );
    if (editing) editing(el, shape, layer);
    layer.append(el);
  }
}

function binDisplayName(bin, shelfId, shelfData = {}) {
  const name = bin.name || '';
  if (name.trim().toLowerCase() !== 'new bin') return name || 'Unnamed bin';
  const meaningful =
    [bin.contents, bin.keywords, bin.notes, bin.description].some((text) =>
      text?.trim(),
    ) ||
    bin.hasLegacyDescription ||
    (shelfData.legacyBinText?.[bin.id] || []).some(
      (source) =>
        source.keywords?.trim() ||
        (!source.converted && source.contents?.trim()),
    );
  const populated = Object.values(inventoryState?.stocks || {}).some(
    (stock) =>
      !stock.archived && stock.shelfId === shelfId && stock.binId === bin.id,
  );
  return meaningful || populated ? name : 'empty';
}
function shelfBins(data) {
  const result = [];
  data.matrix.forEach((row, r) =>
    row.forEach((bin, c) => {
      if (bin)
        result.push({
          bin,
          r: r + (bin.offsetY || 0),
          c: c + (bin.offsetX || 0),
        });
    }),
  );
  return result;
}
function configureShelfGrid(grid, data, size = 22) {
  grid.style.setProperty('--cols', data.cols * 2);
  grid.style.setProperty('--rows', data.rows * 2);
  grid.style.setProperty('--cell', size + 'px');
}
function positionShelfBin(el, bin, r, c) {
  gridPosition(el, { x: c * 2 + 1, y: r * 2 + 1, w: bin.w * 2, h: bin.h * 2 });
}
function readOnlyShelfGrid(
  host,
  data,
  targetBin = null,
  onSelect = null,
  matchingBins = [],
) {
  const viewport = document.createElement('div');
  viewport.className = 'viewport readonly-shelf-viewport';
  const grid = document.createElement('div');
  grid.className = 'shelf-grid readonly-grid';
  grid.dataset.shelfId = data.id || '';
  grid.setAttribute('aria-label', 'Read-only shelf inventory matrix');
  configureShelfGrid(grid, data);
  grid.classList.toggle('decor-only', data.mode === 'simple');
  renderShelfDecor(grid, data);
  const tooltip = document.createElement('div');
  tooltip.className = 'bin-tooltip';
  tooltip.id = 'bin-tip-' + uniqueId();
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const hide = () => {
    tooltip.hidden = true;
  };
  (data.mode === 'simple' ? [] : shelfBins(data)).forEach(({ bin, r, c }) => {
    const el = document.createElement('button');
    el.className = 'grid-item shelf-bin readonly-bin';
    el.dataset.binId = bin.id;
    el.classList.toggle('inventory-target', bin.id === targetBin);
    el.type = 'button';
    el.classList.toggle('inventory-match', matchingBins.includes(bin.id));
    el.setAttribute('aria-pressed', String(bin.id === targetBin));
    el.addEventListener('click', () => {
      grid.querySelectorAll('.readonly-bin').forEach((node) => {
        const selected = node.dataset.binId === bin.id;
        node.classList.toggle('inventory-target', selected);
        node.setAttribute('aria-pressed', String(selected));
      });
      onSelect?.(bin);
    });
    positionShelfBin(el, bin, r, c);
    el.style.backgroundColor = bin.background;
    el.style.setProperty('--bg', bin.background);
    el.append(labelFor({ ...bin, name: binDisplayName(bin, data.id, data) }));
    el.setAttribute(
      'aria-label',
      `${binDisplayName(bin, data.id, data)}, row ${r + 1}, column ${c + 1}`,
    );
    el.setAttribute('aria-describedby', tooltip.id);
    const show = () => {
      tooltip.replaceChildren(
        infoField(
          binDisplayName(bin, data.id, data),
          'Select to view inventory',
        ),
      );
      tooltip.hidden = false;
      const rect = el.getBoundingClientRect();
      tooltip.style.left =
        Math.max(
          8,
          Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8),
        ) + 'px';
      tooltip.style.top =
        Math.max(
          8,
          Math.min(
            rect.bottom + 6,
            window.innerHeight - tooltip.offsetHeight - 8,
          ),
        ) + 'px';
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });
    grid.append(el);
  });
  const updateLabels = () => {
    grid.querySelectorAll('.readonly-bin').forEach((node) => {
      const position = shelfBins(data).find(
        ({ bin }) => bin.id === node.dataset.binId,
      );
      if (position) {
        const label = binDisplayName(position.bin, data.id, data);
        node.querySelector('.fit-label').textContent = label;
        node.setAttribute(
          'aria-label',
          `${label}, row ${position.r + 1}, column ${position.c + 1}`,
        );
      }
    });
    fitLabels(grid);
  };
  document.addEventListener('inventory-updated', updateLabels);
  viewport.addEventListener('scroll', () => {
    const hovered = grid.querySelector('.readonly-bin:hover');
    if (hovered) hovered.dispatchEvent(new Event('mouseenter'));
    else hide();
  });
  const stage = document.createElement('div');
  stage.className = 'readonly-shelf-stage';
  stage.append(grid);
  viewport.append(stage);
  const controls = document.createElement('div');
  controls.className = 'toolbar shelf-view-controls';
  controls.setAttribute('aria-label', 'Shelf zoom');
  const out = document.createElement('button'),
    inside = document.createElement('button'),
    fit = document.createElement('button'),
    level = document.createElement('output');
  out.textContent = '−';
  out.setAttribute('aria-label', 'Zoom shelf out');
  inside.textContent = '+';
  inside.setAttribute('aria-label', 'Zoom shelf in');
  fit.textContent = 'Fit shelf';
  level.setAttribute('aria-label', 'Shelf zoom level');
  controls.append(out, inside, fit, level);
  host.append(controls, viewport, tooltip);
  let scale = 1,
    minimum = 1,
    fitted = true;
  const apply = () => {
    if (!grid.isConnected || !viewport.clientWidth) return;
    const style = getComputedStyle(viewport),
      width =
        viewport.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      height =
        viewport.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
    minimum = Math.min(1, width / grid.offsetWidth, height / grid.offsetHeight);
    scale = fitted ? minimum : Math.max(minimum, Math.min(3, scale));
    grid.style.transform = `scale(${scale})`;
    stage.style.width = grid.offsetWidth * scale + 'px';
    stage.style.height = grid.offsetHeight * scale + 'px';
    out.disabled = scale <= minimum + 0.0001;
    inside.disabled = scale >= 3;
    level.textContent = Math.round(scale * 100) + '%';
    hide();
  };
  const zoom = (multiplier) => {
    fitted = false;
    scale *= multiplier;
    apply();
  };
  out.addEventListener('click', () => zoom(1 / 1.25));
  inside.addEventListener('click', () => zoom(1.25));
  fit.addEventListener('click', () => {
    fitted = true;
    apply();
    viewport.scrollTo(0, 0);
  });
  const observer = new ResizeObserver(() => apply());
  observer.observe(viewport);
  host._disposeShelfGrid = () => {
    observer.disconnect();
    document.removeEventListener('inventory-updated', updateLabels);
    hide();
  };
  requestAnimationFrame(() => {
    fitLabels(grid);
    apply();
  });
}

// Matrix indices remain integers; optional offsets locate a bin on the half grid.
const halfStep = (value) =>
  Number.isFinite(value) && Number.isInteger(value * 2);
const snapHalf = (value) => Math.round(value * 2) / 2;
function setShelfBin(data, r, c, bin) {
  if (bin) {
    bin = { ...bin };
    delete bin.offsetX;
    delete bin.offsetY;
    if (c % 1) bin.offsetX = c % 1;
    if (r % 1) bin.offsetY = r % 1;
    data.schemaVersion = 3;
  }
  data.matrix[Math.floor(r)][Math.floor(c)] = bin;
}
function shelfBinFits(data, bin, r, c, ignore = null) {
  if (
    ![r, c, bin.w, bin.h].every(halfStep) ||
    r < 0 ||
    c < 0 ||
    bin.w < 1 ||
    bin.h < 1 ||
    r + bin.h > data.rows ||
    c + bin.w > data.cols
  )
    return false;
  return !shelfBins(data).some(
    (p) =>
      !(ignore && p.r === ignore.r && p.c === ignore.c) &&
      overlaps(
        { x: c, y: r, w: bin.w, h: bin.h },
        { x: p.c, y: p.r, w: p.bin.w, h: p.bin.h },
      ),
  );
}

function infoField(title, value) {
  const block = document.createElement('div');
  block.className = 'info-field';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = value || 'Not recorded';
  block.append(heading, text);
  return block;
}

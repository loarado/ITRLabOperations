'use strict';
let selectedDecor = null;
const decorKeys = [
  'x',
  'y',
  'w',
  'h',
  'text',
  'outlineWidth',
  'outlineColor',
  'fillColor',
  'textColor',
];
function currentDecor() {
  return shelf.data?.decor.find((shape) => shape.id === selectedDecor);
}
function chooseDecor(id) {
  selectedDecor = id;
  selection = null;
  render();
}
function renderDecorControls() {
  const select = $('#decorSelection');
  select.replaceChildren(new Option('No decor selected', ''));
  shelf.data.decor.forEach((shape, index) =>
    select.add(
      new Option(shape.text || `${shape.shape} ${index + 1}`, shape.id),
    ),
  );
  if (!currentDecor()) selectedDecor = null;
  select.value = selectedDecor || '';
  const shape = currentDecor();
  $('#decorFields').hidden = !shape;
  if (shape)
    decorKeys.forEach((key) => ($('#decor-' + key).value = shape[key]));
}
function bindShelfDecor(el, shape, layer) {
  if (!isAdmin || !$('#editDecor').checked) return;
  el.classList.add('editable-decor');
  el.classList.toggle('selected', shape.id === selectedDecor);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute(
    'aria-label',
    `${shape.shape} decor${shape.text ? ': ' + shape.text : ''}`,
  );
  el.setAttribute('aria-pressed', String(shape.id === selectedDecor));
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    chooseDecor(shape.id);
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseDecor(shape.id);
    }
  });
  const handle = document.createElement('button');
  handle.className = 'decor-resize';
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Resize decor');
  handle.title = 'Drag to resize; size fields also available';
  el.append(handle);
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const resize = event.target === handle,
      rect = layer.getBoundingClientRect(),
      start = { x: event.clientX, y: event.clientY };
    let candidate = { ...shape },
      moved = false;
    selectedDecor = shape.id;
    selection = null;
    renderDecorControls();
    renderDetails();
    el.classList.add('selected');
    el.setPointerCapture(event.pointerId);
    const snap = (value) => Math.round(value * 4) / 4;
    const move = (e) => {
      const dx = snap(((e.clientX - start.x) / rect.width) * shelf.data.cols),
        dy = snap(((e.clientY - start.y) / rect.height) * shelf.data.rows);
      candidate = resize
        ? {
            ...shape,
            w: Math.max(
              0.25,
              Math.min(shelf.data.cols - shape.x, snap(shape.w + dx)),
            ),
            h: Math.max(
              0.25,
              Math.min(shelf.data.rows - shape.y, snap(shape.h + dy)),
            ),
          }
        : {
            ...shape,
            x: Math.max(
              0,
              Math.min(shelf.data.cols - shape.w, snap(shape.x + dx)),
            ),
            y: Math.max(
              0,
              Math.min(shelf.data.rows - shape.h, snap(shape.y + dy)),
            ),
          };
      moved = JSON.stringify(candidate) !== JSON.stringify(shape);
      positionShelfDecor(el, candidate, shelf.data);
    };
    const cleanup = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', cancel);
    };
    const end = () => {
      cleanup();
      if (moved && validShelfDecor(candidate, shelf.data)) {
        checkpoint();
        Object.assign(shape, candidate);
        changed();
      }
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
}
function deleteShelfDecor() {
  if (!isAdmin || !currentDecor()) return;
  checkpoint();
  shelf.data.decor = shelf.data.decor.filter(
    (shape) => shape.id !== selectedDecor,
  );
  selectedDecor = null;
  render();
  changed();
}
function setupShelfDecor() {
  mountEditorGroup('decorPanel', 'Shelf Decor');
  $('#editDecor').addEventListener('change', render);
  $('#decorSelection').addEventListener('change', () =>
    chooseDecor($('#decorSelection').value || null),
  );
  $('#addDecor').addEventListener('click', () => {
    if (!isAdmin || !shelf.data) return;
    if (shelf.data.decor.length >= 200) {
      message('A shelf supports up to 200 decor shapes.', true);
      return;
    }
    checkpoint();
    const shape = {
      id: 'D-' + uniqueId(),
      shape: $('#decorShape').value,
      x: 0,
      y: 0,
      w: Math.min(6, shelf.data.cols),
      h: Math.min(4, shelf.data.rows),
      text: '',
      outlineWidth: 2,
      outlineColor: '#dce8f5',
      fillColor: '#65798e',
      textColor: '#ffffff',
    };
    shelf.data.decor.push(shape);
    chooseDecor(shape.id);
    changed();
  });
  decorKeys.forEach((key) =>
    $('#decor-' + key).addEventListener('change', () => {
      const shape = currentDecor();
      if (!isAdmin || !shape) return;
      const field = $('#decor-' + key),
        candidate = {
          ...shape,
          [key]: field.type === 'number' ? Number(field.value) : field.value,
        };
      if (!validShelfDecor(candidate, shelf.data)) {
        message(
          'Use positive quarter-cell sizes within the shelf and an outline from 0–20 pixels.',
          true,
        );
        renderDecorControls();
        return;
      }
      checkpoint();
      Object.assign(shape, candidate);
      render();
      changed();
    }),
  );
  $('#deleteDecor').addEventListener('click', deleteShelfDecor);
  document.addEventListener('keydown', (event) => {
    if (
      !isAdmin ||
      !currentDecor() ||
      typingShortcut() ||
      event.ctrlKey ||
      event.metaKey ||
      document.querySelector('dialog[open]')
    )
      return;
    if (['Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      deleteShelfDecor();
      return;
    }
    const delta = {
      ArrowLeft: [-0.25, 0],
      ArrowRight: [0.25, 0],
      ArrowUp: [0, -0.25],
      ArrowDown: [0, 0.25],
    }[event.key];
    if (delta) {
      event.preventDefault();
      const shape = currentDecor(),
        candidate = { ...shape, x: shape.x + delta[0], y: shape.y + delta[1] };
      if (validShelfDecor(candidate, shelf.data)) {
        checkpoint();
        Object.assign(shape, candidate);
        render();
        changed();
      }
    }
  });
}

function pasteShelfDecor(source) {
  if (shelf.data.decor.length >= 200) {
    message('A shelf supports up to 200 decor shapes.', true);
    return;
  }
  const shape = { ...clone(source), id: 'D-' + uniqueId() };
  const target = nearbyPositions(
    source.x,
    source.y,
    0.25,
    0.25,
    shelf.data.cols,
    shelf.data.rows,
    0.25,
  ).find(
    (p) =>
      (p.x !== source.x || p.y !== source.y) &&
      validShelfDecor({ ...shape, ...p }, shelf.data),
  );
  if (!target) {
    message(
      'No nearby position within this shelf fits the copied decor. Resize the canvas or shape.',
      true,
    );
    return;
  }
  checkpoint();
  Object.assign(shape, target);
  shelf.data.decor.push(shape);
  decorClipboard = clone(shape);
  chooseDecor(shape.id);
  changed();
}

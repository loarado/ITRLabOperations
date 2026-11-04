'use strict';
let selectedGeometry = null;
function geometrySelected() {
  return selectedGeometry
    ? lab.data?.[selectedGeometry.type]?.find(
        (g) => g.id === selectedGeometry.id,
      )
    : null;
}
function selectGeometry(type, id) {
  if (!canEditMap()) return;
  selectedGeometry = { type, id };
  selectedId = null;
  selectedRoute = null;
  selectedVertex = null;
  render();
}
function validWall(w, cols = lab.data.cols, rows = lab.data.rows) {
  return (
    [w.a, w.b].every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isInteger) &&
        p[0] >= 0 &&
        p[1] >= 0 &&
        p[0] <= cols &&
        p[1] <= rows,
    ) &&
    w.a.some((n, i) => n !== w.b[i]) &&
    Number.isFinite(w.thickness) &&
    w.thickness >= 0.1 &&
    w.thickness <= 2
  );
}
function wallFromFields() {
  return {
    a: [$('#wallAX'), $('#wallAY')].map((e) => Number(e.value)),
    b: [$('#wallBX'), $('#wallBY')].map((e) => Number(e.value)),
    thickness: Number($('#wallThickness').value),
  };
}
function commitGeometry(type, value) {
  if (!canEditMap()) return false;
  if (
    !(type === 'walls'
      ? validWall(value)
      : validDoor(value, lab.data.cols, lab.data.rows))
  ) {
    message(
      type === 'walls'
        ? 'Use distinct wall endpoints on the grid and thickness from 0.1 to 2.'
        : 'Keep the door and its radius inside the grid (radius 1–20).',
      true,
    );
    return false;
  }
  if (
    (lab.data[type] || []).length >= 500 &&
    !(lab.data[type] || []).some((g) => g.id === value.id)
  ) {
    message('The map supports up to 500 elements of each type.', true);
    return false;
  }
  checkpoint();
  const list = lab.data[type] ?? (lab.data[type] = []),
    index = list.findIndex((g) => g.id === value.id);
  if (index < 0) list.push(value);
  else list[index] = value;
  selectedGeometry = { type, id: value.id };
  selectedId = null;
  selectedRoute = null;
  selectedVertex = null;
  render();
  changed();
  return true;
}
function bindGeometryDrag(el, type, original, preview, endpoint = null) {
  el.addEventListener('click', () => selectGeometry(type, original.id));
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectGeometry(type, original.id);
    }
  });
  el.addEventListener('pointerdown', (event) => {
    if (!canEditMap() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = plan.getBoundingClientRect(),
      start = [event.clientX, event.clientY];
    let candidate = clone(original),
      moved = false;
    el.setPointerCapture(event.pointerId);
    const move = (e) => {
      const dx = Math.round(
          ((e.clientX - start[0]) / rect.width) * lab.data.cols,
        ),
        dy = Math.round(((e.clientY - start[1]) / rect.height) * lab.data.rows);
      candidate = clone(original);
      if (type === 'doors') {
        candidate.x += dx;
        candidate.y += dy;
      } else
        for (const key of ['a', 'b'])
          if (!endpoint || endpoint === key)
            candidate[key] = [original[key][0] + dx, original[key][1] + dy];
      moved = dx !== 0 || dy !== 0;
      preview(candidate);
    };
    const cleanup = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', cancel);
    };
    const end = () => {
      cleanup();
      if (moved) commitGeometry(type, candidate);
      else selectGeometry(type, original.id);
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
function renderMapElements() {
  if (!canEditMap() || !geometrySelected()) selectedGeometry = null;
  const layer = svgElement('svg', {
    viewBox: `0 0 ${lab.data.cols} ${lab.data.rows}`,
    preserveAspectRatio: 'none',
    class: 'wall-layer',
  });
  for (const wall of lab.data.walls || []) {
    const group = svgElement('g', { 'data-wall': wall.id }),
      line = svgElement('line', {
        stroke: '#34444e',
        'stroke-width': wall.thickness,
        'stroke-linecap': 'round',
      }),
      hit = svgElement('line', {
        stroke: 'transparent',
        'stroke-width': Math.max(0.9, wall.thickness),
        class: 'geometry-hit',
        tabindex: 0,
        role: 'button',
        'aria-label': 'Wall ' + wall.id,
      });
    const handles = [];
    const preview = (w) => {
      for (const el of [line, hit])
        for (const [key, p] of [
          ['1', w.a],
          ['2', w.b],
        ]) {
          el.setAttribute('x' + key, p[0]);
          el.setAttribute('y' + key, p[1]);
        }
      handles.forEach((h, i) => {
        h.setAttribute('cx', w[i ? 'b' : 'a'][0]);
        h.setAttribute('cy', w[i ? 'b' : 'a'][1]);
      });
    };
    group.append(line);
    if (canEditMap()) {
      group.append(hit);
      bindGeometryDrag(hit, 'walls', wall, preview);
      if (selectedGeometry?.id === wall.id) {
        line.setAttribute('stroke', '#2565e8');
        for (const key of ['a', 'b']) {
          const handle = svgElement('circle', {
            r: 0.35,
            class: 'geometry-handle',
            'data-endpoint': key,
            tabindex: 0,
            role: 'button',
            'aria-label': 'Wall endpoint ' + key,
          });
          handles.push(handle);
          group.append(handle);
          bindGeometryDrag(handle, 'walls', wall, preview, key);
        }
      }
    }
    preview(wall);
    layer.append(group);
  }
  plan.append(layer);
  renderDoors();
  renderGeometryTools();
  renderDoorTools();
}
function renderGeometryTools() {
  $('#geometryPanel').hidden = !canEditMap();
  const wall = selectedGeometry?.type === 'walls' ? geometrySelected() : null;
  $('#applyWall').disabled = !canEditMap() || !wall;
  $('#deleteWall').disabled = !canEditMap() || !wall;
  if (wall) {
    [wall.a[0], wall.a[1], wall.b[0], wall.b[1], wall.thickness].forEach(
      (n, i) =>
        ($(
          '#' + ['wallAX', 'wallAY', 'wallBX', 'wallBY', 'wallThickness'][i],
        ).value = n),
    );
  }
  const list = $('#wallDirectory');
  list.replaceChildren();
  for (const w of lab.data.walls || []) {
    const button = document.createElement('button');
    button.textContent = `Wall · ${w.a.join(',')} → ${w.b.join(',')}`;
    button.dataset.wallId = w.id;
    button.addEventListener('click', () => selectGeometry('walls', w.id));
    list.append(button);
  }
}
$('#addWall').addEventListener('click', () =>
  commitGeometry('walls', { id: 'W-' + uniqueId(), ...wallFromFields() }),
);
$('#applyWall').addEventListener('click', () => {
  if (selectedGeometry?.type === 'walls' && geometrySelected())
    commitGeometry('walls', { ...geometrySelected(), ...wallFromFields() });
});
function deleteGeometry() {
  if (!canEditMap() || !geometrySelected()) return;
  checkpoint();
  lab.data[selectedGeometry.type] = lab.data[selectedGeometry.type].filter(
    (g) => g.id !== selectedGeometry.id,
  );
  selectedGeometry = null;
  render();
  changed();
}
$('#deleteWall').addEventListener('click', deleteGeometry);
document.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented ||
    !canEditMap() ||
    !geometrySelected() ||
    typingShortcut() ||
    event.ctrlKey ||
    event.metaKey ||
    document.querySelector('dialog[open]')
  )
    return;
  if (['Delete', 'Backspace'].includes(event.key)) {
    event.preventDefault();
    deleteGeometry();
    return;
  }
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[event.key];
  if (!delta) return;
  event.preventDefault();
  const wall = clone(geometrySelected());
  if (selectedGeometry.type === 'doors') {
    wall.x += delta[0];
    wall.y += delta[1];
  } else
    for (const key of ['a', 'b'])
      wall[key] = wall[key].map((n, i) => n + delta[i]);
  commitGeometry(selectedGeometry.type, wall);
});

function doorFromFields() {
  return {
    x: Number($('#doorX').value),
    y: Number($('#doorY').value),
    radius: Number($('#doorRadius').value),
    orientation: $('#doorOrientation').value,
  };
}
function renderDoors() {
  const layer = svgElement('svg', {
    viewBox: `0 0 ${lab.data.cols} ${lab.data.rows}`,
    preserveAspectRatio: 'none',
    class: 'door-layer',
  });
  for (const door of lab.data.doors || []) {
    const group = svgElement('g', {
        'data-door': door.id,
        'data-orientation': door.orientation,
      }),
      symbol = svgElement('path', {
        fill: '#ddb97533',
        stroke: selectedGeometry?.id === door.id ? '#2565e8' : '#806032',
        'stroke-width': 0.2,
      }),
      hit = svgElement('path', {
        fill: 'transparent',
        stroke: 'transparent',
        'stroke-width': 0.9,
        class: 'geometry-hit door-hit',
        tabindex: 0,
        role: 'button',
        'aria-label': `Door ${door.orientation} · ${door.id}`,
      });
    const preview = (d) => {
      symbol.setAttribute('d', doorPath(d));
      hit.setAttribute('d', doorPath(d));
    };
    preview(door);
    group.append(symbol);
    if (canEditMap()) {
      group.append(hit);
      bindGeometryDrag(hit, 'doors', door, preview);
    }
    layer.append(group);
  }
  plan.append(layer);
}
function renderDoorTools() {
  const door = selectedGeometry?.type === 'doors' ? geometrySelected() : null;
  $('#applyDoor').disabled = !canEditMap() || !door;
  $('#deleteDoor').disabled = !canEditMap() || !door;
  if (door) {
    $('#doorX').value = door.x;
    $('#doorY').value = door.y;
    $('#doorRadius').value = door.radius;
    $('#doorOrientation').value = door.orientation;
  }
  const list = $('#doorDirectory');
  list.replaceChildren();
  for (const d of lab.data.doors || []) {
    const button = document.createElement('button');
    button.dataset.doorId = d.id;
    button.textContent = `Door ${d.orientation} · ${d.x}, ${d.y} · radius ${d.radius}`;
    button.addEventListener('click', () => selectGeometry('doors', d.id));
    list.append(button);
  }
}
$('#addDoor').addEventListener('click', () =>
  commitGeometry('doors', { id: 'D-' + uniqueId(), ...doorFromFields() }),
);
$('#applyDoor').addEventListener('click', () => {
  if (selectedGeometry?.type === 'doors' && geometrySelected())
    commitGeometry('doors', { ...geometrySelected(), ...doorFromFields() });
});
$('#deleteDoor').addEventListener('click', deleteGeometry);

'use strict';
let mapEditing = false,
  selectedVertex = null;
function canEditMap() {
  return isAdmin && mapEditing;
}
function canEditItem(item) {
  return (
    !!item && isAdmin && (item.kind === 'section' ? mapEditing : !mapEditing)
  );
}
function setMapEditing(value) {
  mapEditing = isAdmin && value;
  selectedGeometry = null;
  selectedVertex = null;
  selectedId = null;
  selectedRoute = null;
  render();
  storeRecovery(false);
}
function renderWorkspace() {
  if (!isAdmin) mapEditing = false;
  document.body.classList.toggle('map-editing', mapEditing);
  $('h1').textContent = isAdmin
    ? mapEditing
      ? 'Lab Map Editor'
      : 'Lab Editor'
    : 'Lab Explorer';
  document.title = $('h1').textContent + ' · ITR Lab';
  $('#labHint').textContent = !isAdmin
    ? 'Explore the lab. Select a shelf or section to learn more.'
    : mapEditing
      ? 'Edit the outline, sections, walls, doors, and traffic arrows. Your changes stay in the draft until saved.'
      : 'Select an item to edit. Drag unlocked items or use arrow keys to move them one cell.';
  $('aside > h2').textContent = mapEditing ? 'Map structure' : 'Lab items';
  $('#mapMode').hidden = !isAdmin;
  $('#mapMode').textContent = mapEditing
    ? 'Leave Lab Map Editor'
    : 'Lab Map Editor';
  $('#mapMode').setAttribute('aria-pressed', mapEditing);
  $('#addPanel').hidden = mapEditing;
  $('#directoryPanel').hidden = mapEditing;
  $('#mapPanel').hidden = !mapEditing;
  $('#pathsPanel').hidden = !mapEditing;
  $('#search').hidden = mapEditing;
  $('#filter').hidden = mapEditing;
  if (selected() && !canEditItem(selected())) selectedId = null;
  if (!mapEditing) selectedRoute = null;
}
$('#mapMode').addEventListener('click', () => setMapEditing(!mapEditing));

function selectVertex(index) {
  if (!canEditMap()) return;
  selectedGeometry = null;
  selectedVertex = index;
  selectedId = null;
  selectedRoute = null;
  render();
}
function renderVertices() {
  if (!canEditMap()) return;
  if (selectedVertex !== null && !lab.data.outline[selectedVertex])
    selectedVertex = null;
  const layer = svgElement('svg', {
    viewBox: `0 0 ${lab.data.cols} ${lab.data.rows}`,
    preserveAspectRatio: 'none',
    class: 'outline-vertices',
  });
  lab.data.outline.forEach(([x, y], index) => {
    const point = svgElement('circle', {
      cx: x,
      cy: y,
      r: '.38',
      class: 'outline-vertex' + (index === selectedVertex ? ' chosen' : ''),
      tabindex: 0,
      role: 'button',
      'aria-label': `Outline point ${index + 1}: ${x}, ${y}`,
      'data-vertex': index,
    });
    bindOutlineDrag(point, index);
    point.addEventListener('click', () => selectVertex(index));
    point.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectVertex(index);
      }
    });
    layer.append(point);
  });
  plan.append(layer);
  $('#deleteVertex').disabled = selectedVertex === null;
  $('#insertVertex').disabled = selectedVertex === null;
  ['vertexX', 'vertexY'].forEach((id, axis) => {
    const field = $('#' + id);
    field.disabled = selectedVertex === null;
    field.value =
      selectedVertex === null ? '' : lab.data.outline[selectedVertex][axis];
  });
  $('#selectedPoint').textContent =
    selectedVertex === null
      ? 'Select an outline vertex on the map.'
      : `Point ${selectedVertex + 1}: x ${lab.data.outline[selectedVertex][0]}, y ${lab.data.outline[selectedVertex][1]}`;
}
function validOutline(points, cols = lab.data.cols, rows = lab.data.rows) {
  if (
    points.length < 3 ||
    points.length > 500 ||
    points.some(
      (p) =>
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        p[0] < 0 ||
        p[0] > cols ||
        p[1] < 0 ||
        p[1] > rows,
    )
  )
    return false;
  if (new Set(points.map((p) => p.join(','))).size !== points.length)
    return false;
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  return Math.abs(area) > 0.001;
}
function commitOutline(points) {
  if (!canEditMap()) return false;
  if (!validOutline(points)) {
    message(
      'An outline needs at least three distinct points with nonzero area, inside the grid.',
      true,
    );
    return false;
  }
  checkpoint();
  lab.data.outline = points;
  render();
  changed();
  return true;
}
function bindOutlineDrag(point, index) {
  point.addEventListener('pointerdown', (event) => {
    if (!canEditMap() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = plan.getBoundingClientRect(),
      start = [event.clientX, event.clientY],
      original = clone(lab.data.outline);
    let candidate = clone(original),
      moved = false;
    selectedGeometry = null;
    selectedVertex = index;
    selectedId = null;
    selectedRoute = null;
    point.setPointerCapture(event.pointerId);
    const move = (e) => {
      candidate = clone(original);
      candidate[index] = [
        Math.round(
          original[index][0] +
            ((e.clientX - start[0]) / rect.width) * lab.data.cols,
        ),
        Math.round(
          original[index][1] +
            ((e.clientY - start[1]) / rect.height) * lab.data.rows,
        ),
      ];
      moved = JSON.stringify(candidate) !== JSON.stringify(original);
      if (validOutline(candidate)) {
        point.setAttribute('cx', candidate[index][0]);
        point.setAttribute('cy', candidate[index][1]);
        plan
          .querySelector('.outline polygon')
          .setAttribute('points', candidate.map((p) => p.join(',')).join(' '));
        $('#selectedPoint').textContent =
          `Point ${index + 1}: x ${candidate[index][0]}, y ${candidate[index][1]}`;
      }
    };
    const cleanup = () => {
      point.removeEventListener('pointermove', move);
      point.removeEventListener('pointerup', end);
      point.removeEventListener('pointercancel', cancel);
    };
    const end = () => {
      cleanup();
      if (moved) commitOutline(candidate);
      render();
    };
    const cancel = () => {
      cleanup();
      render();
    };
    point.addEventListener('pointermove', move);
    point.addEventListener('pointerup', end);
    point.addEventListener('pointercancel', cancel);
  });
}

function moveVertex(dx, dy) {
  if (!canEditMap() || selectedVertex === null) return;
  const points = clone(lab.data.outline);
  points[selectedVertex] = [
    points[selectedVertex][0] + dx,
    points[selectedVertex][1] + dy,
  ];
  commitOutline(points);
}
['vertexX', 'vertexY'].forEach((id, axis) =>
  $('#' + id).addEventListener('change', () => {
    if (!canEditMap() || selectedVertex === null) return;
    const points = clone(lab.data.outline);
    points[selectedVertex][axis] = Number($('#' + id).value);
    commitOutline(points);
    render();
  }),
);
document.addEventListener('keydown', (event) => {
  if (
    !canEditMap() ||
    selectedVertex === null ||
    event.ctrlKey ||
    event.metaKey ||
    document.querySelector('dialog[open]') ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) ||
    document.activeElement.isContentEditable
  )
    return;
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[event.key];
  if (delta) {
    event.preventDefault();
    moveVertex(...delta);
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteVertex();
  }
});

function deleteVertex() {
  if (!canEditMap() || selectedVertex === null) return;
  if (lab.data.outline.length <= 3) {
    message('Keep at least three outline points. Nothing was deleted.', true);
    return;
  }
  const points = clone(lab.data.outline);
  points.splice(selectedVertex, 1);
  commitOutline(points);
}
$('#deleteVertex').addEventListener('click', deleteVertex);
$('#insertVertex').addEventListener('click', () => {
  if (!canEditMap() || selectedVertex === null) return;
  const points = clone(lab.data.outline),
    a = points[selectedVertex],
    b = points[(selectedVertex + 1) % points.length];
  points.splice(selectedVertex + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  commitOutline(points);
});

function centerLab() {
  if (!canEditMap()) return;
  try {
    const centered = centeredLab(lab.data);
    if (!centered.dx && !centered.dy) {
      message('The lab is already centered as closely as the grid allows.');
      return;
    }
    checkpoint();
    lab.data = centered.data;
    render();
    changed();
    message(
      'Lab centered · all items and map elements moved together · save to keep this arrangement',
    );
  } catch (error) {
    message(error.message, true);
  }
}
$('#centerLab').addEventListener('click', centerLab);

'use strict';
let selectedRoute = null;
function validRoute(points) {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= 500 &&
    points.every(
      (p) =>
        p.length === 2 &&
        p.every(Number.isFinite) &&
        p[0] >= 0 &&
        p[0] <= lab.data.cols &&
        p[1] >= 0 &&
        p[1] <= lab.data.rows,
    )
  );
}
function chooseRoute(index) {
  if (!canEditMap()) return;
  selectedGeometry = null;
  selectedVertex = null;
  selectedRoute = index;
  selectedId = null;
  $('#routes').checked = true;
  render();
}
function replaceRoute(points) {
  if (!canEditMap() || selectedRoute === null) return;
  if (!validRoute(points)) {
    message('Use 2–500 x,y points within the lab grid.', true);
    return;
  }
  checkpoint();
  lab.data.routes[selectedRoute] = points;
  render();
  changed();
}
function moveRoute(dx, dy) {
  const route = lab.data.routes[selectedRoute];
  if (!canEditMap() || !route) return;
  replaceRoute(
    route.map(([x, y]) => [
      Math.round((x + dx) * 10) / 10,
      Math.round((y + dy) * 10) / 10,
    ]),
  );
}
function drawRoutes() {
  if (!$('#routes').checked) return;
  const d = lab.data,
    svg = svgElement('svg', {
      viewBox: `0 0 ${d.cols} ${d.rows}`,
      preserveAspectRatio: 'none',
      class: 'traffic-layer',
    });
  const defs = svgElement('defs', {}),
    marker = svgElement('marker', {
      id: 'arrow',
      viewBox: '0 0 10 10',
      refX: 8,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: 'auto',
    });
  marker.append(
    svgElement('path', {
      d: 'M1 1 9 5 1 9',
      fill: 'none',
      stroke: '#ce6767',
      'stroke-width': 1.5,
    }),
  );
  defs.append(marker);
  svg.append(defs);
  d.routes.forEach((route, index) => {
    const group = svgElement('g', { 'data-route': index });
    const line = svgElement('polyline', {
      points: route.map((p) => p.join(',')).join(' '),
      fill: 'none',
      stroke: selectedRoute === index ? '#2565e8' : '#ce6767',
      'stroke-width': selectedRoute === index ? '.22' : '.14',
      'stroke-dasharray': '.6 .5',
      'marker-end': 'url(#arrow)',
    });
    const hit = svgElement('polyline', {
      points: line.getAttribute('points'),
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': '.8',
      class: 'route-hit',
      tabindex: 0,
      role: 'button',
      'aria-label': `Traffic arrow ${index + 1}`,
    });
    group.append(line);
    if (canEditMap()) group.append(hit);
    const handles = [];
    function preview(points) {
      const value = points.map((p) => p.join(',')).join(' ');
      line.setAttribute('points', value);
      hit.setAttribute('points', value);
      handles.forEach((h, i) => {
        h.setAttribute('cx', points[i][0]);
        h.setAttribute('cy', points[i][1]);
      });
    }
    function bindDrag(el, vertex = null) {
      el.addEventListener('click', () => chooseRoute(index));
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          chooseRoute(index);
        }
      });
      el.addEventListener('pointerdown', (event) => {
        if (!canEditMap() || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = plan.getBoundingClientRect(),
          start = [event.clientX, event.clientY];
        let candidate = clone(route),
          moved = false;
        el.setPointerCapture(event.pointerId);
        const move = (e) => {
          const dx = ((e.clientX - start[0]) / rect.width) * d.cols,
            dy = ((e.clientY - start[1]) / rect.height) * d.rows;
          candidate = route.map(([x, y], i) =>
            vertex !== null && vertex !== i
              ? [x, y]
              : vertex === null
                ? [
                    Math.round((x + Math.round(dx)) * 10) / 10,
                    Math.round((y + Math.round(dy)) * 10) / 10,
                  ]
                : [
                    Math.round((x + dx) * 10) / 10,
                    Math.round((y + dy) * 10) / 10,
                  ],
          );
          moved = JSON.stringify(candidate) !== JSON.stringify(route);
          if (validRoute(candidate)) preview(candidate);
        };
        const cleanup = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', end);
          el.removeEventListener('pointercancel', cancel);
        };
        const end = () => {
          cleanup();
          selectedGeometry = null;
          selectedVertex = null;
          selectedRoute = index;
          selectedId = null;
          if (moved && validRoute(candidate)) {
            checkpoint();
            d.routes[index] = candidate;
            changed();
          } else if (moved)
            message('Keep traffic arrows inside the grid.', true);
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
    bindDrag(hit);
    if (selectedRoute === index && canEditMap())
      route.forEach(([x, y], i) => {
        const handle = svgElement('circle', {
          cx: x,
          cy: y,
          r: '.36',
          fill: '#ffffff',
          stroke: '#2565e8',
          'stroke-width': '.15',
          class: 'route-handle',
          'aria-label': `Arrow ${index + 1} point ${i + 1}`,
        });
        handles.push(handle);
        group.append(handle);
        bindDrag(handle, i);
      });
    svg.append(group);
  });
  plan.append(svg);
}
function renderRouteTools() {
  if (!lab.data) return;
  if (!lab.data.routes[selectedRoute]) selectedRoute = null;
  $('#routeDetails').hidden = selectedRoute === null;
  if (selectedRoute !== null) {
    $('#details').hidden = true;
    $('#empty').hidden = true;
    $('#routeTitle').textContent = `Traffic arrow ${selectedRoute + 1}`;
    $('#routePoints').value = lab.data.routes[selectedRoute]
      .map((p) => p.join(', '))
      .join('\n');
  }
  $('#routeDirectory').replaceChildren();
  lab.data.routes.forEach((route, index) => {
    const button = document.createElement('button');
    button.textContent = `Arrow ${index + 1} · ${route.length} points`;
    button.classList.toggle('active', selectedRoute === index);
    button.addEventListener('click', () => chooseRoute(index));
    $('#routeDirectory').append(button);
  });
}
$('#applyRoute').addEventListener('click', () => {
  const text = $('#routePoints').value.trim();
  const points = text
    .split('\n')
    .map((line) =>
      line.split(',').map((n) => (n.trim() === '' ? NaN : Number(n.trim()))),
    );
  replaceRoute(points);
});
$('#reverseRoute').addEventListener('click', () => {
  if (selectedRoute !== null)
    replaceRoute(clone(lab.data.routes[selectedRoute]).reverse());
});
$('#deleteRoute').addEventListener('click', () => {
  if (!canEditMap() || selectedRoute === null) return;
  checkpoint();
  lab.data.routes.splice(selectedRoute, 1);
  selectedRoute = null;
  render();
  changed();
});
$('#addRoute').addEventListener('click', () => {
  if (!canEditMap() || !lab.data) return;
  if (lab.data.routes.length >= 100) {
    message('The lab supports up to 100 traffic arrows.', true);
    return;
  }
  checkpoint();
  lab.data.routes.push([
    [1, Math.min(22, lab.data.rows - 1)],
    [Math.min(10, lab.data.cols - 1), Math.min(22, lab.data.rows - 1)],
  ]);
  chooseRoute(lab.data.routes.length - 1);
  changed();
});
$('#versionHistory').addEventListener('click', async () => {
  if (!lab.data) return;
  if (!(await cacheDraft())) return;
  $('#historyError').textContent = '';
  $('#historyVersions').replaceChildren();
  $('#restoreVersion').disabled = true;
  $('#historyDialog').showModal();
  try {
    const result = await api('/api/lab/history');
    const original = document.createElement('option');
    original.value = 'original';
    original.textContent = 'Original layout · initial floor plan';
    $('#historyVersions').append(original);
    result.versions.forEach((version) => {
      const option = document.createElement('option');
      option.value = version.version;
      option.textContent = `${version.name || version.reason} · Revision ${version.revision}${version.revision === result.currentRevision ? ' (current)' : ''} · ${version.savedAt ? new Date(version.savedAt).toLocaleString() : 'previously saved'} · ${version.reason}`;
      $('#historyVersions').append(option);
    });
    $('#historyInfo').textContent =
      'History is stored on disk. Only versions recorded since history was introduced are available, plus the original floor plan.';
    $('#restoreVersion').disabled = !isAdmin;
  } catch (error) {
    $('#historyError').textContent = error.message;
  }
});
$('#closeHistory').addEventListener('click', () => $('#historyDialog').close());
$('#restoreVersion').addEventListener('click', async () => {
  if (!isAdmin) return;
  $('#restoreVersion').disabled = true;
  $('#closeHistory').disabled = true;
  try {
    const result = await api('/api/lab/restore', 'POST', {
      version: $('#historyVersions').value,
      revision: lab.data.revision,
    });
    if (result._previousInventoryState) {
      lab.data._inventoryState = result._previousInventoryState;
      delete result._previousInventoryState;
    } else if (lab.data._inventoryState)
      result._inventoryState = lab.data._inventoryState;
    checkpoint();
    lab.data = result;
    selectedId = null;
    selectedRoute = null;
    render();
    changed();
    await cacheDraft();
    await refreshShelfIndex();
    $('#historyDialog').close();
    message(
      'Layout loaded into your draft · use Save changes to name and persist it',
    );
  } catch (error) {
    $('#historyError').textContent = error.message;
    if (error.status === 403) setAuth(false);
  } finally {
    $('#restoreVersion').disabled = !isAdmin;
    $('#closeHistory').disabled = false;
  }
});

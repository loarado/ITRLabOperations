'use strict';
// Logical map coordinates only; viewport size never enters containment tests.
function sectionFor(item, data) {
  const x = item.x + item.w / 2,
    y = item.y + item.h / 2;
  return (
    data.items
      .filter(
        (s) =>
          s.kind === 'section' &&
          x >= s.x &&
          x < s.x + s.w &&
          y >= s.y &&
          y < s.y + s.h,
      )
      .sort((a, b) => a.w * a.h - b.w * b.h || a.id.localeCompare(b.id))[0] ||
    null
  );
}
function itemArea(item, data) {
  return item.kind === 'section'
    ? item.name
    : sectionFor(item, data)?.name || 'Lab';
}

function doorSigns(door) {
  return [
    door.orientation.includes('E') ? 1 : -1,
    door.orientation.includes('S') ? 1 : -1,
  ];
}
function doorPath(door) {
  const [sx, sy] = doorSigns(door),
    { x, y, radius: r } = door;
  return `M ${x} ${y} L ${x + sx * r} ${y} A ${r} ${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${x} ${y + sy * r} Z`;
}
function validDoor(d, cols, rows) {
  if (
    !['NW', 'NE', 'SW', 'SE'].includes(d.orientation) ||
    ![d.x, d.y, d.radius].every(Number.isInteger) ||
    d.radius < 1 ||
    d.radius > 20
  )
    return false;
  const [sx, sy] = doorSigns(d);
  return (
    [d.x, d.x + sx * d.radius].every((x) => x >= 0 && x <= cols) &&
    [d.y, d.y + sy * d.radius].every((y) => y >= 0 && y <= rows)
  );
}

const GEOMETRY_EPS = 1e-8;
function rectangleEdges(r) {
  const a = [r.x, r.y],
    b = [r.x + r.w, r.y],
    c = [r.x + r.w, r.y + r.h],
    d = [r.x, r.y + r.h];
  return [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
  ];
}
function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy,
    t = length
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
        )
      : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function segmentRectangle(a, b, r) {
  let low = 0,
    high = 1;
  for (const [axis, start, size] of [
    [0, r.x, r.w],
    [1, r.y, r.h],
  ]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < GEOMETRY_EPS) {
      if (a[axis] < start || a[axis] > start + size) return false;
      continue;
    }
    const t1 = (start - a[axis]) / delta,
      t2 = (start + size - a[axis]) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}
function wallIntersectsRectangle(wall, rect) {
  // Walls lie on grid lines. Contact with an item's edge is allowed; the
  // painted stroke must not force a whole empty cell beside a thin wall.
  const inset = GEOMETRY_EPS * 4;
  if (
    segmentRectangle(wall.a, wall.b, {
      x: rect.x + inset,
      y: rect.y + inset,
      w: rect.w - 2 * inset,
      h: rect.h - 2 * inset,
    })
  )
    return true;
  // A thick wall still cannot completely contain an item on either side.
  return rectangleEdges(rect).every(
    ([corner]) =>
      pointSegmentDistance(corner, wall.a, wall.b) <=
      wall.thickness / 2 + GEOMETRY_EPS,
  );
}
function doorIntersectsRectangle(door, rect) {
  // Reserve the interior of the quarter disk; boundary contact is allowed.
  // Transform into the door's positive quadrant, then find the nearest rectangle point.
  const [sx, sy] = doorSigns(door),
    xs = [sx * (rect.x - door.x), sx * (rect.x + rect.w - door.x)],
    ys = [sy * (rect.y - door.y), sy * (rect.y + rect.h - door.y)];
  if (Math.max(...xs) <= GEOMETRY_EPS || Math.max(...ys) <= GEOMETRY_EPS)
    return false;
  const x = Math.max(0, Math.min(...xs)),
    y = Math.max(0, Math.min(...ys));
  return x * x + y * y < door.radius ** 2 - GEOMETRY_EPS;
}
function clearOfMapGeometry(item, data) {
  const rect = { x: item.x - 1, y: item.y - 1, w: item.w, h: item.h };
  return (
    !(data.walls || []).some((w) => wallIntersectsRectangle(w, rect)) &&
    !(data.doors || []).some((d) => doorIntersectsRectangle(d, rect))
  );
}

function centeredLab(data) {
  const outlineX = data.outline.map((p) => p[0]),
    outlineY = data.outline.map((p) => p[1]);
  const points = [...data.outline, ...data.routes.flat()];
  for (const item of data.items)
    points.push(
      [item.x - 1, item.y - 1],
      [item.x + item.w - 1, item.y + item.h - 1],
    );
  for (const wall of data.walls || []) points.push(wall.a, wall.b);
  for (const door of data.doors || []) {
    const [sx, sy] = doorSigns(door);
    points.push(
      [door.x, door.y],
      [door.x + sx * door.radius, door.y + sy * door.radius],
    );
  }
  const shift = (axis, size, outline) => {
    const values = points.map((p) => p[axis]),
      low = Math.ceil(-Math.min(...values)),
      high = Math.floor(size - Math.max(...values));
    if (low > high)
      throw new Error('Expand the grid first so the whole lab fits.');
    return Math.max(
      low,
      Math.min(
        high,
        Math.round((size - Math.min(...outline) - Math.max(...outline)) / 2),
      ),
    );
  };
  const dx = shift(0, data.cols, outlineX),
    dy = shift(1, data.rows, outlineY),
    result = clone(data);
  const move = ([x, y]) => [
    Math.round((x + dx) * 1e8) / 1e8,
    Math.round((y + dy) * 1e8) / 1e8,
  ];
  result.outline = result.outline.map(move);
  result.routes = result.routes.map((route) => route.map(move));
  result.items.forEach((item) => {
    item.x += dx;
    item.y += dy;
  });
  (result.walls || []).forEach((wall) => {
    wall.a = move(wall.a);
    wall.b = move(wall.b);
  });
  (result.doors || []).forEach((door) => {
    door.x += dx;
    door.y += dy;
  });
  return { data: result, dx, dy };
}

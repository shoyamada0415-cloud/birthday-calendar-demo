const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function normalized(width, height, zoom, centerX, centerY) {
  const safeZoom = clamp(Number(zoom) || MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const half = Math.min(width, height) / safeZoom / 2;
  return { width, height, zoom: safeZoom,
    centerX: clamp(centerX, half, width - half),
    centerY: clamp(centerY, half, height - half) };
}

export function initialCrop(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('画像の寸法が正しくありません。');
  }
  return normalized(width, height, MIN_ZOOM, width / 2, height / 2);
}

export function cropRect(crop) {
  const size = Math.min(crop.width, crop.height) / crop.zoom;
  return { x: crop.centerX - size / 2, y: crop.centerY - size / 2, size };
}

export function zoomCrop(crop, zoom) {
  return normalized(crop.width, crop.height, zoom, crop.centerX, crop.centerY);
}

// 指の開始位置にあった画像上の点を、移動・ピンチ後も指の下に保つ。
export function gestureCrop(start, startPoints, currentPoints, viewportSize) {
  if (!viewportSize || !startPoints.length || startPoints.length !== currentPoints.length) return start;
  const average = (points) => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  });
  const before = average(startPoints), after = average(currentPoints);
  const distance = (points) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const ratio = startPoints.length > 1
    ? distance(currentPoints) / Math.max(1, distance(startPoints)) : 1;
  const zoom = clamp(start.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
  const oldSide = Math.min(start.width, start.height) / start.zoom;
  const newSide = Math.min(start.width, start.height) / zoom;
  const focusX = start.centerX + (before.x / viewportSize - .5) * oldSide;
  const focusY = start.centerY + (before.y / viewportSize - .5) * oldSide;
  return normalized(start.width, start.height, zoom,
    focusX - (after.x / viewportSize - .5) * newSide,
    focusY - (after.y / viewportSize - .5) * newSide);
}

export function cropLayout(crop, viewportSize) {
  const side = Math.min(crop.width, crop.height) / crop.zoom;
  const scale = viewportSize / side;
  return { width: crop.width * scale, height: crop.height * scale,
    left: viewportSize / 2 - crop.centerX * scale,
    top: viewportSize / 2 - crop.centerY * scale };
}

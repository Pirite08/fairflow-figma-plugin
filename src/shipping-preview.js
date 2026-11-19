const MAX_IMAGE_DIMENSION = 720;
const MAX_IMAGE_BYTES = 384 * 1024;
const variants = [
  ["original", "원본"],
  ["minimal", "최소 수정"],
  ["layout", "비교 배치"]
];
const controls = [
  ["basic", "basicId", "일반배송 선택"],
  ["fast", "paidId", "빠른배송 선택"],
  ["continue", "continueId", "선택 없이 계속"]
];
const won = amount => String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";

function assertPage(api, id) {
  if (api.currentPage.id !== id) throw Error("검사한 페이지로 돌아간 뒤 다시 겹쳐보세요.");
}

function isWithin(node, ancestorId) {
  for (let current = node; current; current = current.parent) {
    if (current.id === ancestorId) return true;
  }
  return false;
}

function boundsOf(node) {
  const bounds = node.absoluteBoundingBox;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) {
    throw Error("미리보기에 필요한 프레임 또는 레이어의 위치를 읽을 수 없습니다.");
  }
  return bounds;
}

function clip(bounds, area) {
  const x = Math.max(bounds.x, area.x);
  const y = Math.max(bounds.y, area.y);
  return {
    x, y,
    width: Math.min(bounds.x + bounds.width, area.x + area.width) - x,
    height: Math.min(bounds.y + bounds.height, area.y + area.height) - y
  };
}

function normalizedBounds(control, frame, frameBounds) {
  let bounds = boundsOf(control);
  let withinFrame = false;
  for (let current = control; current; current = current.parent) {
    if (current.id === frame.id) {
      withinFrame = true;
      break;
    }
    if (current.visible === false || current.opacity === 0) break;
    if (current !== control && current.clipsContent) bounds = clip(bounds, boundsOf(current));
  }
  bounds = clip(bounds, frameBounds);
  if (!withinFrame || bounds.width <= 0 || bounds.height <= 0)
    throw Error("배송 옵션 또는 주문 버튼이 프레임 안에서 보이는지 확인하세요.");
  return {
    x: (bounds.x - frameBounds.x) / frameBounds.width,
    y: (bounds.y - frameBounds.y) / frameBounds.height,
    width: bounds.width / frameBounds.width,
    height: bounds.height / frameBounds.height
  };
}

function moved(before, after, frame) {
  return Math.abs(before.x - after.x) * frame.width > 1 ||
    Math.abs(before.y - after.y) * frame.height > 1 ||
    Math.abs(before.width - after.width) * frame.width > 1 ||
    Math.abs(before.height - after.height) * frame.height > 1;
}

function markersFor(original, column) {
  if (column.key === "original") return [];
  const markers = [];
  for (const [index, spot] of column.hotspots.entries()) {
    const { key, x, y, width, height } = spot;
    const beforeSpot = original.hotspots[index];
    const before = { x: beforeSpot.x, y: beforeSpot.y, width: beforeSpot.width, height: beforeSpot.height };
    const relocated = moved(before, spot, column.frame);
    const defaultChanged = original.defaultOption !== column.defaultOption;
    const selected = key === column.defaultOption;
    const originalTotal = original[original.defaultOption + "Total"];
    const total = column[column.defaultOption + "Total"];
    const details = [];
    if (key === "continue") {
      if (defaultChanged || total !== originalTotal)
        details.push("별도 선택 없이 계속하면 주문 합계가 " + won(originalTotal) + "에서 " + won(total) + "으로 바뀝니다.");
    } else if (defaultChanged) {
      details.push((key === "basic" ? "일반배송" : "빠른배송") +
        (selected ? "이 기본으로 선택됩니다." : "의 기본 선택을 해제합니다."));
    }
    if (relocated) details.push("원본과 비교해 화면에서 위치 또는 크기가 바뀌었습니다.");
    if (!details.length) continue;
    markers.push({
      key,
      label: key === "continue" ? "기본 주문 경로" : key === "basic" ? "일반배송" : "빠른배송",
      detail: details.join(" "),
      nodeId: column.nodes[index].id,
      x, y, width, height,
      ...(relocated ? { from: before } : {})
    });
  }
  return markers;
}

function sameReceipt(column, spec) {
  return column.frameId === spec.shippingFrameId && column.fastReviewId === spec.fastReviewId &&
    column.basicReviewId === spec.basicReviewId &&
    new Set([spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId]).size === 3;
}

async function loadColumn(api, column, label, pageId) {
  const spec = column?.spec;
  if (!spec || spec.pageId !== pageId || !sameReceipt(column, spec) ||
      !["fast", "basic"].includes(spec.defaultOption) ||
      ![spec.fastTotal, spec.basicTotal, spec.fastFee, spec.basicFee].every(Number.isSafeInteger)) {
    throw Error("배송 방법과 주문 화면의 연결·금액을 다시 검사한 뒤 겹쳐보세요.");
  }
  const frameIds = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
  const controlIds = controls.map(([, field]) => spec[field]);
  const nodes = await Promise.all([...frameIds, ...controlIds].map(id => api.getNodeByIdAsync(id)));
  if (nodes.some(node => !node || node.removed || !isWithin(node, pageId)))
    throw Error("겹쳐볼 배송 화면이나 근거 레이어가 변경되었습니다. 다시 검사하세요.");
  const frames = nodes.slice(0, frameIds.length);
  for (const frame of frames) {
    const transform = frame.absoluteTransform;
    if (frame.type !== "FRAME" || frame.visible === false || frame.opacity === 0 ||
        (transform && (Math.abs(transform[0][1]) > 0.001 || Math.abs(transform[1][0]) > 0.001 ||
          transform[0][0] <= 0 || transform[1][1] <= 0))) {
      throw Error("겹쳐보기는 회전하지 않은 가시 프레임에서 사용할 수 있습니다.");
    }
  }
  const frameBounds = boundsOf(frames[0]);
  const hotspots = controls.map(([key, , actionLabel], index) => ({
    key, label: actionLabel, ...normalizedBounds(nodes[index + frames.length], frames[0], frameBounds)
  }));
  return { column, label, frames, nodes: nodes.slice(frames.length), hotspots };
}

async function exportImage(api, frame, pageId) {
  assertPage(api, pageId);
  if (frame.removed) throw Error("미리보기를 만드는 동안 프레임이 삭제되었습니다.");
  const { width, height } = boundsOf(frame);
  let scale = Math.min(2, MAX_IMAGE_DIMENSION / Math.max(width, height));
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = await frame.exportAsync({
      format: "PNG", contentsOnly: true, useAbsoluteBounds: true,
      constraint: { type: "SCALE", value: scale }
    });
    assertPage(api, pageId);
    if (!bytes?.length) break;
    if (bytes.length <= MAX_IMAGE_BYTES) return { id: frame.id, width, height, png: api.base64Encode(bytes) };
    scale *= Math.min(0.8, Math.sqrt(MAX_IMAGE_BYTES / bytes.length) * 0.9);
  }
  throw Error("프레임의 PNG를 미리보기 크기로 만들 수 없습니다.");
}

export function renderShippingFrame(api, frame) {
  const pageId = api.currentPage.id;
  if (!frame || frame.type !== "FRAME" || !isWithin(frame, pageId))
    throw Error("검사한 페이지의 프레임에서 미리보기를 다시 만드세요.");
  return exportImage(api, frame, pageId);
}

export async function renderShippingPreview(api, columns) {
  const pageId = api.currentPage.id;
  // Read all anchors first so missing or stale layers do not trigger expensive exports.
  const candidates = await Promise.all(variants.map(([key, label]) =>
    loadColumn(api, columns.find(column => column.key === key), label, pageId)));
  const preview = [];
  for (const candidate of candidates) {
    const { column, label, frames, hotspots, nodes } = candidate;
    const [deliveryFrame, fastFrame, basicFrame] = frames;
    const frame = await exportImage(api, deliveryFrame, pageId);
    const fast = await exportImage(api, fastFrame, pageId);
    const basic = await exportImage(api, basicFrame, pageId);
    const { defaultOption, fastTotal, basicTotal, fastFee, basicFee } = column.spec;
    const data = {
      key: column.key, label, frame, receipts: { fast, basic }, hotspots,
      defaultOption, fastTotal, basicTotal, fastFee, basicFee, status: column.status
    };
    preview.push({ ...data, markers: markersFor(preview[0], { ...data, nodes }) });
  }
  return { columns: preview };
}

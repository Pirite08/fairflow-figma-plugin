const GUTTER = 96;

export function canvasBounds(node) {
  return node.absoluteBoundingBox || { x: node.x, y: node.y, width: node.width, height: node.height };
}

export function positionOnCanvas(node, x, y) {
  const rect = canvasBounds(node);
  node.x += x - rect.x;
  node.y += y - rect.y;
}

export function roomToRight(existing, x, y, width, height) {
  for (const rect of existing.map(canvasBounds).sort((a, b) => a.x - b.x)) {
    if (
      rect.y + rect.height + GUTTER <= y || rect.y >= y + height + GUTTER ||
      rect.x + rect.width + GUTTER <= x || rect.x >= x + width + GUTTER
    ) continue;
    x = rect.x + rect.width + GUTTER;
  }
  return x;
}

function indexCopy(source, copy, byId, sources) {
  if (source.type !== copy.type) throw Error("복제한 레이어의 구조가 원본과 달라 연결을 유지할 수 없습니다.");
  byId.set(source.id, copy);
  sources.push(source);
  const original = source.children || [];
  const cloned = copy.children || [];
  if (original.length !== cloned.length) throw Error("복제한 레이어의 구조가 원본과 달라 연결을 유지할 수 없습니다.");
  for (let index = 0; index < original.length; index++) indexCopy(original[index], cloned[index], byId, sources);
}

function mapAction(action, byId) {
  if (action.type === "CONDITIONAL") {
    return { ...action, conditionalBlocks: action.conditionalBlocks.map(block => ({
      ...block, actions: block.actions.map(next => mapAction(next, byId))
    })) };
  }
  const destination = action.type === "NODE" && byId.get(action.destinationId);
  return destination ? { ...action, destinationId: destination.id } : action;
}

async function wireCopies(sources, byId) {
  for (const source of sources) {
    if (!source.reactions?.length) continue;
    const copy = byId.get(source.id);
    const reactions = source.reactions.map(reaction => ({
      trigger: reaction.trigger,
      actions: (reaction.actions || (reaction.action ? [reaction.action] : [])).map(action => mapAction(action, byId))
    }));
    const originalCopy = (copy.reactions || []).map(reaction => ({ trigger: reaction.trigger, actions: reaction.actions }));
    if (JSON.stringify(reactions) !== JSON.stringify(originalCopy)) await copy.setReactionsAsync(reactions);
  }
}

function arrangeBoard(existing, source, columns) {
  const anchor = canvasBounds(source);
  const widths = columns.map(column => Math.max(...column.map(frame => canvasBounds(frame).width)));
  const height = Math.max(...columns.map(column =>
    column.reduce((total, frame) => total + canvasBounds(frame).height + GUTTER, -GUTTER)));
  const width = widths.reduce((total, size) => total + size + GUTTER, -GUTTER);
  let x = roomToRight(existing, anchor.x + anchor.width + GUTTER, anchor.y, width, height);
  for (const [index, column] of columns.entries()) {
    let y = anchor.y;
    for (const frame of column) {
      positionOnCanvas(frame, x, y);
      y += canvasBounds(frame).height + GUTTER;
    }
    x += widths[index] + GUTTER;
  }
}

// Clone a source snapshot and two independent prototype journeys. An adapter
// only edits nodes in its own copies. All created frames are removed on error.
export async function cloneProposal(api, spec, editVariant) {
  const page = api.currentPage;
  if (page.id !== spec.pageId) throw Error("검사한 페이지에서 수정안을 만들어 주세요.");
  const ids = [...new Set([spec.frameId, ...spec.frameIds])];
  const source = await Promise.all(ids.map(id => api.getNodeByIdAsync(id)));
  if (source.some(frame => !frame || frame.removed || frame.type !== "FRAME" || frame.parent?.id !== page.id)) {
    throw Error("수정할 여정의 화면이 모두 같은 페이지의 최상위 프레임이어야 합니다.");
  }
  const existing = page.children.slice();
  const owned = [];
  const names = new Set(existing.map(node => node.name));
  function copyFrame(frame, label) {
    const copied = frame.clone();
    owned.push(copied);
    const title = frame.name + " · " + label;
    let name = title;
    let index = 2;
    while (names.has(name)) name = title + " " + index++;
    names.add(name);
    copied.name = name;
    copied.locked = false;
    return copied;
  }

  try {
    const reference = copyFrame(source[0], "원본 · 생성 시점");
    const referenceById = new Map(), referenceSources = [];
    indexCopy(source[0], reference, referenceById, referenceSources);
    await wireCopies(referenceSources, referenceById);
    const result = { referenceFrameId: reference.id };
    const columns = [[reference]];
    const starts = [];
    for (const [kind, label] of [["minimal", "최소 수정안"], ["layout", "배치 변경안"]]) {
      const copies = source.map(node => copyFrame(node, label));
      columns.push(copies);
      const byId = new Map(), sources = [];
      for (const [index, node] of source.entries()) indexCopy(node, copies[index], byId, sources);
      await wireCopies(sources, byId);
      const frame = id => byId.get(id);
      const getNode = (sourceFrameId, nodeId) => {
        const node = byId.get(nodeId);
        for (let cursor = node; cursor; cursor = cursor.parent) {
          if (cursor.id === byId.get(sourceFrameId)?.id) return node;
          if (cursor.type === "PAGE") break;
        }
        throw Error("수정할 레이어를 복제한 여정에서 찾을 수 없습니다.");
      };
      await editVariant({ kind, frame, getNode, own: node => { owned.push(node); return node; } });
      result[kind] = { frameId: copies[0].id };
      starts.push({ nodeId: copies[0].id, name: copies[0].name });
    }
    if (api.currentPage.id !== page.id) throw Error("수정안을 만드는 동안 페이지가 바뀌었습니다.");
    arrangeBoard(existing, source[0], columns);
    const generated = new Set(owned.map(node => node.id));
    page.flowStartingPoints = [...page.flowStartingPoints.filter(point => !generated.has(point.nodeId)), ...starts];
    return result;
  } catch (error) {
    for (const node of owned.reverse()) if (!node.removed) node.remove();
    throw error;
  }
}

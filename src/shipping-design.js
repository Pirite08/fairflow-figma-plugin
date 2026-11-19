import { isSelectionProperty, parseSelection } from "./reader.js";
import { canvasBounds as box, positionOnCanvas as position, roomToRight } from "./proposal-frames.js";

const GUTTER = 96;

async function setChoice(instance, desired) {
  if (instance.type !== "INSTANCE") throw Error("배송 선택 상태를 바꿀 컴포넌트 인스턴스를 찾을 수 없습니다.");
  const candidates = Object.entries(instance.componentProperties).filter(
    ([key, property]) =>
      isSelectionProperty(key) &&
      ["BOOLEAN", "VARIANT"].includes(property.type) &&
      parseSelection(property.value) !== undefined,
  );
  if (candidates.length !== 1) throw Error("배송 컴포넌트의 선택 속성을 하나로 특정할 수 없습니다.");
  const [key, property] = candidates[0];
  let value = desired;
  if (property.type === "VARIANT") {
    const component = await instance.getMainComponentAsync();
    const set = component?.parent;
    const values = set?.type === "COMPONENT_SET" ? set.variantGroupProperties[key]?.values || [] : [];
    const matches = values.filter((v) => parseSelection(v) === desired);
    if (matches.length !== 1) throw Error("이 컴포넌트의 선택·해제 변형을 확정할 수 없습니다.");
    value = matches[0];
  }
  instance.setProperties({ [key]: value });
  if (parseSelection(instance.componentProperties[key]?.value) !== desired)
    throw Error("배송 선택 상태를 적용하지 못했습니다.");
}

function pathInFrame(node, frame) {
  const path = [];
  for (let current = node; current?.id !== frame.id; current = current.parent) {
    const parent = current?.parent;
    if (!parent || parent.type === "PAGE") throw Error("배송 선택 화면에 속하지 않는 레이어가 있습니다.");
    const index = parent.children.findIndex((child) => child.id === current.id);
    if (index < 0) throw Error("배송 레이어의 위치가 변경되었습니다.");
    path.unshift(index);
  }
  return path;
}

function atPath(frame, path) {
  return path.reduce((node, index) => node.children[index], frame);
}

function pageOf(node) {
  while (node && node.type !== "PAGE") node = node.parent;
  return node;
}

function compareOptions(api, paid, basic, owned) {
  const parent = paid.parent;
  if (!parent || basic.parent?.id !== parent.id || !["FRAME", "GROUP"].includes(parent.type)) {
    throw Error("비교 배치를 만들려면 두 배송 옵션이 같은 편집 가능한 컨테이너에 있어야 합니다.");
  }
  for (let ancestor = parent; ancestor && ancestor.type !== "PAGE"; ancestor = ancestor.parent) {
    if (ancestor.type === "INSTANCE") throw Error("인스턴스 내부의 레이어는 비교 배치로 옮길 수 없습니다.");
  }
  const left = Math.min(paid.x, basic.x),
    top = Math.min(paid.y, basic.y);
  const width = Math.max(paid.x + paid.width, basic.x + basic.width) - left;
  const height = Math.max(paid.y + paid.height, basic.y + basic.height) - top;
  if ([paid, basic].some((n) => Math.abs(n.rotation || 0) > 0.01))
    throw Error("회전한 배송 옵션은 비교 배치로 묶을 수 없습니다.");
  const paidIndex = parent.children.findIndex((n) => n.id === paid.id);
  const basicIndex = parent.children.findIndex((n) => n.id === basic.id);
  const inAutoLayout = parent.layoutMode && parent.layoutMode !== "NONE";
  if (
    inAutoLayout &&
    (parent.layoutMode === "GRID" ||
      Math.abs(paidIndex - basicIndex) !== 1 ||
      [paid, basic].some((n) => n.layoutPositioning === "ABSOLUTE"))
  ) {
    throw Error("이 자동 레이아웃에서는 다른 요소를 유지하면서 배송 옵션을 묶을 수 없습니다.");
  }
  const stacked = Math.abs(basic.y - paid.y) >= Math.min(basic.height, paid.height) / 2;
  const free = stacked ? height - paid.height - basic.height : width - paid.width - basic.width;
  if (free < -1) throw Error("겹쳐 있는 배송 옵션은 비교 배치로 묶을 수 없습니다.");
  const spacing = Math.max(0, Math.min(8, Math.floor(free / 2)));
  const pad = Math.max(0, Math.min(6, Math.floor((free - spacing) / 2)));

  const wrapper = api.createFrame();
  owned.push(wrapper);
  parent.insertChild(Math.min(paidIndex, basicIndex), wrapper);
  wrapper.name = "배송 방법 비교";
  wrapper.fills = [];
  wrapper.strokes = [{ type: "SOLID", color: { r: 0.43, g: 0.51, b: 0.47 }, opacity: 0.55 }];
  wrapper.strokeAlign = "INSIDE";
  wrapper.cornerRadius = 12;
  wrapper.clipsContent = false;
  wrapper.layoutMode = stacked ? "VERTICAL" : "HORIZONTAL";
  wrapper.primaryAxisSizingMode = "FIXED";
  wrapper.counterAxisSizingMode = "FIXED";
  wrapper.resize(width, height);
  wrapper.paddingLeft = wrapper.paddingRight = stacked ? 4 : pad;
  wrapper.paddingTop = wrapper.paddingBottom = stacked ? pad : 2;
  wrapper.itemSpacing = spacing;
  wrapper.counterAxisAlignItems = "CENTER";
  wrapper.primaryAxisAlignItems = "CENTER";

  for (const choice of [basic, paid]) {
    wrapper.appendChild(choice);
    choice.layoutPositioning = "AUTO";
    if (stacked) {
      choice.layoutSizingHorizontal = "FILL";
      choice.layoutSizingVertical = "FIXED";
    } else {
      choice.layoutSizingHorizontal = "FILL";
      choice.layoutSizingVertical = "FILL";
    }
  }
  if (!inAutoLayout) {
    wrapper.x = left;
    wrapper.y = top;
  }
}

// Work from the copied reactions, including any nested label used as a hotspot.
// Only the default continuation changes its destination. Other reactions keep
// their triggers, transitions and unrelated destinations.
async function wireCopies(frames, controls, destinations, fastId, basicId, defaultId = basicId) {
  const desired = new Map([
    [controls.paid.id, fastId],
    [controls.basic.id, basicId],
    [controls.next.id, defaultId],
  ]);
  const found = new Set();
  const receipts = new Set([fastId, basicId]);
  function remap(action, scope, onClick) {
    if (action.type === "CONDITIONAL") {
      const blocks = action.conditionalBlocks.map((block) => {
        const actions = block.actions.map((a) => remap(a, null, false));
        return actions.some((a, i) => a !== block.actions[i]) ? { ...block, actions } : block;
      });
      return blocks.some((b, i) => b !== action.conditionalBlocks[i])
        ? { ...action, conditionalBlocks: blocks }
        : action;
    }
    if (action.type !== "NODE") return action;
    let id = destinations.get(action.destinationId) || action.destinationId;
    if (scope && onClick && action.navigation === "NAVIGATE" && receipts.has(id)) {
      found.add(scope);
      id = desired.get(scope);
    }
    return id === action.destinationId ? action : { ...action, destinationId: id };
  }
  async function visit(node, scope) {
    if (desired.has(node.id)) scope = node.id;
    const original = node.reactions || [];
    const reactions = original.map((r) => {
      const actions = r.actions || (r.action ? [r.action] : []);
      const mapped = actions.map((a) => remap(a, scope, r.trigger?.type === "ON_CLICK"));
      return mapped.some((a, i) => a !== actions[i]) ? { trigger: r.trigger, actions: mapped } : r;
    });
    if (reactions.some((r, i) => r !== original[i])) await node.setReactionsAsync(reactions);
    for (const child of node.children || []) await visit(child, scope);
  }
  for (const frame of frames) await visit(frame, null);
  // A swapped variant can omit the original hotspot. Add a native click to the
  // copied row if there is no competing click action at that row.
  for (const control of [controls.paid, controls.basic, controls.next]) {
    if (found.has(control.id)) continue;
    if ((control.reactions || []).some((r) => r.trigger?.type === "ON_CLICK"))
      throw Error("배송 버튼의 클릭 동작을 안전하게 연결할 수 없습니다.");
    const click = {
      trigger: { type: "ON_CLICK" },
      actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId: desired.get(control.id), transition: null }],
    };
    await control.setReactionsAsync([...(control.reactions || []), click]);
  }
}

export async function createShippingDesigns(api, spec) {
  const page = api.currentPage;
  if (page.id !== spec.pageId) throw Error("검사한 페이지로 돌아가서 다시 실행하세요.");
  const keys = [
    "shippingFrameId",
    "fastReviewId",
    "basicReviewId",
    "paidId",
    "basicId",
    "paidSelectionId",
    "basicSelectionId",
    "continueId",
  ];
  const nodes = await Promise.all(keys.map((key) => api.getNodeByIdAsync(spec[key])));
  if (nodes.some((n) => !n || n.removed || pageOf(n)?.id !== page.id))
    throw Error("원본 배송 여정이 변경되었습니다. 다시 검사하세요.");
  const [shipping, fastReview, basicReview, paid, basic, paidSelection, basicSelection, next] = nodes;
  if (
    [shipping, fastReview, basicReview].some((n) => n.type !== "FRAME") ||
    new Set([shipping.id, fastReview.id, basicReview.id]).size !== 3 ||
    new Set([paid.id, basic.id, next.id]).size !== 3
  ) {
    throw Error("서로 다른 배송 선택 화면과 두 확인 화면이 필요합니다.");
  }
  pathInFrame(paidSelection, paid);
  pathInFrame(basicSelection, basic);
  const paths = [paid, basic, paidSelection, basicSelection, next].map((node) => pathInFrame(node, shipping));
  const existing = page.children.slice(),
    existingNames = new Set(existing.map((n) => n.name));
  const baseLabels = ["원본 · 생성 시점", "최소 수정안", "비교 배치안"];
  const nameSet = (number) =>
    baseLabels.map((label) => shipping.name + " · " + label + (number > 1 ? " " + number : ""));
  let number = 1,
    labels = nameSet(number);
  while (
    labels.some((label) =>
      [label, label + " · 빠른배송 확인", label + " · 일반배송 확인"].some((name) => existingNames.has(name)),
    )
  )
    labels = nameSet(++number);

  const originals = [shipping, fastReview, basicReview],
    rects = originals.map(box);
  const column = Math.max(...rects.map((r) => r.width)) + GUTTER,
    y = rects[0].y;
  const boardWidth = 2 * column + Math.max(...rects.map((r) => r.width));
  const boardHeight = rects.reduce((total, r) => total + r.height, 2 * GUTTER);
  const x = roomToRight(existing, rects[0].x + rects[0].width + GUTTER, y, boardWidth, boardHeight);

  const owned = [];
  function copy(source, name, x, y) {
    const clone = source.clone();
    owned.push(clone);
    if (clone.parent?.id !== page.id) page.appendChild(clone);
    clone.name = name;
    position(clone, x, y);
    return clone;
  }

  try {
    const reference = copy(shipping, labels[0], x, y);
    const [referencePaid, referenceBasic, , , referenceNext] = paths.map((path) => atPath(reference, path));
    await wireCopies(
      [reference],
      { paid: referencePaid, basic: referenceBasic, next: referenceNext },
      new Map(),
      fastReview.id,
      basicReview.id,
      spec.defaultOption === "fast" ? fastReview.id : basicReview.id,
    );
    const results = { referenceFrameId: reference.id };
    const starts = [];
    for (const [index, kind] of ["minimal", "layout"].entries()) {
      const left = x + (index + 1) * column,
        label = labels[index + 1];
      const frame = copy(shipping, label, left, y);
      const fast = copy(fastReview, label + " · 빠른배송 확인", left, y + rects[0].height + GUTTER);
      const normal = copy(
        basicReview,
        label + " · 일반배송 확인",
        left,
        y + rects[0].height + rects[1].height + 2 * GUTTER,
      );
      const [paidRow, basicRow, paidState, basicState, continueButton] = paths.map((path) => atPath(frame, path));
      await setChoice(paidState, false);
      await setChoice(basicState, true);
      const dest = new Map([
        [shipping.id, frame.id],
        [fastReview.id, fast.id],
        [basicReview.id, normal.id],
      ]);
      await wireCopies(
        [frame, fast, normal],
        { paid: paidRow, basic: basicRow, next: continueButton },
        dest,
        fast.id,
        normal.id,
      );
      if (kind === "layout") compareOptions(api, paidRow, basicRow, owned);
      starts.push({ nodeId: frame.id, name: label });
      results[kind] = { frameId: frame.id, fastReviewId: fast.id, basicReviewId: normal.id };
    }
    if (api.currentPage.id !== page.id) throw Error("디자인을 만드는 동안 페이지가 변경되었습니다.");
    const generatedIds = new Set(owned.map((n) => n.id));
    page.flowStartingPoints = [...page.flowStartingPoints.filter((p) => !generatedIds.has(p.nodeId)), ...starts];
    return results;
  } catch (error) {
    for (const node of owned.reverse()) if (!node.removed) node.remove();
    throw error;
  }
}

import { cloneProposal } from "./proposal-frames.js";
import { luminance } from "./analyze.js";

const pattern = "misleading_visual_hierarchy";
const plainText = text => text.trim().replace(/\s+/g, " ");

export function readHierarchyProposal(journey, findings, pageId) {
  if (journey.warnings?.length) return null;
  const states = new Map(journey.states.map(state => [state.state_id, state]));
  const outgoing = new Map();
  for (const edge of journey.transitions) {
    if (!outgoing.has(edge.from_state_id)) outgoing.set(edge.from_state_id, []);
    outgoing.get(edge.from_state_id).push(edge);
  }
  const candidates = [];
  for (const finding of findings) {
    if (finding.pattern !== pattern || finding.evidence.length !== 2) continue;
    const [paidRef, basicRef] = finding.evidence;
    if (paidRef.state_id !== basicRef.state_id || paidRef.node_id === basicRef.node_id) continue;
    const start = states.get(paidRef.state_id);
    if (!start) continue;
    // The analyzer emits the promoted action first, then the basic action.
    const choices = [paidRef, basicRef].map(({node_id}, index) => {
      const control = start.nodes.find(node => node.node_id === node_id);
      const edges = (outgoing.get(start.state_id) || []).filter(edge => edge.action.node_id === node_id);
      if (!control || control.enabled === false || edges.length !== 1 ||
          edges[0].uncertain || edges[0].action.type !== "click") return null;
      const destination = states.get(edges[0].to_state_id);
      if (!destination || destination.frame_id === start.frame_id) return null;
      return {
        control,
        stateId: destination.state_id,
        step: {
          key: index === 0 ? "paid" : "basic",
          label: plainText(control.text),
          detail: destination.name || "연결된 화면",
          frameId: destination.frame_id
        }
      };
    });
    if (choices.some(choice => !choice?.step.label) ||
        choices[0].step.frameId === choices[1].step.frameId) continue;
    // Clone the remainder of both button paths, including shared screens and loops.
    const path = new Set([start.state_id, ...choices.map(choice => choice.stateId)]);
    for (const id of path) {
      if (id === start.state_id) continue;
      for (const edge of outgoing.get(id) || []) {
        if (!edge.uncertain && edge.action.type === "click" && states.has(edge.to_state_id)) path.add(edge.to_state_id);
      }
    }
    candidates.push({
      pageId,
      frameId: start.frame_id,
      frameIds: [...path].map(id => states.get(id).frame_id),
      status: finding.status,
      steps: choices.map(choice => choice.step),
      controls: choices.map(choice => choice.control)
    });
  }
  return candidates.find(candidate => candidate.frameId === states.get(journey.entry_state_id)?.frame_id) ??
    (candidates.length === 1 ? candidates[0] : null);
}

function colorChannels(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || "")
    ? hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    : null;
}

function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return a === null || b === null ? 0 : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function textLabel(node, expected) {
  const labels = [];
  function walk(layer) {
    if (layer.visible === false || layer.opacity === 0) return;
    if (layer.type === "TEXT" && plainText(layer.characters) === expected) labels.push(layer);
    for (const child of layer.children || []) walk(child);
  }
  walk(node);
  if (labels.length !== 1) throw Error("버튼에서 수정할 문구 레이어를 하나로 특정할 수 없습니다.");
  return labels[0];
}

function applyColor(node, hex, palette) {
  const [r, g, b] = colorChannels(hex);
  // Preserve the original resolved solid paint, including its variable binding
  // if the chosen color already exists on one of the source button layers.
  const paint = palette.find(p => p.type === "SOLID" && p.visible !== false && (p.opacity ?? 1) === 1 &&
    (!p.blendMode || p.blendMode === "NORMAL") &&
    [p.color.r, p.color.g, p.color.b].every((c, i) => Math.round(c * 255) === Math.round([r, g, b][i] * 255)));
  node.fills = [paint || { type: "SOLID", color: { r, g, b } }];
}

const isAuto = node => Boolean(node?.layoutMode && node.layoutMode !== "NONE");
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

function blockSize(basic, paid, label) {
  const target = {
    x: basic.x,
    y: basic.y,
    width: Math.max(basic.width, paid.width, label.width + Math.max(10, label.x * 2)),
    height: Math.max(basic.height, paid.height, label.height + 8)
  };
  const parent = basic.parent;
  if (isAuto(parent) && basic.layoutPositioning !== "ABSOLUTE") return target;
  const before = { x: basic.x, y: basic.y, width: basic.width, height: basic.height };
  // Stop at neighboring layers that did not already enclose or overlap the control.
  for (const sibling of parent.children) {
    if (sibling.id === basic.id || sibling.visible === false || !overlaps(target, sibling) ||
        contains(sibling, target) || overlaps(before, sibling)) continue;
    const roomX = sibling.x - target.x, roomY = sibling.y - target.y;
    if (roomY >= before.height) target.height = Math.min(target.height, roomY);
    else if (roomX >= before.width) target.width = Math.min(target.width, roomX);
  }
  if (parent.clipsContent) {
    target.width = Math.min(target.width, parent.width - target.x);
    target.height = Math.min(target.height, parent.height - target.y);
  }
  if (target.width < label.width + 8 || target.height < label.height + 4 ||
      target.width * target.height < paid.width * paid.height * 0.45)
    throw Error("기존 배치에 기본 선택 버튼을 넓힐 공간이 부족합니다.");
  return target;
}

async function adjustBasic(api, paid, basic, strong, weak) {
  const paidLabel = textLabel(paid, plainText(strong.text));
  const label = textLabel(basic, plainText(weak.text));
  if (label.hasMissingFont || !label.fontName || typeof label.fontName !== "object" ||
      typeof paidLabel.fontSize !== "number" || typeof label.fontSize !== "number")
    throw Error("기본 선택 문구의 편집 가능한 단일 글꼴과 크기가 필요합니다.");
  await api.loadFontAsync(label.fontName);

  const strongStyle = strong.style || {}, weakStyle = weak.style || {};
  const originalBg = weakStyle.background_color;
  const palette = [paid, paidLabel, basic, label].flatMap(node => Array.isArray(node.fills) ? node.fills : []);
  let foreground = [weakStyle.text_color, strongStyle.background_color, strongStyle.text_color]
    .find(color => contrast(color, originalBg) >= 4.5);
  if (!foreground) {
    foreground = strongStyle.text_color;
    if (contrast(foreground, strongStyle.background_color) < 4.5)
      throw Error("두 버튼에서 읽기 쉬운 기존 글자색과 배경색을 찾을 수 없습니다.");
    applyColor(basic, strongStyle.background_color, palette);
  }
  if (foreground !== weakStyle.text_color) applyColor(label, foreground, palette);
  basic.opacity = 1;
  label.opacity = 1;
  label.fontSize = Math.max(label.fontSize, paidLabel.fontSize);
  if (label.lineHeight?.unit === "PIXELS" && label.lineHeight.value < label.fontSize)
    label.lineHeight = { unit: "AUTO" };
  const size = blockSize(basic, paid, label);
  basic.resize(size.width, size.height);
  if (basic.type === "FRAME" && !isAuto(basic) && label.parent?.id === basic.id)
    label.y = (basic.height - label.height) / 2;
}

function alignChoices(api, paid, basic, own) {
  const parent = paid.parent;
  if (!parent || parent.id !== basic.parent?.id || !["FRAME", "GROUP"].includes(parent.type))
    throw Error("두 버튼을 같은 편집 가능한 프레임이나 그룹에 두고 다시 실행하세요.");
  for (let ancestor = parent; ancestor && ancestor.type !== "PAGE"; ancestor = ancestor.parent) {
    if (ancestor.type === "INSTANCE") throw Error("인스턴스 내부의 버튼은 비교 배치로 옮길 수 없습니다.");
  }
  const indexes = [paid, basic].map(node => parent.children.findIndex(child => child.id === node.id));
  const auto = isAuto(parent);
  if (parent.layoutMode === "GRID" || [paid, basic].some(node => Math.abs(node.rotation || 0) > 0.01) ||
      (auto && (Math.abs(indexes[0] - indexes[1]) !== 1 ||
        [paid, basic].some(node => node.layoutPositioning === "ABSOLUTE"))))
    throw Error("현재 자동 레이아웃의 다른 요소를 유지하면서 두 버튼을 묶을 수 없습니다.");

  const stack = auto ? parent.layoutMode === "VERTICAL" :
    Math.abs(paid.y - basic.y) >= Math.min(paid.height, basic.height) / 2;
  const x = Math.min(paid.x, basic.x), y = Math.min(paid.y, basic.y);
  const width = Math.max(paid.x + paid.width, basic.x + basic.width) - x;
  const height = Math.max(paid.y + paid.height, basic.y + basic.height) - y;
  const availableGap = stack ? height - paid.height - basic.height : width - paid.width - basic.width;
  if (availableGap < -0.01) throw Error("겹쳐 있는 버튼을 비교 배치로 옮길 공간이 부족합니다.");
  const gap = Math.min(12, Math.max(0, availableGap));
  const row = own(api.createFrame());
  parent.insertChild(Math.min(...indexes), row);
  row.name = "선택지 비교";
  row.fills = [];
  row.layoutMode = stack ? "VERTICAL" : "HORIZONTAL";
  row.primaryAxisSizingMode = "FIXED";
  row.counterAxisSizingMode = "FIXED";
  row.resize(width, height);
  row.itemSpacing = gap;
  row.primaryAxisAlignItems = "CENTER";
  row.counterAxisAlignItems = "CENTER";
  for (const choice of [basic, paid]) {
    row.appendChild(choice);
    choice.layoutPositioning = "AUTO";
    choice.layoutSizingHorizontal = "FILL";
    choice.layoutSizingVertical = stack ? "FIXED" : "FILL";
  }
  if (!auto) {
    row.x = x;
    row.y = y;
  }
}

export function createHierarchyProposals(api, spec) {
  const [strong, weak] = spec.controls;
  return cloneProposal(api, spec, async ({kind, getNode, own}) => {
    const [paid, basic] = await Promise.all([strong, weak].map(control => getNode(spec.frameId, control.node_id)));
    if ([paid, basic].some(node => !node || !["FRAME", "INSTANCE"].includes(node.type)))
      throw Error("버튼의 프레임 또는 컴포넌트 인스턴스가 필요합니다.");
    await adjustBasic(api, paid, basic, strong, weak);
    if (kind === "layout") alignChoices(api, paid, basic, own);
  });
}

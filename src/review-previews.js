import { feeText, luminance, money, uncertainFee, won } from "./analyze.js";
import { renderShippingFrame } from "./shipping-preview.js";

const keys = ["original", "minimal", "layout"];
const numericPrice = /^(\s*(?:(?:₩|KRW)\s*)?)(\d{1,3}(?:,\d{3})+|\d+)(\s*원?\s*)$/i;
const included = /포함(?:됨|입니다|됩니다)?[.。)]?\s*$/;
const separateFee = /별도|추가\s*결제|미포함|불포함/;

function visibleOnPage(node, pageId) {
  for (let layer = node; layer; layer = layer.parent) {
    if (layer.visible === false || layer.opacity === 0 || layer.removed) return false;
    if (layer.type === "PAGE") return layer.id === pageId;
  }
  return false;
}

// Use the same bounded local PNG renderer as the shipping comparison. Previews
// are optional, so an unsupported or removed frame doesn't erase the proposal.
export async function renderReviewThumbnails(api, columns) {
  const pageId = api.currentPage.id;
  const thumbnails = Object.fromEntries(keys.map(key => [key, null]));
  const rendered = new Map();
  for (const key of keys) {
    const id = columns.find(column => column.key === key)?.frameId;
    if (!id) continue;
    if (api.currentPage.id !== pageId) break;
    try {
      if (!rendered.has(id)) {
        const frame = await api.getNodeByIdAsync(id);
        const thumbnail = api.currentPage.id === pageId && frame?.type === "FRAME" && visibleOnPage(frame, pageId)
          ? await renderShippingFrame(api, frame)
          : null;
        rendered.set(id, thumbnail);
      }
      thumbnails[key] = rendered.get(id);
    } catch {
      rendered.set(id, null);
    }
  }
  return api.currentPage.id === pageId ? thumbnails : Object.fromEntries(keys.map(key => [key, null]));
}

function contains(outer, inner) {
  return outer && inner && inner.width > 0 && inner.height > 0 &&
    inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5;
}

function visibleTextOnFrame(node, frameId, pageId, editable = false) {
  if (!node || node.type !== "TEXT" || node.removed || node.hasMissingFont) return false;
  let inFrame = false;
  const bounds = node.absoluteBoundingBox;
  for (let layer = node; layer; layer = layer.parent) {
    if (layer.visible === false || layer.opacity === 0 || (editable && layer.locked)) return false;
    if (layer.type === "PAGE") return inFrame && layer.id === pageId;
    if (layer !== node && (layer.id === frameId || layer.clipsContent) && !contains(layer.absoluteBoundingBox, bounds))
      return false;
    if (layer.id === frameId) inFrame = true;
  }
  return false;
}

function editableCharacters(layer) {
  const property = layer.componentPropertyReferences?.characters;
  let inInstance = false;
  for (let owner = layer.parent; owner && owner.type !== "PAGE"; owner = owner.parent) {
    if (owner.type !== "INSTANCE") continue;
    inInstance = true;
    if (property && owner.componentProperties?.[property]?.type === "TEXT") return true;
  }
  // Some instances permit overrides without a declared text property, which
  // can't be established reliably from the inspected layer alone.
  return !inInstance;
}

function readableFee(node) {
  const style = node.style;
  const fg = luminance(style?.text_color);
  const bg = luminance(style?.background_color);
  return (style?.opacity ?? 1) >= 0.8 && style?.font_size_px >= 12 && fg !== null && bg !== null &&
    (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 4.5;
}

function replacePrice(layer, firstAmount, finalAmount) {
  const match = layer.characters.match(numericPrice);
  if (!match || Number(match[2].replace(/,/g, "")) !== firstAmount || !Number.isFinite(layer.fontSize) ||
      typeof layer.fontName?.family !== "string" || layer.textTruncation === "ENDING" || /[\r\n]/.test(layer.characters))
    return null;
  const [, prefix, digits, suffix] = match;
  const newDigits = digits.includes(",") ? won(finalAmount).slice(0, -1) : String(finalAmount);
  const tabular = layer.openTypeFeatures?.TNUM === true ||
    /\b(?:mono|monospace|courier|consolas)\b/i.test(layer.fontName.family);
  // Preserve the numeral count and grouping, and require equal-width digits to
  // establish that only the characters need to change without writing the file.
  if (!tabular || digits.replace(/\d/g, "0") !== newDigits.replace(/\d/g, "0")) return null;
  return prefix + newDigits + suffix;
}

export async function editablePriceCopy(finding, journey, api) {
  if (finding?.pattern !== "drip_pricing" || finding.status !== "risk_signal" || journey.warnings?.length)
    return null;
  const { first, fee, firstAmount, finalAmount } = finding.pricing || {};
  if (!first || !fee?.label || !Number.isSafeInteger(firstAmount) || !Number.isSafeInteger(finalAmount) ||
      fee.amount <= 0 || firstAmount + fee.amount !== finalAmount) return null;
  const state = journey.states.find(item => item.state_id === first.state_id);
  const price = state?.nodes.find(item => item.node_id === first.node_id);
  if (price?.role !== "text") return null;
  const owner = price.control_node_id || price.parent_id;
  const existing = state.nodes.filter(node => node.node_id !== price.node_id && node.role === "text" &&
    (node.control_node_id || node.parent_id) === owner &&
    node.text.match(feeText)?.[0]?.replace(/\s/g, "") === fee.label.replace(/\s/g, "") &&
    money(node) === fee.amount && included.test(node.text) &&
    !uncertainFee.test(node.text) && !separateFee.test(node.text) && readableFee(node));
  if (!owner || existing.length !== 1) return null;

  const pageId = api.currentPage.id;
  try {
    const [layer, feeLayer] = await Promise.all([first.node_id, existing[0].node_id].map(id => api.getNodeByIdAsync(id)));
    if (api.currentPage.id !== pageId || !visibleTextOnFrame(layer, state.frame_id, pageId, true) ||
        !visibleTextOnFrame(feeLayer, state.frame_id, pageId) || !editableCharacters(layer) ||
        feeLayer.characters.trim() !== existing[0].text.trim()) return null;
    const after = replacePrice(layer, firstAmount, finalAmount);
    if (!after) return null;
    return {
      before: layer.characters.trim(), after: after.trim(),
      detail: '같은 화면에 이미 표시된 ‘' + feeLayer.characters.trim() + '’과 첫 가격을 맞춥니다.',
      nodeId: layer.id, stateId: first.state_id
    };
  } catch {
    return null;
  }
}

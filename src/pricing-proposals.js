import { feeText, joinPriceRows, money, offerPrice, totalText, uncertainFee, won } from "./analyze.js";
import { cloneProposal } from "./proposal-frames.js";

const normalized = value => value.replace(/\s/g, "");
const amountText = /(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi;

function directPath(journey, first, last) {
  const states = new Map(journey.states.map(state => [state.state_id, joinPriceRows(state)]));
  const path = [];
  const visited = new Set();
  for (let id = first; !visited.has(id);) {
    const state = states.get(id);
    if (!state || path.length >= 8) return null;
    path.push(state);
    if (id === last) return path.length >= 2 ? path : null;
    visited.add(id);
    const next = journey.transitions.filter(edge => edge.from_state_id === id);
    if (next.length !== 1 || next[0].uncertain || next[0].action.type !== "click") return null;
    id = next[0].to_state_id;
  }
  return null;
}

export function readPricingProposal(journey, findings, pageId) {
  if (!journey.flow_start_confirmed || journey.warnings?.length) return null;
  const reports = findings.filter(report => report.pattern === "drip_pricing" && report.pricing);
  if (reports.length !== 1) return null;
  const { pricing, status } = reports[0];
  const { first, checkout, fee, base, firstAmount, finalAmount, baseAmount } = pricing;
  if (!base || !fee.label) return null;
  const path = directPath(journey, first.state_id, checkout.state_id);
  if (!path) return null;
  const feeNodes = state => state.nodes.filter(node => {
    const label = node.text.match(feeText)?.[0];
    return label && normalized(label) === normalized(fee.label);
  });
  if (path.some(state => feeNodes(state).some(node => {
    const amount = money(node);
    return uncertainFee.test(node.text) || (amount != null && amount !== fee.amount);
  }))) return null;
  const screens = path.map((state, index) => {
    const label = state.name || (index === 0 ? "첫 가격" : "단계 " + (index + 1));
    const nodes = feeNodes(state);
    const feeShown = nodes.some(node => money(node) === fee.amount);
    const baseShown = state.nodes.some(node => /^상품\s*(?:가격|금액|소계)/.test(node.text) && money(node) === baseAmount);
    const headline = index === 0 ? offerPrice(state) || state.nodes.find(node => node.node_id === first.node_id)
      : index === path.length - 1 ? state.nodes.find(node => node.node_id === checkout.node_id)
      : offerPrice(state);
    const amount = headline ? money(headline) : null;
    const totalShown = amount === finalAmount || state.nodes.some(node => totalText.test(node.text) && money(node) === finalAmount);
    const priceDetail = amount == null ? "대표 가격 미표시" : "표시 가격 " + won(amount);
    const feeDetail = feeShown ? "필수 비용 " + won(fee.amount) : "필수 비용 금액 미표시";
    return {
      frameId: state.frame_id,
      label,
      feeShown,
      baseShown,
      totalShown,
      headlineId: headline?.node_id,
      cardId: headline?.offer_action_id,
      headingId: state.nodes.filter(node => node.role === "text" && node.text && money(node) == null)
        .sort((a, b) => (b.style?.font_size_px || 0) - (a.style?.font_size_px || 0))[0]?.node_id,
      amount,
      detail: priceDetail + " · " + feeDetail + (totalShown ? " · 포함 총액 표시" : "")
    };
  });
  const firstFee = screens.find(screen => screen.feeShown);
  const firstTotal = screens.find(screen => screen.totalShown);
  if (!firstFee || !firstTotal) return null;
  return {
    pageId,
    frameId: path[0].frame_id,
    frameIds: screens.map(screen => screen.frameId),
    status,
    summary: "필수 비용 " + won(fee.amount) + " 최초 표시: " + firstFee.label +
      " · 포함 총액 " + won(finalAmount) + " 최초 표시: " + firstTotal.label,
    steps: screens.map(({ frameId, label, detail }, index) => ({ key: "stage-" + index, label, detail, frameId })),
    screens,
    pricing
  };
}

function amountOf(text) {
  const values = text.match(amountText) || [];
  return values.length === 1 ? Number(values[0].replace(/\D/g, "")) : null;
}

function priceLabel(node, amount) {
  if (node.type === "TEXT" && amountOf(node.characters) === amount) return node;
  const matches = node.findAll?.(child =>
    child.type === "TEXT" && child.visible && amountOf(child.characters) === amount && !feeText.test(child.characters));
  return matches?.length === 1 ? matches[0] : null;
}

async function loadFont(api, layer) {
  if (layer.type !== "TEXT" || typeof layer.fontName !== "object" || layer.hasMissingFont)
    throw Error("가격 문구의 글꼴을 읽을 수 없습니다. 한 가지 글꼴을 사용한 텍스트 레이어를 지정하세요.");
  await api.loadFontAsync(layer.fontName);
}

function setInstanceProperty(layer, reference, type, value) {
  const property = layer.componentPropertyReferences?.[reference];
  if (!property) return false;
  for (let owner = layer.parent; owner && owner.type !== "PAGE"; owner = owner.parent) {
    if (owner.type === "INSTANCE" && owner.componentProperties[property]?.type === type) {
      owner.setProperties({ [property]: value });
      return true;
    }
  }
  return false;
}

async function setCopy(api, layer, characters) {
  await loadFont(api, layer);
  if (!setInstanceProperty(layer, "characters", "TEXT", characters)) layer.characters = characters;
  if (layer.characters !== characters) throw Error("가격 컴포넌트의 텍스트 속성을 바꿀 수 없습니다.");
}

async function reuseFeeCopy(api, card, price, fee, characters) {
  const matches = card.findAll?.(node => {
    if (node.type !== "TEXT" || node.id === price.id) return false;
    const kind = node.characters.match(feeText)?.[0];
    return kind && normalized(kind) === normalized(fee.label) &&
      /포함/.test(node.characters) && !uncertainFee.test(node.characters) &&
      amountOf(node.characters) == null;
  });
  if (matches?.length !== 1) return false;
  const copy = matches[0];
  for (let parent = copy.parent; parent && parent.id !== card.id; parent = parent.parent) {
    if (!parent.visible) return false;
  }
  await setCopy(api, copy, characters);
  if (!copy.visible && !setInstanceProperty(copy, "visible", "BOOLEAN", true)) copy.visible = true;
  if (!copy.visible) throw Error("가격 컴포넌트의 비용 안내를 표시할 수 없습니다.");
  return true;
}

function isInInstance(node) {
  for (let ancestor = node; ancestor && ancestor.type !== "PAGE"; ancestor = ancestor.parent) {
    if (ancestor.type === "INSTANCE") return true;
  }
  return false;
}

function placeBelow(block, anchor, screen) {
  for (let item = anchor; item && item.id !== screen.id; item = item.parent) {
    const parent = item.parent;
    if (!parent || parent.type !== "FRAME" || isInInstance(parent)) continue;
    if (parent.layoutMode === "VERTICAL" && item.layoutPositioning !== "ABSOLUTE") {
      const index = parent.children.findIndex(child => child.id === item.id);
      const right = parent.width - parent.paddingLeft - parent.paddingRight;
      if (block.width > right || (parent.primaryAxisSizingMode !== "AUTO" && parent.clipsContent)) continue;
      parent.insertChild(index + 1, block);
      return;
    }
    if (parent.layoutMode !== "NONE" || Math.abs(item.rotation || 0) > 0.01) continue;
    const x = Math.max(0, item.x);
    if (x + block.width > parent.width) continue;
    let y = item.y + item.height + 6;
    for (const sibling of [...parent.children].sort((a, b) => a.y - b.y)) {
      if (sibling.id === item.id || !sibling.visible || sibling.x >= x + block.width || sibling.x + sibling.width <= x) continue;
      if (sibling.y < y + block.height + 4 && sibling.y + sibling.height + 4 > y)
        y = sibling.y + sibling.height + 4;
    }
    if (y + block.height > parent.height) continue;
    parent.appendChild(block);
    block.x = x;
    block.y = y;
    return;
  }
  throw Error("가격 아래 안내 공간을 확보할 수 없습니다. 가격 주변 레이어의 여백을 확인하세요.");
}

async function disclosure(api, screen, anchor, rows, layout, feeStyle) {
  const block = api.createFrame();
  try {
    block.name = layout ? "포함 가격 내역" : "필수 비용 안내";
    block.layoutMode = "VERTICAL";
    block.primaryAxisSizingMode = "AUTO";
    block.counterAxisSizingMode = "AUTO";
    block.itemSpacing = layout ? 3 : 0;
    block.fills = layout && Array.isArray(feeStyle.parent?.fills) ? feeStyle.parent.fills : [];
    block.paddingLeft = block.paddingRight = layout ? 6 : 0;
    block.paddingTop = block.paddingBottom = layout ? 4 : 0;
    block.cornerRadius = layout ? 6 : 0;
    for (const { label, text, style } of rows) {
      await loadFont(api, style);
      const line = api.createText();
      block.appendChild(line);
      line.name = label;
      line.fontName = style.fontName;
      if (typeof style.fontSize === "number") line.fontSize = style.fontSize;
      if (style.textStyleId && typeof style.textStyleId === "string")
        await line.setTextStyleIdAsync(style.textStyleId);
      if (Array.isArray(style.fills)) line.fills = style.fills;
      line.characters = text;
    }
    placeBelow(block, anchor, screen);
  } catch (error) {
    if (!block.removed) block.remove();
    throw error;
  }
}

export function createPricingProposals(api, spec) {
  const { pricing, screens } = spec;
  return cloneProposal(api, spec, async ({ kind, frame, getNode }) => {
    const checkout = screens[screens.length - 1];
    const feeStyle = await getNode(checkout.frameId, pricing.fee.node_id);
    const baseStyle = await getNode(checkout.frameId, pricing.base.node_id);
    const totalStyle = await getNode(checkout.frameId, pricing.checkout.node_id);
    if ([feeStyle, baseStyle, totalStyle].some(node => node.type !== "TEXT"))
      throw Error("주문 화면에서 필수 비용과 상품 가격의 텍스트 레이어가 필요합니다.");
    for (const [index, screen] of screens.slice(0, -1).entries()) {
      const variantFrame = frame(screen.frameId);
      let price = null;
      if (screen.headlineId && [pricing.baseAmount, pricing.finalAmount].includes(screen.amount)) {
        const node = await getNode(screen.frameId, screen.headlineId);
        price = priceLabel(node, screen.amount);
        if (!price) throw Error("변경할 가격 텍스트를 하나로 특정할 수 없습니다.");
        if (screen.amount !== pricing.finalAmount)
          await setCopy(api, price, price.characters.replace(amountText, won(pricing.finalAmount)));
      }
      if (index === 0 && !price) throw Error("첫 가격 레이어를 확인할 수 없습니다.");
      if (index > 0 && kind !== "layout") continue;
      const anchor = price || (screen.headingId && await getNode(screen.frameId, screen.headingId));
      if (!anchor) continue;
      const rows = [];
      if (kind === "layout" && !screen.baseShown) {
        rows.push({ label: "상품 소계", text: "상품 소계 " + won(pricing.baseAmount), style: baseStyle });
      }
      if (!screen.feeShown) {
        const label = "필수 고정 " + pricing.fee.label + " " + won(pricing.fee.amount) + " 포함";
        const card = screen.cardId ? await getNode(screen.frameId, screen.cardId) : price?.parent;
        if (!(kind === "minimal" && card && await reuseFeeCopy(api, card, price, pricing.fee, label))) {
          rows.push({ label: "포함 필수 비용", text: label, style: feeStyle });
        }
      }
      if (!price && !screen.totalShown) {
        rows.push({ label: "포함 총액", text: "포함 총액 " + won(pricing.finalAmount), style: totalStyle });
      }
      if (rows.length) await disclosure(api, variantFrame, anchor, rows, kind === "layout", feeStyle);
    }
  });
}

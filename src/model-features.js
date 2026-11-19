import {feeText, joinPriceRows, luminance, money, offerPrice, totalText, uncertainFee} from "./analyze.js";

const preselection = "paid_option_preselection";
const hierarchy = "misleading_visual_hierarchy";
const pricing = "drip_pricing";

export const FEATURE_NAMES = {
  [preselection]: ["initial_checked_share", "explicit_paid_selection"],
  [hierarchy]: ["area_log_ratio", "font_log_ratio", "contrast_log_ratio", "basic_log_contrast", "opacity_difference", "basic_opacity"],
  [pricing]: ["price_increase_fraction", "first_price_matches_total", "required_fixed_fee_fraction", "fee_visible_at_first_price", "explicit_optional_selection"]
};

const isControl = node => ["radio", "checkbox", "switch", "toggle"].includes(node.role);
const isButton = node => ["button", "link"].includes(node.role);
const compact = text => text.replace(/[^\p{L}\d]/gu, "").toLowerCase();
const allFees = /배송비|빠른\s*배송|포장비|수수료|서비스\s*요금|발권비|이용료|처리비|접수비|발급비|관리비/;
const amountSyntax = /(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi;

function amount(node) {
  // The reader deliberately leaves ranges and multiple visible amounts unresolved.
  const text = node.text;
  if (/[\d,]\s*[~–-]\s*[₩\d]/.test(text) || text.match(amountSyntax)?.length !== 1) return null;
  return money(node) ?? Number(text.match(amountSyntax)[0].replace(/\D/g, ""));
}

function walk(graph, start, follow = () => true) {
  if (!start) return [];
  const states = [start];
  const seen = new Set(states);
  for (const state of states) {
    for (const edge of graph.next(state)) {
      if (edge.uncertain || seen.has(edge.destination) || !follow(state, edge)) continue;
      states.push(edge.destination);
      seen.add(edge.destination);
    }
  }
  return states;
}

function createGraph(input) {
  const byId = new Map(input.states.map(state => [state.state_id, joinPriceRows(state)]));
  const nodes = new Map([...byId.values()].map(state => [state, new Map(state.nodes.map(node => [node.node_id, node]))]));
  const edges = new Map([...byId.values()].map(state => [state, []]));
  for (const transition of input.transitions) {
    const source = byId.get(transition.from_state_id);
    const destination = byId.get(transition.to_state_id);
    const action = nodes.get(source)?.get(transition.action?.node_id);
    if (!action || action.enabled === false) continue;
    const uncertain = transition.uncertain || transition.action.type !== "click" || !destination;
    edges.get(source).push({action, destination, uncertain});
  }
  const entry = byId.get(input.entry_state_id);
  // Version 1 fixtures used entry_state_id to supply the prototype start.
  const confirmed = Boolean(entry && (input.flow_start_confirmed ?? true));
  const graph = {entry, confirmed, next: state => edges.get(state)};
  graph.states = walk(graph, entry);
  return graph;
}

const paidCue = /유료|빠른\s*배송|새벽\s*배송|보장\s*추가|(?:추가|부가|선택)\s*(?:옵션|서비스|보장|상품)|선물\s*포장|설치\s*옵션/;

function isPaidOption(node, state) {
  if (!isControl(node) || !(amount(node) > 0)) return false;
  const freeAlternative = state.nodes.some(other => other !== node && isControl(other) &&
    (amount(other) === 0 || /무료|추가\s*없음/.test(other.text)));
  return paidCue.test(node.text) || (/\+\s*(?:₩\s*)?\d/.test(node.text) && freeAlternative);
}

const optionName = node => compact(node.text.replace(amountSyntax, "").replace(/무료|선택\s*서비스|추가\s*요금/g, ""));
const mentionsOption = (node, option) => {
  const name = optionName(option);
  return name.length > 1 && optionName(node).includes(name);
};

function choosesOption(node, option) {
  return mentionsOption(node, option) && (isControl(node) ||
    (isButton(node) && amount(node) === amount(option) && /선택|추가|신청/.test(node.text)));
}

function optionFeatures(graph) {
  if (!graph.confirmed) return null;
  const initial = [];
  let explicit = false;
  for (const state of graph.states) {
    for (const option of state.nodes.filter(node => isPaidOption(node, state))) {
      // After a screen exposes the option, a later snapshot is not its default.
      const firstExposure = walk(graph, graph.entry, prior =>
        !prior.nodes.some(node => isControl(node) && mentionsOption(node, option)));
      if (firstExposure.includes(state)) {
        const beforeChoice = walk(graph, graph.entry, (prior, edge) =>
          !prior.nodes.some(node => isControl(node) && mentionsOption(node, option)) && !choosesOption(edge.action, option));
        if (beforeChoice.includes(state)) initial.push(option.checked);
      }
      if (option.checked === true && graph.states.some(prior => graph.next(prior).some(edge =>
        !edge.uncertain && edge.destination === state && edge.action.checked !== true && choosesOption(edge.action, option)))) {
        explicit = true;
      }
    }
  }
  if (initial.some(value => typeof value !== "boolean") || (!initial.length && !explicit)) return null;
  return [initial.length ? initial.filter(Boolean).length / initial.length : 0, Number(explicit)];
}

const basicCopy = /(?:기본|일반|표준).*(?:계속|진행|이용|선택)|(?:무료|그대로)로?\s*계속|(?:추가|가입|구매|동의)\s*없이|가입하지\s*않|나중에|거절|거부|해지|탈퇴|필수만|동의하지|건너뛰|구독\s*취소/;
const promotedCopy = /추가|전체\s*동의|가입|유료|구매|구독\s*유지|이용권\s*변경|혜택.*받|체험\s*시작|업그레이드|프리미엄|수락|허용|멤버십/;

function buttonMetrics(node) {
  const {text_color, background_color, font_size_px, opacity = 1} = node.style ?? {};
  const fg = luminance(text_color), bg = luminance(background_color);
  const {width, height} = node.bounds ?? {};
  if (fg === null || bg === null || ![font_size_px, width, height, opacity].every(Number.isFinite) ||
      font_size_px <= 0 || width <= 0 || height <= 0 || opacity < 0 || opacity > 1) return null;
  const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return {area: width * height, font: font_size_px, contrast, opacity};
}

function destinationOf(graph, state, node) {
  const links = graph.next(state).filter(edge => edge.action === node);
  const destinations = new Set(links.map(edge => edge.destination));
  return !links.some(edge => edge.uncertain) && destinations.size === 1 ? links[0].destination : null;
}

function hierarchyFeatures(graph) {
  const pairs = [];
  for (const state of graph.states) {
    const buttons = state.nodes.filter(isButton);
    const basics = buttons.filter(node => basicCopy.test(node.text));
    const promoted = buttons.filter(node => !basics.includes(node) && promotedCopy.test(node.text));
    if (!basics.length || !promoted.length) continue;
    if (basics.length !== 1 || promoted.length !== 1) return null;
    const strong = destinationOf(graph, state, promoted[0]);
    const weak = destinationOf(graph, state, basics[0]);
    const a = buttonMetrics(promoted[0]), b = buttonMetrics(basics[0]);
    if (!strong || !weak || strong === weak || !a || !b) return null;
    pairs.push([Math.log2(a.area / b.area), Math.log2(a.font / b.font), Math.log2(a.contrast / b.contrast),
      Math.log2(b.contrast), a.opacity - b.opacity, b.opacity]);
  }
  // Keep all measurements from a single pair when several linked screens contain choices.
  const emphasisGap = ([area, font, contrast, , opacity]) => [area, font, contrast, opacity]
    .reduce((total, difference) => total + Math.max(0, difference), 0);
  return pairs.sort((a, b) => emphasisGap(b) - emphasisGap(a))[0] ?? null;
}

const firstPriceNode = state => offerPrice({...state, nodes: state.nodes.filter(node =>
  !(allFees.test(node.text) && !feeText.test(node.text) && !/포함/.test(node.text)))});
const productLabel = state => state.nodes.find(node => /^(?:상품명|상품\s*코드|SKU)\s*[:：]/i.test(node.text))?.text.split(/[:：]/).slice(1).join(":").trim();
const feeKind = node => compact(node.text.match(allFees)?.[0] ?? "");

function explicitlySelected(graph, start, checkout, fee, followsOrder) {
  const sameFee = node => amount(node) === amount(fee) &&
    (mentionsOption(fee, node) || (feeKind(node) && feeKind(node) === feeKind(fee)));
  const choseFee = ({action, destination}) => isControl(action) && action.checked === false && sameFee(action) &&
    destination.nodes.some(node => isControl(node) && node.checked === true && sameFee(node));
  return !walk(graph, start, (state, edge) => followsOrder(state, edge) && !choseFee(edge)).includes(checkout);
}

function priceComparison(graph, start, first, checkout, total, followsOrder) {
  const firstAmount = amount(first), totalAmount = amount(total);
  if (firstAmount === null || !(totalAmount > 0) || firstAmount > totalAmount) return null;
  const fees = checkout.nodes.filter(node => node !== total && node.role === "text" && allFees.test(node.text) && amount(node) > 0);
  const baseAmounts = new Set(checkout.nodes.filter(node => node !== total && !allFees.test(node.text) &&
    /상품|기본\s*요금|소계|객실\s*요금|티켓\s*요금|이용권/.test(node.text) && amount(node) !== null).map(amount));
  const feeSum = fees.reduce((sum, fee) => sum + amount(fee), 0);
  const difference = totalAmount - firstAmount;
  if (baseAmounts.size > 1 || (baseAmounts.size === 1 && [...baseAmounts][0] + feeSum !== totalAmount) || difference > feeSum) return null;

  let required = 0, disclosed = 0, optedIn = 0;
  const relatedStates = walk(graph, start, followsOrder).filter(state => walk(graph, state, followsOrder).includes(checkout));
  for (const fee of fees) {
    const kind = feeKind(fee);
    const matches = node => feeKind(node) === kind;
    const description = relatedStates.flatMap(state => state.nodes.filter(matches).map(node => node.text)).join(" · ");
    const variable = uncertainFee.test(description) || /추후\s*(?:확정|안내)|별도\s*(?:결정|계산)|현장\s*결정/.test(description);
    const mandatory = /필수|의무|모든\s*(?:주문|구매|예약)|전\s*(?:고객|주문)/.test(description) && !variable;
    const fixed = /고정|정액|일괄|일률/.test(description) && !variable;
    const selected = !mandatory && explicitlySelected(graph, start, checkout, fee, followsOrder);
    if (mandatory && fixed) required += amount(fee);
    if (selected) optedIn += amount(fee);
    if (start.nodes.some(node => matches(node) && (amount(node) === amount(fee) || /포함/.test(node.text)))) disclosed += amount(fee);
  }
  if (difference > required + optedIn) return null;
  return pricingVector(firstAmount, totalAmount, feeSum, required, disclosed, optedIn);
}

function pricingFeatures(graph) {
  if (!graph.confirmed) return null;
  const totals = new Map();
  for (const state of graph.states) {
    const nodes = state.nodes.filter(node => totalText.test(node.text) && amount(node) !== null);
    if (nodes.length === 1) totals.set(state, nodes[0]);
  }
  const firstStates = walk(graph, graph.entry, state => !state.nodes.some(node => amount(node) !== null));
  const comparisons = [];
  for (const start of firstStates) {
    const first = firstPriceNode(start);
    if (!first || totals.has(start)) continue;
    const product = productLabel(start);
    const followsOrder = (state, {action, destination}) =>
      !(state === start && first.offer_action_id && action.node_id !== first.offer_action_id) &&
      !(product && productLabel(destination) && productLabel(destination) !== product) &&
      !/다른\s*(?:상품|요금제)/.test(action.text);
    for (const checkout of walk(graph, start, followsOrder)) {
      const total = totals.get(checkout);
      if (!total) continue;
      const comparison = priceComparison(graph, start, first, checkout, total, followsOrder);
      if (!comparison) return null;
      comparisons.push(comparison);
    }
  }
  // Compare a single complete order path at a time. Prefer the largest unexplained increase.
  const orderIncrease = ([increase, , , , selected]) => increase * (selected ? 0 : 1);
  return comparisons.sort((a, b) => orderIncrease(b) - orderIncrease(a))[0] ?? null;
}

export function pricingVector(first, total, feeSum, required, disclosed, optedIn) {
  const difference = total - first;
  return [difference / total, Number(!difference), required / total,
    feeSum ? disclosed / feeSum : 0, Number(optedIn > 0)];
}

export function extractModelFeatures(input, includePricing = true) {
  const graph = createGraph(input);
  const complete = !input.warnings?.length;
  const measures = {
    [preselection]: complete ? optionFeatures(graph) : null,
    [hierarchy]: complete ? hierarchyFeatures(graph) : null,
    [pricing]: complete && includePricing ? pricingFeatures(graph) : null
  };
  return Object.fromEntries(Object.entries(FEATURE_NAMES).map(([pattern, names]) => {
    const values = measures[pattern];
    const observed = Boolean(values?.every(Number.isFinite));
    return [pattern, {observed, values: observed ? values : names.map(() => 0)}];
  }));
}

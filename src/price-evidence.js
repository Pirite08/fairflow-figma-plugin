import { joinPriceRows, money, offerPrice, totalText, uncertainFee } from "./analyze.js";

const priceToken = /(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi;
const feeToken = /배송비|빠른\s*배송|포장비|수수료|서비스\s*요금|발권비|이용료|처리비|접수비|발급비|관리비/;
const baseCopy = /상품\s*(?:금액|소계|가|가격)|^상품\s|주문\s*금액|기본\s*요금|소계|객실\s*요금|티켓\s*요금|이용권/;
const choiceRoles = new Set(["radio", "checkbox", "switch", "toggle"]);
const mandatoryCopy = /필수|의무|모든\s*(?:주문|구매|예약)/;
const fixedCopy = /고정|정액|일괄|일률/;
const optionCopy = /선택\s*(?:사항|배송|추가)|배송\s*선택|선택\s*시|직접\s*선택/;
const amountsVary = /이상.*무료|미만|별도\s*(?:결정|계산)|추후\s*(?:확정|안내)|현장\s*결정|제주|도서산간/;
const excludedCopy = /미포함|불포함|포함\s*(?:여부|안\s*됨|되지\s*않)/;
const priceLabel = /\s*(?:정가|할인\s*전(?:\s*가격)?|판매가|할인가|쿠폰가)\s*[:：]?\s*$/;

function amount(node) {
  if (Number.isSafeInteger(node.amount_krw)) return node.amount_krw;
  if (/[\d,]\s*[~–-]\s*[₩\d]/.test(node.text)) return null;
  const matches = [...node.text.matchAll(priceToken)];
  return matches.length === 1 ? Number(matches[0][0].replace(/\D/g, "")) : null;
}

function priceRoles(node) {
  const matches = [...node.text.matchAll(priceToken)];
  if (!node.struck_ranges?.length || !matches.length || /[\d,]\s*[~–-]\s*[₩\d]/.test(node.text)) return node;
  const visible = matches.filter(match => {
    const firstDigit = match.index + match[0].search(/\d/);
    const lastDigit = match.index + match[0].search(/\d(?=\s*원?$)/);
    return !node.struck_ranges.some(([start, end]) => start <= firstDigit && end > lastDigit);
  });
  if (visible.length !== 1 || visible.length === matches.length) return visible.length ? node : null;
  const current = visible[0];
  const index = matches.indexOf(current);
  const from = index === 0 ? 0 : matches[index - 1].index + matches[index - 1][0].length;
  const next = matches[index + 1];
  const currentText = node.text.slice(from, next?.index ?? node.text.length);
  return {
    ...node,
    text: (next ? currentText.replace(priceLabel, "") : currentText).trim(),
    amount_krw: Number(current[0].replace(/\D/g, ""))
  };
}

function priceState(state) {
  const nodes = new Map(state.nodes.map(node => [node.node_id, node]));
  for (const layer of state.price_texts ?? []) nodes.set(layer.node_id, layer);
  return joinPriceRows({ ...state, nodes: [...nodes.values()].map(priceRoles).filter(Boolean) });
}

function identity(state) {
  const label = state.nodes.find(node => /^(?:상품명|상품\s*코드|SKU)\s*[:：]/i.test(node.text));
  return state.product_id || state.product_name || label?.text.split(/[:：]/).slice(1).join(":").replace(/\s+/g, "");
}

function reference(state, node) {
  return { state_id: state.state_id, node_id: node.node_id };
}

function findPath(journey) {
  if (journey.flow_start_confirmed === false || journey.warnings?.some(warning => warning.includes("한도")) ||
      (journey.warnings?.length && !journey.states.some(state => state.read_warnings?.length))) return null;
  const states = new Map(journey.states.map(state => [state.state_id, priceState(state)]));
  const outgoing = new Map();
  for (const transition of journey.transitions) {
    const edges = outgoing.get(transition.from_state_id) ?? [];
    edges.push(transition);
    outgoing.set(transition.from_state_id, edges);
  }
  const frames = [];
  const edges = [];
  const visited = new Set();
  let state = states.get(journey.entry_state_id);
  let first;
  let firstIndex = 0;
  let item;
  while (state && !visited.has(state.state_id)) {
    if (state.read_warnings?.length) return null;
    visited.add(state.state_id);
    frames.push(state);
    const stateItem = identity(state);
    if (item && stateItem && item !== stateItem) return null;
    item ??= stateItem;
    const totals = state.nodes.filter(node => totalText.test(node.text) && amount(node) !== null);
    if (totals.length) {
      const [total] = totals;
      if (first && totals.every(candidate => amount(candidate) === amount(total))) {
        return { first, firstIndex, total, frames, edges };
      }
      return null;
    }
    const displaysPrice = state.nodes.some(node => amount(node) !== null);
    if (!first && displaysPrice) {
      first = offerPrice(state);
      if (!first) return null;
      firstIndex = frames.length - 1;
    }
    const relevant = (outgoing.get(state.state_id) ?? []).filter(edge => {
      if (first?.offer_action_id && firstIndex === frames.length - 1 && edge.action.node_id !== first.offer_action_id) return false;
      const action = state.nodes.find(node => node.node_id === edge.action.node_id);
      return !/다른\s*(?:상품|요금제)/.test(action?.text ?? "");
    });
    if (relevant.length !== 1) return null;
    const [edge] = relevant;
    const action = state.nodes.find(node => node.node_id === edge.action.node_id);
    if (!action || action.enabled === false || edge.uncertain || edge.action.type !== "click") return null;
    edges.push({ edge, action });
    state = states.get(edge.to_state_id);
  }
  return null;
}

function feeKind(node) {
  return node.text.match(feeToken)?.[0].replace(/\s+/g, "");
}

function readFee(fee, path) {
  const { frames, edges, firstIndex } = path;
  const checkout = frames[frames.length - 1];
  const kind = feeKind(fee);
  const value = amount(fee);
  const matches = node => feeKind(node) === kind;
  const sameAmount = node => matches(node) && amount(node) === value;
  const optsIn = edges.some(({action}, index) => choiceRoles.has(action.role) &&
    action.checked === false && sameAmount(action) && frames[index + 1].nodes.some(node =>
      choiceRoles.has(node.role) && node.checked === true && sameAmount(node)));
  const description = frames.flatMap(state => state.nodes.filter(matches).map(node => node.text)).join(" · ");
  const conditional = uncertainFee.test(description) || amountsVary.test(description);
  const mandatory = mandatoryCopy.test(description);
  const optional = optsIn || optionCopy.test(description);
  const required = mandatory && !optional && !conditional ? true : optional && !mandatory ? false : null;
  const firstDisplay = state => state.nodes.find(node =>
    sameAmount(node) || (matches(node) && /포함/.test(node.text) && !excludedCopy.test(node.text)));
  const offerState = frames[firstIndex];
  const firstShownState = frames.slice(firstIndex).find(state => firstDisplay(state));
  const shown = firstShownState && firstDisplay(firstShownState);
  return {
    ...reference(checkout, fee),
    amount: value,
    firstShown: shown ? { ...reference(firstShownState, shown), stateName: firstShownState.name || firstShownState.state_id } : null,
    visibleAtFirst: Boolean(firstDisplay(offerState)),
    required,
    calculable: fixedCopy.test(description) && !conditional ? true : null,
    explicitOptIn: required === true ? false : optsIn && required === false ? true : null
  };
}

export function readPriceEvidence(journey) {
  const path = findPath(journey);
  if (!path) return null;
  const { first, total, firstIndex, frames, edges } = path;
  const offer = frames[firstIndex];
  const checkout = frames[frames.length - 1];
  const firstAmount = money(first), totalAmount = amount(total);
  if (!Number.isSafeInteger(firstAmount) || firstAmount < 0 || !(totalAmount > 0) || firstAmount > totalAmount) return null;
  const charges = checkout.nodes.filter(node => node !== total && node.role === "text" && feeKind(node));
  if (charges.some(node => amount(node) === null && !/무료|포함/.test(node.text) &&
      // A plain label paired by joinPriceRows is represented by the amount layer.
      !charges.some(charge => charge.price_label_id === node.node_id))) return null;
  const fees = charges.filter(node => amount(node) > 0);
  if (fees.length > 1) return null;
  const fee = fees.length ? readFee(fees[0], path) : null;
  const feeAmount = fee?.amount ?? 0;
  const difference = totalAmount - firstAmount;
  const baseAmounts = new Set(checkout.nodes.filter(node => node !== total && !feeKind(node) && baseCopy.test(node.text))
    .map(amount).filter(value => value !== null));
  if (baseAmounts.size > 1 || (baseAmounts.size === 1 && !baseAmounts.has(totalAmount - feeAmount)) ||
      (difference !== 0 && difference !== feeAmount)) return null;
  return {
    key: JSON.stringify([
      journey.entry_state_id, frames.map(state => [state.state_id, identity(state), state.price_texts, state.nodes]),
      edges.map(({ edge }) => [edge.from_state_id, edge.to_state_id, edge.action])
    ]),
    first: { ...reference(offer, first), amount: firstAmount },
    total: { ...reference(checkout, total), amount: totalAmount },
    fee
  };
}

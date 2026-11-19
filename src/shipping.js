import { joinPriceRows, money, totalText } from "./analyze.js";

const optionRoles = new Set(["radio", "checkbox", "toggle"]);
const fastLabel = /빠른\s*배송/;
const basicLabel = /(?:일반|기본)\s*배송/;
const nextLabel = /^(?:주문\s*(?:내역\s*)?확인|결제\s*(?:정보|단계)(?:\s*보기)?|다음(?:\s*단계)?|계속(?:하기)?)$/;
export const shippingPattern = "paid_option_preselection";

function only(nodes, predicate) {
  const matches = nodes.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

export function hasFastShipping(journey) {
  return journey.states.some(state => state.nodes.some(node => optionRoles.has(node.role) && fastLabel.test(node.text)));
}

function reviewTotal(state) {
  const label = state && only(joinPriceRows(state).nodes, node => totalText.test(node.text) && money(node) !== null);
  const amount = label ? money(label) : null;
  return Number.isSafeInteger(amount) ? amount : null;
}

// The MVP copies a screen whose two choices and default button already have
// deterministic click destinations. Derive the comparison from the receipts.
export function readShippingScenario(journey, pageId) {
  if (!journey.flow_start_confirmed || journey.warnings?.length) return null;
  const entries = new Map(journey.states.map(state => [state.state_id, state]));
  const reachable = new Set([journey.entry_state_id]);
  for (const id of reachable) {
    for (const edge of journey.transitions) {
      if (edge.from_state_id === id && !edge.uncertain && edge.action.type === "click") reachable.add(edge.to_state_id);
    }
  }
  const shipping = only(journey.states, state => reachable.has(state.state_id) &&
    state.nodes.some(node => optionRoles.has(node.role) && fastLabel.test(node.text)));
  if (!shipping) return null;

  const options = shipping.nodes.filter(node => optionRoles.has(node.role) && node.text.trim());
  if (options.length !== 2) return null;
  const paid = only(options, node => fastLabel.test(node.text));
  const basic = only(options, node => basicLabel.test(node.text));
  const proceed = only(shipping.nodes, node => ["button", "link"].includes(node.role) && nextLabel.test(node.text.trim()));
  if (!paid || !basic || paid === basic || !proceed ||
      typeof paid.checked !== "boolean" || typeof basic.checked !== "boolean" || paid.checked === basic.checked) return null;

  const paidFee = money(paid), knownBasicFee = money(basic);
  const basicFee = knownBasicFee ?? (/무료/.test(basic.text) ? 0 : null);
  if (!Number.isSafeInteger(paidFee) || !Number.isSafeInteger(basicFee) || paidFee <= basicFee || basicFee < 0) return null;

  const routes = journey.transitions.filter(edge => edge.from_state_id === shipping.state_id);
  const destination = node => {
    const edge = only(routes, route => route.action.node_id === node.node_id);
    if (!edge || edge.uncertain || edge.action.type !== "click" || edge.action.trigger_node_id) return null;
    return entries.get(edge.to_state_id);
  };
  const fastReview = destination(paid), basicReview = destination(basic), defaultReview = destination(proceed);
  if (!fastReview || !basicReview || fastReview === basicReview || fastReview === shipping || basicReview === shipping ||
      defaultReview !== (paid.checked ? fastReview : basicReview)) return null;

  const fastTotal = reviewTotal(fastReview), basicTotal = reviewTotal(basicReview);
  if (fastTotal === null || basicTotal === null || fastTotal < paidFee || basicTotal < basicFee ||
      fastTotal - paidFee !== basicTotal - basicFee) return null;

  return {
    pageId,
    rootId: entries.get(journey.entry_state_id)?.frame_id,
    shippingFrameId: shipping.frame_id,
    paidId: paid.node_id,
    basicId: basic.node_id,
    paidSelectionId: paid.selection_node_id || paid.node_id,
    basicSelectionId: basic.selection_node_id || basic.node_id,
    continueId: proceed.node_id,
    fastReviewId: fastReview.frame_id,
    basicReviewId: basicReview.frame_id,
    fastTotal,
    basicTotal,
    fastFee: paidFee,
    basicFee,
    defaultOption: paid.checked ? "fast" : "basic"
  };
}

export function shippingQuote(spec) {
  const { fastTotal, basicTotal, fastFee, basicFee, defaultOption } = spec || {};
  return {
    fastTotal: fastTotal ?? null,
    basicTotal: basicTotal ?? null,
    fastFee: fastFee ?? null,
    basicFee: basicFee ?? null,
    defaultOption: defaultOption ?? null
  };
}

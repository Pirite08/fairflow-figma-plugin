const patterns = {
  paid_option_preselection: "특정옵션 사전선택",
  misleading_visual_hierarchy: "잘못된 계층구조",
  drip_pricing: "순차공개 가격책정"
};

function finding(pattern, status, reason, suggestion, evidence = []) {
  return {pattern, status, title: patterns[pattern], reason, suggestion, evidence};
}

function ref(state, node) {
  return {state_id: state.state_id, node_id: node.node_id};
}

function money(node) {
  if (Number.isSafeInteger(node.amount_krw)) return node.amount_krw;
  const values = node.text.match(/₩\s*[\d,]+(?:\s*원)?|[\d,]+\s*원/g);
  return values?.length === 1 ? Number(values[0].replace(/[^\d]/g, "")) : null;
}

const won = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
const compact = value => value.replace(/\s+/g, "").toLowerCase();
const control = node => ["checkbox", "radio", "toggle", "switch"].includes(node.role);
const button = node => ["button", "link"].includes(node.role);
const feeText = /배송비|빠른\s*배송|포장비|예약\s*수수료|서비스\s*요금|이용\s*수수료|수수료|발권비/;
const totalText = /결제\s*(?:예정\s*)?(?:금액|총액)|총\s*(?:결제|금액|합계)|최종\s*(?:가격|금액)|주문\s*합계/;

// Figma price rows often use separate label and value layers. Pair only a
// unique two-text sibling row and retain both source IDs for canvas focus.
function joinPriceRows(state) {
  const byParent = new Map(), joined = new Map();
  for (const n of state.nodes) {
    if (n.role !== "text" || !n.parent_id) continue;
    if (!byParent.has(n.parent_id)) byParent.set(n.parent_id, []);
    byParent.get(n.parent_id).push(n);
  }
  for (const row of byParent.values()) {
    if (row.length !== 2) continue;
    const value = row.find(n => /^\s*(?:₩\s*[\d,]+(?:\s*원)?|[\d,]+\s*원)\s*$/.test(n.text));
    if (!value) continue;
    const label = row.find(n => n !== value);
    if (money(label) !== null || !(feeText.test(label.text) || totalText.test(label.text) || /상품|기본\s*요금/.test(label.text))) continue;
    joined.set(value.node_id, {...value, text: label.text + " " + value.text, price_label_id: label.node_id});
  }
  return joined.size ? {...state, nodes: state.nodes.map(n => joined.get(n.node_id) || n)} : state;
}

function priceEvidence(state, node) {
  const references = [ref(state, node)];
  if (node.price_label_id) references.push({state_id: state.state_id, node_id: node.price_label_id});
  if (node.offer_action_id && node.offer_action_id !== node.node_id) {
    references.push({state_id: state.state_id, node_id: node.offer_action_id});
  }
  return references;
}

function graphOf(input) {
  const all = new Map(input.states.map(state => [state.state_id, state]));
  const edges = new Map();
  for (const edge of input.transitions) {
    const src = all.get(edge.from_state_id);
    const dst = all.get(edge.to_state_id);
    if (edge.uncertain || !src || !dst) continue;
    const action = src.nodes.find(n => n.node_id === edge.action.node_id);
    if (!action || edge.action.type !== "click") continue;
    if (!edges.has(src.state_id)) edges.set(src.state_id, []);
    edges.get(src.state_id).push({action, dst});
  }
  const next = state => edges.get(state.state_id) || [];
  const entry = all.get(input.entry_state_id);
  // The published v1 fixtures supply a journey entry and known scenario terms.
  const confirmed = input.flow_start_confirmed ?? Boolean(entry && input.scenario_terms);
  const reachable = (start, follow = () => true) => {
    const queue = [start];
    const seen = new Set([start.state_id]);
    for (let i = 0; i < queue.length; i++) {
      for (const {action, dst} of next(queue[i])) {
        if (seen.has(dst.state_id) || !follow(queue[i], action, dst)) continue;
        seen.add(dst.state_id);
        queue.push(dst);
      }
    }
    return queue;
  };
  return {entry, confirmed, next, reachable, states: entry ? reachable(entry) : input.states};
}

function paidOption(node, state, terms) {
  if (!control(node)) return false;
  const declared = terms.shipping_options?.find(o => o.option_id === node.option_id);
  if (declared) return declared.fee_krw > 0 && declared.separately_offered_service;
  if (!(money(node) > 0)) return false;
  return /(?:선택|추가|부가|유료)\s*(?:옵션|서비스|상품|포장)|빠른\s*배송|선물\s*포장|추가\s*보장/.test(node.text)
    || (/\+\s*[\d,]+\s*원/.test(node.text)
      && state.nodes.some(n => control(n) && n !== node && (money(n) === 0 || /무료/.test(n.text))));
}

function optionName(node) {
  return compact(node.text.replace(/[₩+\d,.]+\s*원?/g, "").replace(/[☑☐✓✔○●()[\]]/g, ""));
}

function namesMatch(node, option) {
  if (node.option_id && option.option_id) return node.option_id === option.option_id;
  const name = optionName(option);
  return name.length >= 2 && compact(node.text).includes(name);
}

function preselection(graph, terms) {
  const pattern = "paid_option_preselection";
  const results = [];
  const reviewed = new Set();
  for (const state of graph.states) {
    for (const option of state.nodes.filter(n => paidOption(n, state, terms))) {
      const key = option.option_id || optionName(option);
      if (reviewed.has(state.state_id + "/" + key)) continue;
      // Later snapshots of a choice are not observations of the default.
      if (graph.entry && state !== graph.entry) {
        const before = graph.reachable(graph.entry, (prior, action) =>
          !prior.nodes.some(n => control(n) && namesMatch(n, option)) && !namesMatch(action, option));
        if (!before.includes(state)) continue;
      }
      reviewed.add(state.state_id + "/" + key);
      const proof = [ref(state, option)];
      if (!graph.confirmed || typeof option.checked !== "boolean") {
        results.push(finding(pattern, "needs_context", "유료 옵션을 발견했습니다. 첫 진입 시점과 선택 상태를 함께 확인해야 합니다.",
          "여정 시작점에서 옵션까지 연결하고 선택 전후를 컴포넌트 상태로 표시하세요.", proof));
      } else if (option.checked) {
        results.push(finding(pattern, "risk_signal", "사용자가 이 유료 옵션을 고르는 동작을 거치지 않은 경로에서 ‘" + option.text + "’이 선택되어 있습니다.",
          "기본 상태에서 이 옵션을 해제하고 직접 선택했을 때만 비용을 반영하세요.", proof));
      } else {
        results.push(finding(pattern, "signal_absent", "첫 진입 경로에서 ‘" + option.text + "’은 선택 해제 상태입니다.",
          "이 옵션을 직접 선택한 경우에만 다음 단계의 금액이 바뀌는지 재검사하세요.", proof));
      }
    }
  }
  return results.length ? results : [finding(pattern, "needs_context", "추가 유료 옵션의 초기 상태를 확인할 수 있는 경로가 부족합니다.",
    "상품에서 옵션으로 이동하는 연결과 유료 항목의 선택 상태를 확인하세요.")];
}

function luminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
  const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function metrics(node) {
  const s = node.style || {};
  const fg = luminance(s.text_color);
  const bg = luminance(s.background_color);
  if (fg === null || bg === null || !(s.font_size_px > 0) ||
      !(node.bounds?.width > 0) || !(node.bounds?.height > 0)) return null;
  const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return {area: node.bounds.width * node.bounds.height, font: s.font_size_px, contrast, opacity: s.opacity ?? 1};
}

function visualHierarchy(graph) {
  const pattern = "misleading_visual_hierarchy";
  const results = [];
  const skip = /기본.*계속|추가\s*없이|가입\s*없이|가입하지\s*않|구매\s*없이|나중에|거절|거부|해지|탈퇴|필수만|동의하지|건너뛰/;
  const accept = /추가|전체\s*동의|가입|유료|구매|구독\s*유지|이용권\s*변경|혜택.*받/;
  for (const state of graph.states) {
    const choices = state.nodes.filter(button);
    const comparison = choices.filter(n => skip.test(n.text));
    const promoted = choices.filter(n => !skip.test(n.text) && accept.test(n.text));
    if (!promoted.length && !comparison.length) continue;
    const evidence = [...promoted, ...comparison].map(n => ref(state, n));
    const review = () => finding(pattern, "needs_context", "비교할 두 선택지의 표시 상태와 각각의 이동 경로를 확인해야 합니다.",
      "같은 제안 화면의 유료 선택과 기본 선택에 글자·배경 스타일과 목적지를 지정하세요.", evidence);
    // Multiple unrelated offers on one screen cannot be paired by button order.
    if (promoted.length !== 1 || comparison.length !== 1) {
      results.push(review());
      continue;
    }
    const strong = promoted[0], weak = comparison[0];
    const destination = n => {
      const edges = graph.next(state).filter(e => e.action.node_id === n.node_id);
      return n.enabled !== false && edges.length === 1 ? edges[0].dst : null;
    };
    const promotedDestination = destination(strong), basicDestination = destination(weak);
    const a = metrics(strong), b = metrics(weak);
    if (!a || !b || !promotedDestination || !basicDestination || promotedDestination === basicDestination) {
      results.push(review());
      continue;
    }
    // Screening heuristics only. The statute does not specify pixel or contrast cutoffs.
    const small = b.area < a.area * 0.45 || b.font < a.font * 0.75;
    const faint = (b.contrast < 3 && a.contrast >= b.contrast * 1.5)
      || (b.opacity < 0.45 && a.opacity >= 0.8);
    if (small && faint) {
      results.push(finding(pattern, "risk_signal", "‘" + weak.text + "’은 이동 가능한 선택지이지만 ‘" + strong.text + "’보다 작고 흐려 비활성처럼 보일 수 있습니다.",
        "두 선택지를 읽기 쉬운 크기와 대비로 나란히 제시하고 기본 경로가 계속 작동하는지 확인하세요.", evidence));
    } else if (b.contrast >= 3 && b.opacity >= 0.7 && !small) {
      results.push(finding(pattern, "signal_absent", "비교한 두 선택지의 목적지가 연결되어 있고, 기본 선택지도 읽을 수 있는 크기와 대비로 표시됩니다.",
        "스타일을 수정한 뒤에도 두 선택지의 문구와 이동 경로를 유지하세요.", evidence));
    } else {
      results.push(review());
    }
  }
  return results.length ? results : [finding(pattern, "needs_context", "함께 제시되는 유료·기본 선택지의 스타일과 연결 정보를 찾지 못했습니다.",
    "가입, 구매 또는 해지 선택지가 함께 보이는 프레임을 포함하세요.")];
}

function offerPrice(state) {
  const controls = new Map(state.nodes.filter(button).map(n => [n.node_id, n]));
  const isCard = n => /[가-힣a-z]/i.test(n.text.replace(/₩?\s*[\d,]+\s*원?/g, "")) &&
    !/결제|구매하기|장바구니|담기|선택|추가|옵션|동의|계속|신청|가입|주문하기/.test(n.text);
  // A single product label may put the included fee note after the total.
  const includesFee = /(?:^|\s)총(?:액|\s*가격)?\s*(?:₩\s*)?[\d,]+\s*원\s*[(（·,]?\s*(?:필수\s*)?(?:배송비|수수료|발권비)\s*포함\s*[)）.]?\s*$/;
  const isPrice = n => money(n) !== null && !totalText.test(n.text) &&
    (!feeText.test(n.text) || includesFee.test(n.text)) && !/할인액|적립|쿠폰|정가/.test(n.text);
  const represented = new Set(), options = [];
  for (const n of state.nodes) {
    if (n.role !== "text" || !isPrice(n)) continue;
    const owner = controls.get(n.control_node_id || n.parent_id);
    if (!owner) options.push(n);
    else if (isCard(owner)) {
      options.push({...n, offer_action_id: owner.node_id});
      represented.add(owner.node_id);
    }
  }
  for (const card of controls.values()) {
    if (!represented.has(card.node_id) && isPrice(card) && isCard(card)) {
      options.push({...card, offer_action_id: card.node_id});
    }
  }
  return options.length === 1 ? options[0] : null;
}

function productIdentity(state) {
  if (state.product_id || state.product_name) return state.product_id || state.product_name;
  const label = state.nodes.find(n => /^(?:상품명|상품\s*코드|SKU)\s*[:：]/i.test(n.text));
  return label ? compact(label.text.split(/[:：]/).slice(1).join(":")) : null;
}

function prices(graph, terms) {
  const pattern = "drip_pricing";
  const unresolved = (proof = []) => finding(pattern, "needs_context",
    "첫 가격, 동일 상품의 최종 금액, 비용의 필수 여부와 산정 시점을 함께 확인해야 합니다.",
    "첫 가격부터 주문까지 연결하고 비용이 필수·고정인지, 조건에 따라 달라지는지 표시하세요.", proof);
  const checks = [];
  const totals = new Map();
  for (const state of graph.states) {
    const total = state.nodes.find(n => totalText.test(n.text) && money(n) !== null);
    if (total) totals.set(state, total);
  }
  if (!graph.entry || !graph.confirmed) {
    const proof = Array.from(totals, ([state, total]) => ref(state, total));
    return [unresolved(proof)];
  }
  // A page of competing prices is already a price display. Without a linked item
  // identity we cannot substitute its later detail page as the first advertisement.
  const displaysPrice = state => state.nodes.some(n => /₩\s*[\d,]+|[\d,]+\s*원/.test(n.text));
  const starts = graph.reachable(graph.entry, state => !displaysPrice(state) && !totals.has(state))
    .filter(state => offerPrice(state) && !totals.has(state));
  for (const start of starts) {
    const first = offerPrice(start);
    const firstAmount = money(first);
    const firstItem = productIdentity(start);
    const sameProduct = (state, action, dst) => !(state === start && first.offer_action_id && first.offer_action_id !== action.node_id)
      && !(firstItem && productIdentity(dst) && productIdentity(dst) !== firstItem)
      && !/다른\s*상품|다른\s*요금제/.test(action.text);
    for (const checkout of graph.reachable(start, sameProduct)) {
      const total = totals.get(checkout);
      if (!total) continue;
      const finalAmount = money(total);
      const fees = checkout.nodes.filter(n => n !== total && feeText.test(n.text) && money(n) > 0);
      const proof = priceEvidence(start, first);
      for (const fee of fees) proof.push(...priceEvidence(checkout, fee));
      proof.push(...priceEvidence(checkout, total));
      if (fees.length !== 1) { checks.push(unresolved(proof)); continue; }
      const fee = fees[0], feeAmount = money(fee);
      const spec = terms.fees?.find(item => item.fee_id && item.fee_id === fee.fee_id);
      const baseNode = checkout.nodes.find(n => n !== total && n !== fee && /상품|기본\s*요금/.test(n.text) && money(n) !== null);
      const base = baseNode ? money(baseNode) : terms.product_price_krw;
      if (!Number.isSafeInteger(base) || base + feeAmount !== finalAmount ||
          (firstAmount !== base && firstAmount !== finalAmount) ||
          (spec && spec.amount_krw !== feeAmount)) {
        checks.push(unresolved(proof)); continue;
      }
      const negated = /(?:필수|의무|고정|정액)(?:은|는|가|이|적용|되지)?\s*(?:아[닌님니닙]|없|않|제외|X\b)|선택\s*(배송|사항)|조건부/i;
      const variable = /변동|달라|다를|따라|상이|미정|별도\s*산정|지역별|주소별|무게별/;
      const feeNotes = [...start.nodes, ...checkout.nodes].filter(n => feeText.test(n.text));
      if (feeNotes.some(n => negated.test(n.text) || variable.test(n.text))) {
        checks.push(unresolved(proof)); continue;
      }
      const mandatory = spec?.mandatory ?? (/필수|의무|모든\s*(주문|구매)/.test(fee.text) ? true : null);
      const fixed = spec?.known_at_first_price ?? (/고정|정액|일괄|일률/.test(fee.text) ? true : null);
      if (firstAmount === finalAmount) {
        checks.push(finding(pattern, "signal_absent", "이 주문 경로는 첫 표시 가격과 배송비·수수료를 포함한 최종 금액이 " + won(finalAmount) + "으로 같습니다.",
          "첫 가격과 주문 명세가 계속 일치하는지 확인하세요.", proof));
      } else if (mandatory === true && fixed === true) {
        checks.push(finding(pattern, "risk_signal", "첫 가격 " + won(firstAmount) + "에 확정된 필수 비용 " + won(feeAmount) + "이 빠져 주문 금액이 " + won(finalAmount) + "이 됩니다.",
          "첫 가격에 총 " + won(finalAmount) + "을 표시하고 포함된 필수 비용을 함께 안내하세요.", proof));
      } else {
        const explicit = selectedFeeOnPath(graph, start, checkout, fee, sameProduct);
        if (mandatory !== true && explicit) {
          checks.push(finding(pattern, "signal_absent", "이 경로에서 금액 증가는 사용자가 직접 선택한 추가 비용 " + won(feeAmount) + "과 일치합니다.",
            "선택 직전의 추가 금액과 선택 후 총액을 함께 확인하세요.", [...proof, explicit]));
        } else {
          checks.push(unresolved(proof));
        }
      }
    }
  }
  return checks.length ? checks : [unresolved(Array.from(totals, ([state, total]) => ref(state, total)))];
}

function selectedFeeOnPath(graph, start, checkout, fee, follow) {
  const selectsFee = n => control(n) && n.checked === false && money(n) === money(fee)
    && ((n.fee_id && n.fee_id === fee.fee_id) || namesMatch(fee, n));
  // If a path can reach this same total without selecting the fee, its cause is ambiguous.
  if (graph.reachable(start, (state, action, dst) => follow(state, action, dst) && !selectsFee(action)).includes(checkout)) return null;
  for (const state of graph.reachable(start, follow)) {
    for (const {action, dst} of graph.next(state)) {
      if (follow(state, action, dst) && selectsFee(action) &&
          dst.nodes.some(n => control(n) && n.checked === true && namesMatch(n, action)) &&
          graph.reachable(dst, follow).includes(checkout)) return ref(state, action);
    }
  }
  return null;
}

export function analyzeJourney(input) {
  const graph = graphOf({...input, states: input.states.map(joinPriceRows)});
  const terms = input.scenario_terms || {};
  const findings = [...preselection(graph, terms), ...visualHierarchy(graph), ...prices(graph, terms)];
  for (const finding of findings) {
    if (finding.status === "signal_absent" && input.warnings?.length) {
      finding.status = "needs_context";
      finding.reason += " 일부 화면 또는 연결의 수집이 제한되어 추가 확인이 필요합니다.";
    }
  }
  return findings;
}

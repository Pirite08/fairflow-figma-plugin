(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __objRest = (source, exclude) => {
    var target = {};
    for (var prop in source)
      if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
        target[prop] = source[prop];
    if (source != null && __getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(source)) {
        if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
          target[prop] = source[prop];
      }
    return target;
  };

  // src/analyze.js
  var patterns = {
    paid_option_preselection: "특정옵션 사전선택",
    misleading_visual_hierarchy: "잘못된 계층구조",
    drip_pricing: "순차공개 가격책정"
  };
  function finding(pattern2, status, reason, suggestion, evidence = []) {
    return { pattern: pattern2, status, title: patterns[pattern2], reason, suggestion, evidence };
  }
  function ref(state, node) {
    return { state_id: state.state_id, node_id: node.node_id };
  }
  function money(node) {
    if (Number.isSafeInteger(node.amount_krw)) return node.amount_krw;
    const values = node.text.match(/₩\s*[\d,]+(?:\s*원)?|[\d,]+\s*원/g);
    return (values == null ? void 0 : values.length) === 1 ? Number(values[0].replace(/[^\d]/g, "")) : null;
  }
  var won = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
  var compact = (value) => value.replace(/\s+/g, "").toLowerCase();
  var control = (node) => ["checkbox", "radio", "toggle", "switch"].includes(node.role);
  var button = (node) => ["button", "link"].includes(node.role);
  var feeText = /배송비|빠른\s*배송|포장비|예약\s*수수료|서비스\s*요금|이용\s*수수료|수수료|발권비/;
  var uncertainFee = /(?:필수|의무|고정|정액)(?:은|는|가|이|적용|되지)?\s*(?:아[닌님니닙]|없|않|제외|X\b)|선택\s*(배송|사항)|조건부|변동|달라|다를|따라|상이|미정|별도\s*산정|지역별|주소별|무게별/i;
  var totalText = /결제\s*(?:예정\s*)?(?:금액|총액)|총\s*(?:결제|금액|합계)|최종\s*(?:가격|금액)|주문\s*합계/;
  function joinPriceRows(state) {
    const byParent = /* @__PURE__ */ new Map(), joined = /* @__PURE__ */ new Map();
    for (const n of state.nodes) {
      if (n.role !== "text" || !n.parent_id) continue;
      if (!byParent.has(n.parent_id)) byParent.set(n.parent_id, []);
      byParent.get(n.parent_id).push(n);
    }
    for (const row of byParent.values()) {
      if (row.length !== 2) continue;
      const value = row.find((n) => /^\s*(?:₩\s*[\d,]+(?:\s*원)?|[\d,]+\s*원)\s*$/.test(n.text));
      if (!value) continue;
      const label = row.find((n) => n !== value);
      if (money(label) !== null || !(feeText.test(label.text) || totalText.test(label.text) || /상품|기본\s*요금/.test(label.text))) continue;
      joined.set(value.node_id, __spreadProps(__spreadValues({}, value), { text: label.text + " " + value.text, price_label_id: label.node_id }));
    }
    return joined.size ? __spreadProps(__spreadValues({}, state), { nodes: state.nodes.map((n) => joined.get(n.node_id) || n) }) : state;
  }
  function priceEvidence(state, node) {
    const references = [ref(state, node)];
    if (node.price_label_id) references.push({ state_id: state.state_id, node_id: node.price_label_id });
    if (node.offer_action_id && node.offer_action_id !== node.node_id) {
      references.push({ state_id: state.state_id, node_id: node.offer_action_id });
    }
    return references;
  }
  function graphOf(input) {
    var _a;
    const all = new Map(input.states.map((state) => [state.state_id, state]));
    const edges = /* @__PURE__ */ new Map();
    for (const edge of input.transitions) {
      const src = all.get(edge.from_state_id);
      const dst = all.get(edge.to_state_id);
      if (edge.uncertain || !src || !dst) continue;
      const action = src.nodes.find((n) => n.node_id === edge.action.node_id);
      if (!action || edge.action.type !== "click") continue;
      if (!edges.has(src.state_id)) edges.set(src.state_id, []);
      edges.get(src.state_id).push({ action, dst });
    }
    const next = (state) => edges.get(state.state_id) || [];
    const entry = all.get(input.entry_state_id);
    const confirmed = (_a = input.flow_start_confirmed) != null ? _a : Boolean(entry && input.scenario_terms);
    const reachable = (start, follow = () => true) => {
      const queue = [start];
      const seen = /* @__PURE__ */ new Set([start.state_id]);
      for (let i = 0; i < queue.length; i++) {
        for (const { action, dst } of next(queue[i])) {
          if (seen.has(dst.state_id) || !follow(queue[i], action, dst)) continue;
          seen.add(dst.state_id);
          queue.push(dst);
        }
      }
      return queue;
    };
    return { entry, confirmed, next, reachable, states: entry ? reachable(entry) : input.states };
  }
  function paidOption(node, state, terms) {
    var _a;
    if (!control(node)) return false;
    const declared = (_a = terms.shipping_options) == null ? void 0 : _a.find((o) => o.option_id === node.option_id);
    if (declared) return declared.fee_krw > 0 && declared.separately_offered_service;
    if (!(money(node) > 0)) return false;
    return /(?:선택|추가|부가|유료)\s*(?:옵션|서비스|상품|포장)|빠른\s*배송|선물\s*포장|추가\s*보장/.test(node.text) || /\+\s*[\d,]+\s*원/.test(node.text) && state.nodes.some((n) => control(n) && n !== node && (money(n) === 0 || /무료/.test(n.text)));
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
    const pattern2 = "paid_option_preselection";
    const results = [];
    const reviewed = /* @__PURE__ */ new Set();
    for (const state of graph.states) {
      for (const option of state.nodes.filter((n) => paidOption(n, state, terms))) {
        const key = option.option_id || optionName(option);
        if (reviewed.has(state.state_id + "/" + key)) continue;
        if (graph.entry && state !== graph.entry) {
          const before = graph.reachable(graph.entry, (prior, action) => !prior.nodes.some((n) => control(n) && namesMatch(n, option)) && !namesMatch(action, option));
          if (!before.includes(state)) continue;
        }
        reviewed.add(state.state_id + "/" + key);
        const proof = [ref(state, option)];
        if (!graph.confirmed || typeof option.checked !== "boolean") {
          results.push(finding(
            pattern2,
            "needs_context",
            "유료 옵션을 발견했습니다. 첫 진입 시점과 선택 상태를 함께 확인해야 합니다.",
            "여정 시작점에서 옵션까지 연결하고 선택 전후를 컴포넌트 상태로 표시하세요.",
            proof
          ));
        } else if (option.checked) {
          results.push(finding(
            pattern2,
            "risk_signal",
            "사용자가 이 유료 옵션을 고르는 동작을 거치지 않은 경로에서 ‘" + option.text + "’이 선택되어 있습니다.",
            "기본 상태에서 이 옵션을 해제하고 직접 선택했을 때만 비용을 반영하세요.",
            proof
          ));
        } else {
          results.push(finding(
            pattern2,
            "signal_absent",
            "첫 진입 경로에서 ‘" + option.text + "’은 선택 해제 상태입니다.",
            "이 옵션을 직접 선택한 경우에만 다음 단계의 금액이 바뀌는지 재검사하세요.",
            proof
          ));
        }
      }
    }
    return results.length ? results : [finding(
      pattern2,
      "needs_context",
      "추가 유료 옵션의 초기 상태를 확인할 수 있는 경로가 부족합니다.",
      "상품에서 옵션으로 이동하는 연결과 유료 항목의 선택 상태를 확인하세요."
    )];
  }
  function luminance(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
    const rgb = hex.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function metrics(node) {
    var _a, _b, _c;
    const s = node.style || {};
    const fg = luminance(s.text_color);
    const bg = luminance(s.background_color);
    if (fg === null || bg === null || !(s.font_size_px > 0) || !(((_a = node.bounds) == null ? void 0 : _a.width) > 0) || !(((_b = node.bounds) == null ? void 0 : _b.height) > 0)) return null;
    const contrast2 = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    return { area: node.bounds.width * node.bounds.height, font: s.font_size_px, contrast: contrast2, opacity: (_c = s.opacity) != null ? _c : 1 };
  }
  function visualHierarchy(graph) {
    const pattern2 = "misleading_visual_hierarchy";
    const results = [];
    const skip = /기본.*계속|추가\s*없이|가입\s*없이|가입하지\s*않|구매\s*없이|나중에|거절|거부|해지|탈퇴|필수만|동의하지|건너뛰/;
    const accept = /추가|전체\s*동의|가입|유료|구매|구독\s*유지|이용권\s*변경|혜택.*받/;
    for (const state of graph.states) {
      const choices = state.nodes.filter(button);
      const comparison = choices.filter((n) => skip.test(n.text));
      const promoted = choices.filter((n) => !skip.test(n.text) && accept.test(n.text));
      if (!promoted.length && !comparison.length) continue;
      const evidence = [...promoted, ...comparison].map((n) => ref(state, n));
      const review = () => finding(
        pattern2,
        "needs_context",
        "비교할 두 선택지의 표시 상태와 각각의 이동 경로를 확인해야 합니다.",
        "같은 제안 화면의 유료 선택과 기본 선택에 글자·배경 스타일과 목적지를 지정하세요.",
        evidence
      );
      if (promoted.length !== 1 || comparison.length !== 1) {
        results.push(review());
        continue;
      }
      const strong = promoted[0], weak = comparison[0];
      const destination = (n) => {
        const edges = graph.next(state).filter((e) => e.action.node_id === n.node_id);
        return n.enabled !== false && edges.length === 1 ? edges[0].dst : null;
      };
      const promotedDestination = destination(strong), basicDestination = destination(weak);
      const a = metrics(strong), b = metrics(weak);
      if (!a || !b || !promotedDestination || !basicDestination || promotedDestination === basicDestination) {
        results.push(review());
        continue;
      }
      const small = b.area < a.area * 0.45 || b.font < a.font * 0.75;
      const faint = b.contrast < 3 && a.contrast >= b.contrast * 1.5 || b.opacity < 0.45 && a.opacity >= 0.8;
      if (small && faint) {
        results.push(finding(
          pattern2,
          "risk_signal",
          "‘" + weak.text + "’은 이동 가능한 선택지이지만 ‘" + strong.text + "’보다 작고 흐려 비활성처럼 보일 수 있습니다.",
          "두 선택지를 읽기 쉬운 크기와 대비로 나란히 제시하고 기본 경로가 계속 작동하는지 확인하세요.",
          evidence
        ));
      } else if (b.contrast >= 3 && b.opacity >= 0.7 && !small) {
        results.push(finding(
          pattern2,
          "signal_absent",
          "비교한 두 선택지의 목적지가 연결되어 있고, 기본 선택지도 읽을 수 있는 크기와 대비로 표시됩니다.",
          "스타일을 수정한 뒤에도 두 선택지의 문구와 이동 경로를 유지하세요.",
          evidence
        ));
      } else {
        results.push(review());
      }
    }
    return results.length ? results : [finding(
      pattern2,
      "needs_context",
      "함께 제시되는 유료·기본 선택지의 스타일과 연결 정보를 찾지 못했습니다.",
      "가입, 구매 또는 해지 선택지가 함께 보이는 프레임을 포함하세요."
    )];
  }
  function offerPrice(state) {
    const controls2 = new Map(state.nodes.filter(button).map((n) => [n.node_id, n]));
    const isCard = (n) => /[가-힣a-z]/i.test(n.text.replace(/₩?\s*[\d,]+\s*원?/g, "")) && !/결제|구매하기|장바구니|담기|선택|추가|옵션|동의|계속|신청|가입|주문하기/.test(n.text);
    const includesFee = /(?:^|\s)총(?:액|\s*가격)?\s*(?:₩\s*)?[\d,]+\s*원\s*[(（·,]?\s*(?:필수\s*)?(?:배송비|수수료|발권비)\s*포함\s*[)）.]?\s*$/;
    const isPrice = (n) => money(n) !== null && !totalText.test(n.text) && (!feeText.test(n.text) || includesFee.test(n.text)) && !/할인액|적립|쿠폰|정가|상품\s*소계/.test(n.text);
    const represented = /* @__PURE__ */ new Set(), options = [];
    for (const n of state.nodes) {
      if (n.role !== "text" || !isPrice(n)) continue;
      const owner = controls2.get(n.control_node_id || n.parent_id);
      if (!owner) options.push(n);
      else if (isCard(owner)) {
        options.push(__spreadProps(__spreadValues({}, n), { offer_action_id: owner.node_id }));
        represented.add(owner.node_id);
      }
    }
    for (const card of controls2.values()) {
      if (!represented.has(card.node_id) && isPrice(card) && isCard(card)) {
        options.push(__spreadProps(__spreadValues({}, card), { offer_action_id: card.node_id }));
      }
    }
    return options.length === 1 ? options[0] : null;
  }
  function productIdentity(state) {
    if (state.product_id || state.product_name) return state.product_id || state.product_name;
    const label = state.nodes.find((n) => /^(?:상품명|상품\s*코드|SKU)\s*[:：]/i.test(n.text));
    return label ? compact(label.text.split(/[:：]/).slice(1).join(":")) : null;
  }
  function prices(graph, terms) {
    var _a, _b, _c, _d;
    const pattern2 = "drip_pricing";
    const unresolved = (proof = []) => finding(
      pattern2,
      "needs_context",
      "첫 가격, 동일 상품의 최종 금액, 비용의 필수 여부와 산정 시점을 함께 확인해야 합니다.",
      "첫 가격부터 주문까지 연결하고 비용이 필수·고정인지, 조건에 따라 달라지는지 표시하세요.",
      proof
    );
    const checks = [];
    const totals = /* @__PURE__ */ new Map();
    for (const state of graph.states) {
      const total = state.nodes.find((n) => totalText.test(n.text) && money(n) !== null);
      if (total) totals.set(state, total);
    }
    if (!graph.entry || !graph.confirmed) {
      const proof = Array.from(totals, ([state, total]) => ref(state, total));
      return [unresolved(proof)];
    }
    const displaysPrice = (state) => state.nodes.some((n) => /₩\s*[\d,]+|[\d,]+\s*원/.test(n.text));
    const starts = graph.reachable(graph.entry, (state) => !displaysPrice(state) && !totals.has(state)).filter((state) => offerPrice(state) && !totals.has(state));
    for (const start of starts) {
      const first = offerPrice(start);
      const firstAmount = money(first);
      const firstItem = productIdentity(start);
      const sameProduct = (state, action, dst) => !(state === start && first.offer_action_id && first.offer_action_id !== action.node_id) && !(firstItem && productIdentity(dst) && productIdentity(dst) !== firstItem) && !/다른\s*상품|다른\s*요금제/.test(action.text);
      for (const checkout of graph.reachable(start, sameProduct)) {
        const total = totals.get(checkout);
        if (!total) continue;
        const finalAmount = money(total);
        const fees = checkout.nodes.filter((n) => n !== total && feeText.test(n.text) && money(n) > 0);
        const proof = priceEvidence(start, first);
        for (const fee2 of fees) proof.push(...priceEvidence(checkout, fee2));
        proof.push(...priceEvidence(checkout, total));
        if (fees.length !== 1) {
          checks.push(unresolved(proof));
          continue;
        }
        const fee = fees[0], feeAmount = money(fee);
        const spec = (_a = terms.fees) == null ? void 0 : _a.find((item) => item.fee_id && item.fee_id === fee.fee_id);
        const baseNode = checkout.nodes.find((n) => n !== total && n !== fee && /상품|기본\s*요금/.test(n.text) && money(n) !== null);
        const base = baseNode ? money(baseNode) : terms.product_price_krw;
        if (!Number.isSafeInteger(base) || base + feeAmount !== finalAmount || firstAmount !== base && firstAmount !== finalAmount || spec && spec.amount_krw !== feeAmount) {
          checks.push(unresolved(proof));
          continue;
        }
        const feeNotes = [...start.nodes, ...checkout.nodes].filter((n) => feeText.test(n.text));
        if (feeNotes.some((n) => uncertainFee.test(n.text))) {
          checks.push(unresolved(proof));
          continue;
        }
        const mandatory = (_b = spec == null ? void 0 : spec.mandatory) != null ? _b : /필수|의무|모든\s*(주문|구매)/.test(fee.text) ? true : null;
        const fixed = (_c = spec == null ? void 0 : spec.known_at_first_price) != null ? _c : /고정|정액|일괄|일률/.test(fee.text) ? true : null;
        const pricing = mandatory === true && fixed === true ? {
          first: ref(start, first),
          checkout: ref(checkout, total),
          fee: __spreadProps(__spreadValues({}, ref(checkout, fee)), { label: (_d = fee.text.match(feeText)) == null ? void 0 : _d[0], amount: feeAmount }),
          base: baseNode ? ref(checkout, baseNode) : null,
          firstAmount,
          finalAmount,
          baseAmount: base
        } : null;
        if (firstAmount === finalAmount) {
          const result = finding(
            pattern2,
            "signal_absent",
            "이 주문 경로는 첫 표시 가격과 배송비·수수료를 포함한 최종 금액이 " + won(finalAmount) + "으로 같습니다.",
            "첫 가격과 주문 명세가 계속 일치하는지 확인하세요.",
            proof
          );
          checks.push(pricing ? __spreadProps(__spreadValues({}, result), { pricing }) : result);
        } else if (pricing) {
          checks.push(__spreadProps(__spreadValues({}, finding(
            pattern2,
            "risk_signal",
            "첫 가격 " + won(firstAmount) + "에 확정된 필수 비용 " + won(feeAmount) + "이 빠져 주문 금액이 " + won(finalAmount) + "이 됩니다.",
            "첫 가격에 총 " + won(finalAmount) + "을 표시하고 포함된 필수 비용을 함께 안내하세요.",
            proof
          )), {
            pricing
          }));
        } else {
          const explicit = selectedFeeOnPath(graph, start, checkout, fee, sameProduct);
          if (mandatory !== true && explicit) {
            checks.push(finding(
              pattern2,
              "signal_absent",
              "이 경로에서 금액 증가는 사용자가 직접 선택한 추가 비용 " + won(feeAmount) + "과 일치합니다.",
              "선택 직전의 추가 금액과 선택 후 총액을 함께 확인하세요.",
              [...proof, explicit]
            ));
          } else {
            checks.push(unresolved(proof));
          }
        }
      }
    }
    return checks.length ? checks : [unresolved(Array.from(totals, ([state, total]) => ref(state, total)))];
  }
  function selectedFeeOnPath(graph, start, checkout, fee, follow) {
    const selectsFee = (n) => control(n) && n.checked === false && money(n) === money(fee) && (n.fee_id && n.fee_id === fee.fee_id || namesMatch(fee, n));
    if (graph.reachable(start, (state, action, dst) => follow(state, action, dst) && !selectsFee(action)).includes(checkout)) return null;
    for (const state of graph.reachable(start, follow)) {
      for (const { action, dst } of graph.next(state)) {
        if (follow(state, action, dst) && selectsFee(action) && dst.nodes.some((n) => control(n) && n.checked === true && namesMatch(n, action)) && graph.reachable(dst, follow).includes(checkout)) return ref(state, action);
      }
    }
    return null;
  }
  function analyzeJourney(input) {
    var _a;
    const graph = graphOf(__spreadProps(__spreadValues({}, input), { states: input.states.map(joinPriceRows) }));
    const terms = input.scenario_terms || {};
    const findings = [...preselection(graph, terms), ...visualHierarchy(graph), ...prices(graph, terms)];
    for (const finding2 of findings) {
      if (finding2.status === "signal_absent" && ((_a = input.warnings) == null ? void 0 : _a.length)) {
        finding2.status = "needs_context";
        finding2.reason += " 일부 화면 또는 연결의 수집이 제한되어 추가 확인이 필요합니다.";
      }
    }
    return findings;
  }

  // src/reader.js
  var MAX_STATES = 40;
  var MAX_LAYERS = 6e3;
  var MAX_CONNECTIONS = 500;
  var MAX_DEPTH = 100;
  var SCREEN_TYPES = /* @__PURE__ */ new Set(["FRAME", "COMPONENT", "INSTANCE"]);
  var CHOICES = /* @__PURE__ */ new Set(["radio", "checkbox", "toggle"]);
  function namedRole(layer) {
    const name = (layer.name || "").toLowerCase();
    if (/(button|radio|checkbox|toggle|버튼|라디오|체크박스)\s*(group|list|set|그룹|목록|모음)/i.test(name)) return null;
    if (layer.type === "TEXT") {
      if (/^[☐☑☒]/u.test(layer.characters.trim())) return "checkbox";
      return null;
    }
    if (/radio|라디오/.test(name)) return "radio";
    if (/check[\s_-]?box|체크[\s_-]?박스/.test(name)) return "checkbox";
    if (/toggle|switch|토글|스위치/.test(name)) return "toggle";
    if (layer.type === "INSTANCE" && Object.keys(layer.componentProperties || {}).some(
      (key) => /^(is[\s_-]?)?(checked|체크)(\s*여부)?$/i.test(key.split("#")[0].trim())
    )) return "checkbox";
    if (/button|\bbtn\b|버튼/.test(name)) return "button";
    if (/(^|[\s/_-])link($|[\s/_-])|링크/.test(name)) return "link";
    return null;
  }
  function rowIndicator(layer) {
    var _a;
    const children = layer.children || [];
    if (!children.length || children.length > 8) return null;
    let indicator = null;
    let labels = 0;
    for (const child of children) {
      if (child.visible === false || child.opacity === 0) continue;
      if (CHOICES.has(namedRole(child))) {
        if (indicator) return null;
        indicator = child;
      } else if (child.type === "TEXT" && !((_a = child.reactions) == null ? void 0 : _a.length)) {
        labels++;
      } else return null;
    }
    return labels ? indicator : null;
  }
  function parseSelection(value) {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return void 0;
    const token = value.trim().toLowerCase().replace(/[\s_-]/g, "");
    if (["selected", "checked", "true", "on", "선택", "선택됨", "체크됨", "켜짐"].includes(token)) return true;
    if (["unselected", "unchecked", "deselected", "false", "off", "해제", "미선택", "선택해제", "체크해제", "꺼짐"].includes(token)) return false;
    return void 0;
  }
  function isSelectionProperty(key) {
    const name = key.split("#")[0].trim();
    return /^(is[\s_-]?)?(checked|selected|선택|체크)(\s*여부)?$/i.test(name) || /^(selection|check state|선택 상태|state|상태)$/i.test(name);
  }
  function componentSelection(layer) {
    const properties = layer.componentProperties || {};
    for (const [key, property] of Object.entries(properties)) {
      if (!isSelectionProperty(key)) continue;
      const value = parseSelection(property.value);
      if (value !== void 0) return value;
    }
    for (const [key, value] of Object.entries(layer.variantProperties || {})) {
      if (/^(state|selected|checked|선택|체크|상태|선택 상태)$/i.test(key)) {
        const selected = parseSelection(value);
        if (selected !== void 0) return selected;
      }
    }
    const tokens = (layer.name || "").split(/[,=/|]/);
    return tokens.length > 1 ? parseSelection(tokens[tokens.length - 1]) : void 0;
  }
  function priceFromText(text) {
    if (/[\d,]\s*[~–-]\s*[₩\d]/.test(text)) return void 0;
    const amounts = text.match(/(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi) || [];
    if (amounts.length !== 1) return void 0;
    const value = Number(amounts[0].replace(/\D/g, ""));
    return Number.isSafeInteger(value) ? value : void 0;
  }
  var visiblePaint = (paint) => paint.visible !== false && paint.opacity !== 0;
  function solidColor(paints) {
    var _a;
    if (!Array.isArray(paints)) return void 0;
    const visible = paints.filter(visiblePaint);
    if (visible.length !== 1 || visible[0].type !== "SOLID" || ((_a = visible[0].opacity) != null ? _a : 1) !== 1 || visible[0].blendMode && visible[0].blendMode !== "NORMAL") return void 0;
    return "#" + ["r", "g", "b"].map((key) => {
      const channel = Math.round(visible[0].color[key] * 255);
      return channel.toString(16).padStart(2, "0").toUpperCase();
    }).join("");
  }
  function intersects(rect, clip2) {
    return !rect || !clip2 || rect.x < clip2.x + clip2.width && rect.x + rect.width > clip2.x && rect.y < clip2.y + clip2.height && rect.y + rect.height > clip2.y;
  }
  function rectangleBackdrop(shape, label) {
    var _a, _b, _c, _d;
    const rect = shape.absoluteBoundingBox;
    if (shape.type !== "RECTANGLE" || !rect || ((_a = shape.opacity) != null ? _a : 1) !== 1 || ((_b = shape.effects) == null ? void 0 : _b.some((effect) => effect.visible !== false)) || ((_c = shape.strokes) == null ? void 0 : _c.some(visiblePaint)) || shape.blendMode && !["NORMAL", "PASS_THROUGH"].includes(shape.blendMode)) return void 0;
    const transform = shape.absoluteTransform;
    if (transform && (transform[0][1] !== 0 || transform[1][0] !== 0)) return void 0;
    const insetX = Math.min(label.x - rect.x, rect.x + rect.width - label.x - label.width);
    const insetY = Math.min(label.y - rect.y, rect.y + rect.height - label.y - label.height);
    const radius = (_d = shape.cornerRadius) != null ? _d : 0;
    if (insetX < 0 || insetY < 0 || typeof radius !== "number" || radius > 0 && (shape.cornerSmoothing || Math.max(insetX, insetY) < radius)) return void 0;
    return solidColor(shape.fills);
  }
  function siblingBackdrop(label, inherited) {
    var _a, _b;
    const parent = label.parent;
    const siblings = parent == null ? void 0 : parent.children;
    if (!siblings || siblings.length < 2) return inherited;
    const rect = label.absoluteBoundingBox;
    if (!rect || siblings.length > 64) return void 0;
    const reversed = ["HORIZONTAL", "VERTICAL"].includes(parent.layoutMode) && parent.itemReverseZIndex;
    let behind = true;
    let color = inherited;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[reversed ? siblings.length - 1 - i : i];
      if (sibling.id === label.id) {
        behind = false;
        continue;
      }
      if (sibling.visible === false || sibling.opacity === 0) continue;
      if (sibling.isMask) return void 0;
      if (!intersects(rect, sibling.absoluteRenderBounds || sibling.absoluteBoundingBox)) continue;
      if (sibling.type === "RECTANGLE" && Array.isArray(sibling.fills) && !sibling.fills.some(visiblePaint) && !((_a = sibling.strokes) == null ? void 0 : _a.some(visiblePaint)) && !((_b = sibling.effects) == null ? void 0 : _b.some((effect) => effect.visible !== false))) continue;
      if (!behind) return void 0;
      color = rectangleBackdrop(sibling, rect);
    }
    return color;
  }
  function clipRect(rect, inherited) {
    if (!rect || !inherited) return rect || inherited;
    const x = Math.max(rect.x, inherited.x);
    const y = Math.max(rect.y, inherited.y);
    return {
      x,
      y,
      width: Math.min(rect.x + rect.width, inherited.x + inherited.width) - x,
      height: Math.min(rect.y + rect.height, inherited.y + inherited.height) - y
    };
  }
  function normalizeLayer(layer, role, origin, opacity, background) {
    var _a;
    const item = { node_id: layer.id, name: layer.name, role, text: "", style: { opacity } };
    if (background) item.style.background_color = background;
    if ((_a = layer.parent) == null ? void 0 : _a.id) item.parent_id = layer.parent.id;
    const rect = layer.absoluteBoundingBox;
    if (rect) item.bounds = { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
    return item;
  }
  function setTextStyle(item, layer, opacity, background) {
    const style = { opacity };
    if (typeof layer.fontSize === "number") style.font_size_px = layer.fontSize;
    const color = solidColor(layer.fills);
    if (color) style.text_color = color;
    if (background) style.background_color = background;
    item.style = style;
  }
  function snapshot(frame, budget, warnings) {
    const nodes = [];
    const links = [];
    const origin = frame.absoluteBoundingBox || { x: 0, y: 0 };
    function walk(layer, owner, parentOpacity, parentColor, clip2, depth) {
      var _a, _b;
      if (budget.layers === 0 || depth > MAX_DEPTH) {
        warnings.add("레이어 수 또는 중첩 깊이 한도에 도달해 일부 레이어를 생략했습니다.");
        return;
      }
      budget.layers--;
      const opacity = parentOpacity * ((_a = layer.opacity) != null ? _a : 1);
      if (layer.visible === false || opacity === 0) return;
      const rect = layer.absoluteBoundingBox;
      if (!intersects(rect, clip2)) {
        warnings.add("프레임 밖으로 완전히 잘린 레이어는 현재 화면에서 제외했습니다.");
        return;
      }
      const textLayer = layer.type === "TEXT";
      const paints = layer.fills;
      let background = parentColor;
      const hasPaint = Array.isArray(paints) ? paints.some(visiblePaint) : Boolean(paints);
      if (!textLayer && hasPaint) {
        background = solidColor(paints);
      }
      if (textLayer) background = siblingBackdrop(layer, background);
      const reactions = layer.reactions || [];
      const isRoot = layer.id === frame.id;
      const ownRole = namedRole(layer);
      const indicator = !isRoot && !CHOICES.has(ownRole) && rowIndicator(layer);
      const role = indicator ? namedRole(indicator) : ownRole;
      const hasReactions = reactions.length > 0;
      const singleLabelHotspot = textLayer && owner && !owner.hasReactions && owner.onlyChildId === layer.id && !role;
      const embeddedIndicator = (owner == null ? void 0 : owner.indicatorId) === layer.id;
      const isControl = !singleLabelHotspot && !embeddedIndicator && (role || hasReactions);
      let part = owner;
      if ((isRoot ? hasReactions : isControl) || textLayer && !owner) {
        const item = normalizeLayer(layer, isRoot ? "region" : role || (hasReactions ? "button" : "text"), origin, opacity, background);
        if (CHOICES.has(item.role)) {
          const selected = componentSelection(indicator || layer);
          if (selected !== void 0) item.checked = selected;
          if (indicator) item.selection_node_id = indicator.id;
        }
        const onlyChildId = ((_b = layer.children) == null ? void 0 : _b.length) === 1 ? layer.children[0].id : null;
        part = { item, labels: [], longest: 0, onlyChildId, hasReactions, indicatorId: indicator == null ? void 0 : indicator.id };
        nodes.push(part);
      }
      if (textLayer && part) {
        const text = layer.characters.trim();
        if (text) {
          part.labels.push(text);
          if (text.length > part.longest) {
            part.longest = text.length;
            setTextStyle(part.item, layer, opacity, background);
          }
          if (owner === part && ["button", "link"].includes(part.item.role) && (/^(?:(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원)$/i.test(text) || feeText.test(text) && priceFromText(text) !== void 0)) {
            const price = normalizeLayer(layer, "text", origin, opacity, background);
            price.control_node_id = part.item.node_id;
            setTextStyle(price, layer, opacity, background);
            nodes.push({ item: price, labels: [text] });
          }
        }
      }
      for (const reaction of reactions) {
        part.hasTrigger = true;
        links.push({ nodeId: part.item.node_id, triggerNodeId: layer.id, reaction });
      }
      const activeOwner = isRoot ? null : part;
      const nextClip = layer.clipsContent ? clipRect(rect, clip2) : clip2;
      for (const child of layer.children || []) {
        if (!budget.layers) {
          warnings.add("레이어 수 또는 중첩 깊이 한도에 도달해 일부 레이어를 생략했습니다.");
          break;
        }
        walk(child, activeOwner, opacity, background, nextClip, depth + 1);
      }
    }
    walk(frame, null, 1, void 0, null, 0);
    return {
      state: {
        state_id: frame.id,
        frame_id: frame.id,
        name: frame.name,
        nodes: nodes.filter((part) => part.labels.length || part.hasTrigger || CHOICES.has(part.item.role)).map(({ item, labels }) => {
          item.text = labels.join(" ");
          const amount = priceFromText(item.text);
          if (amount !== void 0) item.amount_krw = amount;
          if (CHOICES.has(item.role) && item.checked === void 0 && /^[☐☑☒]/u.test(item.text)) {
            item.checked = item.text[0] !== "☐";
          }
          return item;
        })
      },
      links
    };
  }
  function destinations(actions, warnings, conditional = false) {
    const edges = [];
    const variableDependent = actions.some((action) => (action == null ? void 0 : action.type) === "SET_VARIABLE" || (action == null ? void 0 : action.type) === "SET_VARIABLE_MODE");
    for (const action of actions) {
      if ((action == null ? void 0 : action.type) === "CONDITIONAL") {
        warnings.add("조건이나 변수에 따라 바뀌는 화면은 프로토타입 실행에서 확인해야 합니다.");
        for (const block of action.conditionalBlocks || []) edges.push(...destinations(block.actions || [], warnings, true));
      } else if ((action == null ? void 0 : action.type) === "NODE" && action.destinationId && action.navigation !== "SCROLL_TO") {
        const uncertain = conditional || variableDependent || action.navigation !== "NAVIGATE";
        if (uncertain) warnings.add("조건부 연결, 오버레이 또는 컴포넌트 변형의 실제 표시 상태는 추가 확인이 필요합니다.");
        edges.push({ id: action.destinationId, navigation: action.navigation, uncertain });
      } else {
        warnings.add("변수 변경, 뒤로 가기, 스크롤, 외부 링크 등 목적 화면을 확정할 수 없는 동작이 있습니다.");
      }
    }
    return edges;
  }
  async function readJourney(figmaApi, rootFrame) {
    var _a;
    const states = [];
    const transitions = [];
    const warnings = /* @__PURE__ */ new Set();
    const budget = { layers: MAX_LAYERS };
    const frames = [rootFrame];
    const resolved = /* @__PURE__ */ new Map([[rootFrame.id, rootFrame]]);
    const queued = /* @__PURE__ */ new Set([rootFrame.id]);
    let examined = 0;
    for (let i = 0; i < frames.length && budget.layers > 0; i++) {
      const frame = frames[i];
      const { state, links } = snapshot(frame, budget, warnings);
      states.push(state);
      for (const { nodeId, triggerNodeId, reaction } of links) {
        const actions = reaction.actions || (reaction.action ? [reaction.action] : []);
        for (const edge of destinations(actions, warnings)) {
          if (++examined > MAX_CONNECTIONS) {
            warnings.add("프로토타입 연결 수 한도에 도달해 일부 경로를 생략했습니다.");
            break;
          }
          if (!resolved.has(edge.id)) {
            let target2 = null;
            try {
              target2 = await figmaApi.getNodeByIdAsync(edge.id);
            } catch (e) {
            }
            resolved.set(edge.id, target2);
          }
          const target = resolved.get(edge.id);
          if (!target || !SCREEN_TYPES.has(target.type) || target.visible === false) {
            warnings.add("목적 화면이 삭제되었거나 표시 상태를 읽을 수 없는 연결이 있습니다.");
            continue;
          }
          if (!queued.has(target.id)) {
            if (frames.length >= MAX_STATES) {
              warnings.add("연결된 화면 수 한도에 도달해 일부 경로를 생략했습니다.");
              continue;
            }
            queued.add(target.id);
            frames.push(target);
          }
          const clicked = ((_a = reaction.trigger) == null ? void 0 : _a.type) === "ON_CLICK";
          if (!clicked) warnings.add("클릭 이외의 트리거로 이어지는 경로는 실제 실행 조건을 확인해야 합니다.");
          transitions.push(__spreadValues({
            transition_id: "t" + (transitions.length + 1),
            from_state_id: frame.id,
            to_state_id: target.id,
            action: __spreadValues({
              type: clicked ? "click" : "other",
              node_id: nodeId
            }, triggerNodeId === nodeId ? {} : { trigger_node_id: triggerNodeId })
          }, edge.uncertain || !clicked ? { uncertain: true } : {}));
        }
        if (examined > MAX_CONNECTIONS) break;
      }
    }
    if (states.length < frames.length) warnings.add("레이어 한도에 도달해 일부 연결 화면을 읽지 못했습니다.");
    const captured = new Set(states.map((s) => s.state_id));
    return {
      entry_state_id: rootFrame.id,
      flow_start_confirmed: (figmaApi.currentPage.flowStartingPoints || []).some((point) => point.nodeId === rootFrame.id),
      states,
      transitions: transitions.filter((t) => captured.has(t.to_state_id)),
      warnings: [...warnings]
    };
  }

  // src/proposal-frames.js
  var GUTTER = 96;
  function canvasBounds(node) {
    return node.absoluteBoundingBox || { x: node.x, y: node.y, width: node.width, height: node.height };
  }
  function positionOnCanvas(node, x, y) {
    const rect = canvasBounds(node);
    node.x += x - rect.x;
    node.y += y - rect.y;
  }
  function roomToRight(existing, x, y, width, height) {
    for (const rect of existing.map(canvasBounds).sort((a, b) => a.x - b.x)) {
      if (rect.y + rect.height + GUTTER <= y || rect.y >= y + height + GUTTER || rect.x + rect.width + GUTTER <= x || rect.x >= x + width + GUTTER) continue;
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
      return __spreadProps(__spreadValues({}, action), { conditionalBlocks: action.conditionalBlocks.map((block) => __spreadProps(__spreadValues({}, block), {
        actions: block.actions.map((next) => mapAction(next, byId))
      })) });
    }
    const destination = action.type === "NODE" && byId.get(action.destinationId);
    return destination ? __spreadProps(__spreadValues({}, action), { destinationId: destination.id }) : action;
  }
  async function wireCopies(sources, byId) {
    var _a;
    for (const source of sources) {
      if (!((_a = source.reactions) == null ? void 0 : _a.length)) continue;
      const copy = byId.get(source.id);
      const reactions = source.reactions.map((reaction) => ({
        trigger: reaction.trigger,
        actions: (reaction.actions || (reaction.action ? [reaction.action] : [])).map((action) => mapAction(action, byId))
      }));
      const originalCopy = (copy.reactions || []).map((reaction) => ({ trigger: reaction.trigger, actions: reaction.actions }));
      if (JSON.stringify(reactions) !== JSON.stringify(originalCopy)) await copy.setReactionsAsync(reactions);
    }
  }
  function arrangeBoard(existing, source, columns) {
    const anchor = canvasBounds(source);
    const widths = columns.map((column) => Math.max(...column.map((frame) => canvasBounds(frame).width)));
    const height = Math.max(...columns.map((column) => column.reduce((total, frame) => total + canvasBounds(frame).height + GUTTER, -GUTTER)));
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
  async function openCopySession(api, { pageId, frameId, frameIds }) {
    const page = api.currentPage;
    if (page.id !== pageId) throw Error("검사한 페이지에서 수정안을 만들어 주세요.");
    const ids = [.../* @__PURE__ */ new Set([frameId, ...frameIds])];
    const source = await Promise.all(ids.map((id) => api.getNodeByIdAsync(id)));
    if (source.some((frame) => {
      var _a;
      return !frame || frame.removed || frame.type !== "FRAME" || ((_a = frame.parent) == null ? void 0 : _a.id) !== page.id;
    })) {
      throw Error("수정할 여정의 화면이 모두 같은 페이지의 최상위 프레임이어야 합니다.");
    }
    const existing = page.children.slice();
    const owned = [];
    const names = new Set(existing.map((node) => node.name));
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
    function finish(columns, starts) {
      if (api.currentPage.id !== page.id) throw Error("수정안을 만드는 동안 페이지가 바뀌었습니다.");
      arrangeBoard(existing, source[0], columns);
      const generated = new Set(owned.map((node) => node.id));
      page.flowStartingPoints = [...page.flowStartingPoints.filter((point) => !generated.has(point.nodeId)), ...starts];
    }
    function rollback() {
      for (const node of owned.reverse()) if (!node.removed) node.remove();
    }
    return { source, copyFrame, finish, rollback, own: (node) => {
      owned.push(node);
      return node;
    } };
  }
  async function copyJourney(source, label, copyFrame) {
    const copies = source.map((node) => copyFrame(node, label));
    const byId = /* @__PURE__ */ new Map(), sources = [];
    for (const [index, node] of source.entries()) indexCopy(node, copies[index], byId, sources);
    await wireCopies(sources, byId);
    return { copies, byId };
  }
  async function cloneProposal(api, spec, editVariant) {
    const { source, copyFrame, finish, rollback, own } = await openCopySession(api, spec);
    try {
      const reference = copyFrame(source[0], "원본 · 생성 시점");
      const referenceById = /* @__PURE__ */ new Map(), referenceSources = [];
      indexCopy(source[0], reference, referenceById, referenceSources);
      await wireCopies(referenceSources, referenceById);
      const result = { referenceFrameId: reference.id };
      const columns = [[reference]];
      const starts = [];
      for (const [kind, label] of [["minimal", "최소 수정안"], ["layout", "배치 변경안"]]) {
        const { copies, byId } = await copyJourney(source, label, copyFrame);
        columns.push(copies);
        const frame = (id) => byId.get(id);
        const getNode = (sourceFrameId, nodeId) => {
          var _a;
          const node = byId.get(nodeId);
          for (let cursor = node; cursor; cursor = cursor.parent) {
            if (cursor.id === ((_a = byId.get(sourceFrameId)) == null ? void 0 : _a.id)) return node;
            if (cursor.type === "PAGE") break;
          }
          throw Error("수정할 레이어를 복제한 여정에서 찾을 수 없습니다.");
        };
        await editVariant({ kind, frame, getNode, own });
        result[kind] = { frameId: copies[0].id };
        starts.push({ nodeId: copies[0].id, name: copies[0].name });
      }
      finish(columns, starts);
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }
  async function cloneAdoptedJourney(api, spec, validate) {
    const { source, copyFrame, finish, rollback } = await openCopySession(api, spec);
    try {
      const { copies, byId } = await copyJourney(source, "채택안", copyFrame);
      await validate(copies[0], byId);
      finish([copies], [{ nodeId: copies[0].id, name: copies[0].name }]);
      return byId;
    } catch (error) {
      rollback();
      throw error;
    }
  }

  // src/shipping-preview.js
  var MAX_IMAGE_DIMENSION = 720;
  var MAX_IMAGE_BYTES = 384 * 1024;
  var variants = [
    ["original", "원본"],
    ["minimal", "최소 수정"],
    ["layout", "비교 배치"]
  ];
  var controls = [
    ["basic", "basicId", "일반배송 선택"],
    ["fast", "paidId", "빠른배송 선택"],
    ["continue", "continueId", "선택 없이 계속"]
  ];
  var won2 = (amount) => String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
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
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
      throw Error("미리보기에 필요한 프레임 또는 레이어의 위치를 읽을 수 없습니다.");
    }
    return bounds;
  }
  function clip(bounds, area) {
    const x = Math.max(bounds.x, area.x);
    const y = Math.max(bounds.y, area.y);
    return {
      x,
      y,
      width: Math.min(bounds.x + bounds.width, area.x + area.width) - x,
      height: Math.min(bounds.y + bounds.height, area.y + area.height) - y
    };
  }
  function normalizedBounds(control2, frame, frameBounds) {
    let bounds = boundsOf(control2);
    let withinFrame = false;
    for (let current = control2; current; current = current.parent) {
      if (current.id === frame.id) {
        withinFrame = true;
        break;
      }
      if (current.visible === false || current.opacity === 0) break;
      if (current !== control2 && current.clipsContent) bounds = clip(bounds, boundsOf(current));
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
    return Math.abs(before.x - after.x) * frame.width > 1 || Math.abs(before.y - after.y) * frame.height > 1 || Math.abs(before.width - after.width) * frame.width > 1 || Math.abs(before.height - after.height) * frame.height > 1;
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
          details.push("별도 선택 없이 계속하면 주문 합계가 " + won2(originalTotal) + "에서 " + won2(total) + "으로 바뀝니다.");
      } else if (defaultChanged) {
        details.push((key === "basic" ? "일반배송" : "빠른배송") + (selected ? "이 기본으로 선택됩니다." : "의 기본 선택을 해제합니다."));
      }
      if (relocated) details.push("원본과 비교해 화면에서 위치 또는 크기가 바뀌었습니다.");
      if (!details.length) continue;
      markers.push(__spreadValues({
        key,
        label: key === "continue" ? "기본 주문 경로" : key === "basic" ? "일반배송" : "빠른배송",
        detail: details.join(" "),
        nodeId: column.nodes[index].id,
        x,
        y,
        width,
        height
      }, relocated ? { from: before } : {}));
    }
    return markers;
  }
  function sameReceipt(column, spec) {
    return column.frameId === spec.shippingFrameId && column.fastReviewId === spec.fastReviewId && column.basicReviewId === spec.basicReviewId && (/* @__PURE__ */ new Set([spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId])).size === 3;
  }
  async function loadColumn(api, column, label, pageId) {
    const spec = column == null ? void 0 : column.spec;
    if (!spec || spec.pageId !== pageId || !sameReceipt(column, spec) || !["fast", "basic"].includes(spec.defaultOption) || ![spec.fastTotal, spec.basicTotal, spec.fastFee, spec.basicFee].every(Number.isSafeInteger)) {
      throw Error("배송 방법과 주문 화면의 연결·금액을 다시 검사한 뒤 겹쳐보세요.");
    }
    const frameIds = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
    const controlIds = controls.map(([, field]) => spec[field]);
    const nodes = await Promise.all([...frameIds, ...controlIds].map((id) => api.getNodeByIdAsync(id)));
    if (nodes.some((node) => !node || node.removed || !isWithin(node, pageId)))
      throw Error("겹쳐볼 배송 화면이나 근거 레이어가 변경되었습니다. 다시 검사하세요.");
    const frames = nodes.slice(0, frameIds.length);
    for (const frame of frames) {
      const transform = frame.absoluteTransform;
      if (frame.type !== "FRAME" || frame.visible === false || frame.opacity === 0 || transform && (Math.abs(transform[0][1]) > 1e-3 || Math.abs(transform[1][0]) > 1e-3 || transform[0][0] <= 0 || transform[1][1] <= 0)) {
        throw Error("겹쳐보기는 회전하지 않은 가시 프레임에서 사용할 수 있습니다.");
      }
    }
    const frameBounds = boundsOf(frames[0]);
    const hotspots = controls.map(([key, , actionLabel], index) => __spreadValues({
      key,
      label: actionLabel
    }, normalizedBounds(nodes[index + frames.length], frames[0], frameBounds)));
    return { column, label, frames, nodes: nodes.slice(frames.length), hotspots };
  }
  async function exportImage(api, frame, pageId) {
    assertPage(api, pageId);
    if (frame.removed) throw Error("미리보기를 만드는 동안 프레임이 삭제되었습니다.");
    const { width, height } = boundsOf(frame);
    let scale = Math.min(2, MAX_IMAGE_DIMENSION / Math.max(width, height));
    for (let attempt = 0; attempt < 3; attempt++) {
      const bytes = await frame.exportAsync({
        format: "PNG",
        contentsOnly: true,
        useAbsoluteBounds: true,
        constraint: { type: "SCALE", value: scale }
      });
      assertPage(api, pageId);
      if (!(bytes == null ? void 0 : bytes.length)) break;
      if (bytes.length <= MAX_IMAGE_BYTES) return { id: frame.id, width, height, png: api.base64Encode(bytes) };
      scale *= Math.min(0.8, Math.sqrt(MAX_IMAGE_BYTES / bytes.length) * 0.9);
    }
    throw Error("프레임의 PNG를 미리보기 크기로 만들 수 없습니다.");
  }
  function renderShippingFrame(api, frame) {
    const pageId = api.currentPage.id;
    if (!frame || frame.type !== "FRAME" || !isWithin(frame, pageId))
      throw Error("검사한 페이지의 프레임에서 미리보기를 다시 만드세요.");
    return exportImage(api, frame, pageId);
  }
  async function renderShippingPreview(api, columns) {
    const pageId = api.currentPage.id;
    const candidates = await Promise.all(variants.map(([key, label]) => loadColumn(api, columns.find((column) => column.key === key), label, pageId)));
    const preview = [];
    for (const candidate of candidates) {
      const { column, label, frames, hotspots, nodes } = candidate;
      const [deliveryFrame, fastFrame, basicFrame] = frames;
      const frame = await exportImage(api, deliveryFrame, pageId);
      const fast = await exportImage(api, fastFrame, pageId);
      const basic = await exportImage(api, basicFrame, pageId);
      const { defaultOption, fastTotal, basicTotal, fastFee, basicFee } = column.spec;
      const data = {
        key: column.key,
        label,
        frame,
        receipts: { fast, basic },
        hotspots,
        defaultOption,
        fastTotal,
        basicTotal,
        fastFee,
        basicFee,
        status: column.status
      };
      preview.push(__spreadProps(__spreadValues({}, data), { markers: markersFor(preview[0], __spreadProps(__spreadValues({}, data), { nodes })) }));
    }
    return { columns: preview };
  }

  // src/shipping.js
  var optionRoles = /* @__PURE__ */ new Set(["radio", "checkbox", "toggle"]);
  var fastLabel = /빠른\s*배송/;
  var basicLabel = /(?:일반|기본)\s*배송/;
  var nextLabel = /^(?:주문\s*(?:내역\s*)?확인|결제\s*(?:정보|단계)(?:\s*보기)?|다음(?:\s*단계)?|계속(?:하기)?)$/;
  var shippingPattern = "paid_option_preselection";
  function only(nodes, predicate) {
    const matches = nodes.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }
  function reviewTotal(state) {
    const label = state && only(joinPriceRows(state).nodes, (node) => totalText.test(node.text) && money(node) !== null);
    const amount = label ? money(label) : null;
    return Number.isSafeInteger(amount) ? amount : null;
  }
  function readShippingScenario(journey, pageId) {
    var _a, _b;
    if (!journey.flow_start_confirmed || ((_a = journey.warnings) == null ? void 0 : _a.length)) return null;
    const entries = new Map(journey.states.map((state) => [state.state_id, state]));
    const reachable = /* @__PURE__ */ new Set([journey.entry_state_id]);
    for (const id of reachable) {
      for (const edge of journey.transitions) {
        if (edge.from_state_id === id && !edge.uncertain && edge.action.type === "click") reachable.add(edge.to_state_id);
      }
    }
    const shipping = only(journey.states, (state) => reachable.has(state.state_id) && state.nodes.some((node) => optionRoles.has(node.role) && fastLabel.test(node.text)));
    if (!shipping) return null;
    const options = shipping.nodes.filter((node) => optionRoles.has(node.role) && node.text.trim());
    if (options.length !== 2) return null;
    const paid = only(options, (node) => fastLabel.test(node.text));
    const basic = only(options, (node) => basicLabel.test(node.text));
    const proceed = only(shipping.nodes, (node) => ["button", "link"].includes(node.role) && nextLabel.test(node.text.trim()));
    if (!paid || !basic || paid === basic || !proceed || typeof paid.checked !== "boolean" || typeof basic.checked !== "boolean" || paid.checked === basic.checked) return null;
    const paidFee = money(paid), knownBasicFee = money(basic);
    const basicFee = knownBasicFee != null ? knownBasicFee : /무료/.test(basic.text) ? 0 : null;
    if (!Number.isSafeInteger(paidFee) || !Number.isSafeInteger(basicFee) || paidFee <= basicFee || basicFee < 0) return null;
    const routes = journey.transitions.filter((edge) => edge.from_state_id === shipping.state_id);
    const destination = (node) => {
      const edge = only(routes, (route) => route.action.node_id === node.node_id);
      if (!edge || edge.uncertain || edge.action.type !== "click" || edge.action.trigger_node_id) return null;
      return entries.get(edge.to_state_id);
    };
    const fastReview = destination(paid), basicReview = destination(basic), defaultReview = destination(proceed);
    if (!fastReview || !basicReview || fastReview === basicReview || fastReview === shipping || basicReview === shipping || defaultReview !== (paid.checked ? fastReview : basicReview)) return null;
    const fastTotal = reviewTotal(fastReview), basicTotal = reviewTotal(basicReview);
    if (fastTotal === null || basicTotal === null || fastTotal < paidFee || basicTotal < basicFee || fastTotal - paidFee !== basicTotal - basicFee) return null;
    return {
      pageId,
      rootId: (_b = entries.get(journey.entry_state_id)) == null ? void 0 : _b.frame_id,
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
  function shippingQuote(spec) {
    const { fastTotal, basicTotal, fastFee, basicFee, defaultOption } = spec || {};
    return {
      fastTotal: fastTotal != null ? fastTotal : null,
      basicTotal: basicTotal != null ? basicTotal : null,
      fastFee: fastFee != null ? fastFee : null,
      basicFee: basicFee != null ? basicFee : null,
      defaultOption: defaultOption != null ? defaultOption : null
    };
  }

  // src/shipping-panel.js
  var variants2 = /* @__PURE__ */ new Set(["minimal", "layout"]);
  var quoteFields = ["fastTotal", "basicTotal", "fastFee", "basicFee"];
  var sameQuote = (a, b) => a && b && quoteFields.every((key) => a[key] === b[key]);
  function shippingStatus(report, spec) {
    var _a;
    const findings = ((_a = report == null ? void 0 : report.findings) == null ? void 0 : _a.filter((finding2) => finding2.pattern === shippingPattern)) || [];
    const matching = spec && findings.find((finding2) => finding2.evidence.some((ref2) => ref2.node_id === spec.paidId));
    return (matching == null ? void 0 : matching.status) || (findings.length === 1 ? findings[0].status : "needs_context");
  }
  function createShippingPanel({ api, inspectFrame, makeShippingDesigns, post, revealNodes, context }) {
    const comparisons = /* @__PURE__ */ new Map();
    let busy = false;
    async function readFrame(id, confirmed) {
      const frame = await api.getNodeByIdAsync(id);
      if (!frame || frame.removed || frame.type !== "FRAME") return null;
      return inspectFrame(frame, confirmed);
    }
    async function readColumns(entry, original) {
      const columns = [];
      for (const variant of entry.columns) {
        const report = variant.key === "original" ? original : await readFrame(variant.frameId, false);
        const spec = report == null ? void 0 : report.shipping;
        columns.push(__spreadProps(__spreadValues(__spreadValues(__spreadValues({}, variant), spec ? {
          frameId: spec.shippingFrameId,
          fastReviewId: spec.fastReviewId,
          basicReviewId: spec.basicReviewId
        } : {}), shippingQuote(spec)), {
          status: shippingStatus(report, spec),
          spec
        }));
      }
      return columns;
    }
    function showExisting(rootId) {
      var _a;
      const comparison = (_a = comparisons.get(rootId)) == null ? void 0 : _a.result;
      if (comparison) post("shipping-comparison", { comparison, canRescan: true });
    }
    function invalidatePreview(rootId) {
      const entry = comparisons.get(rootId);
      if (!(entry == null ? void 0 : entry.preview)) return;
      entry.preview = null;
      post("shipping-preview-invalidated", { rootId });
    }
    async function update(create) {
      const { rootId, generation, confirmed } = context();
      if (busy || !rootId) return;
      let entry = comparisons.get(rootId);
      if (!create && !entry) return;
      busy = true;
      invalidatePreview(rootId);
      post("shipping-loading");
      try {
        const original = await readFrame(rootId, confirmed);
        if (!entry) {
          const spec = original == null ? void 0 : original.shipping;
          if (!spec) throw Error("두 배송 방법의 옵션, 기본 진행 버튼, 주문 확인 화면의 총액을 다시 확인하세요.");
          const designs = await makeShippingDesigns(api, spec);
          entry = { referenceFrameId: designs.referenceFrameId, adopted: /* @__PURE__ */ new Map(), columns: [
            { key: "original", frameId: spec.shippingFrameId, fastReviewId: spec.fastReviewId, basicReviewId: spec.basicReviewId },
            __spreadValues({ key: "minimal" }, designs.minimal),
            __spreadValues({ key: "layout" }, designs.layout)
          ] };
          comparisons.set(rootId, entry);
        }
        const columns = (await readColumns(entry, original)).map((_a) => {
          var _b = _a, { spec } = _b, column = __objRest(_b, ["spec"]);
          return column;
        });
        entry.result = __spreadProps(__spreadValues({ rootId, referenceFrameId: entry.referenceFrameId }, shippingQuote(original == null ? void 0 : original.shipping)), { columns });
        if (context().generation === generation) showExisting(rootId);
      } catch (error) {
        console.error("FairFlow shipping comparison", error);
        if (context().generation === generation) {
          post("shipping-error", { message: error instanceof Error ? error.message : "배송 수정안을 검사할 수 없습니다." });
        }
      } finally {
        busy = false;
      }
    }
    function previewError(request, error, fallback) {
      console.error("FairFlow shipping preview", error);
      if (context().generation === request.generation)
        post("shipping-preview-error", { rootId: request.rootId, message: (error == null ? void 0 : error.message) || fallback });
    }
    async function preview() {
      const request = context();
      const { rootId, generation, confirmed } = request;
      const entry = comparisons.get(rootId);
      if (busy || !(entry == null ? void 0 : entry.result)) return;
      busy = true;
      entry.preview = null;
      post("shipping-preview-loading", { rootId });
      try {
        const original = await readFrame(rootId, confirmed);
        const columns = await readColumns(entry, original);
        const rendered = await renderShippingPreview(api, columns);
        entry.preview = rendered;
        if (context().generation === generation) {
          post("shipping-preview-result", { rootId, preview: __spreadProps(__spreadValues({}, rendered), { adopted: entry.lastAdopted }) });
        }
      } catch (error) {
        previewError(request, error, "배송 화면을 표시할 수 없습니다.");
      } finally {
        busy = false;
      }
    }
    async function verifySnapshot(shown, spec) {
      if (!sameQuote(shown, spec) || spec.defaultOption !== shown.defaultOption) return false;
      const ids = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
      const snapshots = [shown.frame, shown.receipts.fast, shown.receipts.basic];
      for (const [index, id] of ids.entries()) {
        const before = snapshots[index];
        if (id !== before.id) return false;
        const after = await renderShippingFrame(api, await api.getNodeByIdAsync(id));
        if (after.width !== before.width || after.height !== before.height || after.png !== before.png) return false;
      }
      return true;
    }
    async function adopt(key) {
      var _a;
      const request = context();
      const { rootId, generation, confirmed } = request;
      const entry = comparisons.get(rootId);
      const shown = (_a = entry == null ? void 0 : entry.preview) == null ? void 0 : _a.columns.find((column) => column.key === key);
      if (busy || !shown || !variants2.has(key)) return;
      busy = true;
      post("shipping-preview-loading", { rootId, operation: "adopt" });
      try {
        let adopted = entry.adopted.get(key);
        if (adopted) {
          const existing = await api.getNodeByIdAsync(adopted.frameId);
          if (!existing || existing.removed) adopted = null;
        }
        if (!adopted) {
          const original = await readFrame(rootId, confirmed);
          const proposal = await readFrame(shown.frame.id, false);
          const spec = proposal == null ? void 0 : proposal.shipping;
          if (!spec || spec.defaultOption !== "basic" || !sameQuote(original == null ? void 0 : original.shipping, spec) || shippingStatus(proposal, spec) !== "signal_absent") {
            throw Error("일반배송 기본값, 원본과 같은 요금, 두 주문 경로를 확인한 뒤 채택하세요.");
          }
          if (!await verifySnapshot(shown, spec)) throw Error("미리보기 이후 화면이 바뀌었습니다. 다시 겹쳐 본 뒤 채택하세요.");
          const frameIds = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
          const byId = await cloneAdoptedJourney(
            api,
            { pageId: spec.pageId, frameId: spec.shippingFrameId, frameIds },
            async (frame2, copies) => {
              const report = await inspectFrame(frame2, true);
              const copied = report == null ? void 0 : report.shipping;
              if (!sameQuote(spec, copied) || copied.defaultOption !== "basic" || copied.fastReviewId !== copies.get(spec.fastReviewId).id || copied.basicReviewId !== copies.get(spec.basicReviewId).id || shippingStatus(report, copied) !== "signal_absent") {
                throw Error("채택안의 총액과 주문 경로를 다시 확인하지 못했습니다.");
              }
            }
          );
          const frame = byId.get(spec.shippingFrameId);
          adopted = {
            key,
            frameId: frame.id,
            name: frame.name,
            fastReviewId: byId.get(spec.fastReviewId).id,
            basicReviewId: byId.get(spec.basicReviewId).id
          };
          entry.adopted.set(key, adopted);
        }
        entry.lastAdopted = adopted;
        if (context().generation === generation) {
          await revealNodes([adopted.frameId], generation);
          post("shipping-adopted", { rootId, adopted });
        }
      } catch (error) {
        previewError(request, error, "채택안을 만들 수 없습니다.");
      } finally {
        busy = false;
      }
    }
    async function focus({ type, key, option, marker }) {
      var _a, _b;
      if (busy) return;
      const request = context();
      const { rootId, generation } = request;
      const entry = comparisons.get(rootId);
      if (!(entry == null ? void 0 : entry.result)) return;
      let ids;
      const previewFocus = type === "shipping-preview-focus" || type === "shipping-adopt-focus";
      if (type === "shipping-preview-focus") {
        const change = (_b = (_a = entry.preview) == null ? void 0 : _a.columns.find((column) => column.key === key)) == null ? void 0 : _b.markers.find((item) => item.key === marker);
        if (change) ids = [change.nodeId];
      } else if (type === "shipping-adopt-focus") {
        const adopted = entry.adopted.get(key);
        if (adopted) ids = [adopted.frameId];
      } else if (type === "shipping-overview") {
        ids = [entry.referenceFrameId || entry.columns[0].frameId, ...entry.columns.slice(1).map((column) => column.frameId)];
      } else {
        const column = entry.result.columns.find((item) => item.key === key);
        if (!column || option != null && option !== "fast" && option !== "basic") return;
        ids = [option === "fast" ? column.fastReviewId : option === "basic" ? column.basicReviewId : column.frameId];
      }
      if (!ids) return;
      try {
        await revealNodes(ids, generation);
      } catch (error) {
        if (previewFocus) previewError(request, null, "변경 레이어를 열 수 없습니다. 미리보기를 다시 만드세요.");
        else post("shipping-error", { message: "선택한 비교 화면을 열 수 없습니다. 수정안이 남아 있는지 확인하세요." });
      }
    }
    return { update, preview, adopt, focus, showExisting, invalidatePreview, get busy() {
      return busy;
    } };
  }

  // src/proposal-panel.js
  var catalog = {
    hierarchy: {
      pattern: "misleading_visual_hierarchy",
      issue: "같은 화면의 유료·기본 버튼 두 개를 서로 다른 프레임에 직접 연결하세요."
    },
    price: {
      pattern: "drip_pricing",
      issue: "첫 표시 가격부터 총액까지 연결하고 주문 화면에 금액이 확정된 필수 비용을 표시하세요."
    }
  };
  function proposalOffers(report) {
    var _a;
    const offers = {};
    for (const [kind, definition] of Object.entries(catalog)) {
      const available = Boolean((_a = report.proposals) == null ? void 0 : _a[kind]);
      const candidate = report.findings.some((finding2) => finding2.pattern === definition.pattern && finding2.evidence.length > 0);
      if (available || candidate) offers[kind] = { available, issue: available ? null : definition.issue };
    }
    return offers;
  }
  function createProposalPanel({ api, inspectFrame, builders, post, revealNodes, context }) {
    const comparisons = /* @__PURE__ */ new Map();
    let busy = false;
    async function read(id, confirmed = false) {
      const frame = await api.getNodeByIdAsync(id);
      return frame && !frame.removed && frame.type === "FRAME" ? inspectFrame(frame, confirmed) : null;
    }
    function showExisting(rootId) {
      var _a, _b;
      for (const kind of Object.keys(builders)) {
        const comparison = (_b = (_a = comparisons.get(rootId)) == null ? void 0 : _a.get(kind)) == null ? void 0 : _b.result;
        if (comparison) post("proposal-comparison", { kind, rootId, comparison });
      }
    }
    async function update(kind, create) {
      var _a, _b;
      if (busy || !Object.hasOwn(builders, kind)) return;
      const { rootId, generation, confirmed } = context();
      if (!rootId) return;
      let entries = comparisons.get(rootId);
      let entry = entries == null ? void 0 : entries.get(kind);
      if (!entry && !create) return;
      busy = true;
      post("proposal-loading", { kind, rootId });
      try {
        const original = await read(rootId, confirmed);
        if (!entry) {
          const spec = (_a = original == null ? void 0 : original.proposals) == null ? void 0 : _a[kind];
          if (!spec) throw Error(catalog[kind].issue);
          const generated = await builders[kind](api, spec);
          entry = {
            referenceFrameId: generated.referenceFrameId,
            columns: [
              { key: "original", frameId: spec.frameId },
              { key: "minimal", frameId: generated.minimal.frameId },
              { key: "layout", frameId: generated.layout.frameId }
            ]
          };
          if (!entries) comparisons.set(rootId, entries = /* @__PURE__ */ new Map());
          entries.set(kind, entry);
        }
        const columns = [];
        for (const column of entry.columns) {
          const report = column.key === "original" ? original : await read(column.frameId);
          const spec = (_b = report == null ? void 0 : report.proposals) == null ? void 0 : _b[kind];
          columns.push(__spreadProps(__spreadValues({}, column), {
            frameId: (spec == null ? void 0 : spec.frameId) || column.frameId,
            status: (spec == null ? void 0 : spec.status) || "needs_context",
            summary: spec ? spec.summary : catalog[kind].issue,
            steps: (spec == null ? void 0 : spec.steps) || []
          }));
        }
        const comparison = { rootId, referenceFrameId: entry.referenceFrameId, columns };
        entry.result = comparison;
        if (context().generation === generation) post("proposal-comparison", { kind, rootId, comparison });
      } catch (error) {
        console.error("FairFlow design proposal", error);
        if (context().generation === generation) {
          post("proposal-error", { kind, rootId, message: (error == null ? void 0 : error.message) || "디자인 수정안을 검사할 수 없습니다." });
        }
      } finally {
        busy = false;
      }
    }
    async function focus({ type, kind, key, step }) {
      var _a, _b, _c;
      const { rootId, generation } = context();
      const comparison = (_b = (_a = comparisons.get(rootId)) == null ? void 0 : _a.get(kind)) == null ? void 0 : _b.result;
      if (busy || !comparison) return;
      const column = comparison.columns.find((candidate) => candidate.key === key);
      const target = step == null ? column == null ? void 0 : column.frameId : (_c = column == null ? void 0 : column.steps.find((candidate) => candidate.key === step)) == null ? void 0 : _c.frameId;
      const ids = type === "proposal-overview" ? [comparison.referenceFrameId, ...comparison.columns.slice(1).map((item) => item.frameId)] : target ? [target] : [];
      if (!ids.length) return;
      try {
        await revealNodes(ids, generation);
      } catch (e) {
        if (context().generation === generation) {
          post("proposal-error", { kind, rootId, message: "비교 화면을 열 수 없습니다. 프레임을 다시 검사하세요." });
        }
      }
    }
    return { update, focus, showExisting, get busy() {
      return busy;
    } };
  }

  // src/controller.js
  function startPanel(api, inspectFrame, makeShippingDesigns, proposalBuilders) {
    let rootId = null;
    let generation = 0;
    const evidenceByState = /* @__PURE__ */ new Map();
    let confirmedRootId = null;
    let canConfirmStart = false;
    let ready = false;
    const post = (type, fields = {}) => api.ui.postMessage(__spreadValues({ type }, fields));
    const selectedFrame = () => {
      const selection = api.currentPage.selection;
      return selection.length === 1 && selection[0].type === "FRAME" ? selection[0] : null;
    };
    const postSelection = () => {
      var _a, _b;
      const frame = selectedFrame();
      post("selection", { frameId: (_a = frame == null ? void 0 : frame.id) != null ? _a : null, name: (_b = frame == null ? void 0 : frame.name) != null ? _b : null });
    };
    const panelContext = {
      api,
      inspectFrame,
      post,
      revealNodes,
      context: () => ({ rootId, generation, confirmed: Boolean(rootId && confirmedRootId === rootId) })
    };
    const shipping = makeShippingDesigns && createShippingPanel(__spreadProps(__spreadValues({}, panelContext), { makeShippingDesigns }));
    const proposals = proposalBuilders && createProposalPanel(__spreadProps(__spreadValues({}, panelContext), { builders: proposalBuilders }));
    async function scan(useSelection) {
      if ((shipping == null ? void 0 : shipping.busy) || (proposals == null ? void 0 : proposals.busy)) return;
      const version = ++generation;
      evidenceByState.clear();
      canConfirmStart = false;
      try {
        const frame = useSelection || !rootId ? selectedFrame() : await api.getNodeByIdAsync(rootId);
        if (generation !== version) return;
        if (!frame || frame.removed || frame.type !== "FRAME") {
          rootId = null;
          confirmedRootId = null;
          post("empty", { message: "검사를 시작할 프레임 하나를 선택하세요." });
          return;
        }
        if (rootId !== frame.id) confirmedRootId = null;
        rootId = frame.id;
        post("loading", { message: frame.name + "의 레이어와 프로토타입 연결을 읽고 있습니다." });
        const result = await inspectFrame(frame, confirmedRootId === frame.id);
        if (generation !== version) return;
        canConfirmStart = Boolean(result.canConfirmStart);
        for (const finding2 of result.findings) {
          for (const item of finding2.evidence) {
            if (!evidenceByState.has(item.state_id)) evidenceByState.set(item.state_id, /* @__PURE__ */ new Set());
            evidenceByState.get(item.state_id).add(item.node_id);
          }
        }
        const _a = result, { shipping: spec, proposals: _specs } = _a, report = __objRest(_a, ["shipping", "proposals"]);
        post("result", __spreadValues(__spreadValues(__spreadProps(__spreadValues({}, report), {
          rootId: frame.id
        }), proposals ? { proposals: proposalOffers(result) } : {}), shipping ? { shipping: spec ? shippingQuote(spec) : null } : {}));
        shipping == null ? void 0 : shipping.invalidatePreview(frame.id);
        shipping == null ? void 0 : shipping.showExisting(frame.id);
        proposals == null ? void 0 : proposals.showExisting(frame.id);
      } catch (error) {
        if (generation !== version) return;
        console.error("FairFlow scan", error);
        post("error", { message: "프레임을 읽는 중 오류가 발생했습니다. 프레임을 선택하고 다시 검사하세요." });
      }
    }
    async function revealNodes(ids, version) {
      const nodes = await Promise.all(ids.map((id) => api.getNodeByIdAsync(id)));
      if (generation !== version) return;
      if (nodes.some((node) => !node || node.removed)) throw Error("레이어가 삭제되었습니다. 다시 검사하세요.");
      let page = nodes[0].parent;
      while (page && page.type !== "PAGE") page = page.parent;
      if (!page) return;
      if (page.id !== api.currentPage.id) await api.setCurrentPageAsync(page);
      if (generation !== version) return;
      api.currentPage.selection = nodes;
      api.viewport.scrollAndZoomIntoView(nodes);
    }
    async function focus({ state_id, node_id }) {
      var _a;
      const version = generation;
      if (!((_a = evidenceByState.get(state_id)) == null ? void 0 : _a.has(node_id))) {
        post("notice", { message: "이 근거가 현재 검사 결과에 없습니다. 다시 검사하세요." });
        return;
      }
      try {
        await revealNodes([node_id], version);
      } catch (error) {
        if (generation !== version) return;
        post("notice", { message: error.message === "레이어가 삭제되었습니다. 다시 검사하세요." ? error.message : "레이어를 열 수 없습니다. 프레임을 다시 검사하세요." });
      }
    }
    api.ui.onmessage = async (message) => {
      if (!message || typeof message !== "object") return;
      switch (message.type) {
        case "ready":
          ready = true;
          postSelection();
          return scan(true);
        case "scan-selection":
          return scan(true);
        case "scan":
          return scan(false);
        case "confirm-start":
          if (rootId && canConfirmStart) {
            confirmedRootId = rootId;
            return scan(false);
          }
          break;
        case "focus":
          return focus(message);
        case "shipping-create":
        case "shipping-rescan":
          if (!(proposals == null ? void 0 : proposals.busy)) return shipping == null ? void 0 : shipping.update(message.type === "shipping-create");
          break;
        case "shipping-preview":
          if (!(proposals == null ? void 0 : proposals.busy)) return shipping == null ? void 0 : shipping.preview();
          break;
        case "shipping-adopt":
          if (!(proposals == null ? void 0 : proposals.busy)) return shipping == null ? void 0 : shipping.adopt(message.key);
          break;
        case "shipping-focus":
        case "shipping-overview":
        case "shipping-preview-focus":
        case "shipping-adopt-focus":
          if (!(proposals == null ? void 0 : proposals.busy)) return shipping == null ? void 0 : shipping.focus(message);
          break;
        case "proposal-create":
        case "proposal-rescan":
          if (!(shipping == null ? void 0 : shipping.busy)) return proposals == null ? void 0 : proposals.update(message.kind, message.type === "proposal-create");
          break;
        case "proposal-focus":
        case "proposal-overview":
          if (!(shipping == null ? void 0 : shipping.busy)) return proposals == null ? void 0 : proposals.focus(message);
          break;
      }
    };
    api.on("selectionchange", () => {
      if (!ready) return;
      postSelection();
      if (!rootId && selectedFrame()) return scan(true);
    });
  }

  // src/shipping-design.js
  var GUTTER2 = 96;
  async function setChoice(instance, desired) {
    var _a, _b;
    if (instance.type !== "INSTANCE") throw Error("배송 선택 상태를 바꿀 컴포넌트 인스턴스를 찾을 수 없습니다.");
    const candidates = Object.entries(instance.componentProperties).filter(
      ([key2, property2]) => isSelectionProperty(key2) && ["BOOLEAN", "VARIANT"].includes(property2.type) && parseSelection(property2.value) !== void 0
    );
    if (candidates.length !== 1) throw Error("배송 컴포넌트의 선택 속성을 하나로 특정할 수 없습니다.");
    const [key, property] = candidates[0];
    let value = desired;
    if (property.type === "VARIANT") {
      const component = await instance.getMainComponentAsync();
      const set = component == null ? void 0 : component.parent;
      const values = (set == null ? void 0 : set.type) === "COMPONENT_SET" ? ((_a = set.variantGroupProperties[key]) == null ? void 0 : _a.values) || [] : [];
      const matches = values.filter((v) => parseSelection(v) === desired);
      if (matches.length !== 1) throw Error("이 컴포넌트의 선택·해제 변형을 확정할 수 없습니다.");
      value = matches[0];
    }
    instance.setProperties({ [key]: value });
    if (parseSelection((_b = instance.componentProperties[key]) == null ? void 0 : _b.value) !== desired)
      throw Error("배송 선택 상태를 적용하지 못했습니다.");
  }
  function pathInFrame(node, frame) {
    const path = [];
    for (let current = node; (current == null ? void 0 : current.id) !== frame.id; current = current.parent) {
      const parent = current == null ? void 0 : current.parent;
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
    var _a;
    const parent = paid.parent;
    if (!parent || ((_a = basic.parent) == null ? void 0 : _a.id) !== parent.id || !["FRAME", "GROUP"].includes(parent.type)) {
      throw Error("비교 배치를 만들려면 두 배송 옵션이 같은 편집 가능한 컨테이너에 있어야 합니다.");
    }
    for (let ancestor = parent; ancestor && ancestor.type !== "PAGE"; ancestor = ancestor.parent) {
      if (ancestor.type === "INSTANCE") throw Error("인스턴스 내부의 레이어는 비교 배치로 옮길 수 없습니다.");
    }
    const left = Math.min(paid.x, basic.x), top = Math.min(paid.y, basic.y);
    const width = Math.max(paid.x + paid.width, basic.x + basic.width) - left;
    const height = Math.max(paid.y + paid.height, basic.y + basic.height) - top;
    if ([paid, basic].some((n) => Math.abs(n.rotation || 0) > 0.01))
      throw Error("회전한 배송 옵션은 비교 배치로 묶을 수 없습니다.");
    const paidIndex = parent.children.findIndex((n) => n.id === paid.id);
    const basicIndex = parent.children.findIndex((n) => n.id === basic.id);
    const inAutoLayout = parent.layoutMode && parent.layoutMode !== "NONE";
    if (inAutoLayout && (parent.layoutMode === "GRID" || Math.abs(paidIndex - basicIndex) !== 1 || [paid, basic].some((n) => n.layoutPositioning === "ABSOLUTE"))) {
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
  async function wireCopies2(frames, controls2, destinations2, fastId, basicId, defaultId = basicId) {
    const desired = /* @__PURE__ */ new Map([
      [controls2.paid.id, fastId],
      [controls2.basic.id, basicId],
      [controls2.next.id, defaultId]
    ]);
    const found = /* @__PURE__ */ new Set();
    const receipts = /* @__PURE__ */ new Set([fastId, basicId]);
    function remap(action, scope, onClick) {
      if (action.type === "CONDITIONAL") {
        const blocks = action.conditionalBlocks.map((block) => {
          const actions = block.actions.map((a) => remap(a, null, false));
          return actions.some((a, i) => a !== block.actions[i]) ? __spreadProps(__spreadValues({}, block), { actions }) : block;
        });
        return blocks.some((b, i) => b !== action.conditionalBlocks[i]) ? __spreadProps(__spreadValues({}, action), { conditionalBlocks: blocks }) : action;
      }
      if (action.type !== "NODE") return action;
      let id = destinations2.get(action.destinationId) || action.destinationId;
      if (scope && onClick && action.navigation === "NAVIGATE" && receipts.has(id)) {
        found.add(scope);
        id = desired.get(scope);
      }
      return id === action.destinationId ? action : __spreadProps(__spreadValues({}, action), { destinationId: id });
    }
    async function visit(node, scope) {
      if (desired.has(node.id)) scope = node.id;
      const original = node.reactions || [];
      const reactions = original.map((r) => {
        const actions = r.actions || (r.action ? [r.action] : []);
        const mapped = actions.map((a) => {
          var _a;
          return remap(a, scope, ((_a = r.trigger) == null ? void 0 : _a.type) === "ON_CLICK");
        });
        return mapped.some((a, i) => a !== actions[i]) ? { trigger: r.trigger, actions: mapped } : r;
      });
      if (reactions.some((r, i) => r !== original[i])) await node.setReactionsAsync(reactions);
      for (const child of node.children || []) await visit(child, scope);
    }
    for (const frame of frames) await visit(frame, null);
    for (const control2 of [controls2.paid, controls2.basic, controls2.next]) {
      if (found.has(control2.id)) continue;
      if ((control2.reactions || []).some((r) => {
        var _a;
        return ((_a = r.trigger) == null ? void 0 : _a.type) === "ON_CLICK";
      }))
        throw Error("배송 버튼의 클릭 동작을 안전하게 연결할 수 없습니다.");
      const click = {
        trigger: { type: "ON_CLICK" },
        actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId: desired.get(control2.id), transition: null }]
      };
      await control2.setReactionsAsync([...control2.reactions || [], click]);
    }
  }
  async function createShippingDesigns(api, spec) {
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
      "continueId"
    ];
    const nodes = await Promise.all(keys.map((key) => api.getNodeByIdAsync(spec[key])));
    if (nodes.some((n) => {
      var _a;
      return !n || n.removed || ((_a = pageOf(n)) == null ? void 0 : _a.id) !== page.id;
    }))
      throw Error("원본 배송 여정이 변경되었습니다. 다시 검사하세요.");
    const [shipping, fastReview, basicReview, paid, basic, paidSelection, basicSelection, next] = nodes;
    if ([shipping, fastReview, basicReview].some((n) => n.type !== "FRAME") || (/* @__PURE__ */ new Set([shipping.id, fastReview.id, basicReview.id])).size !== 3 || (/* @__PURE__ */ new Set([paid.id, basic.id, next.id])).size !== 3) {
      throw Error("서로 다른 배송 선택 화면과 두 확인 화면이 필요합니다.");
    }
    pathInFrame(paidSelection, paid);
    pathInFrame(basicSelection, basic);
    const paths = [paid, basic, paidSelection, basicSelection, next].map((node) => pathInFrame(node, shipping));
    const existing = page.children.slice(), existingNames = new Set(existing.map((n) => n.name));
    const baseLabels = ["원본 · 생성 시점", "최소 수정안", "비교 배치안"];
    const nameSet = (number2) => baseLabels.map((label) => shipping.name + " · " + label + (number2 > 1 ? " " + number2 : ""));
    let number = 1, labels = nameSet(number);
    while (labels.some(
      (label) => [label, label + " · 빠른배송 확인", label + " · 일반배송 확인"].some((name) => existingNames.has(name))
    ))
      labels = nameSet(++number);
    const originals = [shipping, fastReview, basicReview], rects = originals.map(canvasBounds);
    const column = Math.max(...rects.map((r) => r.width)) + GUTTER2, y = rects[0].y;
    const boardWidth = 2 * column + Math.max(...rects.map((r) => r.width));
    const boardHeight = rects.reduce((total, r) => total + r.height, 2 * GUTTER2);
    const x = roomToRight(existing, rects[0].x + rects[0].width + GUTTER2, y, boardWidth, boardHeight);
    const owned = [];
    function copy(source, name, x2, y2) {
      var _a;
      const clone = source.clone();
      owned.push(clone);
      if (((_a = clone.parent) == null ? void 0 : _a.id) !== page.id) page.appendChild(clone);
      clone.name = name;
      positionOnCanvas(clone, x2, y2);
      return clone;
    }
    try {
      const reference = copy(shipping, labels[0], x, y);
      const [referencePaid, referenceBasic, , , referenceNext] = paths.map((path) => atPath(reference, path));
      await wireCopies2(
        [reference],
        { paid: referencePaid, basic: referenceBasic, next: referenceNext },
        /* @__PURE__ */ new Map(),
        fastReview.id,
        basicReview.id,
        spec.defaultOption === "fast" ? fastReview.id : basicReview.id
      );
      const results = { referenceFrameId: reference.id };
      const starts = [];
      for (const [index, kind] of ["minimal", "layout"].entries()) {
        const left = x + (index + 1) * column, label = labels[index + 1];
        const frame = copy(shipping, label, left, y);
        const fast = copy(fastReview, label + " · 빠른배송 확인", left, y + rects[0].height + GUTTER2);
        const normal = copy(
          basicReview,
          label + " · 일반배송 확인",
          left,
          y + rects[0].height + rects[1].height + 2 * GUTTER2
        );
        const [paidRow, basicRow, paidState, basicState, continueButton] = paths.map((path) => atPath(frame, path));
        await setChoice(paidState, false);
        await setChoice(basicState, true);
        const dest = /* @__PURE__ */ new Map([
          [shipping.id, frame.id],
          [fastReview.id, fast.id],
          [basicReview.id, normal.id]
        ]);
        await wireCopies2(
          [frame, fast, normal],
          { paid: paidRow, basic: basicRow, next: continueButton },
          dest,
          fast.id,
          normal.id
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

  // src/hierarchy-proposals.js
  var pattern = "misleading_visual_hierarchy";
  var plainText = (text) => text.trim().replace(/\s+/g, " ");
  function readHierarchyProposal(journey, findings, pageId) {
    var _a, _b;
    if ((_a = journey.warnings) == null ? void 0 : _a.length) return null;
    const states = new Map(journey.states.map((state) => [state.state_id, state]));
    const outgoing = /* @__PURE__ */ new Map();
    for (const edge of journey.transitions) {
      if (!outgoing.has(edge.from_state_id)) outgoing.set(edge.from_state_id, []);
      outgoing.get(edge.from_state_id).push(edge);
    }
    const candidates = [];
    for (const finding2 of findings) {
      if (finding2.pattern !== pattern || finding2.evidence.length !== 2) continue;
      const [paidRef, basicRef] = finding2.evidence;
      if (paidRef.state_id !== basicRef.state_id || paidRef.node_id === basicRef.node_id) continue;
      const start = states.get(paidRef.state_id);
      if (!start) continue;
      const choices = [paidRef, basicRef].map(({ node_id }, index) => {
        const control2 = start.nodes.find((node) => node.node_id === node_id);
        const edges = (outgoing.get(start.state_id) || []).filter((edge) => edge.action.node_id === node_id);
        if (!control2 || control2.enabled === false || edges.length !== 1 || edges[0].uncertain || edges[0].action.type !== "click") return null;
        const destination = states.get(edges[0].to_state_id);
        if (!destination || destination.frame_id === start.frame_id) return null;
        return {
          control: control2,
          stateId: destination.state_id,
          step: {
            key: index === 0 ? "paid" : "basic",
            label: plainText(control2.text),
            detail: destination.name || "연결된 화면",
            frameId: destination.frame_id
          }
        };
      });
      if (choices.some((choice) => !(choice == null ? void 0 : choice.step.label)) || choices[0].step.frameId === choices[1].step.frameId) continue;
      const path = /* @__PURE__ */ new Set([start.state_id, ...choices.map((choice) => choice.stateId)]);
      for (const id of path) {
        if (id === start.state_id) continue;
        for (const edge of outgoing.get(id) || []) {
          if (!edge.uncertain && edge.action.type === "click" && states.has(edge.to_state_id)) path.add(edge.to_state_id);
        }
      }
      candidates.push({
        pageId,
        frameId: start.frame_id,
        frameIds: [...path].map((id) => states.get(id).frame_id),
        status: finding2.status,
        steps: choices.map((choice) => choice.step),
        controls: choices.map((choice) => choice.control)
      });
    }
    return (_b = candidates.find((candidate) => {
      var _a2;
      return candidate.frameId === ((_a2 = states.get(journey.entry_state_id)) == null ? void 0 : _a2.frame_id);
    })) != null ? _b : candidates.length === 1 ? candidates[0] : null;
  }
  function colorChannels(hex) {
    return /^#[0-9a-f]{6}$/i.test(hex || "") ? hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255) : null;
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
    const paint = palette.find((p) => {
      var _a;
      return p.type === "SOLID" && p.visible !== false && ((_a = p.opacity) != null ? _a : 1) === 1 && (!p.blendMode || p.blendMode === "NORMAL") && [p.color.r, p.color.g, p.color.b].every((c, i) => Math.round(c * 255) === Math.round([r, g, b][i] * 255));
    });
    node.fills = [paint || { type: "SOLID", color: { r, g, b } }];
  }
  var isAuto = (node) => Boolean((node == null ? void 0 : node.layoutMode) && node.layoutMode !== "NONE");
  var overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  var contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
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
    for (const sibling of parent.children) {
      if (sibling.id === basic.id || sibling.visible === false || !overlaps(target, sibling) || contains(sibling, target) || overlaps(before, sibling)) continue;
      const roomX = sibling.x - target.x, roomY = sibling.y - target.y;
      if (roomY >= before.height) target.height = Math.min(target.height, roomY);
      else if (roomX >= before.width) target.width = Math.min(target.width, roomX);
    }
    if (parent.clipsContent) {
      target.width = Math.min(target.width, parent.width - target.x);
      target.height = Math.min(target.height, parent.height - target.y);
    }
    if (target.width < label.width + 8 || target.height < label.height + 4 || target.width * target.height < paid.width * paid.height * 0.45)
      throw Error("기존 배치에 기본 선택 버튼을 넓힐 공간이 부족합니다.");
    return target;
  }
  async function adjustBasic(api, paid, basic, strong, weak) {
    var _a, _b;
    const paidLabel = textLabel(paid, plainText(strong.text));
    const label = textLabel(basic, plainText(weak.text));
    if (label.hasMissingFont || !label.fontName || typeof label.fontName !== "object" || typeof paidLabel.fontSize !== "number" || typeof label.fontSize !== "number")
      throw Error("기본 선택 문구의 편집 가능한 단일 글꼴과 크기가 필요합니다.");
    await api.loadFontAsync(label.fontName);
    const strongStyle = strong.style || {}, weakStyle = weak.style || {};
    const originalBg = weakStyle.background_color;
    const palette = [paid, paidLabel, basic, label].flatMap((node) => Array.isArray(node.fills) ? node.fills : []);
    let foreground = [weakStyle.text_color, strongStyle.background_color, strongStyle.text_color].find((color) => contrast(color, originalBg) >= 4.5);
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
    if (((_a = label.lineHeight) == null ? void 0 : _a.unit) === "PIXELS" && label.lineHeight.value < label.fontSize)
      label.lineHeight = { unit: "AUTO" };
    const size = blockSize(basic, paid, label);
    basic.resize(size.width, size.height);
    if (basic.type === "FRAME" && !isAuto(basic) && ((_b = label.parent) == null ? void 0 : _b.id) === basic.id)
      label.y = (basic.height - label.height) / 2;
  }
  function alignChoices(api, paid, basic, own) {
    var _a;
    const parent = paid.parent;
    if (!parent || parent.id !== ((_a = basic.parent) == null ? void 0 : _a.id) || !["FRAME", "GROUP"].includes(parent.type))
      throw Error("두 버튼을 같은 편집 가능한 프레임이나 그룹에 두고 다시 실행하세요.");
    for (let ancestor = parent; ancestor && ancestor.type !== "PAGE"; ancestor = ancestor.parent) {
      if (ancestor.type === "INSTANCE") throw Error("인스턴스 내부의 버튼은 비교 배치로 옮길 수 없습니다.");
    }
    const indexes = [paid, basic].map((node) => parent.children.findIndex((child) => child.id === node.id));
    const auto = isAuto(parent);
    if (parent.layoutMode === "GRID" || [paid, basic].some((node) => Math.abs(node.rotation || 0) > 0.01) || auto && (Math.abs(indexes[0] - indexes[1]) !== 1 || [paid, basic].some((node) => node.layoutPositioning === "ABSOLUTE")))
      throw Error("현재 자동 레이아웃의 다른 요소를 유지하면서 두 버튼을 묶을 수 없습니다.");
    const stack = auto ? parent.layoutMode === "VERTICAL" : Math.abs(paid.y - basic.y) >= Math.min(paid.height, basic.height) / 2;
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
  function createHierarchyProposals(api, spec) {
    const [strong, weak] = spec.controls;
    return cloneProposal(api, spec, async ({ kind, getNode, own }) => {
      const [paid, basic] = await Promise.all([strong, weak].map((control2) => getNode(spec.frameId, control2.node_id)));
      if ([paid, basic].some((node) => !node || !["FRAME", "INSTANCE"].includes(node.type)))
        throw Error("버튼의 프레임 또는 컴포넌트 인스턴스가 필요합니다.");
      await adjustBasic(api, paid, basic, strong, weak);
      if (kind === "layout") alignChoices(api, paid, basic, own);
    });
  }

  // src/pricing-proposals.js
  var normalized = (value) => value.replace(/\s/g, "");
  var amountText = /(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi;
  function directPath(journey, first, last) {
    const states = new Map(journey.states.map((state) => [state.state_id, joinPriceRows(state)]));
    const path = [];
    const visited = /* @__PURE__ */ new Set();
    for (let id = first; !visited.has(id); ) {
      const state = states.get(id);
      if (!state || path.length >= 8) return null;
      path.push(state);
      if (id === last) return path.length >= 2 ? path : null;
      visited.add(id);
      const next = journey.transitions.filter((edge) => edge.from_state_id === id);
      if (next.length !== 1 || next[0].uncertain || next[0].action.type !== "click") return null;
      id = next[0].to_state_id;
    }
    return null;
  }
  function readPricingProposal(journey, findings, pageId) {
    var _a;
    if (!journey.flow_start_confirmed || ((_a = journey.warnings) == null ? void 0 : _a.length)) return null;
    const reports = findings.filter((report) => report.pattern === "drip_pricing" && report.pricing);
    if (reports.length !== 1) return null;
    const { pricing, status } = reports[0];
    const { first, checkout, fee, base, firstAmount, finalAmount, baseAmount } = pricing;
    if (!base || !fee.label) return null;
    const path = directPath(journey, first.state_id, checkout.state_id);
    if (!path) return null;
    const feeNodes = (state) => state.nodes.filter((node) => {
      var _a2;
      const label = (_a2 = node.text.match(feeText)) == null ? void 0 : _a2[0];
      return label && normalized(label) === normalized(fee.label);
    });
    if (path.some((state) => feeNodes(state).some((node) => {
      const amount = money(node);
      return uncertainFee.test(node.text) || amount != null && amount !== fee.amount;
    }))) return null;
    const screens = path.map((state, index) => {
      var _a2;
      const label = state.name || (index === 0 ? "첫 가격" : "단계 " + (index + 1));
      const nodes = feeNodes(state);
      const feeShown = nodes.some((node) => money(node) === fee.amount);
      const baseShown = state.nodes.some((node) => /^상품\s*(?:가격|금액|소계)/.test(node.text) && money(node) === baseAmount);
      const headline = index === 0 ? offerPrice(state) || state.nodes.find((node) => node.node_id === first.node_id) : index === path.length - 1 ? state.nodes.find((node) => node.node_id === checkout.node_id) : offerPrice(state);
      const amount = headline ? money(headline) : null;
      const totalShown = amount === finalAmount || state.nodes.some((node) => totalText.test(node.text) && money(node) === finalAmount);
      const priceDetail = amount == null ? "대표 가격 미표시" : "표시 가격 " + won(amount);
      const feeDetail = feeShown ? "필수 비용 " + won(fee.amount) : "필수 비용 금액 미표시";
      return {
        frameId: state.frame_id,
        label,
        feeShown,
        baseShown,
        totalShown,
        headlineId: headline == null ? void 0 : headline.node_id,
        cardId: headline == null ? void 0 : headline.offer_action_id,
        headingId: (_a2 = state.nodes.filter((node) => node.role === "text" && node.text && money(node) == null).sort((a, b) => {
          var _a3, _b;
          return (((_a3 = b.style) == null ? void 0 : _a3.font_size_px) || 0) - (((_b = a.style) == null ? void 0 : _b.font_size_px) || 0);
        })[0]) == null ? void 0 : _a2.node_id,
        amount,
        detail: priceDetail + " · " + feeDetail + (totalShown ? " · 포함 총액 표시" : "")
      };
    });
    const firstFee = screens.find((screen) => screen.feeShown);
    const firstTotal = screens.find((screen) => screen.totalShown);
    if (!firstFee || !firstTotal) return null;
    return {
      pageId,
      frameId: path[0].frame_id,
      frameIds: screens.map((screen) => screen.frameId),
      status,
      summary: "필수 비용 " + won(fee.amount) + " 최초 표시: " + firstFee.label + " · 포함 총액 " + won(finalAmount) + " 최초 표시: " + firstTotal.label,
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
    var _a;
    if (node.type === "TEXT" && amountOf(node.characters) === amount) return node;
    const matches = (_a = node.findAll) == null ? void 0 : _a.call(node, (child) => child.type === "TEXT" && child.visible && amountOf(child.characters) === amount && !feeText.test(child.characters));
    return (matches == null ? void 0 : matches.length) === 1 ? matches[0] : null;
  }
  async function loadFont(api, layer) {
    if (layer.type !== "TEXT" || typeof layer.fontName !== "object" || layer.hasMissingFont)
      throw Error("가격 문구의 글꼴을 읽을 수 없습니다. 한 가지 글꼴을 사용한 텍스트 레이어를 지정하세요.");
    await api.loadFontAsync(layer.fontName);
  }
  function setInstanceProperty(layer, reference, type, value) {
    var _a, _b;
    const property = (_a = layer.componentPropertyReferences) == null ? void 0 : _a[reference];
    if (!property) return false;
    for (let owner = layer.parent; owner && owner.type !== "PAGE"; owner = owner.parent) {
      if (owner.type === "INSTANCE" && ((_b = owner.componentProperties[property]) == null ? void 0 : _b.type) === type) {
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
    var _a;
    const matches = (_a = card.findAll) == null ? void 0 : _a.call(card, (node) => {
      var _a2;
      if (node.type !== "TEXT" || node.id === price.id) return false;
      const kind = (_a2 = node.characters.match(feeText)) == null ? void 0 : _a2[0];
      return kind && normalized(kind) === normalized(fee.label) && /포함/.test(node.characters) && !uncertainFee.test(node.characters) && amountOf(node.characters) == null;
    });
    if ((matches == null ? void 0 : matches.length) !== 1) return false;
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
        const index = parent.children.findIndex((child) => child.id === item.id);
        const right = parent.width - parent.paddingLeft - parent.paddingRight;
        if (block.width > right || parent.primaryAxisSizingMode !== "AUTO" && parent.clipsContent) continue;
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
    var _a;
    const block = api.createFrame();
    try {
      block.name = layout ? "포함 가격 내역" : "필수 비용 안내";
      block.layoutMode = "VERTICAL";
      block.primaryAxisSizingMode = "AUTO";
      block.counterAxisSizingMode = "AUTO";
      block.itemSpacing = layout ? 3 : 0;
      block.fills = layout && Array.isArray((_a = feeStyle.parent) == null ? void 0 : _a.fills) ? feeStyle.parent.fills : [];
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
  function createPricingProposals(api, spec) {
    const { pricing, screens } = spec;
    return cloneProposal(api, spec, async ({ kind, frame, getNode }) => {
      const checkout = screens[screens.length - 1];
      const feeStyle = await getNode(checkout.frameId, pricing.fee.node_id);
      const baseStyle = await getNode(checkout.frameId, pricing.base.node_id);
      const totalStyle = await getNode(checkout.frameId, pricing.checkout.node_id);
      if ([feeStyle, baseStyle, totalStyle].some((node) => node.type !== "TEXT"))
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
        const anchor = price || screen.headingId && await getNode(screen.frameId, screen.headingId);
        if (!anchor) continue;
        const rows = [];
        if (kind === "layout" && !screen.baseShown) {
          rows.push({ label: "상품 소계", text: "상품 소계 " + won(pricing.baseAmount), style: baseStyle });
        }
        if (!screen.feeShown) {
          const label = "필수 고정 " + pricing.fee.label + " " + won(pricing.fee.amount) + " 포함";
          const card = screen.cardId ? await getNode(screen.frameId, screen.cardId) : price == null ? void 0 : price.parent;
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

  // src/main.js
  figma.showUI(__html__, { width: 540, height: 700, themeColors: true });
  startPanel(figma, async (frame, startConfirmedByDesigner) => {
    const journey = await readJourney(figma, frame);
    if (startConfirmedByDesigner) journey.flow_start_confirmed = true;
    const layerLabels = /* @__PURE__ */ new Map();
    for (const state of journey.states) {
      const labels = /* @__PURE__ */ new Map();
      for (const node of state.nodes) {
        const label = (node.text || node.name || node.role || "레이어").replace(/\s+/g, " ").trim().slice(0, 60);
        labels.set(node.node_id, label);
      }
      layerLabels.set(state.state_id, labels);
    }
    const findings = analyzeJourney(journey).map((finding2) => __spreadProps(__spreadValues({}, finding2), {
      evidence: finding2.evidence.map((item) => {
        var _a;
        return __spreadProps(__spreadValues({}, item), {
          label: ((_a = layerLabels.get(item.state_id)) == null ? void 0 : _a.get(item.node_id)) || "프레임 보기"
        });
      })
    }));
    return {
      frameName: frame.name,
      stateCount: journey.states.length,
      transitionCount: journey.transitions.length,
      canConfirmStart: !journey.flow_start_confirmed,
      warnings: journey.warnings || [],
      findings,
      shipping: readShippingScenario(journey, figma.currentPage.id),
      proposals: {
        hierarchy: readHierarchyProposal(journey, findings, figma.currentPage.id),
        price: readPricingProposal(journey, findings, figma.currentPage.id)
      }
    };
  }, createShippingDesigns, { hierarchy: createHierarchyProposals, price: createPricingProposals });
})();

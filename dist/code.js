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
  function componentSelection(layer) {
    const properties = layer.componentProperties || {};
    for (const [key, property] of Object.entries(properties)) {
      const name = key.split("#")[0].trim();
      if (!/^(is[\s_-]?)?(checked|selected|선택|체크)(\s*여부)?$/i.test(name) && !/^(selection|check state|선택 상태|state|상태)$/i.test(name)) continue;
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
  function solidColor(paints) {
    var _a;
    if (!Array.isArray(paints)) return void 0;
    const visible = paints.filter((p) => p.visible !== false && p.opacity !== 0);
    if (visible.length !== 1 || visible[0].type !== "SOLID" || ((_a = visible[0].opacity) != null ? _a : 1) !== 1) return void 0;
    return "#" + ["r", "g", "b"].map((key) => {
      const channel = Math.round(visible[0].color[key] * 255);
      return channel.toString(16).padStart(2, "0").toUpperCase();
    }).join("");
  }
  function intersects(rect, clip) {
    return !rect || !clip || rect.x < clip.x + clip.width && rect.x + rect.width > clip.x && rect.y < clip.y + clip.height && rect.y + rect.height > clip.y;
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
    function walk(layer, owner, parentOpacity, parentColor, clip, depth) {
      var _a, _b;
      if (budget.layers === 0 || depth > MAX_DEPTH) {
        warnings.add("레이어 수 또는 중첩 깊이 한도에 도달해 일부 레이어를 생략했습니다.");
        return;
      }
      budget.layers--;
      const opacity = parentOpacity * ((_a = layer.opacity) != null ? _a : 1);
      if (layer.visible === false || opacity === 0) return;
      const rect = layer.absoluteBoundingBox;
      if (!intersects(rect, clip)) {
        warnings.add("프레임 밖으로 완전히 잘린 레이어는 현재 화면에서 제외했습니다.");
        return;
      }
      const textLayer = layer.type === "TEXT";
      const paints = layer.fills;
      let background = parentColor;
      const hasPaint = Array.isArray(paints) ? paints.some((p) => p.visible !== false && p.opacity !== 0) : Boolean(paints);
      if (!textLayer && hasPaint) {
        background = solidColor(paints);
      }
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
          if (owner === part && ["button", "link"].includes(part.item.role) && /^(?:(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원)$/i.test(text)) {
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
      const nextClip = layer.clipsContent ? clipRect(rect, clip) : clip;
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

  // src/analyze.js
  var patterns = {
    paid_option_preselection: "특정옵션 사전선택",
    misleading_visual_hierarchy: "잘못된 계층구조",
    drip_pricing: "순차공개 가격책정"
  };
  function finding(pattern, status, reason, suggestion, evidence = []) {
    return { pattern, status, title: patterns[pattern], reason, suggestion, evidence };
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
    const pattern = "paid_option_preselection";
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
            pattern,
            "needs_context",
            "유료 옵션을 발견했습니다. 첫 진입 시점과 선택 상태를 함께 확인해야 합니다.",
            "여정 시작점에서 옵션까지 연결하고 선택 전후를 컴포넌트 상태로 표시하세요.",
            proof
          ));
        } else if (option.checked) {
          results.push(finding(
            pattern,
            "risk_signal",
            "사용자가 이 유료 옵션을 고르는 동작을 거치지 않은 경로에서 ‘" + option.text + "’이 선택되어 있습니다.",
            "기본 상태에서 이 옵션을 해제하고 직접 선택했을 때만 비용을 반영하세요.",
            proof
          ));
        } else {
          results.push(finding(
            pattern,
            "signal_absent",
            "첫 진입 경로에서 ‘" + option.text + "’은 선택 해제 상태입니다.",
            "이 옵션을 직접 선택한 경우에만 다음 단계의 금액이 바뀌는지 재검사하세요.",
            proof
          ));
        }
      }
    }
    return results.length ? results : [finding(
      pattern,
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
    const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    return { area: node.bounds.width * node.bounds.height, font: s.font_size_px, contrast, opacity: (_c = s.opacity) != null ? _c : 1 };
  }
  function visualHierarchy(graph) {
    const pattern = "misleading_visual_hierarchy";
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
        pattern,
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
          pattern,
          "risk_signal",
          "‘" + weak.text + "’은 이동 가능한 선택지이지만 ‘" + strong.text + "’보다 작고 흐려 비활성처럼 보일 수 있습니다.",
          "두 선택지를 읽기 쉬운 크기와 대비로 나란히 제시하고 기본 경로가 계속 작동하는지 확인하세요.",
          evidence
        ));
      } else if (b.contrast >= 3 && b.opacity >= 0.7 && !small) {
        results.push(finding(
          pattern,
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
      pattern,
      "needs_context",
      "함께 제시되는 유료·기본 선택지의 스타일과 연결 정보를 찾지 못했습니다.",
      "가입, 구매 또는 해지 선택지가 함께 보이는 프레임을 포함하세요."
    )];
  }
  function offerPrice(state) {
    const controls = new Map(state.nodes.filter(button).map((n) => [n.node_id, n]));
    const isCard = (n) => /[가-힣a-z]/i.test(n.text.replace(/₩?\s*[\d,]+\s*원?/g, "")) && !/결제|구매하기|장바구니|담기|선택|추가|옵션|동의|계속|신청|가입|주문하기/.test(n.text);
    const isPrice = (n) => money(n) !== null && !totalText.test(n.text) && !feeText.test(n.text) && !/할인액|적립|쿠폰|정가/.test(n.text);
    const represented = /* @__PURE__ */ new Set(), options = [];
    for (const n of state.nodes) {
      if (n.role !== "text" || !isPrice(n)) continue;
      const owner = controls.get(n.control_node_id || n.parent_id);
      if (!owner) options.push(n);
      else if (isCard(owner)) {
        options.push(__spreadProps(__spreadValues({}, n), { offer_action_id: owner.node_id }));
        represented.add(owner.node_id);
      }
    }
    for (const card of controls.values()) {
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
    var _a, _b, _c;
    const pattern = "drip_pricing";
    const unresolved = (proof = []) => finding(
      pattern,
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
        const negated = /(?:필수|의무|고정|정액)(?:은|는|가|이|적용|되지)?\s*(?:아[닌님니닙]|없|않|제외|X\b)|선택\s*(배송|사항)|조건부/i;
        const variable = /변동|달라|다를|따라|상이|미정|별도\s*산정|지역별|주소별|무게별/;
        const feeNotes = [...start.nodes, ...checkout.nodes].filter((n) => feeText.test(n.text));
        if (feeNotes.some((n) => negated.test(n.text) || variable.test(n.text))) {
          checks.push(unresolved(proof));
          continue;
        }
        const mandatory = (_b = spec == null ? void 0 : spec.mandatory) != null ? _b : /필수|의무|모든\s*(주문|구매)/.test(fee.text) ? true : null;
        const fixed = (_c = spec == null ? void 0 : spec.known_at_first_price) != null ? _c : /고정|정액|일괄|일률/.test(fee.text) ? true : null;
        if (firstAmount === finalAmount) {
          checks.push(finding(
            pattern,
            "signal_absent",
            "이 주문 경로는 첫 표시 가격과 배송비·수수료를 포함한 최종 금액이 " + won(finalAmount) + "으로 같습니다.",
            "첫 가격과 주문 명세가 계속 일치하는지 확인하세요.",
            proof
          ));
        } else if (mandatory === true && fixed === true) {
          checks.push(finding(
            pattern,
            "risk_signal",
            "첫 가격 " + won(firstAmount) + "에 확정된 필수 비용 " + won(feeAmount) + "이 빠져 주문 금액이 " + won(finalAmount) + "이 됩니다.",
            "첫 가격에 총 " + won(finalAmount) + "을 표시하고 포함된 필수 비용을 함께 안내하세요.",
            proof
          ));
        } else {
          const explicit = selectedFeeOnPath(graph, start, checkout, fee, sameProduct);
          if (mandatory !== true && explicit) {
            checks.push(finding(
              pattern,
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

  // src/controller.js
  function startPanel(api, inspectFrame) {
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
    async function scan(useSelection) {
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
        post("result", result);
      } catch (error) {
        if (generation !== version) return;
        console.error("FairFlow scan", error);
        post("error", { message: "프레임을 읽는 중 오류가 발생했습니다. 프레임을 선택하고 다시 검사하세요." });
      }
    }
    async function focus({ state_id, node_id }) {
      var _a;
      const version = generation;
      if (!((_a = evidenceByState.get(state_id)) == null ? void 0 : _a.has(node_id))) {
        post("notice", { message: "이 근거가 현재 검사 결과에 없습니다. 다시 검사하세요." });
        return;
      }
      try {
        const node = await api.getNodeByIdAsync(node_id);
        if (generation !== version) return;
        if (!node || node.removed) {
          post("notice", { message: "레이어가 삭제되었습니다. 다시 검사하세요." });
          return;
        }
        let page = node.parent;
        while (page && page.type !== "PAGE") page = page.parent;
        if (!page) return;
        if (page.id !== api.currentPage.id) await api.setCurrentPageAsync(page);
        if (generation !== version) return;
        api.currentPage.selection = [node];
        api.viewport.scrollAndZoomIntoView([node]);
      } catch (e) {
        post("notice", { message: "레이어를 열 수 없습니다. 프레임을 다시 검사하세요." });
      }
    }
    api.ui.onmessage = async (message) => {
      if (!message || typeof message !== "object") return;
      switch (message.type) {
        case "ready":
          ready = true;
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
      }
    };
    api.on("selectionchange", () => {
      if (ready && !rootId && selectedFrame()) return scan(true);
    });
  }

  // src/main.js
  figma.showUI(__html__, { width: 420, height: 620, themeColors: true });
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
      findings
    };
  });
})();

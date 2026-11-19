import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { reviewContent } from "../src/review-content.js";

function loadPanel() {
  const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const window = new EventTarget();
  const elements = new Map();
  const sent = [];
  const parent = { postMessage: (data) => sent.push(JSON.parse(JSON.stringify(data.pluginMessage))) };

  class Element extends EventTarget {
    constructor(tagName) {
      super();
      this.tagName = tagName;
      this.className = "";
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.open = false;
      this.label = "";
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    get textContent() { return this.label + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.label = value; this.children = []; }
    click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
  }

  const createElement = tagName => new Element(tagName);
  const document = {
    createElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    }
  };
  for (const [, script] of scripts) runInNewContext(script, { window, document, parent });
  const deliver = (source, data) => window.dispatchEvent(Object.assign(new Event("message"), { source, data }));
  return { deliver, elements, sent };
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

const hasClass = name => node => node.className.split(/\s+/).includes(name);

test("the panel renders relayed Figma replies and ignores unsupported messages", () => {
  const { deliver, elements, sent } = loadPanel();
  assert.deepEqual(sent, [{ type: "ready" }]);
  const relay = new EventTarget();
  deliver(relay, { pluginMessage: {
    type: "result", frameName: "배송 방법", stateCount: 1, transitionCount: 0, findings: []
  } });
  assert.equal(elements.get("announcement").textContent, "배송 방법 검사 완료. 위험 신호 0건.");
  assert.equal(elements.get("scan").hidden, false);

  deliver(null, { pluginMessage: { type: "notice", message: "레이어가 삭제되었습니다." } });
  for (const data of [null, { type: "notice" }, { pluginMessage: "notice" }, { pluginMessage: { type: "unknown" } }]) {
    deliver(relay, data);
  }
  assert.equal(elements.get("notice").textContent, "레이어가 삭제되었습니다.");
  assert.equal(elements.get("scan").hidden, false);
});

test("manual inspection shows the issue, legal basis, alternatives and evidence together", () => {
  const { deliver, elements, sent } = loadPanel();
  const relay = new EventTarget();
  const reply = pluginMessage => deliver(relay, { pluginMessage });
  reply({ type: "selection", frameId: null, name: null });
  assert.equal(elements.get("scan-selection").disabled, true);
  reply({ type: "selection", frameId: "1:10", name: "배송 방법" });
  assert.equal(elements.get("scan-selection").disabled, false);
  assert.match(elements.get("content").textContent + elements.get("selection-info").textContent, /배송 방법/);
  assert.deepEqual(sent, [{ type: "ready" }]);
  elements.get("scan-selection").click();
  assert.deepEqual(sent.at(-1), { type: "scan-selection" });
  const issue = {
    pattern: "paid_option_preselection", status: "risk_signal",
    title: "특정옵션 사전선택", reason: "빠른배송 요금이 사용자의 선택 전에 추가됩니다.",
    suggestion: "기본값을 일반배송으로 바꾸세요.",
    evidence: [{ state_id: "1:10", node_id: "1:11", label: "빠른배송" }]
  };
  reply({
    type: "result",
    rootId: "1:10",
    frameName: "배송 방법",
    stateCount: 3,
    transitionCount: 3,
    shipping: { basicTotal: 29900, fastTotal: 34900 },
    findings: [
      {
        pattern: "drip_pricing", status: "needs_context",
        title: "순차공개 가격책정", reason: "총액을 확인할 수 없습니다.", suggestion: "총액을 확인하세요."
      },
      { ...issue, review: reviewContent(issue) }
    ]
  });
  assert.equal(elements.get("scan-selection").hidden, true);

  const all = descendants(elements.get("content"));
  const risk = all.find(node => hasClass("finding")(node) && node.dataset.status === "risk_signal");
  assert.ok(risk, "the primary risk should be visible in a result card");
  const riskNodes = descendants(risk);
  assert.match(risk.textContent, /유료 옵션이 미리 선택/);
  const legal = riskNodes.find(hasClass("review-rule"));
  assert.ok(legal, "the legal basis should be part of the result card");
  assert.match(legal.textContent, /제21조의2 제1항 제2호/);
  assert.match(legal.textContent, /소비자가 직접 고르기 전에/);
  const alternatives = riskNodes.filter(hasClass("review-alternative"));
  assert.equal(alternatives.length, 2);
  assert.match(alternatives[0].textContent, /처음에는 선택 해제/);
  assert.match(alternatives[1].textContent, /옵션과 요금을 나란히/);

  const evidence = descendants(risk).find(hasClass("layer"));
  assert.equal(evidence.textContent, "빠른배송");
  evidence.click();
  assert.deepEqual(sent.at(-1), { type: "focus", state_id: "1:10", node_id: "1:11" });

  reply({ type: "selection", frameId: "1:40", name: "주문 확인" });
  assert.equal(elements.get("scan-selection").hidden, false);
  assert.match(elements.get("content").textContent + elements.get("selection-info").textContent, /주문 확인/);
  assert.equal(elements.get("scan").hidden, false);
  elements.get("scan-selection").click();
  assert.deepEqual(sent.at(-1), { type: "scan-selection" });
  const pendingActions = sent.length;
  elements.get("scan-selection").click();
  assert.equal(sent.length, pendingActions, "a scan in progress should prevent duplicate requests");
  reply({ type: "loading", message: "주문 확인의 화면과 연결을 읽고 있습니다." });
  assert.equal(elements.get("scan-selection").hidden, false, "the starting button should remain visible during a scan");
  assert.equal(elements.get("scan").hidden, false);
});

test("a copy-only correction shows the current and replacement wording", () => {
  const { deliver, elements } = loadPanel();
  const finding = {
    pattern: "drip_pricing", status: "risk_signal", title: "순차공개 가격책정",
    reason: "필수 배송비가 나중에 표시됩니다.", suggestion: "첫 가격에 배송비를 포함하세요.",
    pricing: { firstAmount: 29900, finalAmount: 32900, fee: { label: "배송비", amount: 3000 } },
    copyEdit: { fields: [{ before: "29,900원", after: "32,900원 · 필수 배송비 3,000원 포함" }] },
    evidence: []
  };
  deliver(null, { pluginMessage: {
    type: "result", frameName: "상품 페이지", rootId: "1:20",
    stateCount: 2, transitionCount: 1, findings: [{ ...finding, review: reviewContent(finding) }]
  } });
  const all = descendants(elements.get("content"));
  assert.match(all.find(hasClass("review-rule")).textContent, /제21조의2 제1항 제1호/);
  const plans = all.filter(hasClass("review-alternative"));
  assert.equal(plans.length, 1);
  assert.match(plans[0].textContent, /29,900원/);
  assert.match(plans[0].textContent, /32,900원 · 필수 배송비 3,000원 포함/);
});

test("an inspection error lets the user retry the same frame while a text layer is selected", () => {
  const { deliver, elements, sent } = loadPanel();
  const reply = pluginMessage => deliver(null, { pluginMessage });
  reply({ type: "selection", frameId: "1:20", name: "상품 페이지" });
  reply({ type: "result", rootId: "1:20", frameName: "상품 페이지", findings: [] });
  reply({ type: "selection", frameId: null, name: null });
  const rescan = elements.get("scan");
  rescan.click();
  reply({ type: "loading" });
  reply({ type: "error", retryRootId: "1:20", message: "잠시 후 다시 검사하세요." });
  assert.equal(rescan.hidden, false);
  assert.equal(rescan.disabled, false);
  assert.equal(elements.get("scan-selection").hidden, true);
  const before = sent.length;
  rescan.click();
  assert.equal(sent.length, before + 1);
  assert.deepEqual(sent.at(-1), { type: "scan" });
});

test("a clear inspected frame shows the clean result without legal or change cards", () => {
  const { deliver, elements } = loadPanel();
  deliver(null, { pluginMessage: {
    type: "result", frameName: "배송 선택", rootId: "1:30",
    stateCount: 3, transitionCount: 3, findings: [{
      pattern: "paid_option_preselection", status: "signal_absent",
      title: "특정옵션 사전선택", reason: "유료 배송 옵션을 직접 선택할 수 있습니다.", evidence: []
    }]
  } });
  const root = elements.get("content");
  const all = descendants(root);
  assert.match(root.textContent, /문제 없음/);
  assert.equal(all.some(hasClass("review-rule")), false);
  assert.equal(all.some(hasClass("review-alternative")), false);
});

test("the inspection compares model signals without changing the rule finding", () => {
  const { deliver, elements } = loadPanel();
  const reply = pluginMessage => deliver(null, { pluginMessage });
  const result = {
    type: "result", frameName: "배송 방법", rootId: "1:10", stateCount: 3, transitionCount: 3,
    findings: [{
      pattern: "paid_option_preselection", status: "risk_signal", title: "특정옵션 사전선택",
      reason: "유료 옵션이 처음부터 선택되어 있습니다.", evidence: []
    }]
  };
  reply({ ...result, comparison: [
    { pattern: "paid_option_preselection", ruleStatus: "risk_signal", modelStatus: "signal_absent", score: 0.499 },
    { pattern: "misleading_visual_hierarchy", ruleStatus: "needs_context", modelStatus: "needs_context", score: null },
    { pattern: "drip_pricing", ruleStatus: "risk_signal", modelStatus: "risk_signal", score: 0.84 }
  ] });

  const root = elements.get("content");
  const all = descendants(root);
  const comparison = all.find(hasClass("model-comparison"));
  assert.ok(comparison, "the inspected frame should have a comparison section");
  assert.equal(comparison.open, false);
  assert.match(comparison.children[0].textContent, /결과 다름 1개/);
  assert.match(comparison.textContent, /기존 규칙/);
  assert.match(comparison.textContent, /로지스틱 회귀/);
  assert.match(comparison.textContent, /합성 사례/);
  const rows = descendants(comparison).filter(hasClass("model-comparison-row"));
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /특정옵션 사전선택.*위험 신호.*신호 없음.*위험 점수 49점/);
  assert.match(rows[1].textContent, /잘못된 계층구조.*정보 부족.*정보 부족/);
  assert.doesNotMatch(rows[1].textContent, /위험 점수/);
  assert.match(rows[2].textContent, /순차공개 가격책정.*위험 점수 84점/);
  assert.equal(all.find(hasClass("finding")).dataset.status, "risk_signal");

  reply({ type: "loading", message: "다시 검사 중" });
  assert.equal(descendants(root).some(hasClass("model-comparison")), false);
  reply({ ...result, rootId: "1:50", frameName: "다른 배송 화면" });
  assert.equal(descendants(root).some(hasClass("model-comparison")), false);
});

test("pricing records open their evidence and request the current fact before showing a model score", () => {
  const { deliver, elements, sent } = loadPanel();
  const reply = pluginMessage => deliver(null, { pluginMessage });
  const inspection = {
    type: "result", frameName: "의류", rootId: "3:1", scanVersion: 2,
    findings: [{ pattern: "paid_option_preselection", status: "signal_absent", evidence: [] }]
  };
  const observations = [
    { label: "첫 판매가", value: "62,000원", evidence: { state_id: "3:1", node_id: "3:7" } },
    { label: "결제 합계", value: "102,000원", evidence: { state_id: "4:1", node_id: "4:9" } }
  ];
  const root = elements.get("content");
  const byId = id => descendants(root).find(node => node.id === id);
  reply({ ...inspection, priceInput: {
    status: "needs_context", observations, blockers: ["배송비 적용 조건을 확인해 주세요."],
    question: { id: "requiredForOrder", prompt: "이 주문에서 배송비가 반드시 붙나요?" },
    confirmations: [], signals: [{ label: "결제 합계 대비 증가분", value: "39.2%" }], score: null
  } });
  assert.equal(byId("price-input").dataset.status, "needs_context");
  assert.match(root.textContent, /추가 확인 필요/);
  assert.doesNotMatch(root.textContent, /문제 없음/);
  assert.match(byId("price-input-journey").textContent, /첫 판매가.*62,000원/);
  assert.match(byId("price-input-model").textContent, /이 주문에서 배송비가 반드시 붙나요/);
  assert.doesNotMatch(byId("price-input-model").textContent, /배송비 적용 조건을 확인/);
  assert.match(byId("price-input-model").textContent, /결제 합계 대비 증가분.*39.2%/);
  assert.equal(byId("price-input-score"), undefined);
  descendants(byId("price-input-journey")).find(node => node.dataset.nodeId === "4:9").click();
  assert.deepEqual(sent.at(-1), { type: "focus", state_id: "4:1", node_id: "4:9" });
  const question = byId("price-input-question");
  assert.equal(question.dataset.factId, "requiredForOrder");
  assert.match(question.textContent, /배송비가 반드시 붙나요/);
  const answers = descendants(question).filter(node => node.dataset.priceAnswer);
  assert.deepEqual(answers.map(node => node.dataset.priceAnswer), ["yes", "no", "unknown"]);
  answers[0].click();
  assert.deepEqual(sent.at(-1), {
    type: "answer-price-fact", scanVersion: 2, rootId: "3:1", factId: "requiredForOrder", answer: "yes"
  });
  const sentCount = sent.length;
  answers[1].click();
  assert.equal(sent.length, sentCount);

  reply({ ...inspection, scanVersion: 3, priceInput: {
    status: "ready", observations, blockers: [], question: null, score: 0.93,
    confirmations: [{ label: "배송비 적용", value: "필수" }]
  } });
  assert.equal(byId("price-input").dataset.status, "ready");
  assert.match(byId("price-input-model").textContent, /배송비 적용.*필수/);
  assert.match(byId("price-input-score").textContent, /93점/);
  assert.match(root.textContent, /가격 모델에서 위험 신호/);
  assert.equal(byId("price-input-question"), undefined);
  const reset = byId("price-input-reset");
  assert.equal(reset.textContent, "답변 다시 입력");
  reset.click();
  assert.deepEqual(sent.at(-1), { type: "reset-price-facts", scanVersion: 3, rootId: "3:1" });
  reply({ type: "loading", message: "다시 검사 중" });
  assert.equal(byId("price-input"), undefined);
});

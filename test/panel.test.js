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

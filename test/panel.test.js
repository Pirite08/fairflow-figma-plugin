import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

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

test("the results show the issue and fix first, with follow-up tools collapsed", () => {
  const { deliver, elements, sent } = loadPanel();
  const reason = "빠른배송 요금이 사용자의 선택 전에 추가됩니다.";
  const fix = "기본값을 일반배송으로 바꾸세요.";
  const relay = new EventTarget();
  const reply = pluginMessage => deliver(relay, { pluginMessage });
  reply({ type: "selection", frameId: null, name: null });
  assert.equal(elements.get("scan-selection").disabled, true);
  reply({ type: "selection", frameId: "1:10", name: "배송 방법" });
  assert.equal(elements.get("scan-selection").disabled, false);
  assert.match(elements.get("selection-info").textContent, /배송 방법/);
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
      {
        pattern: "paid_option_preselection", status: "risk_signal",
        title: "특정옵션 사전선택", reason, suggestion: fix,
        evidence: [{ state_id: "1:10", node_id: "1:11", label: "빠른배송" }]
      }
    ]
  });
  assert.equal(elements.get("scan-selection").hidden, true);

  const all = descendants(elements.get("content"));
  const risk = all.find(node => hasClass("finding")(node) && node.dataset.status === "risk_signal");
  assert.ok(risk, "the primary risk should be visible in a result card");
  assert.equal(risk.open, true);
  const comparison = descendants(risk).find(hasClass("finding-compare"));
  assert.ok(comparison, "the issue and fix should share a visual comparison");
  assert.match(comparison.textContent, /문제.*빠른배송 요금/);
  assert.match(comparison.textContent, /수정 방향.*기본값을 일반배송/);
  assert.deepEqual(
    descendants(comparison).filter(hasClass("check-illustration")).map(box => box.dataset.checked),
    ["true", "false"],
  );
  const other = all.find(hasClass("other-findings"));
  const advanced = all.find(hasClass("advanced-tools"));
  assert.ok(other && advanced, "follow-up checks and advanced tools should be grouped separately");
  assert.equal(other.open, false);
  assert.equal(advanced.open, false);
  assert.ok(all.indexOf(risk) < all.indexOf(advanced));
  assert.ok(descendants(other).some(node => node.dataset.status === "needs_context"));
  assert.ok(descendants(advanced).some(node => node.id === "shipping-create"));

  const evidence = descendants(risk).find(hasClass("layer"));
  assert.equal(evidence.textContent, "빠른배송");
  evidence.click();
  assert.deepEqual(sent.at(-1), { type: "focus", state_id: "1:10", node_id: "1:11" });

  reply({ type: "selection", frameId: "1:40", name: "주문 확인" });
  assert.equal(elements.get("scan-selection").hidden, false);
  assert.match(elements.get("selection-info").textContent, /주문 확인/);
  assert.equal(elements.get("scan").hidden, false);
  elements.get("scan-selection").click();
  assert.deepEqual(sent.at(-1), { type: "scan-selection" });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
const asset = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const solid = (r, g, b) => [{type: "SOLID", color: {r, g, b}}];
const white = solid(1, 1, 1);

function frame(id, name, children) {
  const result = {id, name, type: "FRAME", children, fills: white};
  for (const child of children) child.parent = result;
  return result;
}
function text(id, characters, props = {}) {
  return {id, type: "TEXT", characters, name: "Label", ...props};
}
function button(id, label, to, props = {}) {
  return {
    ...frame(id, "Button", [text(id + "-label", label, props.text)]),
    ...props.container,
    reactions: [{
      trigger: {type: "ON_CLICK"},
      actions: [{type: "NODE", navigation: "NAVIGATE", destinationId: to}]
    }]
  };
}

function runPlugin(screens, registeredStart = true) {
  const first = screens[0];
  const page = {
    id: "page", type: "PAGE", selection: [first],
    flowStartingPoints: registeredStart ? [{nodeId: first.id, name: "구매"}] : []
  };
  const index = new Map();
  function indexNode(node, parent) {
    node.parent = parent;
    index.set(node.id, node);
    for (const child of node.children || []) indexNode(child, node);
  }
  for (const screen of screens) indexNode(screen, page);
  const messages = [];
  const zoomedLayers = [];
  const api = {
    currentPage: page, getNodeByIdAsync: async id => index.get(id) || null,
    ui: { postMessage: msg => messages.push(msg) },
    viewport: {scrollAndZoomIntoView(nodes) { zoomedLayers.push(...nodes.map(n => n.id)); }},
    showUI(html) { assert.ok(html.includes("FairFlow")); }, on() {}
  };
  runInNewContext(asset(manifest.main), { figma: api, __html__: asset(manifest.ui), console });
  return { api, messages, zoomedLayers, send: msg => api.ui.onmessage(msg) };
}

async function focusAndRecheck(host, finding, id, edit) {
  const root = host.api.currentPage.selection[0];
  const evidence = finding.evidence.find(e => e.node_id === id);
  assert.ok(evidence?.label, "expected a labelled evidence button");
  await host.send({type: "focus", ...evidence});
  assert.equal(host.api.currentPage.selection[0].id, id);
  assert.equal(host.zoomedLayers.at(-1), id);
  edit();
  await host.send({type: "scan"});
  const updated = host.messages.at(-1);
  assert.equal(updated.frameName, root.name);
  assert.equal(host.api.currentPage.selection[0].id, id);
  assert.equal(updated.findings.find(f => f.pattern === finding.pattern).status, "signal_absent");
}

test("manifest entry follows a price journey, focuses its layer and sees an edited price", async () => {
  const price = text("first-price", "29,900원");
  const source = frame("shop", "상품", [price, button("order", "주문 확인", "checkout")]);
  const target = frame("checkout", "주문 확인", [
    text("base", "상품 29,900원"), text("charge", "필수 고정 배송비 3,000원"), text("total", "결제 예정 금액 32,900원")
  ]);
  const host = runPlugin([source, target], false);
  await host.send({type: "ready"});
  const priceFinding = () => host.messages.at(-1).findings.find(f => f.pattern === "drip_pricing");
  assert.equal(host.messages.at(-1).canConfirmStart, true);
  assert.equal(priceFinding().status, "needs_context");
  await host.send({type: "confirm-start"});
  assert.equal(priceFinding().status, "risk_signal");
  assert.equal(host.messages.at(-1).stateCount, 2);
  const evidence = priceFinding().evidence.find(e => e.node_id === "charge");
  assert.match(evidence.label, /3,000원/);
  await focusAndRecheck(host, priceFinding(), "charge", () => { price.characters = "32,900원"; });
});

test("manifest entry reads paid radio state from a component instance", async () => {
  const radio = {
    ...frame("express", "Radio", [text("caption", "빠른배송 +5,000원")]), type: "INSTANCE",
    componentProperties: {"Selected#8:1": {type: "BOOLEAN", value: true}}
  };
  const first = frame("entry", "상품", [button("next", "배송 옵션 보기", "delivery")]);
  const host = runPlugin([first, frame("delivery", "배송 옵션", [radio])]);
  await host.send({type: "ready"});
  const finding = host.messages.at(-1).findings.find(f => f.pattern === "paid_option_preselection");
  assert.equal(finding.status, "risk_signal");
  await focusAndRecheck(host, finding, "express", () => {
    radio.componentProperties["Selected#8:1"].value = false;
  });
});

test("manifest entry compares two working subscription choices and returns both layer IDs", async () => {
  const extra = button("extra", "월 3,000원 추가하고 계속", "plus", {
    container: {absoluteBoundingBox: {x: 0, y: 0, width: 350, height: 52}, fills: solid(0.12, 0.16, 0.3)},
    text: {fontSize: 18, fills: white}
  });
  const base = button("base", "기본 요금으로 계속", "standard", {
    container: {absoluteBoundingBox: {x: 0, y: 70, width: 118, height: 20}, fills: white},
    text: {fontSize: 9, fills: solid(0.85, 0.85, 0.85)}
  });
  const host = runPlugin([frame("offer", "구독", [extra, base]),
    frame("plus", "추가 가입", [text("p", "월 12,900원")]),
    frame("standard", "기본 가입", [text("s", "월 9,900원")])]);
  await host.send({type: "ready"});
  const result = host.messages.at(-1);
  assert.equal(result.transitionCount, 2);
  const finding = result.findings.find(f => f.pattern === "misleading_visual_hierarchy");
  assert.equal(finding.status, "risk_signal");
  assert.deepEqual(Array.from(finding.evidence, e => e.node_id).sort(), ["base", "extra"]);
  await focusAndRecheck(host, finding, "base", () => {
    base.absoluteBoundingBox = {x: 0, y: 70, width: 350, height: 52};
    base.children[0].fontSize = 18;
    base.children[0].fills = solid(0.1, 0.18, 0.16);
  });
});

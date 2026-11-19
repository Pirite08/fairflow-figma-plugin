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

function checkComparison(result, pattern, status) {
  assert.equal(result.comparison.length, 3);
  const row = result.comparison.find(item => item.pattern === pattern);
  assert.equal(row.ruleStatus, status);
  assert.equal(row.modelStatus, status);
  if (status === "needs_context") {
    assert.equal(row.score, null);
  } else {
    assert.ok(Number.isFinite(row.score) && row.score >= 0 && row.score <= 1);
    assert.equal(row.score >= 0.5, status === "risk_signal");
  }
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
  checkComparison(updated, finding.pattern, "signal_absent");
}

test("manifest entry follows a price journey, focuses its layer and sees an edited price", async () => {
  const price = text("first-price", "29,900원");
  const source = frame("shop", "상품", [price, button("order", "주문 확인", "checkout")]);
  const target = frame("checkout", "주문 확인", [
    text("base", "상품 29,900원"), text("charge", "필수 고정 배송비 3,000원"), text("total", "결제 예정 금액 32,900원")
  ]);
  const host = runPlugin([source, target], false);
  await host.send({type: "ready"});
  assert.deepEqual(host.messages.map(message => message.type), ["selection"]);
  assert.equal(host.messages[0].frameId, source.id);
  await host.send({type: "scan-selection"});
  const priceFinding = () => host.messages.at(-1).findings.find(f => f.pattern === "drip_pricing");
  assert.equal(host.messages.at(-1).canConfirmStart, true);
  assert.equal(priceFinding().status, "needs_context");
  checkComparison(host.messages.at(-1), "drip_pricing", "needs_context");
  await host.send({type: "confirm-start"});
  assert.equal(priceFinding().status, "risk_signal");
  checkComparison(host.messages.at(-1), "drip_pricing", "risk_signal");
  assert.equal(host.messages.at(-1).stateCount, 2);
  const evidence = priceFinding().evidence.find(e => e.node_id === "charge");
  assert.match(evidence.label, /3,000원/);
  await focusAndRecheck(host, priceFinding(), "charge", () => { price.characters = "32,900원"; });
});

test("manifest entry records a checkout path and refreshes its model score only from current confirmations", async () => {
  const list = text("retail-price", "125,000원", {textDecoration: "STRIKETHROUGH"});
  const detailFee = text("detail-fee", "배송비 1개당 40,000원");
  const first = frame("products", "상품 목록", [
    list, text("sale", "62,000원"), button("open-detail", "상품 보기", "detail")
  ]);
  const detail = frame("detail", "상품 상세", [
    text("detail-price", "62,000원"), detailFee, button("open-order", "주문 확인", "order")
  ]);
  const order = frame("order", "결제 확인", [
    text("sub", "상품금액 62,000원"), text("fee", "배송비 40,000원"), text("sum", "총 결제금액 102,000원")
  ]);
  const host = runPlugin([first, detail, order]);
  const result = () => host.messages.at(-1);
  const answer = (current, factId, value = "yes") => host.send({
    type: "answer-price-fact", rootId: current.rootId, scanVersion: current.scanVersion, factId, answer: value
  });
  const pricing = () => result().comparison.find(row => row.pattern === "drip_pricing");

  await host.send({type: "scan-selection"});
  const initial = result();
  assert.equal(initial.priceInput.status, "needs_context");
  assert.equal(initial.priceInput.question.id, "requiredForOrder");
  assert.equal(initial.priceInput.score, null);
  assert.equal(pricing().score, null);
  const evidence = initial.priceInput.observations.find(row => row.evidence.node_id === "detail-fee");
  assert.ok(evidence);
  assert.ok(initial.priceInput.observations.some(row => row.evidence.node_id === "sale"));
  await host.send({type: "focus", ...evidence.evidence});
  assert.equal(host.zoomedLayers.at(-1), "detail-fee");

  await answer(initial, "calculableAtFirstOffer");
  assert.equal(result(), initial);
  await answer(initial, "requiredForOrder", "unknown");
  assert.equal(result().priceInput.score, null);
  assert.equal(result().priceInput.question.id, "requiredForOrder");
  await answer(result(), "requiredForOrder");
  assert.equal(result().priceInput.question.id, "calculableAtFirstOffer");
  assert.equal(result().priceInput.score, null);
  await answer(result(), "calculableAtFirstOffer");
  assert.equal(result().rootId, first.id);
  assert.equal(result().priceInput.status, "ready");
  assert.equal(pricing().ruleStatus, "needs_context");
  assert.equal(pricing().modelStatus, "risk_signal");
  assert.equal(pricing().score, result().priceInput.score);
  assert.ok(pricing().score > 0.5);

  const prior = result();
  await host.send({type: "scan"});
  const current = result();
  assert.equal(current.priceInput.status, "ready");

  const reset = (scanVersion, rootId = first.id) => host.send({
    type: "reset-price-facts", rootId, scanVersion
  });
  await reset(prior.scanVersion);
  await reset(current.scanVersion, detail.id);
  assert.equal(result(), current);

  await reset(current.scanVersion);
  const cleared = result();
  assert.equal(cleared.rootId, first.id);
  assert.equal(host.api.currentPage.selection[0].id, "detail-fee");
  assert.equal(cleared.priceInput.question.id, "requiredForOrder");
  assert.equal(cleared.priceInput.confirmations.length, 0);
  assert.equal(pricing().score, null);
  await reset(cleared.scanVersion);
  assert.equal(result(), cleared);

  await answer(cleared, "requiredForOrder");
  await answer(result(), "calculableAtFirstOffer");
  assert.equal(result().priceInput.status, "ready");

  detailFee.characters = "배송비 1개당 40,000원 · 일부 지역 별도";
  await host.send({type: "scan"});
  assert.equal(result().rootId, first.id);
  assert.equal(result().priceInput.status, "needs_context");
  assert.equal(result().priceInput.confirmations.length, 0);
  assert.equal(pricing().score, null);
});

test("manifest entry reads paid radio state from a component instance", async () => {
  const radio = {
    ...frame("express", "Radio", [text("caption", "빠른배송 +5,000원")]), type: "INSTANCE",
    componentProperties: {"Selected#8:1": {type: "BOOLEAN", value: true}}
  };
  const first = frame("entry", "상품", [button("next", "배송 옵션 보기", "delivery")]);
  const host = runPlugin([first, frame("delivery", "배송 옵션", [radio])]);
  await host.send({type: "ready"});
  await host.send({type: "scan-selection"});
  const finding = host.messages.at(-1).findings.find(f => f.pattern === "paid_option_preselection");
  assert.equal(finding.status, "risk_signal");
  checkComparison(host.messages.at(-1), "paid_option_preselection", "risk_signal");
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
  await host.send({type: "scan-selection"});
  const result = host.messages.at(-1);
  assert.equal(result.transitionCount, 2);
  const finding = result.findings.find(f => f.pattern === "misleading_visual_hierarchy");
  assert.equal(finding.status, "risk_signal");
  checkComparison(result, "misleading_visual_hierarchy", "risk_signal");
  assert.deepEqual(Array.from(finding.evidence, e => e.node_id).sort(), ["base", "extra"]);
  await focusAndRecheck(host, finding, "base", () => {
    base.absoluteBoundingBox = {x: 0, y: 70, width: 350, height: 52};
    base.children[0].fontSize = 18;
    base.children[0].fills = solid(0.1, 0.18, 0.16);
  });
});

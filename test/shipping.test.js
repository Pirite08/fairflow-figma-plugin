import assert from "node:assert/strict";
import test from "node:test";
import { readShippingScenario } from "../src/shipping.js";
import { startPanel } from "../src/controller.js";

function shippingJourney() {
  return {
    entry_state_id: "shop",
    flow_start_confirmed: true,
    states: [
      { state_id: "shop", frame_id: "shop", nodes: [] },
      { state_id: "shipping", frame_id: "shipping", nodes: [
        { node_id: "basic", role: "radio", checked: false, text: "일반배송 무료" },
        { node_id: "fast", role: "radio", checked: true, text: "빠른배송 +5,000원", selection_node_id: "radio" },
        { node_id: "decorative-ring", role: "radio", text: "" },
        { node_id: "next", role: "button", text: "주문 확인" }
      ] },
      { state_id: "fast-review", frame_id: "fast-review", nodes: [{ node_id: "fast-total", role: "text", text: "결제 예정 금액 34,900원" }] },
      { state_id: "basic-review", frame_id: "basic-review", nodes: [
        { node_id: "basic-label", role: "text", text: "주문 합계", parent_id: "bill" },
        { node_id: "basic-total", role: "text", text: "29,900원", parent_id: "bill" }
      ] }
    ],
    transitions: [
      ["shop", "shipping", "from-shop"], ["shipping", "fast-review", "fast"],
      ["shipping", "basic-review", "basic"], ["shipping", "fast-review", "next"]
    ].map(([from_state_id, to_state_id, node_id]) => ({ from_state_id, to_state_id, action: { type: "click", node_id } }))
  };
}

test("uses explicit checkout totals for both connected shipping options", () => {
  assert.deepEqual(readShippingScenario(shippingJourney(), "page"), {
    pageId: "page", rootId: "shop", shippingFrameId: "shipping", paidId: "fast", basicId: "basic",
    paidSelectionId: "radio", basicSelectionId: "basic", continueId: "next",
    fastReviewId: "fast-review", basicReviewId: "basic-review",
    fastTotal: 34900, basicTotal: 29900, fastFee: 5000, basicFee: 0, defaultOption: "fast"
  });
});

test("withholds the proposal if a checkout, default or amount is ambiguous", () => {
  for (const edit of [
    j => { j.flow_start_confirmed = false; },
    j => { j.transitions[2].uncertain = true; },
    j => { j.transitions[3].to_state_id = "basic-review"; },
    j => { j.states[2].nodes[0].text = "주문 합계 35,900원"; },
    j => { j.states[2].nodes = []; },
    j => { j.states[1].nodes[1].checked = undefined; }
  ]) {
    const journey = shippingJourney();
    edit(journey);
    assert.equal(readShippingScenario(journey, "page"), null);
  }
});

test("comparison rescans the same three journeys and opens only registered comparison frames", async () => {
  const page = { id: "page", type: "PAGE", selection: [] };
  const nodes = new Map("shop shipping fast-review basic-review ref min min-fast min-basic layout layout-fast layout-basic".split(" ")
    .map(id => [id, { id, type: "FRAME", name: id, parent: page }]));
  const messages = [], scans = [], reveals = [];
  const api = {
    currentPage: page,
    ui: { postMessage: message => messages.push(message) },
    getNodeByIdAsync: async id => nodes.get(id) || null,
    viewport: { scrollAndZoomIntoView: selection => reveals.push(selection.map(node => node.id)) },
    on() {}
  };
  const original = shippingJourney();
  const spec = readShippingScenario(original, page.id);
  let timesBuilt = 0;
  let edited = false;
  startPanel(api, async frame => {
    scans.push(frame.id);
    const isSource = frame.id === "shop";
    const quote = isSource ? spec : edited && frame.id === "layout" ? null : { ...spec, defaultOption: "basic" };
    return {
      frameName: frame.name,
      shipping: quote && {
        ...quote,
        shippingFrameId: isSource ? spec.shippingFrameId : frame.id,
        fastReviewId: isSource ? spec.fastReviewId : frame.id + "-fast",
        basicReviewId: isSource ? spec.basicReviewId : frame.id + "-basic"
      },
      findings: [
        { pattern: "paid_option_preselection", status: isSource ? "risk_signal" : "signal_absent",
          evidence: [{ node_id: "fast", state_id: frame.id }] }
      ]
    };
  }, async () => {
    timesBuilt++;
    return {
      referenceFrameId: "ref",
      minimal: { frameId: "min", fastReviewId: "min-fast", basicReviewId: "min-basic" },
      layout: { frameId: "layout", fastReviewId: "layout-fast", basicReviewId: "layout-basic" }
    };
  });
  const send = message => api.ui.onmessage(message);
  page.selection = [nodes.get("shop")];
  await send({ type: "ready" });
  await send({ type: "shipping-create" });
  assert.deepEqual(messages.at(-1).comparison.columns.map(column => [column.key, column.defaultOption, column.status]), [
    ["original", "fast", "risk_signal"], ["minimal", "basic", "signal_absent"], ["layout", "basic", "signal_absent"]
  ]);
  await send({ type: "shipping-overview" });
  await send({ type: "shipping-focus", key: "minimal", option: "fast" });
  await send({ type: "shipping-focus", key: "shop", option: "fast" });
  assert.deepEqual(reveals, [["ref", "min", "layout"], ["min-fast"]]);
  edited = true;
  await send({ type: "shipping-rescan" });
  assert.deepEqual(scans.slice(-3), ["shop", "min", "layout"]);
  assert.equal(page.selection[0].id, "min-fast");
  assert.equal(messages.at(-1).comparison.columns[2].fastTotal, null);
  await send({ type: "shipping-create" });
  assert.equal(timesBuilt, 1);
});

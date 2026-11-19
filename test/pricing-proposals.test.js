import assert from "node:assert/strict";
import test from "node:test";
import { analyzeJourney } from "../src/analyze.js";
import { readPricingProposal } from "../src/pricing-proposals.js";
import { readJourney } from "../src/reader.js";

const line = (node_id, text) => ({ node_id, role: "text", text });
const button = (node_id, text) => ({ node_id, role: "button", text });

function journey() {
  return {
    entry_state_id: "product",
    flow_start_confirmed: true,
    states: [
      { state_id: "product", frame_id: "product", name: "상품", nodes: [
        line("offer", "29,900원"), button("details", "상품 상세 보기")
      ] },
      { state_id: "detail", frame_id: "detail", name: "상세", nodes: [
        line("note", "필수 고정 배송비 3,000원 별도"), button("order", "주문 확인")
      ] },
      { state_id: "checkout", frame_id: "checkout", name: "결제", nodes: [
        line("base", "상품 가격 29,900원"),
        line("fee", "필수 고정 배송비 3,000원"),
        line("total", "결제 예정 금액 32,900원")
      ] }
    ],
    transitions: [
      ["product", "detail", "details"], ["detail", "checkout", "order"]
    ].map(([from_state_id, to_state_id, node_id]) => ({ from_state_id, to_state_id, action: { type: "click", node_id } }))
  };
}

test("mandatory fee timing is tracked separately from the inclusive total", () => {
  const input = journey();
  const original = readPricingProposal(input, analyzeJourney(input), "page");
  assert.equal(original.status, "risk_signal");
  assert.deepEqual(original.frameIds, ["product", "detail", "checkout"]);
  assert.match(original.summary, /3,000원 최초 표시: 상세.*32,900원 최초 표시: 결제/);
  assert.match(original.steps[1].detail, /필수 비용 3,000원$/);
  input.states[0].nodes[0].text = "32,900원";
  input.states[0].nodes.push(line("base-note", "상품 소계 29,900원"), line("fee-note", "필수 고정 배송비 3,000원 포함"));
  const revised = readPricingProposal(input, analyzeJourney(input), "page");
  assert.equal(revised.status, "signal_absent");
  assert.match(revised.summary, /3,000원 최초 표시: 상품.*32,900원 최초 표시: 상품/);
});

test("conflicting pricing and branched or unconfirmed prototypes do not produce price proposals", () => {
  for (const edit of [
    input => { input.states[1].nodes[0].text = "필수 고정 배송비 4,000원 별도"; },
    input => { input.states[2].nodes[1].text = "배송비 3,000원"; },
    input => { input.flow_start_confirmed = false; },
    input => { input.transitions.push({ ...input.transitions[0], to_state_id: "checkout" }); },
    input => { input.states[1].nodes[0].text = "지역별 배송비 3,000원"; }
  ]) {
    const input = journey();
    edit(input);
    assert.equal(readPricingProposal(input, analyzeJourney(input), "page"), null);
  }
});

test("a visible fee note inside a linked product card is independently read", async () => {
  const figmaText = (id, characters) => ({ id, type: "TEXT", name: "문구", characters });
  function figmaFrame(id, children) {
    const frame = { id, type: "FRAME", name: id, children };
    for (const child of children) child.parent = frame;
    return frame;
  }
  const note = figmaText("fee-note", "필수 고정 배송비 3,000원 포함");
  const card = figmaFrame("card", [
    figmaText("title", "유리컵"), figmaText("headline", "32,900원"), note
  ]);
  card.reactions = [{
    trigger: { type: "ON_CLICK" },
    actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId: "checkout" }]
  }];
  const source = figmaFrame("product", [card]);
  const checkout = figmaFrame("checkout", [
    figmaText("base", "상품 29,900원"), figmaText("fee", "필수 고정 배송비 3,000원"),
    figmaText("total", "결제 예정 금액 32,900원")
  ]);
  const api = {
    currentPage: { flowStartingPoints: [{ nodeId: "product" }] },
    getNodeByIdAsync: async id => id === "checkout" ? checkout : null
  };
  const result = async () => {
    const input = await readJourney(api, source);
    return readPricingProposal(input, analyzeJourney(input), "page");
  };
  assert.match((await result()).summary, /3,000원 최초 표시: product/);
  note.visible = false;
  assert.match((await result()).summary, /3,000원 최초 표시: checkout/);
});

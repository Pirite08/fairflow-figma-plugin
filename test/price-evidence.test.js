import assert from "node:assert/strict";
import test from "node:test";
import { readPriceEvidence } from "../src/price-evidence.js";

const text = (node_id, content, props = {}) => ({ node_id, role: "text", text: content, ...props });
const button = (id, content) => text(id, content, { role: "button" });
const click = (from_state_id, node_id, to_state_id) => ({
  from_state_id, to_state_id, action: { type: "click", node_id }
});
const state = (state_id, nodes, props = {}) => ({ state_id, name: state_id, nodes, ...props });

function apparel() {
  const original = text("old", "82,000원", { control_node_id: "card" });
  return {
    entry_state_id: "list", flow_start_confirmed: true, warnings: [],
    states: [
      state("list", [
        button("card", "울 코트 82,000원 62,000원"),
        original,
        text("offer", "62,000원", { control_node_id: "card" })
      ], { price_texts: [{ ...original, struck_ranges: [[0, 7]] }] }),
      state("detail", [text("unit-fee", "배송비 1개당 40,000원"), button("order", "주문하기")]),
      state("checkout", [
        text("base", "상품 62,000원"),
        text("fee", "배송비 40,000원"),
        text("total", "결제 예정 금액 102,000원")
      ])
    ],
    transitions: [click("list", "card", "detail"), click("detail", "order", "checkout")]
  };
}

test("binds the active price, first fee disclosure and checkout total while leaving order terms unknown", () => {
  const result = readPriceEvidence(apparel());
  assert.deepEqual(result.first, { amount: 62000, state_id: "list", node_id: "offer" });
  assert.deepEqual(result.total, { amount: 102000, state_id: "checkout", node_id: "total" });
  assert.deepEqual(result.fee.firstShown, { state_id: "detail", node_id: "unit-fee", stateName: "detail" });
  assert.equal(result.fee.visibleAtFirst, false);
  assert.equal(result.fee.required, null);
  assert.equal(result.fee.calculable, null);
  assert.equal(result.fee.explicitOptIn, null);
});

test("supports two prices in one text node when only the old amount is struck", () => {
  const input = apparel();
  const mixed = text("mixed", "  정가 82,000원  판매가 62,000원", { control_node_id: "card" });
  input.states[0].nodes = [input.states[0].nodes[0]];
  input.states[0].price_texts = [{ ...mixed, struck_ranges: [[5, 12]] }];
  const result = readPriceEvidence(input);
  assert.equal(result.first.amount, 62000);
  assert.equal(result.first.node_id, "mixed");
  const reversed = "판매가 62,000원  정가 82,000원";
  input.states[0].price_texts = [{ ...mixed, text: reversed, struck_ranges: [[15, reversed.length]] }];
  assert.equal(readPriceEvidence(input).first.amount, 62000);
});

test("blocks an ambiguous route or amount and invalidates the key when related fee evidence changes", () => {
  const input = apparel();
  const before = readPriceEvidence(input);
  input.states[1].nodes[0].text = "배송비 1개당 40,000원 · 지역별";
  assert.notEqual(readPriceEvidence(input).key, before.key);
  input.states[0].price_texts = [];
  assert.equal(readPriceEvidence(input), null);
  const branched = apparel();
  branched.states[1].nodes.push(button("other-order", "다른 조건 적용"));
  branched.transitions.push(click("detail", "other-order", "checkout"));
  assert.equal(readPriceEvidence(branched), null);
});

test("keeps recognized mandatory and fixed costs and detects explicitly selected additions", () => {
  const input = apparel();
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 40,000원";
  let result = readPriceEvidence(input);
  assert.equal(result.fee.required, true);
  assert.equal(result.fee.calculable, true);
  input.states.at(-1).nodes[1].text = "배송비 40,000원";
  input.states[1].nodes[1] = text("order", "배송비 40,000원", { role: "checkbox", checked: false });
  input.states.at(-1).nodes.push(text("picked", "배송비 40,000원", { role: "checkbox", checked: true }));
  result = readPriceEvidence(input);
  assert.equal(result.fee.required, false);
  assert.equal(result.fee.explicitOptIn, true);
});

test("identifies an all-in offer without treating unknown local charges as free", () => {
  const input = apparel();
  input.states[0].nodes[2].text = "102,000원";
  const result = readPriceEvidence(input);
  assert.equal(result.first.amount, result.total.amount);
  assert.equal(result.fee.required, null);
  assert.equal(result.fee.amount, 40000);
});

test("a first-screen notice that shipping is excluded does not count as a published amount", () => {
  const input = apparel();
  input.states[0].nodes.push(text("note", "배송비 미포함"));
  assert.equal(readPriceEvidence(input).fee.visibleAtFirst, false);
});

test("permits an independently observed path when the reader warning belongs to a different product", () => {
  const input = apparel();
  const warning = "조건부 연결은 추가 확인이 필요합니다.";
  input.states[0].nodes.push(button("other", "다른 상품 보기"));
  input.states.push(state("other-item", [], { read_warnings: [warning] }));
  input.transitions.push(click("list", "other", "other-item"));
  input.warnings.push(warning);
  assert.equal(readPriceEvidence(input).first.amount, 62000);
  input.states[1].read_warnings = [warning];
  assert.equal(readPriceEvidence(input), null);
});

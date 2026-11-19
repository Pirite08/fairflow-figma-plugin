import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeJourney } from "../src/analyze.js";

const rows = readFileSync(new URL("../data/fairflow_examples.jsonl", import.meta.url), "utf8")
  .trim().split(/\r?\n/).map(line => JSON.parse(line));
const result = (input, pattern) => analyzeJourney(input).filter(row => row.pattern === pattern);
const [preselect, hierarchy, pricing] = [0, 4, 8].map(i => rows[i].target.pattern);

for (const row of rows) {
  test(`fixture ${row.sample_id}: ${row.target.status}`, () => {
    const findings = analyzeJourney(row.input);
    const matching = findings.filter(f => f.pattern === row.target.pattern);
    assert.deepEqual([...new Set(matching.map(f => f.status))], [row.target.status]);
    for (const finding of findings) {
      assert.ok(finding.reason && finding.title && finding.suggestion);
      for (const ref of finding.evidence) {
        const state = row.input.states.find(s => s.state_id === ref.state_id);
        assert.ok(state && (state.frame_id === ref.node_id || state.nodes.some(n => n.node_id === ref.node_id)));
      }
    }
  });
}

function liveFixture(index) {
  const input = structuredClone(rows[index].input);
  delete input.scenario_terms;
  input.flow_start_confirmed = true;
  for (const state of input.states) for (const node of state.nodes) {
    delete node.amount_krw;
    delete node.option_id;
    delete node.fee_id;
  }
  return input;
}

test("live screen data exposes selected surcharge, button disparity and a fixed required fee", () => {
  assert.equal(result(liveFixture(0), preselect)[0].status, "risk_signal");
  assert.equal(result(liveFixture(4), hierarchy)[0].status, "risk_signal");
  const price = liveFixture(8);
  price.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  assert.equal(result(price, pricing)[0].status, "risk_signal");
});

test("a paid choice reached by the user's matching purchase action is not preselection", () => {
  const input = liveFixture(0);
  input.states[0].nodes[1].text = "빠른배송 +5,000원 선택";
  assert.ok(result(input, preselect).every(r => r.status !== "risk_signal"));
});

test("a checked snapshot, unknown checked value and partial graph do not earn a clear verdict", () => {
  const input = liveFixture(0);
  input.entry_state_id = input.states[1].state_id;
  input.flow_start_confirmed = false;
  assert.equal(result(input, preselect)[0].status, "needs_context");
  const partial = liveFixture(1);
  partial.states[1].nodes[0].checked = undefined;
  assert.equal(result(partial, preselect)[0].status, "needs_context");
  partial.states[1].nodes[0].checked = false;
  partial.warnings = ["읽기 제한"];
  assert.ok(result(partial, preselect).every(r => r.status !== "signal_absent"));
});

test("a missing / conditional destination or unsupported style cannot substantiate hierarchy", () => {
  const input = liveFixture(4);
  input.transitions.at(-1).uncertain = true;
  assert.equal(result(input, hierarchy)[0].status, "needs_context");
  delete input.transitions.at(-1).uncertain;
  delete input.states[1].nodes[2].style.text_color;
  assert.equal(result(input, hierarchy)[0].status, "needs_context");
});

test("unverified fees, missing first display or unrelated branches are inconclusive", () => {
  const input = liveFixture(8);
  assert.equal(result(input, pricing)[0].status, "needs_context");
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  input.flow_start_confirmed = false;
  assert.equal(result(input, pricing)[0].status, "needs_context");
  input.flow_start_confirmed = true;
  input.transitions[1].uncertain = true;
  assert.ok(result(input, pricing).every(r => r.status !== "risk_signal"));
  delete input.transitions[1].uncertain;
  input.states[0].product_id = "sku-1";
  input.states.at(-1).product_id = "sku-2";
  assert.ok(result(input, pricing).every(r => r.status !== "risk_signal"));
});

test("cycles terminate and a dangling link never furnishes evidence", () => {
  const input = liveFixture(0);
  input.transitions.push({...input.transitions[0], to_state_id:input.entry_state_id});
  input.transitions.push({...input.transitions[0], to_state_id:"missing"});
  const findings = analyzeJourney(input);
  assert.ok(findings.every(f => f.evidence.every(e => e.state_id !== "missing")));
  assert.equal(new Set(findings.map(f => f.pattern)).size, 3);
});

test("explicitly variable or non-mandatory costs cannot substantiate fixed mandatory fee", () => {
  for (const text of ["필수 아님 · 고정 배송비 3,000원", "고정이 아닌 필수 배송비 3,000원",
    "필수 배송비 3,000원 (지역별 변동, 일부 주문 정액)"]) {
    const input = liveFixture(8);
    input.states.at(-1).nodes[1].text = text;
    assert.equal(result(input, pricing)[0].status, "needs_context", text);
  }
});

test("a detail price cannot replace an earlier ambiguous first display", () => {
  const input = liveFixture(8);
  input.states[0].nodes.push({node_id: "another-price", role: "text", text: "다른 상품 45,000원"});
  input.states[1].nodes.push({node_id: "detail-price", role: "text", text: "29,900원"});
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  assert.equal(result(input, pricing)[0].status, "needs_context");
});

test("a first price and its included-fee note can share a single text layer", () => {
  const input = liveFixture(9);
  const display = input.states[0].nodes[0];
  input.states[0].nodes = [display, input.states[0].nodes.at(-1)];
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  display.text = "총 32,900원 (필수 배송비 포함)";
  const [fixed] = result(input, pricing);
  assert.equal(fixed.status, "signal_absent");
  assert.ok(fixed.evidence.some(ref => ref.node_id === display.node_id));
  for (const note of ["총 배송비 3,000원", "총 32,900원 (필수 배송비 별도)", "총 32,900원 (필수 배송비 포함 여부 미정)"]) {
    display.text = note;
    assert.equal(result(input, pricing)[0].status, "needs_context", note);
  }
});

test("advance disclosure of a variable fee or inconsistent product names requests review", () => {
  const input = liveFixture(8);
  input.states[0].nodes.push({node_id: "terms", role: "text", text: "배송비는 주소에 따라 달라집니다."});
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  assert.equal(result(input, pricing)[0].status, "needs_context");
  input.states[0].nodes.pop();
  input.states[0].nodes.push({node_id: "sku-title", role: "text", text: "상품명: 머그잔"});
  input.states.at(-1).nodes.push({node_id: "other-title", role: "text", text: "상품명: 텀블러"});
  assert.equal(result(input, pricing)[0].status, "needs_context");
});

test("two choices pointing to the same destination need further evidence", () => {
  const input = liveFixture(4);
  input.transitions.at(-1).to_state_id = input.transitions[1].to_state_id;
  assert.equal(result(input, hierarchy)[0].status, "needs_context");
});


test("sibling labels and amounts in a Figma auto-layout row both point to selectable evidence", () => {
  const input = liveFixture(8);
  const checkout = input.states.at(-1);
  checkout.nodes = [
    ["item", "상품", "29,900원"],
    ["delivery", "필수 고정 배송비", "3,000원"],
    ["total", "결제 예정 금액", "32,900원"]
  ].flatMap(([parent, label, value]) => [
    {node_id: parent + "-label", parent_id: parent, role: "text", text: label},
    {node_id: parent + "-value", parent_id: parent, role: "text", text: value}
  ]);
  const finding = result(input, pricing)[0];
  assert.equal(finding.status, "risk_signal");
  assert.ok(["delivery-label", "delivery-value", "total-label", "total-value"]
    .every(id => finding.evidence.some(e => e.node_id === id)));
  checkout.nodes.push({node_id: "other-amount", parent_id: "delivery", role: "text", text: "2,000원"});
  assert.equal(result(input, pricing)[0].status, "needs_context");
});


test("a linked product card can be the first advertised price, without comparing other branches", () => {
  const input = liveFixture(8);
  const card = {node_id: "glass-card", role: "button", text: "유리컵 29,900원"};
  input.states[0].nodes = [card];
  input.transitions[0].action.node_id = card.node_id;
  input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
  const check = result(input, pricing)[0];
  assert.equal(check.status, "risk_signal");
  assert.ok(check.evidence.some(e => e.node_id === card.node_id));
  input.states[0].nodes.push({node_id: "price-layer", parent_id: "nested-layout", control_node_id: card.node_id,
    role: "text", text: "29,900원"});
  const split = result(input, pricing)[0];
  assert.equal(split.status, "risk_signal");
  assert.ok([card.node_id, "price-layer"].every(id => split.evidence.some(e => e.node_id === id)));
  input.states[0].nodes.push({node_id: "teapot", role: "button", text: "주전자 45,000원"});
  assert.equal(result(input, pricing)[0].status, "needs_context");
  input.states[0].nodes.pop();
  input.states[0].nodes.push({node_id: "cart", role: "button", text: "장바구니로"});
  input.transitions[1].from_state_id = input.entry_state_id;
  input.transitions[1].action.node_id = "cart";
  assert.equal(result(input, pricing)[0].status, "needs_context");
});

test("purchase and upsell buttons are not first advertising prices", () => {
  for (const text of ["29,900원 결제하기", "월 29,900원 추가하고 계속", "₩29,900 구매하기"]) {
    const input = liveFixture(8);
    input.states[0].nodes = [{ node_id: "cta", role: "button", text }];
    input.transitions[0].action.node_id = "cta";
    input.states.at(-1).nodes[1].text = "필수 고정 배송비 3,000원";
    assert.equal(result(input, pricing)[0].status, "needs_context");
  }
});

test("explicit Korean decline labels are recognised as alternative actions", () => {
  for (const text of ["가입하지 않고 계속", "거부"]) {
    const input = liveFixture(4);
    input.states[1].nodes[2].text = text;
    assert.equal(result(input, hierarchy)[0].status, "risk_signal", text);
  }
});

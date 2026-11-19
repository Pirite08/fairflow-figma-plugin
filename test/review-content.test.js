import assert from "node:assert/strict";
import test from "node:test";
import { reviewContent } from "../src/review-content.js";

const risk = (pattern, fields = {}) => ({
  pattern, status: "risk_signal", evidence: [], ...fields
});
const pricing = { firstAmount: 24800, finalAmount: 29800, fee: { label: "배송비", amount: 5000 } };

test("review explanations connect each risk to its own rule and the observed layers", () => {
  const preselection = reviewContent(risk("paid_option_preselection", {
    evidence: [{ label: "☑ 빠른배송 +5,000원" }]
  }));
  assert.match(preselection.rule.citation, /제2호$/);
  assert.match(preselection.explanation, /‘빠른배송 \+5,000원’/);
  assert.doesNotMatch(preselection.explanation, /☑/);
  assert.ok(preselection.alternatives.every(option => option.kind === "design"));

  const hierarchy = reviewContent(risk("misleading_visual_hierarchy", {
    evidence: [{ label: "모두 동의" }, { label: "기본으로 계속" }]
  }));
  assert.match(hierarchy.rule.citation, /제3호$/);
  assert.match(hierarchy.rule.criterion, /오해/);
  assert.match(hierarchy.explanation, /기본으로 계속/);

  const price = reviewContent(risk("drip_pricing", { pricing }));
  assert.match(price.rule.citation, /제1호$/);
  assert.equal(new URL(price.rule.url).hostname, "www.law.go.kr");
  assert.match(price.rule.criterion, /예외/);
  assert.deepEqual(price.alternatives.map(option => option.kind), ["design", "design"]);
  assert.equal(price.alternatives[0].before, "24,800원");
  assert.equal(price.alternatives[0].after, "29,800원");
  assert.equal(price.alternatives[0].detail, "필수 배송비 5,000원 포함");
});

test("price copy is offered when an editable field exists and pricing adds up", () => {
  const fields = [
    { label: "첫 가격", before: "24,800원", after: "29,800원" },
    { label: "배송 안내", before: "배송비는 결제 화면에서 확인", after: "필수 배송비 5,000원 포함" }
  ];
  const result = reviewContent(risk("drip_pricing", { pricing, copyEdit: { fields } }));
  assert.deepEqual(result.alternatives.map(option => option.kind), ["copy"]);
  assert.deepEqual(result.alternatives[0].changes, fields);
  assert.equal(result.alternatives[0].after, "29,800원\n필수 배송비 5,000원 포함");
  const unknownTotal = reviewContent(risk("drip_pricing", {
    reason: "첫 가격과 주문 화면을 비교하세요.",
    pricing: { ...pricing, finalAmount: 40000 },
    copyEdit: { fields }
  }));
  assert.ok(unknownTotal.alternatives.every(option => option.kind === "design"));
  assert.doesNotMatch(JSON.stringify(unknownTotal), /40,000|5,000/);
  assert.equal(reviewContent({ pattern: "drip_pricing", status: "needs_context" }), null);
  assert.equal(reviewContent({ pattern: "drip_pricing", status: "signal_absent" }), null);
});

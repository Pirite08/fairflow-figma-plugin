import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractModelFeatures, FEATURE_NAMES} from "../src/model-features.js";

const examples = readFileSync(new URL("../data/fairflow_examples.jsonl", import.meta.url), "utf8")
  .trim().split(/\r?\n/).map(line => JSON.parse(line));
const inputFor = number => structuredClone(examples[number - 1].input);
const preselection = "paid_option_preselection";
const hierarchy = "misleading_visual_hierarchy";
const pricing = "drip_pricing";

function features(input, pattern) {
  const {values, observed} = extractModelFeatures(input)[pattern];
  assert.equal(values.length, FEATURE_NAMES[pattern].length);
  assert.ok(values.every(Number.isFinite));
  return {observed, ...Object.fromEntries(FEATURE_NAMES[pattern].map((name, index) => [name, values[index]]))};
}

test("the measured default stays unchecked even when a user later selects the same delivery option", () => {
  const selected = features(inputFor(1), preselection);
  const explicit = features(inputFor(3), preselection);
  assert.equal(selected.observed, true);
  assert.equal(explicit.observed, true);
  assert.equal(selected.initial_checked_share, 1);
  assert.equal(explicit.initial_checked_share, 0);
  assert.equal(explicit.explicit_paid_selection, 1);
  const noStart = inputFor(1);
  noStart.flow_start_confirmed = false;
  assert.equal(features(noStart, preselection).observed, false);
});

test("two working buttons expose continuous size differences without the rule's classification threshold", () => {
  const input = inputFor(5);
  const [promoted, basic] = input.states[1].nodes.filter(node => node.role === "button");
  promoted.bounds = {width: 100, height: 40};
  basic.bounds = {width: 51, height: 40};
  const result = features(input, hierarchy);
  assert.equal(result.observed, true);
  assert.equal(result.area_log_ratio, Math.log2(100 / 51));
  basic.bounds.width = 50;
  assert.equal(features(input, hierarchy).area_log_ratio, 1);
  input.transitions.at(-1).uncertain = true;
  assert.equal(features(input, hierarchy).observed, false);
});

test("pricing measures disclosure on the same order and ignores simulator-only fee metadata", () => {
  const input = inputFor(9);
  assert.equal(features(input, pricing).observed, false);
  input.states.at(-1).nodes[1].text = "필수·고정 배송비 3,000원";
  const late = features(input, pricing);
  assert.equal(late.observed, true);
  assert.equal(late.price_increase_fraction, 3000 / 32900);
  assert.equal(late.first_price_matches_total, 0);
  assert.equal(features(inputFor(10), pricing).first_price_matches_total, 1);
  assert.equal(features(inputFor(11), pricing).explicit_optional_selection, 1);
  input.states[0].nodes.push({node_id: "another-price", role: "text", text: "별도 상품 8,000원"});
  input.states[1].nodes.push({node_id: "detail-price", role: "text", text: "29,900원"});
  assert.equal(features(input, pricing).observed, false);
});

test("a partial scan does not pass an observed result, and simulator-only labels do not change measurements", () => {
  const input = inputFor(1);
  const original = extractModelFeatures(input);
  input.scenario_terms = {shipping_options: [{option_id: "express", fee_krw: 0, separately_offered_service: false}]};
  input.states[1].nodes[0].option_id = "different-option";
  assert.deepEqual(extractModelFeatures(input), original);
  input.warnings = ["레이어를 일부 읽지 못했습니다."];
  assert.ok(Object.values(extractModelFeatures(input)).every(result => result.observed === false));
});

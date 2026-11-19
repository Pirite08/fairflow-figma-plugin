import assert from "node:assert/strict";
import test from "node:test";
import { analyzeJourney } from "../src/analyze.js";
import { readHierarchyProposal } from "../src/hierarchy-proposals.js";

function hierarchyJourney() {
  const choices = [
    { node_id: "upgrade", role: "button", text: "월 3,000원 추가하고 계속",
      bounds: { width: 316, height: 52 },
      style: { text_color: "#FFFFFF", background_color: "#155B47", font_size_px: 16 } },
    { node_id: "continue", role: "button", text: "기본 요금으로 계속",
      bounds: { width: 145, height: 22 },
      style: { text_color: "#CFD3D0", background_color: "#FFFFFF", font_size_px: 9 } }
  ];
  const frame = (id, name, nodes = []) => ({ state_id: id, frame_id: id, name, nodes });
  const edge = (from, to, node, uncertain = false) => ({
    from_state_id: from, to_state_id: to, action: { type: "click", node_id: node }, uncertain
  });
  return {
    entry_state_id: "choice",
    flow_start_confirmed: true,
    states: [
      frame("choice", "멤버십 혜택", choices),
      frame("premium", "멤버십 신청 완료", [{ node_id: "complete", role: "button", text: "확인" }]),
      frame("free", "기본 요금 적용"),
      frame("home", "홈")
    ],
    transitions: [
      edge("choice", "premium", "upgrade"),
      edge("choice", "free", "continue"),
      edge("premium", "home", "complete")
    ]
  };
}

const inspect = journey => readHierarchyProposal(journey, analyzeJourney(journey), "page");

test("the hierarchy proposal follows both button destinations and their linked screens", () => {
  const spec = inspect(hierarchyJourney());
  assert.equal(spec.status, "risk_signal");
  assert.deepEqual(spec.frameIds, ["choice", "premium", "free", "home"]);
  assert.deepEqual(spec.steps, [
    { key: "paid", label: "월 3,000원 추가하고 계속", detail: "멤버십 신청 완료", frameId: "premium" },
    { key: "basic", label: "기본 요금으로 계속", detail: "기본 요금 적용", frameId: "free" }
  ]);
});

test("the proposal can be re-read after a basic button is improved and excludes ambiguous routes", () => {
  const journey = hierarchyJourney();
  const basic = journey.states[0].nodes[1];
  basic.bounds = { width: 316, height: 52 };
  basic.style = { text_color: "#155B47", background_color: "#FFFFFF", font_size_px: 16 };
  assert.equal(inspect(journey).status, "signal_absent");

  const basicLink = journey.transitions[1];
  basicLink.uncertain = true;
  assert.equal(inspect(journey), null);
  basicLink.uncertain = false;
  basicLink.to_state_id = "premium";
  assert.equal(inspect(journey), null);
});

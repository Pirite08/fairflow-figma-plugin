import assert from "node:assert/strict";
import test from "node:test";
import { editablePriceCopy, renderReviewThumbnails } from "../src/review-previews.js";

function copyFixture() {
  const page = { id: "page", type: "PAGE" };
  const first = { id: "first", type: "FRAME", parent: page, absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 320 } };
  const price = {
    id: "price", type: "TEXT", parent: first, characters: "29,900원",
    fontSize: 24, fontName: { family: "Inter" }, openTypeFeatures: { TNUM: true },
    absoluteBoundingBox: { x: 16, y: 100, width: 120, height: 30 }
  };
  const fee = {
    id: "fee", type: "TEXT", parent: first, characters: "필수 배송비 3,000원 포함",
    absoluteBoundingBox: { x: 16, y: 135, width: 160, height: 20 }
  };
  const api = { currentPage: page, getNodeByIdAsync: async id => ({ price, fee }[id]) };
  const finding = {
    pattern: "drip_pricing", status: "risk_signal",
    pricing: { first: { state_id: "first", node_id: "price" }, fee: { label: "배송비", amount: 3000 }, firstAmount: 29900, finalAmount: 32900 }
  };
  const journey = { states: [{
    state_id: "first", frame_id: "first", nodes: [
      { node_id: "price", role: "text", text: price.characters, parent_id: "first" },
      { node_id: "fee", role: "text", text: fee.characters, parent_id: "first", style: {
        font_size_px: 13, opacity: 1, text_color: "#1B2141", background_color: "#FFFFFF"
      } }
    ]
  }] };
  return { finding, journey, api, price, fee, first };
}

test("offers the exact price copy when a readable same-screen fee is already included", async () => {
  const { finding, journey, api, price } = copyFixture();
  assert.deepEqual(await editablePriceCopy(finding, journey, api), {
    before: "29,900원", after: "32,900원",
    detail: "같은 화면에 이미 표시된 ‘필수 배송비 3,000원 포함’과 첫 가격을 맞춥니다.",
    nodeId: "price", stateId: "first"
  });
  assert.equal(price.characters, "29,900원");
});

test("preserves design alternatives when fee copy is hidden, ambiguous or lacks proven space", async () => {
  for (const edit of [
    ({ fee }) => { fee.visible = false; },
    ({ fee, journey }) => { fee.characters += " 아님"; journey.states[0].nodes[1].text = fee.characters; },
    ({ price }) => { price.openTypeFeatures = {}; },
    ({ price, first }) => { price.absoluteBoundingBox.x = first.absoluteBoundingBox.width; },
    ({ first }) => { first.locked = true; },
    ({ journey }) => { journey.states[0].nodes[1].style.text_color = "#EEEEEE"; }
  ]) {
    const fixture = copyFixture();
    edit(fixture);
    assert.equal(await editablePriceCopy(fixture.finding, fixture.journey, fixture.api), null);
  }
});

test("exports up to three authorized local previews and skips a frame on a different page", async () => {
  const page = { id: "page", type: "PAGE" };
  const calls = [];
  const frames = new Map(["original", "minimal", "layout", "external"].map(id => [id, {
    id, type: "FRAME", parent: id === "external" ? { id: "elsewhere", type: "PAGE" } : page,
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 400 },
    async exportAsync({ format }) {
      calls.push([id, format]);
      return Uint8Array.from([137, 80, 78, 71]);
    }
  }]));
  const api = {
    currentPage: page, getNodeByIdAsync: async id => frames.get(id),
    base64Encode: bytes => Buffer.from(bytes).toString("base64")
  };
  const output = await renderReviewThumbnails(api, [
    { key: "original", frameId: "original" }, { key: "minimal", frameId: "minimal" },
    { key: "layout", frameId: "external" }, { key: "unknown", frameId: "layout" }
  ]);
  assert.deepEqual(calls, [["original", "PNG"], ["minimal", "PNG"]]);
  assert.equal(output.original.png, "iVBORw==");
  assert.equal(output.minimal.width, 320);
  assert.equal(output.layout, null);
});

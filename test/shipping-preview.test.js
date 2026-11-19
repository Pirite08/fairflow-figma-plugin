import assert from "node:assert/strict";
import test from "node:test";
import { renderShippingFrame, renderShippingPreview } from "../src/shipping-preview.js";

function host() {
  const page = { id: "page", type: "PAGE" };
  const nodes = new Map();
  const exports = [];
  const columns = ["original", "minimal", "layout"].map((key, index) => {
    const spec = {
      pageId: page.id, shippingFrameId: key + "-delivery", fastReviewId: key + "-fast-review",
      basicReviewId: key + "-basic-review", paidId: key + "-paid", basicId: key + "-basic",
      continueId: key + "-continue", defaultOption: index === 0 ? "fast" : "basic",
      fastTotal: 34900, basicTotal: 29900, fastFee: 5000, basicFee: 0
    };
    const left = 100 + index * 900;
    for (const id of [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId]) {
      nodes.set(id, {
        id, type: "FRAME", parent: page, absoluteBoundingBox: { x: left, y: 500, width: 400, height: 600 },
        async exportAsync(settings) {
          exports.push({ id, settings });
          return Uint8Array.from([137, 80, 78, 71, id.length]);
        }
      });
    }
    const frame = nodes.get(spec.shippingFrameId);
    for (const [id, top] of [
      [spec.paidId, index === 2 ? 610 : 550], [spec.basicId, index === 2 ? 550 : 610], [spec.continueId, 750]
    ]) {
      nodes.set(id, { id, parent: frame, absoluteBoundingBox: {x: left + 24, y: top, width: 352, height: 44} });
    }
    return {
      key, frameId: spec.shippingFrameId, fastReviewId: spec.fastReviewId, basicReviewId: spec.basicReviewId,
      spec, status: index === 0 ? "risk_signal" : "signal_absent"
    };
  });
  const api = {
    currentPage: page, getNodeByIdAsync: async id => nodes.get(id) || null,
    base64Encode: bytes => Buffer.from(bytes).toString("base64")
  };
  return { api, columns, exports, nodes };
}

test("renders actual shipping screens and maps normalized clickable controls and changed layers", async () => {
  const { api, columns, exports, nodes } = host();
  const preview = await renderShippingPreview(api, columns);
  assert.equal(exports.length, 9);
  assert.deepEqual(exports[0].settings, {
    format: "PNG", contentsOnly: true, useAbsoluteBounds: true, constraint: { type: "SCALE", value: 1.2 }
  });
  const [source, minimum, layout] = preview.columns;
  assert.equal(source.defaultOption, "fast");
  assert.equal(source.receipts.basic.id, "original-basic-review");
  assert.equal(layout.defaultOption, "basic");
  assert.equal(layout.basicTotal, 29900);
  assert.deepEqual(layout.hotspots[0], {
    key: "basic", label: "일반배송 선택", x: 24 / 400, y: 50 / 600, width: 352 / 400, height: 44 / 600
  });
  assert.deepEqual(source.markers, []);
  assert.equal(minimum.markers[0].nodeId, "minimal-basic");
  assert.equal(minimum.markers[0].from, undefined);
  assert.equal(layout.markers[0].from.y, 110 / 600);
  assert.match(layout.markers.find(marker => marker.key === "continue").detail, /34,900원에서 29,900원으로/);
  assert.deepEqual(await renderShippingFrame(api, nodes.get("layout-delivery")), layout.frame);
});

test("avoids export when a control belongs to another frame or its clipping hides the target", async () => {
  const { api, columns, nodes, exports } = host();
  const control = nodes.get("minimal-paid");
  const originalParent = control.parent;
  control.parent = nodes.get("layout-delivery");
  await assert.rejects(renderShippingPreview(api, columns), /프레임 안에서 보이는지/);
  control.parent = {
    id: "clip", parent: originalParent, clipsContent: true,
    absoluteBoundingBox: {x: 1000, y: 650, width: 400, height: 50}
  };
  await assert.rejects(renderShippingPreview(api, columns), /프레임 안에서 보이는지/);
  assert.equal(exports.length, 0);
});

test("bounds the size of image exports and stops if the active page changes", async () => {
  const { api, columns, nodes } = host();
  const frame = nodes.get("original-delivery");
  frame.absoluteBoundingBox.width = 1400;
  const scales = [];
  frame.exportAsync = async ({ constraint }) => {
    scales.push(constraint.value);
    return new Uint8Array(scales.length === 1 ? 450 * 1024 : 250 * 1024);
  };
  await renderShippingFrame(api, frame);
  assert.equal(scales[0], 720 / 1400);
  assert.ok(scales[1] < scales[0]);

  frame.exportAsync = async () => {
    api.currentPage = { id: "another-page" };
    return Uint8Array.from([137, 80, 78, 71]);
  };
  await assert.rejects(renderShippingPreview(api, columns), /검사한 페이지로 돌아간/);
});

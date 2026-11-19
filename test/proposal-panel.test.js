import assert from "node:assert/strict";
import test from "node:test";
import { startPanel } from "../src/controller.js";

test("proposal comparisons re-read edited routes without changing the pinned root or the other type", async () => {
  const page = { id: "page", type: "PAGE", selection: [] };
  const nodes = new Map("root source route updated ref min layout p-ref p-min p-layout".split(" ")
    .map(id => [id, { id, name: id, type: "FRAME", parent: page }]));
  const messages = [];
  const created = [];
  const api = {
    currentPage: page,
    getNodeByIdAsync: async id => nodes.get(id) ?? null,
    ui: { postMessage: message => messages.push(message) },
    viewport: { scrollAndZoomIntoView() {} },
    on() {}
  };
  let destination = "route";
  const spec = (root, label, frameId = destination) => ({
    frameId: root, status: root === "source" ? "risk_signal" : "signal_absent",
    steps: [{ key: "choice", label, detail: frameId, frameId }]
  });
  startPanel(api, async frame => {
    const isSource = frame.id === "root";
    return { frameName: frame.name, findings: [], proposals: {
      hierarchy: isSource || ["min", "layout"].includes(frame.id) ? spec(isSource ? "source" : frame.id, "계속") : null,
      price: isSource || ["p-min", "p-layout"].includes(frame.id) ? spec(isSource ? "source" : frame.id, "필수 비용", "route") : null
    } };
  }, null, Object.fromEntries([["hierarchy", ""], ["price", "p-"]].map(([kind, prefix]) => [kind, async () => {
    created.push(kind);
    return { referenceFrameId: prefix + "ref", minimal: { frameId: prefix + "min" }, layout: { frameId: prefix + "layout" } };
  }])));
  const send = message => api.ui.onmessage(message);
  page.selection = [nodes.get("root")];
  await send({ type: "ready" });
  assert.deepEqual(Object.keys(messages.at(-1).proposals), ["hierarchy", "price"]);
  await send({ type: "proposal-create", kind: "hierarchy" });
  await send({ type: "proposal-create", kind: "price" });
  await send({ type: "proposal-overview", kind: "hierarchy" });
  assert.deepEqual(page.selection.map(node => node.id), ["ref", "min", "layout"]);
  await send({ type: "proposal-focus", kind: "price", key: "layout", step: "choice" });
  assert.deepEqual(page.selection.map(node => node.id), ["route"]);

  destination = "updated";
  await send({ type: "proposal-rescan", kind: "hierarchy" });
  assert.equal(messages.at(-1).rootId, "root");
  assert.equal(messages.at(-1).comparison.columns[1].steps[0].frameId, "updated");
  await send({ type: "proposal-focus", kind: "hierarchy", key: "minimal", step: "choice" });
  assert.deepEqual(page.selection.map(node => node.id), ["updated"]);
  await send({ type: "proposal-create", kind: "hierarchy" });
  assert.deepEqual(created, ["hierarchy", "price"]);
});

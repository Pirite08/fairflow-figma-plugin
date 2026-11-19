import assert from "node:assert/strict";
import test from "node:test";
import { cloneProposal } from "../src/proposal-frames.js";

function host() {
  const page = { id: "page", type: "PAGE", children: [], flowStartingPoints: [{ nodeId: "start", name: "원본" }] };
  const nodes = new Map();
  let sequence = 0;
  function node(id, type, parent, reactions = []) {
    const layer = {
      id, type, name: id, parent, children: [], x: 0, y: 0, width: 200, height: 300, reactions,
      async setReactionsAsync(next) { this.reactions = next; },
      clone() { return duplicate(this, parent); },
      remove() {
        this.removed = true;
        parent.children = parent.children.filter(child => child !== this);
        for (const child of [...this.children]) child.remove();
      }
    };
    parent.children.push(layer);
    nodes.set(id, layer);
    return layer;
  }
  function duplicate(original, parent) {
    const layer = node("copy-" + ++sequence, original.type, parent, structuredClone(original.reactions));
    for (const child of original.children) duplicate(child, layer);
    return layer;
  }
  function connect(destinationId) {
    return [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId }] }];
  }
  node("start", "FRAME", page);
  node("middle", "FRAME", page).x = 300;
  node("pay", "FRAME", page).x = 600;
  node("external", "FRAME", page).x = 900;
  node("offer", "INSTANCE", nodes.get("start"), connect("middle"));
  node("continue", "FRAME", nodes.get("middle"), connect("pay"));
  node("next-item", "FRAME", nodes.get("pay"), connect("external"));
  const api = { currentPage: page, getNodeByIdAsync: async id => nodes.get(id) };
  return { api, page, nodes };
}

const spec = { pageId: "page", frameId: "start", frameIds: ["start", "middle", "pay"] };
const destination = frame => frame.children[0].reactions[0].actions[0].destinationId;

test("cloned prototypes keep separate downstream destinations and source component structure", async () => {
  const { api, page, nodes } = host();
  const result = await cloneProposal(api, spec, ({ frame, getNode }) => {
    assert.equal(getNode("start", "offer").type, "INSTANCE");
    assert.equal(destination(frame("start")), frame("middle").id);
    assert.equal(destination(frame("middle")), frame("pay").id);
    assert.equal(destination(frame("pay")), "external");
  });
  const variants = [result.referenceFrameId, result.minimal.frameId, result.layout.frameId].map(id => nodes.get(id));
  assert.equal(destination(variants[0]), "middle");
  assert.notEqual(destination(variants[1]), destination(variants[2]));
  assert.deepEqual(variants.map(frame => frame.y), [0, 0, 0]);
  assert.ok(variants[0].x >= 1100 && variants[1].x > variants[0].x && variants[2].x > variants[1].x);
  assert.deepEqual(page.flowStartingPoints.map(point => point.nodeId), ["start", result.minimal.frameId, result.layout.frameId]);
  assert.equal(destination(nodes.get("start")), "middle");
});

test("failed edits remove both partial alternatives and keep source flow starts", async () => {
  const { api, page } = host();
  await assert.rejects(cloneProposal(api, spec, ({ kind }) => {
    if (kind === "layout") throw Error("unsupported layout");
  }), /unsupported layout/);
  assert.deepEqual(page.children.map(node => node.id), ["start", "middle", "pay", "external"]);
  assert.deepEqual(page.flowStartingPoints.map(point => point.nodeId), ["start"]);
});

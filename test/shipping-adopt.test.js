import assert from "node:assert/strict";
import test from "node:test";
import { createShippingPanel } from "../src/shipping-panel.js";

test("blocks adoption if the shown frame changed, then adopts the freshly rendered native journey", async () => {
  const page = { id: "page", type: "PAGE", children: [], flowStartingPoints: [] };
  const nodes = new Map();
  let sequence = 0;
  function layer(id, parent, name, type = "FRAME", y = 0) {
    const node = {
      id, parent, name, type, x: 0, y, width: type === "FRAME" ? 300 : 268,
      height: type === "FRAME" ? 420 : 45, children: [], reactions: [],
      pixel: 1, async exportAsync() { return Uint8Array.of(this.pixel); },
      async setReactionsAsync(value) { this.reactions = value; },
      clone() { return copy(this, this.parent); },
      remove() {
        this.removed = true;
        this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent.flowStartingPoints = this.parent.flowStartingPoints?.filter(point => point.nodeId !== this.id);
        for (const child of [...this.children]) child.remove();
      },
      get absoluteBoundingBox() {
        const root = this.parent.type === "PAGE" ? null : this.parent;
        return { x: this.x + (root?.x || 0), y: this.y + (root?.y || 0), width: this.width, height: this.height };
      }
    };
    parent.children.push(node);
    nodes.set(id, node);
    return node;
  }

  function copy(source, parent) {
    const node = layer("copy-" + ++sequence, parent, source.name, source.type, source.y);
    node.reactions = structuredClone(source.reactions);
    node.pixel = source.pixel;
    for (const child of source.children) copy(child, node);
    return node;
  }
  function link(node, destinationId) {
    node.reactions = [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId }] }];
  }
  const model = (key, fastDefault) => {
    const start = layer(key, page, key);
    const fast = layer(key + "-fast", page, "빠른배송 확인");
    const basic = layer(key + "-basic", page, "일반배송 확인");
    const paid = layer(key + "-paid", start, "빠른배송", "INSTANCE", 90);
    const general = layer(key + "-general", start, "일반배송", "INSTANCE", 150);
    const next = layer(key + "-next", start, "계속", "INSTANCE", 230);
    link(paid, fast.id);
    link(general, basic.id);
    link(next, fastDefault ? fast.id : basic.id);
    return { frameId: start.id, fastReviewId: fast.id, basicReviewId: basic.id };
  };
  model("original", true);
  const minimal = model("minimal", false);
  const layout = model("layout", false);

  const api = {
    currentPage: page,
    getNodeByIdAsync: async id => nodes.get(id) || null,
    base64Encode: bytes => Buffer.from(bytes).toString("base64")
  };
  const inspectFrame = async frame => {
    const [paid, general, next] = frame.children;
    const destination = node => node.reactions[0].actions[0].destinationId;
    const defaultOption = destination(next) === destination(paid) ? "fast" : "basic";
    return {
      shipping: {
        pageId: page.id, shippingFrameId: frame.id, fastReviewId: destination(paid), basicReviewId: destination(general),
        paidId: paid.id, basicId: general.id, continueId: next.id,
        defaultOption, fastTotal: 34900, basicTotal: 29900, fastFee: 5000, basicFee: 0
      },
      findings: [{
        pattern: "paid_option_preselection", status: defaultOption === "fast" ? "risk_signal" : "signal_absent",
        evidence: [{ node_id: paid.id }]
      }]
    };
  };
  const messages = [], reveals = [];
  const panel = createShippingPanel({
    api, inspectFrame, makeShippingDesigns: async () => ({ minimal, layout }),
    post: (type, payload) => messages.push({type, ...payload}),
    revealNodes: async ids => reveals.push(ids),
    context: () => ({rootId:"original", generation:1, confirmed:true})
  });
  await panel.update(true);
  await panel.preview();
  assert.equal(messages.at(-1).type, "shipping-preview-result");
  nodes.get(layout.frameId).pixel = 4;
  await panel.adopt("layout");
  assert.match(messages.at(-1).message, /미리보기 이후/);
  assert.equal(page.children.length, 9);
  await panel.preview();
  await panel.adopt("layout");
  const { adopted } = messages.at(-1);
  assert.equal(adopted.key, "layout");
  assert.equal(page.children.length, 12);
  assert.match(adopted.name, /채택안$/);
  assert.deepEqual((await inspectFrame(nodes.get(adopted.frameId))).shipping.basicReviewId, adopted.basicReviewId);
  assert.deepEqual(reveals.at(-1), [adopted.frameId]);
  await panel.adopt("layout");
  assert.equal(page.children.length, 12);
  assert.equal(messages.at(-1).adopted.frameId, adopted.frameId);
});

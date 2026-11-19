import assert from "node:assert/strict";
import test from "node:test";
import { startPanel } from "../src/controller.js";

function host() {
  const page = { id: "page", type: "PAGE", selection: [] };
  const frame = { id: "root", name: "주문", type: "FRAME", parent: page };
  const layer = { id: "label", name: "배송비", type: "TEXT", parent: frame };
  const frames = new Map([[frame.id, frame], [layer.id, layer]]);
  const messages = [];
  const zooms = [];
  const listeners = {};
  const api = {
    currentPage: page,
    getNodeByIdAsync: async (id) => frames.get(id) ?? null,
    ui: { postMessage: (message) => messages.push(message) },
    viewport: { scrollAndZoomIntoView: (selection) => zooms.push(selection) },
    on: (event, callback) => { listeners[event] = callback; }
  };
  return { api, page, frame, layer, frames, messages, zooms, listeners };
}

function report(frame) {
  return {
    frameName: frame.name, stateCount: 1, transitionCount: 0, warnings: [],
    findings: [{ evidence: [{ node_id: "label", state_id: frame.id, label: "배송비" }] }]
  };
}

test("selection updates the panel without starting an inspection", async () => {
  const { api, page, frame, messages, listeners } = host();
  const inspected = [];
  startPanel(api, async root => { inspected.push(root.id); return report(root); });
  await api.ui.onmessage({ type: "ready" });
  assert.deepEqual(messages.at(-1), { type: "selection", frameId: null, name: null });
  await api.ui.onmessage({ type: "scan-selection" });
  assert.equal(messages.at(-1).type, "empty");
  page.selection = [frame];
  await listeners.selectionchange();
  assert.deepEqual(messages.at(-1), { type: "selection", frameId: frame.id, name: frame.name });
  assert.deepEqual(inspected, []);
  assert.equal(messages.some(message => message.type === "loading" || message.type === "result"), false);
  await api.ui.onmessage({ type: "scan-selection" });
  assert.equal(messages.at(-1).frameName, "주문");
  assert.deepEqual(inspected, [frame.id]);
});

test("focus uses scanned evidence and recheck retains its original root", async () => {
  const { api, page, frame, layer, messages, zooms } = host();
  const scans = [];
  page.selection = [frame];
  startPanel(api, async (root) => { scans.push(root.id); return report(root); });
  await api.ui.onmessage({ type: "ready" });
  await api.ui.onmessage({ type: "scan-selection" });
  await api.ui.onmessage({ type: "focus", node_id: layer.id, state_id: frame.id });
  assert.deepEqual(page.selection, [layer]);
  assert.deepEqual(zooms, [[layer]]);
  await api.ui.onmessage({ type: "scan" });
  assert.deepEqual(scans, [frame.id, frame.id]);
  await api.ui.onmessage({ type: "focus", node_id: frame.id, state_id: frame.id });
  assert.deepEqual(page.selection, [layer]);
  assert.equal(messages.at(-1).type, "notice");
});

test("an earlier slow scan cannot replace the new frame's results", async () => {
  const { api, page, frame, frames, messages } = host();
  const nextFrame = { ...frame, id: "second", name: "구독" };
  frames.set(nextFrame.id, nextFrame);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  page.selection = [frame];
  startPanel(api, async (root) => { if (root.id === frame.id) await pending; return report(root); });
  await api.ui.onmessage({ type: "ready" });
  const firstScan = api.ui.onmessage({ type: "scan-selection" });
  page.selection = [nextFrame];
  await api.ui.onmessage({ type: "scan-selection" });
  finish();
  await firstScan;
  assert.equal(messages.at(-1).frameName, "구독");
  assert.equal(messages.filter((message) => message.type === "result").length, 1);
});

test("an inspection failure exposes the pinned frame as its retry target", async () => {
  const { api, page, frame, layer, messages } = host();
  page.selection = [frame];
  let attempt = 0;
  startPanel(api, async root => {
    if (++attempt === 2) throw Error("temporary read failure");
    return report(root);
  });
  await api.ui.onmessage({ type: "scan-selection" });
  await api.ui.onmessage({ type: "focus", node_id: layer.id, state_id: frame.id });
  await api.ui.onmessage({ type: "scan" });
  assert.equal(messages.at(-1).type, "error");
  assert.equal(messages.at(-1).retryRootId, frame.id);
  await api.ui.onmessage({ type: "scan" });
  assert.equal(messages.at(-1).rootId, frame.id);
  assert.deepEqual(page.selection, [layer]);
});

test("manual journey-start confirmation is scoped to the pinned frame", async () => {
  const { api, frame, page, frames } = host();
  const other = { ...frame, id: "another" };
  frames.set(other.id, other);
  page.selection = [frame];
  const checks = [];
  startPanel(api, async (root, confirmed) => {
    checks.push([root.id, confirmed]);
    return { ...report(root), canConfirmStart: !confirmed };
  });
  await api.ui.onmessage({ type: "ready" });
  await api.ui.onmessage({ type: "scan-selection" });
  await api.ui.onmessage({ type: "confirm-start" });
  await api.ui.onmessage({ type: "scan" });
  page.selection = [other];
  await api.ui.onmessage({ type: "scan-selection" });
  assert.deepEqual(checks, [["root", false], ["root", true], ["root", true], ["another", false]]);
});

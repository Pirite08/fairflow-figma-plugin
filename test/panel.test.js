import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("the panel renders relayed Figma replies and ignores unsupported messages", () => {
  const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const window = new EventTarget();
  const elements = new Map();
  const sent = [];
  const parent = { postMessage: (data) => sent.push(data.pluginMessage.type) };
  const createElement = () => Object.assign(new EventTarget(), {
    append() {}, replaceChildren() {}, setAttribute() {}
  });
  const document = {
    createElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    }
  };
  for (const [, script] of scripts) runInNewContext(script, { window, document, parent });
  assert.deepEqual(sent, ["ready"]);

  const deliver = (source, data) => window.dispatchEvent(Object.assign(new Event("message"), { source, data }));
  const relay = new EventTarget();
  deliver(relay, { pluginMessage: {
    type: "result", frameName: "배송 방법", stateCount: 1, transitionCount: 0, findings: []
  } });
  assert.equal(elements.get("announcement").textContent, "배송 방법 검사 완료. 위험 신호 0건.");
  assert.equal(elements.get("scan").hidden, false);

  deliver(null, { pluginMessage: { type: "notice", message: "레이어가 삭제되었습니다." } });
  for (const data of [null, { type: "notice" }, { pluginMessage: "notice" }, { pluginMessage: { type: "unknown" } }]) {
    deliver(relay, data);
  }
  assert.equal(elements.get("notice").textContent, "레이어가 삭제되었습니다.");
  assert.equal(elements.get("scan").hidden, false);
});

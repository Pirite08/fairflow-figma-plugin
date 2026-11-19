import { createShippingPanel } from "./shipping-panel.js";
import { shippingQuote } from "./shipping.js";

// The inspected frame stays pinned when a designer selects an evidence layer.
export function startPanel(api, inspectFrame, makeShippingDesigns) {
  let rootId = null;
  let generation = 0;
  const evidenceByState = new Map();
  let confirmedRootId = null;
  let canConfirmStart = false;
  let ready = false;

  const post = (type, fields = {}) => api.ui.postMessage({ type, ...fields });
  const selectedFrame = () => {
    const selection = api.currentPage.selection;
    return selection.length === 1 && selection[0].type === "FRAME" ? selection[0] : null;
  };
  const shipping = makeShippingDesigns && createShippingPanel({
    api, inspectFrame, makeShippingDesigns, post, revealNodes,
    context: () => ({ rootId, generation, confirmed: Boolean(rootId && confirmedRootId === rootId) })
  });

  async function scan(useSelection) {
    if (shipping?.busy) return;
    const version = ++generation;
    evidenceByState.clear();
    canConfirmStart = false;
    try {
      const frame = useSelection || !rootId ? selectedFrame() : await api.getNodeByIdAsync(rootId);
      if (generation !== version) return;
      if (!frame || frame.removed || frame.type !== "FRAME") {
        rootId = null;
        confirmedRootId = null;
        post("empty", { message: "검사를 시작할 프레임 하나를 선택하세요." });
        return;
      }
      if (rootId !== frame.id) confirmedRootId = null;
      rootId = frame.id;
      post("loading", { message: frame.name + "의 레이어와 프로토타입 연결을 읽고 있습니다." });
      const result = await inspectFrame(frame, confirmedRootId === frame.id);
      if (generation !== version) return;
      canConfirmStart = Boolean(result.canConfirmStart);
      for (const finding of result.findings) {
        for (const item of finding.evidence) {
          if (!evidenceByState.has(item.state_id)) evidenceByState.set(item.state_id, new Set());
          evidenceByState.get(item.state_id).add(item.node_id);
        }
      }
      const { shipping: spec, hasFastShipping, ...report } = result;
      post("result", {
        ...report,
        rootId: frame.id,
        ...(shipping ? {
          shipping: spec ? shippingQuote(spec) : null,
          shippingIssue: hasFastShipping && !spec
            ? "여정의 시작점을 확인하고, 일반·빠른배송과 기본 진행 버튼을 총액이 표시된 주문 확인 화면에 각각 연결하세요."
            : null
        } : {})
      });
      shipping?.showExisting(frame.id);
    } catch (error) {
      if (generation !== version) return;
      console.error("FairFlow scan", error);
      post("error", { message: "프레임을 읽는 중 오류가 발생했습니다. 프레임을 선택하고 다시 검사하세요." });
    }
  }

  async function revealNodes(ids, version) {
    const nodes = await Promise.all(ids.map(id => api.getNodeByIdAsync(id)));
    if (generation !== version) return;
    if (nodes.some(node => !node || node.removed)) throw Error("레이어가 삭제되었습니다. 다시 검사하세요.");
    let page = nodes[0].parent;
    while (page && page.type !== "PAGE") page = page.parent;
    if (!page) return;
    if (page.id !== api.currentPage.id) await api.setCurrentPageAsync(page);
    if (generation !== version) return;
    api.currentPage.selection = nodes;
    api.viewport.scrollAndZoomIntoView(nodes);
  }

  async function focus({ state_id, node_id }) {
    const version = generation;
    if (!evidenceByState.get(state_id)?.has(node_id)) {
      post("notice", { message: "이 근거가 현재 검사 결과에 없습니다. 다시 검사하세요." });
      return;
    }
    try {
      await revealNodes([node_id], version);
    } catch (error) {
      if (generation !== version) return;
      post("notice", { message: error.message === "레이어가 삭제되었습니다. 다시 검사하세요."
        ? error.message : "레이어를 열 수 없습니다. 프레임을 다시 검사하세요." });
    }
  }

  api.ui.onmessage = async (message) => {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "ready":
        ready = true;
        return scan(true);
      case "scan-selection":
        return scan(true);
      case "scan":
        return scan(false);
      case "confirm-start":
        if (rootId && canConfirmStart) {
          confirmedRootId = rootId;
          return scan(false);
        }
        break;
      case "focus":
        return focus(message);
      case "shipping-create":
      case "shipping-rescan":
        return shipping?.update(message.type === "shipping-create");
      case "shipping-focus":
      case "shipping-overview":
        return shipping?.focus(message);
    }
  };
  api.on("selectionchange", () => {
    if (ready && !rootId && selectedFrame()) return scan(true);
  });
}

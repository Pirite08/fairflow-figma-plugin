import { createShippingPanel } from "./shipping-panel.js";
import { shippingQuote } from "./shipping.js";
import { createProposalPanel, proposalOffers } from "./proposal-panel.js";
import { lawUrl } from "./review-content.js";

// The inspected frame stays pinned when a designer selects an evidence layer.
export function startPanel(api, inspectFrame, makeShippingDesigns, proposalBuilders) {
  let rootId = null;
  let generation = 0;
  const evidenceByState = new Map();
  let confirmedRootId = null;
  let canConfirmStart = false;
  let priceContext = null;
  let priceQuestionId = null;
  let ready = false;

  const post = (type, fields = {}) => api.ui.postMessage({ type, ...fields });
  const selectedFrame = () => {
    const selection = api.currentPage.selection;
    return selection.length === 1 && selection[0].type === "FRAME" ? selection[0] : null;
  };
  const postSelection = () => {
    const frame = selectedFrame();
    post("selection", { frameId: frame?.id ?? null, name: frame?.name ?? null });
  };
  const panelContext = {
    api, inspectFrame, post, revealNodes,
    context: () => ({ rootId, generation, confirmed: Boolean(rootId && confirmedRootId === rootId) })
  };
  const shipping = makeShippingDesigns && createShippingPanel({ ...panelContext, makeShippingDesigns });
  const proposals = proposalBuilders && createProposalPanel({ ...panelContext, builders: proposalBuilders });

  async function scan(useSelection, submission) {
    if (shipping?.busy || proposals?.busy) return;
    const version = ++generation;
    evidenceByState.clear();
    canConfirmStart = false;
    priceQuestionId = null;
    try {
      const frame = useSelection || !rootId ? selectedFrame() : await api.getNodeByIdAsync(rootId);
      if (generation !== version) return;
      if (!frame || frame.removed || frame.type !== "FRAME") {
        rootId = null;
        confirmedRootId = null;
        priceContext = null;
        post("empty", { message: "검사를 시작할 프레임 하나를 선택하세요." });
        return;
      }
      if (rootId !== frame.id) {
        confirmedRootId = null;
        priceContext = null;
      }
      rootId = frame.id;
      post("loading", { message: frame.name + "의 레이어와 프로토타입 연결을 읽고 있습니다." });
      const result = await inspectFrame(frame, confirmedRootId === frame.id, priceContext, submission);
      if (generation !== version) return;
      canConfirmStart = Boolean(result.canConfirmStart);
      priceContext = result.priceContext ?? null;
      priceQuestionId = result.priceInput?.question?.id ?? null;
      const registerEvidence = ({ state_id, node_id }) => {
        if (!evidenceByState.has(state_id)) evidenceByState.set(state_id, new Set());
        evidenceByState.get(state_id).add(node_id);
      };
      for (const finding of result.findings) {
        for (const item of finding.evidence) registerEvidence(item);
      }
      for (const { evidence } of result.priceInput?.observations ?? []) registerEvidence(evidence);
      const { shipping: spec, proposals: _specs, priceContext: _priceContext, ...report } = result;
      post("result", {
        ...report,
        rootId: frame.id,
        scanVersion: version,
        ...(proposals ? { proposals: proposalOffers(result) } : {}),
        ...(shipping ? { shipping: spec ? shippingQuote(spec) : null } : {})
      });
      shipping?.invalidatePreview(frame.id);
      shipping?.showExisting(frame.id);
      proposals?.showExisting(frame.id);
    } catch (error) {
      if (generation !== version) return;
      console.error("FairFlow scan", error);
      post("error", {
        retryRootId: rootId,
        message: rootId ? "프레임을 읽지 못했습니다. 다시 검사하세요." : "검사할 프레임을 선택하세요."
      });
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
        postSelection();
        break;
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
      case "answer-price-fact":
        if (rootId && message.rootId === rootId && message.scanVersion === generation &&
            priceQuestionId && message.factId === priceQuestionId && ["yes", "no", "unknown"].includes(message.answer)) {
          return scan(false, message);
        }
        break;
      case "reset-price-facts":
        if (rootId && message.rootId === rootId && message.scanVersion === generation &&
            !shipping?.busy && !proposals?.busy && Object.keys(priceContext?.answers ?? {}).length) {
          priceContext = null;
          return scan(false);
        }
        break;
      case "focus":
        return focus(message);
      case "review-law":
        api.openExternal(lawUrl);
        break;
      case "shipping-create":
      case "shipping-rescan":
        if (!proposals?.busy) return shipping?.update(message.type === "shipping-create");
        break;
      case "shipping-preview":
        if (!proposals?.busy) return shipping?.preview();
        break;
      case "shipping-adopt":
        if (!proposals?.busy) return shipping?.adopt(message.key);
        break;
      case "shipping-focus":
      case "shipping-overview":
      case "shipping-preview-focus":
      case "shipping-adopt-focus":
        if (!proposals?.busy) return shipping?.focus(message);
        break;
      case "proposal-create":
      case "proposal-rescan":
        if (!shipping?.busy) return proposals?.update(message.kind, message.type === "proposal-create");
        break;
      case "proposal-focus":
      case "proposal-overview":
        if (!shipping?.busy) return proposals?.focus(message);
        break;
    }
  };
  api.on("selectionchange", () => {
    if (!ready) return;
    postSelection();
  });
}

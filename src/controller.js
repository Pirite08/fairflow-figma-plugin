// The inspected frame stays pinned when a designer selects an evidence layer.
export function startPanel(api, inspectFrame) {
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

  async function scan(useSelection) {
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
      post("result", result);
    } catch (error) {
      if (generation !== version) return;
      console.error("FairFlow scan", error);
      post("error", { message: "프레임을 읽는 중 오류가 발생했습니다. 프레임을 선택하고 다시 검사하세요." });
    }
  }

  async function focus({ state_id, node_id }) {
    const version = generation;
    if (!evidenceByState.get(state_id)?.has(node_id)) {
      post("notice", { message: "이 근거가 현재 검사 결과에 없습니다. 다시 검사하세요." });
      return;
    }
    try {
      const node = await api.getNodeByIdAsync(node_id);
      if (generation !== version) return;
      if (!node || node.removed) {
        post("notice", { message: "레이어가 삭제되었습니다. 다시 검사하세요." });
        return;
      }
      let page = node.parent;
      while (page && page.type !== "PAGE") page = page.parent;
      if (!page) return;
      if (page.id !== api.currentPage.id) await api.setCurrentPageAsync(page);
      if (generation !== version) return;
      api.currentPage.selection = [node];
      api.viewport.scrollAndZoomIntoView([node]);
    } catch {
      post("notice", { message: "레이어를 열 수 없습니다. 프레임을 다시 검사하세요." });
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
    }
  };
  api.on("selectionchange", () => {
    if (ready && !rootId && selectedFrame()) return scan(true);
  });
}

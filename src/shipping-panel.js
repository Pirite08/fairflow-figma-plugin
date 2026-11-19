import { shippingPattern, shippingQuote } from "./shipping.js";

function shippingStatus(report, spec) {
  const findings = report?.findings?.filter(finding => finding.pattern === shippingPattern) || [];
  const matching = spec && findings.find(finding => finding.evidence.some(ref => ref.node_id === spec.paidId));
  return matching?.status || (findings.length === 1 ? findings[0].status : "needs_context");
}

export function createShippingPanel({ api, inspectFrame, makeShippingDesigns, post, revealNodes, context }) {
  const comparisons = new Map();
  let busy = false;

  async function readFrame(id, confirmed) {
    const frame = await api.getNodeByIdAsync(id);
    if (!frame || frame.removed || frame.type !== "FRAME") return null;
    return inspectFrame(frame, confirmed);
  }

  function showExisting(rootId) {
    const comparison = comparisons.get(rootId)?.result;
    if (comparison) post("shipping-comparison", { comparison, canRescan: true });
  }

  async function update(create) {
    const { rootId, generation, confirmed } = context();
    if (busy || !rootId) return;
    let entry = comparisons.get(rootId);
    if (!create && !entry) return;
    busy = true;
    post("shipping-loading");
    try {
      const original = await readFrame(rootId, confirmed);
      if (!entry) {
        const spec = original?.shipping;
        if (!spec) throw Error("두 배송 방법의 옵션, 기본 진행 버튼, 주문 확인 화면의 총액을 다시 확인하세요.");
        const designs = await makeShippingDesigns(api, spec);
        entry = { referenceFrameId: designs.referenceFrameId, columns: [
          { key: "original", frameId: spec.shippingFrameId, fastReviewId: spec.fastReviewId, basicReviewId: spec.basicReviewId },
          { key: "minimal", ...designs.minimal },
          { key: "layout", ...designs.layout }
        ] };
        comparisons.set(rootId, entry);
      }
      const columns = [];
      for (const variant of entry.columns) {
        const report = variant.key === "original" ? original : await readFrame(variant.frameId, false);
        const spec = report?.shipping;
        columns.push({
          ...variant,
          ...(spec ? {
            frameId: spec.shippingFrameId,
            fastReviewId: spec.fastReviewId,
            basicReviewId: spec.basicReviewId
          } : {}),
          ...shippingQuote(spec),
          status: shippingStatus(report, spec)
        });
      }
      entry.result = { rootId, referenceFrameId: entry.referenceFrameId, ...shippingQuote(original?.shipping), columns };
      if (context().generation === generation) showExisting(rootId);
    } catch (error) {
      console.error("FairFlow shipping comparison", error);
      if (context().generation === generation) {
        post("shipping-error", { message: error instanceof Error ? error.message : "배송 수정안을 검사할 수 없습니다." });
      }
    } finally {
      busy = false;
    }
  }

  async function focus({ type, key, option }) {
    if (busy) return;
    const { rootId, generation } = context();
    const entry = comparisons.get(rootId);
    if (!entry?.result) return;
    let ids;
    if (type === "shipping-overview") {
      ids = [entry.referenceFrameId || entry.columns[0].frameId, ...entry.columns.slice(1).map(column => column.frameId)];
    } else {
      const column = entry.result.columns.find(item => item.key === key);
      if (!column || (option != null && option !== "fast" && option !== "basic")) return;
      ids = [option === "fast" ? column.fastReviewId : option === "basic" ? column.basicReviewId : column.frameId];
    }
    try {
      await revealNodes(ids, generation);
    } catch (error) {
      post("shipping-error", { message: "선택한 비교 화면을 열 수 없습니다. 수정안이 남아 있는지 확인하세요." });
    }
  }

  return { update, focus, showExisting, get busy() { return busy; } };
}

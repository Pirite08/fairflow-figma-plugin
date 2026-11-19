import { cloneAdoptedJourney } from "./proposal-frames.js";
import { renderReviewThumbnails } from "./review-previews.js";
import { renderShippingFrame, renderShippingPreview } from "./shipping-preview.js";
import { shippingPattern, shippingQuote } from "./shipping.js";

const variants = new Set(["minimal", "layout"]);
const quoteFields = ["fastTotal", "basicTotal", "fastFee", "basicFee"];
const sameQuote = (a, b) => a && b && quoteFields.every(key => a[key] === b[key]);

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

  async function readColumns(entry, original) {
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
        status: shippingStatus(report, spec),
        spec
      });
    }
    return columns;
  }

  function showExisting(rootId) {
    const comparison = comparisons.get(rootId)?.result;
    if (comparison) post("shipping-comparison", { comparison, canRescan: true });
  }

  function invalidatePreview(rootId) {
    const entry = comparisons.get(rootId);
    if (!entry?.preview) return;
    entry.preview = null;
    post("shipping-preview-invalidated", { rootId });
  }

  async function update(create) {
    const { rootId, generation, confirmed } = context();
    if (busy || !rootId) return;
    let entry = comparisons.get(rootId);
    if (!create && !entry) return;
    busy = true;
    invalidatePreview(rootId);
    post("shipping-loading");
    try {
      const original = await readFrame(rootId, confirmed);
      if (!entry) {
        const spec = original?.shipping;
        if (!spec) throw Error("두 배송 방법의 옵션, 기본 진행 버튼, 주문 확인 화면의 총액을 다시 확인하세요.");
        const designs = await makeShippingDesigns(api, spec);
        entry = { referenceFrameId: designs.referenceFrameId, adopted: new Map(), columns: [
          { key: "original", frameId: spec.shippingFrameId, fastReviewId: spec.fastReviewId, basicReviewId: spec.basicReviewId },
          { key: "minimal", ...designs.minimal },
          { key: "layout", ...designs.layout }
        ] };
        comparisons.set(rootId, entry);
      }
      const columns = (await readColumns(entry, original)).map(({ spec, ...column }) => column);
      const thumbnails = await renderReviewThumbnails(api, columns);
      entry.result = { rootId, referenceFrameId: entry.referenceFrameId, ...shippingQuote(original?.shipping), columns, thumbnails };
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

  function previewError(request, error, fallback) {
    console.error("FairFlow shipping preview", error);
    if (context().generation === request.generation)
      post("shipping-preview-error", { rootId: request.rootId, message: error?.message || fallback });
  }

  async function preview() {
    const request = context();
    const { rootId, generation, confirmed } = request;
    const entry = comparisons.get(rootId);
    if (busy || !entry?.result) return;
    busy = true;
    entry.preview = null;
    post("shipping-preview-loading", { rootId });
    try {
      const original = await readFrame(rootId, confirmed);
      const columns = await readColumns(entry, original);
      const rendered = await renderShippingPreview(api, columns);
      entry.preview = rendered;
      if (context().generation === generation) {
        post("shipping-preview-result", { rootId, preview: { ...rendered, adopted: entry.lastAdopted } });
      }
    } catch (error) {
      previewError(request, error, "배송 화면을 표시할 수 없습니다.");
    } finally {
      busy = false;
    }
  }

  async function verifySnapshot(shown, spec) {
    if (!sameQuote(shown, spec) || spec.defaultOption !== shown.defaultOption) return false;
    const ids = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
    const snapshots = [shown.frame, shown.receipts.fast, shown.receipts.basic];
    for (const [index, id] of ids.entries()) {
      const before = snapshots[index];
      if (id !== before.id) return false;
      const after = await renderShippingFrame(api, await api.getNodeByIdAsync(id));
      if (after.width !== before.width || after.height !== before.height || after.png !== before.png) return false;
    }
    return true;
  }

  async function adopt(key) {
    const request = context();
    const { rootId, generation, confirmed } = request;
    const entry = comparisons.get(rootId);
    const shown = entry?.preview?.columns.find(column => column.key === key);
    if (busy || !shown || !variants.has(key)) return;
    busy = true;
    post("shipping-preview-loading", { rootId, operation: "adopt" });
    try {
      let adopted = entry.adopted.get(key);
      if (adopted) {
        const existing = await api.getNodeByIdAsync(adopted.frameId);
        if (!existing || existing.removed) adopted = null;
      }
      if (!adopted) {
        const original = await readFrame(rootId, confirmed);
        const proposal = await readFrame(shown.frame.id, false);
        const spec = proposal?.shipping;
        if (!spec || spec.defaultOption !== "basic" || !sameQuote(original?.shipping, spec) ||
            shippingStatus(proposal, spec) !== "signal_absent") {
          throw Error("일반배송 기본값, 원본과 같은 요금, 두 주문 경로를 확인한 뒤 채택하세요.");
        }
        if (!await verifySnapshot(shown, spec)) throw Error("미리보기 이후 화면이 바뀌었습니다. 다시 겹쳐 본 뒤 채택하세요.");
        const frameIds = [spec.shippingFrameId, spec.fastReviewId, spec.basicReviewId];
        const byId = await cloneAdoptedJourney(api, { pageId: spec.pageId, frameId: spec.shippingFrameId, frameIds },
          async (frame, copies) => {
            const report = await inspectFrame(frame, true);
            const copied = report?.shipping;
            if (!sameQuote(spec, copied) || copied.defaultOption !== "basic" ||
                copied.fastReviewId !== copies.get(spec.fastReviewId).id ||
                copied.basicReviewId !== copies.get(spec.basicReviewId).id ||
                shippingStatus(report, copied) !== "signal_absent") {
              throw Error("채택안의 총액과 주문 경로를 다시 확인하지 못했습니다.");
            }
          });
        const frame = byId.get(spec.shippingFrameId);
        adopted = {
          key, frameId: frame.id, name: frame.name,
          fastReviewId: byId.get(spec.fastReviewId).id,
          basicReviewId: byId.get(spec.basicReviewId).id
        };
        entry.adopted.set(key, adopted);
      }
      entry.lastAdopted = adopted;
      if (context().generation === generation) {
        await revealNodes([adopted.frameId], generation);
        post("shipping-adopted", { rootId, adopted });
      }
    } catch (error) {
      previewError(request, error, "채택안을 만들 수 없습니다.");
    } finally {
      busy = false;
    }
  }

  async function focus({ type, key, option, marker }) {
    if (busy) return;
    const request = context();
    const { rootId, generation } = request;
    const entry = comparisons.get(rootId);
    if (!entry?.result) return;
    let ids;
    const previewFocus = type === "shipping-preview-focus" || type === "shipping-adopt-focus";
    if (type === "shipping-preview-focus") {
      const change = entry.preview?.columns.find(column => column.key === key)?.markers.find(item => item.key === marker);
      if (change) ids = [change.nodeId];
    } else if (type === "shipping-adopt-focus") {
      const adopted = entry.adopted.get(key);
      if (adopted) ids = [adopted.frameId];
    } else if (type === "shipping-overview") {
      ids = [entry.referenceFrameId || entry.columns[0].frameId, ...entry.columns.slice(1).map(column => column.frameId)];
    } else {
      const column = entry.result.columns.find(item => item.key === key);
      if (!column || (option != null && option !== "fast" && option !== "basic")) return;
      ids = [option === "fast" ? column.fastReviewId : option === "basic" ? column.basicReviewId : column.frameId];
    }
    if (!ids) return;
    try {
      await revealNodes(ids, generation);
    } catch (error) {
      if (previewFocus) previewError(request, null, "변경 레이어를 열 수 없습니다. 미리보기를 다시 만드세요.");
      else post("shipping-error", { message: "선택한 비교 화면을 열 수 없습니다. 수정안이 남아 있는지 확인하세요." });
    }
  }

  return { update, preview, adopt, focus, showExisting, invalidatePreview, get busy() { return busy; } };
}

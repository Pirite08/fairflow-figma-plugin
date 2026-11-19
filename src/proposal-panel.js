import { renderReviewThumbnails } from "./review-previews.js";

const catalog = {
  hierarchy: {
    pattern: "misleading_visual_hierarchy",
    issue: "같은 화면의 유료·기본 버튼 두 개를 서로 다른 프레임에 직접 연결하세요."
  },
  price: {
    pattern: "drip_pricing",
    issue: "첫 표시 가격부터 총액까지 연결하고 주문 화면에 금액이 확정된 필수 비용을 표시하세요."
  }
};

export function proposalOffers(report) {
  const offers = {};
  for (const [kind, definition] of Object.entries(catalog)) {
    const available = Boolean(report.proposals?.[kind]);
    const candidate = report.findings.some(finding => finding.pattern === definition.pattern && finding.evidence.length > 0);
    if (available || candidate) offers[kind] = { available, issue: available ? null : definition.issue };
  }
  return offers;
}

export function createProposalPanel({ api, inspectFrame, builders, post, revealNodes, context }) {
  const comparisons = new Map();
  let busy = false;

  async function read(id, confirmed = false) {
    const frame = await api.getNodeByIdAsync(id);
    return frame && !frame.removed && frame.type === "FRAME" ? inspectFrame(frame, confirmed) : null;
  }

  function showExisting(rootId) {
    for (const kind of Object.keys(builders)) {
      const comparison = comparisons.get(rootId)?.get(kind)?.result;
      if (comparison) post("proposal-comparison", { kind, rootId, comparison });
    }
  }

  async function update(kind, create) {
    if (busy || !Object.hasOwn(builders, kind)) return;
    const { rootId, generation, confirmed } = context();
    if (!rootId) return;
    let entries = comparisons.get(rootId);
    let entry = entries?.get(kind);
    if (!entry && !create) return;
    busy = true;
    post("proposal-loading", { kind, rootId });
    try {
      const original = await read(rootId, confirmed);
      if (!entry) {
        const spec = original?.proposals?.[kind];
        if (!spec) throw Error(catalog[kind].issue);
        const generated = await builders[kind](api, spec);
        entry = {
          referenceFrameId: generated.referenceFrameId,
          columns: [
            { key: "original", frameId: spec.frameId },
            { key: "minimal", frameId: generated.minimal.frameId },
            { key: "layout", frameId: generated.layout.frameId }
          ]
        };
        if (!entries) comparisons.set(rootId, entries = new Map());
        entries.set(kind, entry);
      }
      const columns = [];
      for (const column of entry.columns) {
        const report = column.key === "original" ? original : await read(column.frameId);
        const spec = report?.proposals?.[kind];
        columns.push({
          ...column,
          frameId: spec?.frameId || column.frameId,
          status: spec?.status || "needs_context",
          summary: spec ? spec.summary : catalog[kind].issue,
          steps: spec?.steps || []
        });
      }
      const thumbnails = await renderReviewThumbnails(api, columns);
      const comparison = { rootId, referenceFrameId: entry.referenceFrameId, columns, thumbnails };
      entry.result = comparison;
      if (context().generation === generation) post("proposal-comparison", { kind, rootId, comparison });
    } catch (error) {
      console.error("FairFlow design proposal", error);
      if (context().generation === generation) {
        post("proposal-error", { kind, rootId, message: error?.message || "디자인 수정안을 검사할 수 없습니다." });
      }
    } finally {
      busy = false;
    }
  }

  async function focus({ type, kind, key, step }) {
    const { rootId, generation } = context();
    const comparison = comparisons.get(rootId)?.get(kind)?.result;
    if (busy || !comparison) return;
    const column = comparison.columns.find(candidate => candidate.key === key);
    const target = step == null ? column?.frameId : column?.steps.find(candidate => candidate.key === step)?.frameId;
    const ids = type === "proposal-overview"
      ? [comparison.referenceFrameId, ...comparison.columns.slice(1).map(item => item.frameId)]
      : target ? [target] : [];
    if (!ids.length) return;
    try {
      await revealNodes(ids, generation);
    } catch {
      if (context().generation === generation) {
        post("proposal-error", { kind, rootId, message: "비교 화면을 열 수 없습니다. 프레임을 다시 검사하세요." });
      }
    }
  }

  return { update, focus, showExisting, get busy() { return busy; } };
}

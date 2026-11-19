// This script is appended after the production panel script, in the same iframe.
(() => {
  const cases = [
    {
      key: "shipping",
      pattern: "paid_option_preselection",
      label: "특정옵션 사전선택",
      evidence: ["fast"],
      frames: 3,
      links: 3,
      articleItem: 2,
    },
    {
      key: "hierarchy",
      pattern: "misleading_visual_hierarchy",
      label: "잘못된 계층구조",
      evidence: ["paid", "basic"],
      frames: 3,
      links: 2,
      articleItem: 3,
    },
    {
      key: "price",
      pattern: "drip_pricing",
      label: "순차공개 가격책정",
      evidence: ["first", "card", "fee", "total"],
      frames: 2,
      links: 1,
      articleItem: 1,
    },
  ];
  const query = (selector) => document.querySelector(selector);
  const output = query("#qa-report"),
    status = query("#qa-status"),
    toolbar = query("#qa-tools");
  const pending = new Map();
  let sequence = 0,
    active = false;
  let lastResult = null,
    resultCount = 0,
    scanCount = 0,
    lastSelection = null,
    lastComparison = null,
    comparisonCount = 0,
    lastShippingPreview = null,
    lastAdoptedShipping = null,
    lastError = null;
  const proposalComparisons = new Map();
  window.addEventListener("message", (event) => {
    const message = getPluginMessage(event);
    if (!message) return;
    if (message.type === "result") {
      lastResult = message;
      resultCount++;
    }
    if (message.type === "loading") scanCount++;
    if (message.type === "selection") lastSelection = message;
    if (message.type === "shipping-comparison") {
      lastComparison = message.comparison;
      comparisonCount++;
    }
    if (message.type === "shipping-preview-result") lastShippingPreview = message;
    if (message.type === "shipping-adopted") lastAdoptedShipping = message;
    if (message.type === "proposal-comparison")
      proposalComparisons.set(message.kind, message.comparison);
    if (["error", "notice", "shipping-error", "shipping-preview-error", "proposal-error"].includes(message.type))
      lastError = message.message;
    if (message.type === "qa-reply" && pending.has(message.token)) {
      const accept = pending.get(message.token);
      pending.delete(message.token);
      accept(message);
    }
  });
  function command(operation, journey, targetId, columns, referenceFrameId) {
    const token = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(token);
        reject(Error("Figma 응답 시간 초과: " + operation));
      }, 30000);
      pending.set(token, (reply) => {
        clearTimeout(timeout);
        reply.error ? reject(Error(reply.error)) : resolve(reply);
      });
      parent.postMessage(
        {
          pluginMessage: {
            type: "qa-command",
            token,
            operation,
            journey,
            targetId,
            columns,
            referenceFrameId,
          },
        },
        "*",
      );
    });
  }
  function check(value, msg) {
    if (!value) throw Error(msg);
  }
  async function until(checkState, description, timeout = 10000) {
    const untilTime = Date.now() + timeout;
    while (Date.now() < untilTime) {
      const value = await checkState();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw Error(description + (lastError ? " · " + lastError : ""));
  }
  function sameIds(a, b) {
    const expected = [...b].sort();
    return (
      a.length === b.length &&
      [...a].sort().every((id, i) => id === expected[i])
    );
  }
  async function scan(id, rootName) {
    const button = await until(() => {
      const control = query(id);
      if (control && !control.disabled && !control.hidden) return control;
      if (id === "#scan-selection" && query(".summary h1")?.textContent === rootName) {
        const rescan = query("#scan");
        if (rescan && !rescan.disabled && !rescan.hidden) return rescan;
      }
      return null;
    }, "검사 버튼 비활성 " + id);
    lastError = null;
    const before = resultCount;
    button.click();
    await until(
      () =>
        resultCount > before &&
        lastResult.frameName === rootName &&
        query(".summary h1")?.textContent === rootName,
      "시작 화면 재검사 실패 " + rootName,
    );
    return lastResult;
  }
  function riskCardFor(spec) {
    const cards = Array.from(document.querySelectorAll(".finding")).filter(
      (n) => n.querySelector(".pattern")?.textContent === spec.label,
    );
    check(
      cards.length === 1,
      "결과 카드 개수: " + spec.label + " " + cards.length,
    );
    const card = cards[0];
    check(
      card.dataset.status === "risk_signal" &&
        card.querySelector(".badge")?.textContent === "위험 신호",
      spec.label +
        " 표시 상태: " +
        card.dataset.status +
        " (예상 risk_signal)",
    );
    return card;
  }
  function modelComparisonFor(result, spec, expected) {
    const comparison = result.comparison?.find(row => row.pattern === spec.pattern);
    check(result.comparison?.length === 3 && comparison?.ruleStatus === expected &&
      comparison.modelStatus === expected && Number.isFinite(comparison.score),
    "모델 비교 결과 불일치: " + JSON.stringify(comparison));
    const details = query(".model-comparison");
    check(details, "판별 방식 비교가 표시되지 않았습니다.");
    if (!details.open) details.querySelector("summary").click();
    const row = details.querySelector('[data-pattern="' + spec.pattern + '"]');
    const badges = Array.from(row?.querySelectorAll(".model-comparison-status") || []);
    check(badges.length === 2 && badges.every(badge => badge.dataset.status === expected) &&
      row.querySelector(".model-comparison-score")?.textContent.includes("위험 점수"),
    "판별 방식 비교에 두 상태와 점수가 표시되지 않았습니다.");
    return comparison;
  }
  async function runOne(spec, log) {
    const beforeSelection = scanCount;
    const previousResult = resultCount;
    const start = await command("risk", spec.key),
      board = start.board,
      name = start.rootName;
    log.root = { id: board.start, name };
    check(
      start.view.selected[0]?.id === board.start &&
        start.view.starts.some((p) => p.nodeId === board.start),
      "시작점 등록 또는 선택 실패",
    );
    await until(() => lastSelection?.frameId === board.start, "선택한 프레임이 패널에 반영되지 않았습니다.");
    await command("inspect", spec.key);
    check(scanCount === beforeSelection && resultCount === previousResult,
      "프레임을 선택만 했을 때 검사가 자동으로 시작되었습니다.");
    log.manualScan = true;
    const result = await scan("#scan-selection", name);
    const risks = result.findings.filter((f) => f.status === "risk_signal");
    check(
      risks.length === 1 && risks[0].pattern === spec.pattern,
      "예상하지 않은 위험 유형이 검출되었습니다.",
    );
    log.frames = result.stateCount;
    log.links = result.transitionCount;
    check(
      log.frames === spec.frames && log.links === spec.links,
      "실제 프레임·연결 수 불일치: " + log.frames + "/" + log.links,
    );
    const card = riskCardFor(spec);
    log.before = card.dataset.status;
    log.panelBefore = query('.risk-count[data-tone="risk"]')?.textContent.trim();
    check(log.panelBefore, "검사 결과 상단에서 위험 신호를 확인하지 못했습니다.");
    log.comparisonBefore = modelComparisonFor(result, spec, "risk_signal");
    if (card.tagName === "DETAILS" && !card.open) card.querySelector("summary").click();
    const citation = card.querySelector(".review-rule .review-citation")?.textContent.trim();
    check(citation?.includes("제21조의2 제1항 제" + spec.articleItem + "호"),
      "해당 위험 유형의 전자상거래법 조항이 결과 카드에 표시되지 않았습니다.");
    const alternatives = Array.from(card.querySelectorAll(".review-alternative"));
    check(alternatives.length >= 1 && alternatives.length <= 3 &&
      alternatives.every(alternative => alternative.textContent.trim()),
    "결과 카드에서 1~3개의 대안을 확인하지 못했습니다.");
    log.legalBasis = citation;
    log.alternativeCount = alternatives.length;
    const finding = result.findings.find((f) => f.pattern === spec.pattern);
    const refs = finding.evidence,
      buttons = Array.from(card.querySelectorAll(".layer"));
    check(
      sameIds(
        refs.map((ref) => ref.node_id),
        spec.evidence.map((key) => board[key]),
      ) && buttons.length === refs.length,
      "근거/버튼 ID 불일치: " + JSON.stringify(refs),
    );
    log.evidence = [];
    for (const [index, button] of buttons.entries()) {
      const ref = refs[index];
      check(button.textContent.trim() === ref.label, "근거 버튼 이름 불일치");
      await command("pan-away", spec.key, ref.node_id);
      await until(
        async () =>
          (await command("inspect", spec.key, ref.node_id)).targetInView ===
          false,
        "근거 레이어를 화면 밖으로 옮기지 못했습니다: " + ref.node_id,
      );
      button.click();
      const selected = await until(async () => {
        const { view } = await command("inspect", spec.key);
        return (
          view.selected.length === 1 &&
          view.selected[0].id === ref.node_id &&
          view.selected[0].inViewport &&
          view.selected[0]
        );
      }, "근거 이동 실패: " + ref.node_id);
      log.evidence.push({
        id: selected.id,
        label: button.textContent,
        layer: selected.name,
        offscreenBeforeClick: true,
        inViewport: selected.inViewport,
      });
    }
    const changed = await command("edit", spec.key);
    const pinnedEvidence = log.evidence[log.evidence.length - 1].id;
    check(
      changed.view.selected[0]?.id === pinnedEvidence &&
        pinnedEvidence !== board.start,
      "수정 중 선택 레이어가 변경되었습니다.",
    );
    const after = await scan("#scan", name);
    check(
      after.findings.every((f) => f.status !== "risk_signal"),
      "수정 후 다른 위험 신호가 남았습니다.",
    );
    const cleared = after.findings.find(f => f.pattern === spec.pattern && f.status === "signal_absent");
    check(cleared && !query('.finding[data-status="risk_signal"]'),
      "수정한 유형의 신호 해소가 패널에 반영되지 않았습니다.");
    log.after = cleared.status;
    log.panelAfter = query('.risk-count:not([data-tone="risk"])')?.textContent.trim();
    check(log.panelAfter, "수정 후 검사 결과 상단에 이전 위험 상태가 남았습니다.");
    log.comparisonAfter = modelComparisonFor(after, spec, "signal_absent");
    const view = (await command("inspect", spec.key)).view;
    check(
      view.selected[0]?.id === pinnedEvidence,
      "재검사 중 선택 레이어가 변경되었습니다.",
    );
    log.selectionAfterRescan = view.selected[0].id;
    log.passed = true;
  }
  async function runPriceInput(log) {
    const journey = "price-input";
    const { board, rootName, view } = await command("prepare-price-input", journey);
    check(view.selected[0]?.id === board.start && view.starts.some(point => point.nodeId === board.start),
      "가격 입력 QA 시작점을 선택하지 못했습니다.");
    log.root = { id: board.start, name: rootName };
    const first = await scan("#scan-selection", rootName);
    const compare = result => result.comparison?.find(row => row.pattern === "drip_pricing");
    const blocked = (result, factId) => result.rootId === board.start &&
      result.priceInput?.status === "needs_context" && result.priceInput.question?.id === factId &&
      result.priceInput.score === null && compare(result)?.modelStatus === "needs_context" &&
      query("#price-input[data-status='needs_context']") && !query("#price-input-score");
    check(blocked(first, "requiredForOrder"),
      "배송비 필수 여부 확인 전에는 정보 부족이어야 합니다: " + JSON.stringify(first.priceInput));
    check(first.stateCount === 3 && first.transitionCount === 2 && Number.isInteger(first.scanVersion),
      "가격 입력 QA의 프레임, 연결 또는 검사 버전이 다릅니다.");
    const observations = first.priceInput.observations;
    const values = [
      [board.first, "62,000"],
      [board.detailFee, "40,000"],
      [board.total, "102,000"],
    ];
    for (const [nodeId, value] of values) {
      check(observations.some(item => item.evidence?.node_id === nodeId && String(item.value).includes(value)) &&
        query('#price-input-journey [data-price-evidence][data-node-id="' + nodeId + '"]'),
      "여정 기록의 금액 또는 레이어 근거가 다릅니다: " + value + " / " + JSON.stringify(observations));
    }
    check(query("#price-input-model")?.textContent.includes("40,000원"),
      "확인 가능한 40,000원 가격 차이가 모델 입력에 표시되지 않았습니다.");
    log.before = {
      model: compare(first)?.modelStatus,
      question: first.priceInput.question?.id,
      observations,
      frames: first.stateCount,
      transitions: first.transitionCount,
    };
    await command("pan-away", journey, board.detailFee);
    await until(async () => (await command("inspect", journey, board.detailFee)).targetInView === false,
      "상세 배송비 레이어를 화면 밖으로 옮기지 못했습니다.");
    await clickReady('#price-input-journey [data-price-evidence][data-node-id="' + board.detailFee + '"]',
      "상세 배송비 근거");
    log.evidence = await until(async () => {
      const { view } = await command("inspect", journey);
      return view.selected.length === 1 && view.selected[0].id === board.detailFee && view.selected[0].inViewport &&
        view.selected[0];
    }, "상세의 배송비 레이어로 이동하지 못했습니다.");

    async function yes(factId) {
      const previous = resultCount;
      await clickReady('#price-input-question[data-fact-id="' + factId + '"] [data-price-answer="yes"]', factId);
      return until(() => resultCount > previous && lastResult.rootId === board.start && lastResult,
        "가격 확인 답변이 같은 여정의 재검사에 반영되지 않았습니다: " + factId);
    }
    const required = await yes("requiredForOrder");
    check(blocked(required, "calculableAtFirstOffer"),
      "필수 여부와 첫 표시 시 계산 가능 여부를 각각 확인해야 합니다: " + JSON.stringify(required.priceInput));
    const complete = await yes("calculableAtFirstOffer");
    const risk = compare(complete);
    check(complete.priceInput?.status === "ready" && !complete.priceInput?.question &&
      risk?.modelStatus === "risk_signal" && complete.priceInput?.score === risk.score && risk.score >= 0.5 &&
      query("#price-input[data-status='ready'] #price-input-score"),
    "가격 확인 후 모델 점수 또는 위험 신호가 표시되지 않았습니다: " + JSON.stringify({ risk, input: complete.priceInput }));
    log.confirmed = { model: risk.modelStatus, score: risk.score, answers: complete.priceInput.confirmations };
    const retained = await scan("#scan", rootName);
    check(retained.rootId === board.start && compare(retained)?.score === risk.score &&
      (await command("inspect", journey)).view.selected[0]?.id === board.detailFee,
    "같은 화면을 재검사할 때 답변 또는 근거 선택이 유지되지 않았습니다.");

    const previous = resultCount;
    const resetText = (await clickReady("#price-input-reset", "답변 다시 입력")).textContent.trim();
    const reset = await until(() => resultCount > previous && lastResult.rootId === board.start && lastResult,
      "답변을 다시 입력할 때 같은 여정이 재검사되지 않았습니다.");
    const selected = (await command("inspect", journey)).view.selected;
    check(blocked(reset, "requiredForOrder") && reset.priceInput.confirmations?.length === 0 &&
      selected.length === 1 && selected[0].id === board.detailFee && selected[0].inViewport &&
      document.activeElement === query("#price-input-question"),
    "답변을 지운 뒤 첫 질문, 모델 점수 또는 선택한 근거가 올바른 상태로 돌아가지 않았습니다.");
    log.reset = { action: resetText, model: compare(reset).modelStatus, question: reset.priceInput.question.id,
      score: reset.priceInput.score, rootId: reset.rootId, evidenceId: selected[0].id };
    check(blocked(await yes("requiredForOrder"), "calculableAtFirstOffer"),
      "답변을 다시 입력할 때 두 번째 질문으로 넘어가지 않았습니다.");
    const repeated = await yes("calculableAtFirstOffer");
    check(repeated.priceInput?.status === "ready" && repeated.priceInput.confirmations?.length === 2 &&
      repeated.priceInput.score === risk.score && compare(repeated)?.modelStatus === "risk_signal" &&
      query("#price-input-score"), "답변을 다시 입력해도 검사 조건과 점수가 복원되지 않았습니다.");
    log.reset.restoredScore = repeated.priceInput.score;

    await command("edit-price-input", journey);
    const edited = await scan("#scan", rootName);
    check(blocked(edited, "requiredForOrder") && edited.priceInput.confirmations?.length === 0 &&
      edited.priceInput.observations.some(item => String(item.value).includes("41,000")),
    "배송비를 수정했는데 기존 확인이 남았거나 새 금액이 반영되지 않았습니다: " + JSON.stringify(edited.priceInput));
    log.afterEdit = { model: compare(edited)?.modelStatus, question: edited.priceInput.question.id,
      observations: edited.priceInput.observations };
    log.passed = true;
  }
  const shippingRow = (key) => query('[data-shipping-key="' + key + '"]');
  function openAdvancedTools(kind) {
    const tools = query(".advanced-tools");
    if (!tools || tools.hidden) {
      const showDesign = query('[data-review-design="' + kind + '"]');
      if (showDesign && !showDesign.disabled) {
        showDesign.click();
        return true;
      }
    }
    if (tools && !tools.hidden && !tools.open) tools.querySelector("summary")?.click();
    return false;
  }
  async function compareShipping(selector) {
    openAdvancedTools("shipping");
    const button = await until(() => {
      const control = query(selector);
      return control && !control.disabled && control;
    }, "배송 비교 버튼을 찾지 못했습니다: " + selector);
    const before = comparisonCount;
    lastError = null;
    button.click();
    return until(
      () => comparisonCount > before && lastComparison,
      "배송 비교 결과가 표시되지 않았습니다: " + selector,
    );
  }
  async function setupShipping(log, useReviewAction = false) {
    const { board, rootName } = await command("risk", "shipping");
    await scan("#scan-selection", rootName);
    log.diagnostics = (await command("read-journey", "shipping")).capture;
    riskCardFor(cases[0]);
    const original = { key: "original", frameId: board.start, fastReviewId: board.review, basicReviewId: board.freeReview };
    const originalBefore = (await command("inspect-shipping", "shipping", null, [original])).shipping[0];
    const before = comparisonCount;
    if (useReviewAction) {
      const button = query('[data-review-design="shipping"]');
      check(button && !button.disabled && button.getClientRects().length > 0,
        "위험 카드에서 Figma 시안 보기 버튼을 찾지 못했습니다.");
      const hasComparison = Boolean(shippingRow("minimal"));
      log.action = button.textContent.trim();
      lastError = null;
      button.click();
      check(document.activeElement?.id === "shipping", "Figma 시안 보기 후 키보드 포커스가 시안 영역으로 이동하지 않았습니다.");
      const comparison = await until(() => {
        const tools = query(".advanced-tools");
        return tools?.open && !tools.hidden && lastComparison?.rootId === board.start &&
          (hasComparison || comparisonCount > before) && shippingRow("layout") && lastComparison;
      }, "Figma 시안 보기 버튼으로 배송 비교를 열지 못했습니다.", 45000);
      const thumbnails = await until(() => {
        const images = [...document.querySelectorAll("#shipping .design-thumbnails img")];
        return images.length === 2 && images.every(image => image.naturalWidth > 0) && images;
      }, "최소 수정안과 배치 변경안의 이미지가 플러그인에 표시되지 않았습니다.");
      log.thumbnails = thumbnails.map(image => image.alt);
      return { board, original, originalBefore, comparison };
    }
    if (openAdvancedTools("shipping")) {
      log.action = "shipping-create";
      const comparison = await until(() => comparisonCount > before && lastComparison,
        "위험 카드에서 배송 비교 결과가 표시되지 않았습니다.");
      return { board, original, originalBefore, comparison };
    }
    const action = await until(
      () => query("#shipping-create")?.id || query("#shipping-rescan")?.id,
      "배송 제안 작업을 열 수 없습니다.",
    );
    const comparison = await compareShipping("#" + action);
    log.action = action;
    return { board, original, originalBefore, comparison };
  }
  async function runShipping(log, useReviewAction = false) {
    const { board, original, originalBefore, comparison } = await setupShipping(log, useReviewAction);
    const { columns, basicFee, fastFee, basicTotal, fastTotal, referenceFrameId } = comparison;
    check(
      sameIds(columns.map((column) => column.key), ["original", "minimal", "layout"]),
      "배송 비교에 필요한 세 안이 표시되지 않았습니다.",
    );
    check(basicFee === 0 && fastFee === 5000 && basicTotal === 29900 && fastTotal === 34900,
      "배송 비교 금액이 원본과 일치하지 않습니다.");
    const inspected = (await command("inspect-shipping", "shipping", null, columns)).shipping;
    const allFrames = new Set(inspected.flatMap((row) => [row.delivery.id, row.basicReview.id, row.fastReview.id]));
    check(allFrames.size === 9, "수정안의 화면이 원본 또는 다른 수정안과 중복됩니다.");
    check(JSON.stringify(inspected.find((row) => row.key === "original")) === JSON.stringify(originalBefore),
      "원본 배송 여정이 변경되었습니다.");
    check(referenceFrameId && !allFrames.has(referenceFrameId), "나란히 볼 원본 비교 프레임이 없습니다.");
    const reference = (await command("inspect-shipping", "shipping", null, [
      { ...original, frameId: referenceFrameId },
    ])).shipping[0];
    check(
      reference.fast.selected === true && reference.basic.selected === false &&
      reference.fast.model === board.component && reference.basic.model === board.component,
      "나란히 배치된 원본 비교 화면이 원본의 상태와 일치하지 않습니다.",
    );
    const sideBySide = [reference, ...inspected.filter((row) => row.key !== "original")].map((row) => row.delivery);
    check(sideBySide.every((frame, index) =>
      frame.y === sideBySide[0].y &&
      (index === 0 || frame.x >= sideBySide[index - 1].x + sideBySide[index - 1].width)),
    "원본과 두 안의 시작 프레임이 왼쪽에서 오른쪽으로 정렬되지 않았습니다.");
    for (const row of inspected) {
      const source = row.key === "original";
      check(row.fast.model === board.component && row.basic.model === board.component,
        "기존 배송 컴포넌트 연결이 끊겼습니다: " + row.key);
      check(row.fast.selected === source && row.basic.selected === !source,
        "기본 배송 설정이 올바르지 않습니다: " + row.key);
      check(row.fast.to === row.fastReview.id && row.basic.to === row.basicReview.id &&
        row.next.to === (source ? row.fastReview.id : row.basicReview.id),
        "배송 프로토타입이 올바른 확인 화면으로 연결되지 않았습니다: " + row.key);
      check(row.fastReview.labels.includes("결제 예정 금액 34,900원") &&
        row.basicReview.labels.includes("결제 예정 금액 29,900원"),
        "확인 프레임의 총액이 일치하지 않습니다: " + row.key);
      if (row.key === "minimal") {
        check(row.fast.x === originalBefore.fast.x && row.fast.y === originalBefore.fast.y &&
          row.basic.x === originalBefore.basic.x && row.basic.y === originalBefore.basic.y,
          "최소 수정안에서 기존 배송 옵션 위치가 변경되었습니다.");
      } else if (row.key === "layout") {
        check(row.basic.y < row.fast.y && row.basic.parentId === row.fast.parentId &&
          row.basic.parentId !== row.delivery.id,
          "배치안에서 배송 비교 영역이 구분되지 않았습니다.");
      }
    }
    log.frames = inspected;
    log.sideBySide = sideBySide;
    const overview = query("#shipping-overview");
    check(overview, "캔버스에서 나란히 보기 버튼이 없습니다.");
    overview.click();
    await until(async () => {
      const { view } = await command("inspect", "shipping");
      return sameIds(view.selected.map((layer) => layer.id), sideBySide.map((layer) => layer.id)) &&
        view.selected.every((layer) => layer.inViewport);
    }, "캔버스에서 원본과 수정안 둘을 함께 열지 못했습니다.");

    log.choices = {};
    for (const choice of ["default", "basic", "fast"]) {
      const radio = query('input[name="shipping-choice"][value="' + choice + '"]');
      check(radio, "배송 비교 선택지를 찾지 못했습니다: " + choice);
      radio.click();
      const totals = {};
      for (const column of columns) {
        const option = choice === "default" ? (column.key === "original" ? "fast" : "basic") : choice;
        const expected = option === "fast" ? "34,900원" : "29,900원";
        const row = shippingRow(column.key);
        const total = row?.querySelector(".shipping-amount")?.textContent.trim();
        check(total === expected, "패널 총액 불일치: " + column.key + "/" + choice + " · " + total);
        totals[column.key] = total;
        if (choice === "default") continue;
        const receiptButton = row.querySelector('[data-shipping-focus="receipt"]');
        check(receiptButton, "확인 화면 이동 버튼이 없습니다: " + column.key);
        receiptButton.click();
        const receiptId = option === "fast" ? column.fastReviewId : column.basicReviewId;
        await until(async () => {
          const { view } = await command("inspect", "shipping");
          return view.selected[0]?.id === receiptId && view.selected[0].inViewport;
        }, "확인 화면 이동 실패: " + column.key + "/" + choice);
      }
      log.choices[choice] = totals;
    }

    const rescanned = await compareShipping("#shipping-rescan");
    check(
      rescanned.columns.length === 3 && rescanned.columns.every((column) => {
        const expected = column.key === "original" ? "risk_signal" : "signal_absent";
        return column.status === expected && shippingRow(column.key)?.dataset.status === expected;
      }),
      "배송 재검사 상태가 원본의 위험과 두 수정안의 신호 없음을 보여주지 않습니다.",
    );
    log.after = rescanned.columns.map(({ key, status }) => ({ key, status }));
    delete log.diagnostics;
    log.passed = true;
  }
  function pngHeader(image) {
    if (!image?.png?.startsWith("iVBORw0KGgo") || !(image.width > 0 && image.height > 0)) return false;
    const bytes = Uint8Array.from(atob(image.png.slice(0, 32)), byte => byte.charCodeAt(0));
    const data = new DataView(bytes.buffer);
    return data.getUint32(16) > 0 && data.getUint32(20) > 0;
  }
  async function clickReady(selector, description = selector) {
    openAdvancedTools("shipping");
    const button = await until(() => {
      const control = query(selector);
      return control && !control.disabled && !control.hidden && control;
    }, "조작할 버튼을 찾지 못했습니다: " + description);
    button.click();
    return button;
  }
  async function expectPreviewImage(kind, image) {
    await until(() => {
      const rendered = query('[data-preview-image="' + kind + '"]');
      return rendered?.getAttribute("src") === "data:image/png;base64," + image.png &&
        rendered.naturalWidth > 0 && rendered.naturalHeight > 0;
    }, "실제 미리보기 이미지가 로드되지 않았습니다: " + kind + " " + image.id);
  }
  function isNormalizedRect(rect) {
    return rect?.x >= 0 && rect?.y >= 0 && rect?.width > 0 && rect?.height > 0 &&
      rect.x + rect.width <= 1.001 && rect.y + rect.height <= 1.001;
  }
  async function runShippingPreview(log) {
    const { board, original, originalBefore, comparison } = await setupShipping(log);
    lastError = lastShippingPreview = lastAdoptedShipping = null;
    await clickReady("#shipping-preview", "겹쳐보기");
    const { preview } = await until(
      () => lastShippingPreview?.rootId === board.start && lastShippingPreview,
      "겹쳐보기 결과가 표시되지 않았습니다.",
      45000,
    );
    check(sameIds(preview.columns.map(column => column.key), ["original", "minimal", "layout"]),
      "원본과 두 수정안의 미리보기가 필요합니다.");
    for (const row of preview.columns) {
      const source = comparison.columns.find(column => column.key === row.key);
      check(row.frame.id === source.frameId && row.receipts.fast.id === source.fastReviewId &&
        row.receipts.basic.id === source.basicReviewId, "원본 또는 수정안의 미리보기 프레임 ID 불일치: " + row.key);
      check([row.frame, row.receipts.fast, row.receipts.basic].every(pngHeader),
        "Figma PNG 내보내기 결과 또는 크기가 올바르지 않습니다: " + row.key);
      check(sameIds(row.hotspots.map(spot => spot.key), ["basic", "fast", "continue"]) &&
        row.hotspots.every(isNormalizedRect), "배송 클릭 영역 좌표가 올바르지 않습니다: " + row.key);
      check(row.key === "original" || (row.markers.length > 0 &&
        row.markers.every(marker => marker.nodeId && isNormalizedRect(marker) && (!marker.from || isNormalizedRect(marker.from)))),
      "변경 표시의 레이어 ID 또는 좌표가 올바르지 않습니다: " + row.key);
    }
    log.images = preview.columns.map(row => ({
      key: row.key, start: row.frame.id, basic: row.receipts.basic.id, fast: row.receipts.fast.id,
    }));
    const originalPreview = preview.columns.find(column => column.key === "original");
    log.markers = [];
    log.routes = [];
    for (const row of preview.columns) {
      await clickReady('[data-preview-column="' + row.key + '"]', row.label);
      await clickReady("#shipping-preview-overlay", "겹쳐보기");
      if (row.key !== "original") {
        await expectPreviewImage("original", originalPreview.frame);
        await expectPreviewImage("proposal", row.frame);
        const opacity = query("#shipping-preview-opacity");
        check(opacity, "수정안 표시 강도 조절이 없습니다.");
        opacity.value = "41";
        opacity.dispatchEvent(new Event("input", { bubbles: true }));
        await until(() => {
          const image = query('[data-preview-image="proposal"]');
          // The UI may set opacity on either the image or its immediate layer.
          const style = image && getComputedStyle(image);
          const layerStyle = image?.parentElement && getComputedStyle(image.parentElement);
          return Number(style?.opacity) === 0.41 || Number(layerStyle?.opacity) === 0.41;
        }, "수정안 표시 강도가 이미지에 반영되지 않았습니다.");
        await clickReady("#shipping-preview-peek", "원본 잠깐 보기");
        await until(() => query("#shipping-preview-peek")?.getAttribute("aria-pressed") === "true",
          "원본만 보는 상태가 켜지지 않았습니다.");
        await expectPreviewImage("original", originalPreview.frame);
        await until(() => {
          const image = query('[data-preview-image="proposal"]');
          const hidden = layer => {
            const style = getComputedStyle(layer);
            return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
          };
          return !image || hidden(image) || hidden(image.parentElement);
        }, "원본 잠깐 보기 상태에서 수정안이 계속 보입니다.");
        await clickReady("#shipping-preview-peek", "수정안 다시 보기");
        await expectPreviewImage("proposal", row.frame);
        for (const marker of row.markers) {
          const { targetInView } = await command("pan-away-proposal", "shipping", marker.nodeId);
          check(!targetInView, "이동하기 전에 변경 레이어가 계속 화면에 보입니다: " + marker.key);
          await clickReady('[data-preview-marker="' + marker.key + '"]', marker.label);
          await until(async () => {
            const { view } = await command("inspect", "shipping");
            return view.selected.length === 1 && view.selected[0].id === marker.nodeId && view.selected[0].inViewport;
          }, "변경 표시에서 해당 Figma 레이어로 이동하지 못했습니다: " + marker.key);
          log.markers.push({ key: row.key, layer: marker.nodeId, change: marker.key });
        }
      }
      await clickReady("#shipping-preview-test", "직접 눌러보기");
      for (const route of ["basic", "fast", "continue"]) {
        await clickReady('[data-preview-route="' + route + '"]', row.key + "/" + route);
        const option = route === "continue" ? row.defaultOption : route;
        const expected = option === "fast" ? "34,900원" : "29,900원";
        await expectPreviewImage("receipt", row.receipts[option]);
        await until(() => query("#shipping-preview-total")?.textContent.trim() === expected,
          "배송 선택 후 화면의 주문 합계가 다릅니다: " + row.key + "/" + route);
        log.routes.push({ key: row.key, route, option, total: expected, receipt: row.receipts[option].id });
        await clickReady("#shipping-preview-back", "배송 선택으로 돌아가기");
      }
    }

    let adopted = preview.adopted?.key === "layout" ? preview.adopted : null;
    if (adopted) {
      await clickReady("#shipping-adopt-focus", "채택한 안 보기");
    } else {
      await clickReady("#shipping-adopt", "이 안 채택");
      ({ adopted } = await until(
        () => lastAdoptedShipping?.rootId === board.start && lastAdoptedShipping,
        "배송 수정안 채택 결과가 없습니다.",
        30000,
      ));
    }
    check(adopted.key === "layout", "선택한 배치 변경안이 채택되지 않았습니다.");
    const variantIds = new Set(preview.columns.flatMap(row => [row.frame.id, row.receipts.basic.id, row.receipts.fast.id]));
    check(new Set([adopted.frameId, adopted.basicReviewId, adopted.fastReviewId]).size === 3 &&
      [adopted.frameId, adopted.basicReviewId, adopted.fastReviewId].every(id => id && !variantIds.has(id)),
    "채택안이 별도 프로토타입 여정으로 생성되지 않았습니다.");
    await until(async () => {
      const { view } = await command("inspect", "shipping");
      return view.selected.length === 1 && view.selected[0].id === adopted.frameId && view.selected[0].inViewport;
    }, "채택한 배송 프레임이 선택되지 않았습니다.");
    const selectedDesign = comparison.columns.find(column => column.key === adopted.key);
    const { shipping: [source, accepted, chosen], shippingCheck } = await command(
      "inspect-adopted-shipping", "shipping", null, [original, adopted, selectedDesign],
    );
    check(JSON.stringify(source) === JSON.stringify(originalBefore), "채택 후 원본 배송 여정이 변경되었습니다.");
    check(accepted.fast.model === board.component && accepted.basic.model === board.component &&
      !accepted.fast.selected && accepted.basic.selected,
    "채택안의 배송 옵션에 기존 컴포넌트 또는 기본 선택이 유지되지 않았습니다.");
    check(["basic", "fast", "next"].every(key => ["x", "y", "width", "height"].every(dimension =>
      accepted[key][dimension] === chosen[key][dimension])) &&
      accepted.fast.parentId === accepted.basic.parentId && accepted.fast.parentId !== adopted.frameId,
    "채택안에 선택한 배송 옵션 배치가 유지되지 않았습니다.");
    check(accepted.fast.to === adopted.fastReviewId && accepted.basic.to === adopted.basicReviewId &&
      accepted.next.to === adopted.basicReviewId &&
      accepted.fastReview.labels.includes("결제 예정 금액 34,900원") &&
      accepted.basicReview.labels.includes("결제 예정 금액 29,900원"),
    "채택안의 배송 확인 화면 연결 또는 총액이 일치하지 않습니다.");
    check(shippingCheck.editable && shippingCheck.original === "risk_signal" && shippingCheck.adopted === "signal_absent",
      "채택안이 잠겼거나 실제 재검사 결과가 다릅니다.");
    log.adopted = { key: adopted.key, frame: adopted.frameId, model: accepted.fast.model, ...shippingCheck };
    delete log.diagnostics;
    log.passed = true;
  }
  async function compareProposal(kind, action) {
    const before = proposalComparisons.get(kind);
    lastError = null;
    const triggered = openAdvancedTools(kind);
    const selector = "#" + kind + "-" + action;
    if (action !== "create" || !triggered) {
      const control = await until(() => {
        const button = query(selector);
        return button && !button.disabled && button;
      }, "디자인 제안 버튼을 찾지 못했습니다: " + selector);
      control.click();
    }
    return until(() => {
      const next = proposalComparisons.get(kind);
      return next !== before && next;
    }, "디자인 비교 결과가 표시되지 않았습니다: " + selector);
  }

  async function runProposal(kind, log) {
    const { board, rootName } = await command("start-proposal", kind);
    const scanResult = await scan("#scan-selection", rootName);
    riskCardFor(cases.find(item => item.key === kind));
    log.available = scanResult.proposals?.[kind];
    const originals = [{ key: "original", frameId: board.start }];
    const before = (await command("inspect-proposals", kind, null, originals)).proposalData.proposals[0];
    const comparison = await compareProposal(kind, "create");
    const columns = comparison.columns;
    check(sameIds(columns.map(column => column.key), ["original", "minimal", "layout"]),
      "원본과 두 안의 비교 결과가 없습니다.");
    const { proposals, reference } = (await command("inspect-proposals", kind, null, columns, comparison.referenceFrameId)).proposalData;
    check(JSON.stringify(proposals.find(row => row.key === "original")) === JSON.stringify(before),
      "비교 생성 후 원본 컴포넌트나 화면 연결이 바뀌었습니다.");
    check(before.components.every(item => item.fingerprint.model), "원본 컴포넌트 연결이 유실되었습니다.");
    const allScreens = proposals.flatMap(row => row.screens);
    check(new Set(allScreens).size === 9 && !allScreens.includes(reference.id),
      "비교 안의 프로토타입이 원본 또는 다른 안의 화면을 사용합니다.");
    for (const row of proposals) {
      check(sameIds(row.components.map(item => item.fingerprint.model),
        before.components.map(item => item.fingerprint.model)),
      "기존 모델 컴포넌트 연결이 끊겼습니다: " + row.key);
      check(row.transitions.length === 2 && row.transitions.every(edge =>
        row.screens.includes(edge.from) && row.screens.includes(edge.to)),
      "프로토타입 경로가 해당 수정안의 화면으로 연결되지 않았습니다: " + row.key);
    }
    const topRow = [reference, proposals.find(row => row.key === "minimal").start, proposals.find(row => row.key === "layout").start];
    check(topRow.every((node, index) => node.y === reference.y &&
      (index === 0 || node.x >= topRow[index - 1].x + topRow[index - 1].width)),
    "원본과 수정안이 같은 줄에 나란히 배치되지 않았습니다.");
    log.aligned = topRow;
    log.components = proposals.map(row => ({
      key: row.key, modelIds: row.components.map(item => item.fingerprint.model), transitions: row.transitions
    }));
    const overview = query("#" + kind + "-overview");
    check(overview, "한 줄 비교 버튼이 없습니다.");
    overview.click();
    await until(async () => {
      const { view } = await command("inspect", kind);
      return sameIds(view.selected.map(item => item.id), topRow.map(item => item.id)) &&
        view.selected.every(item => item.inViewport);
    }, "원본과 두 안이 캔버스에 한꺼번에 보이지 않습니다.");
    log.steps = [];
    for (const column of columns) {
      const row = query('[data-proposal-kind="' + kind + '"][data-proposal-key="' + column.key + '"]');
      check(row, "안별 비교 행을 찾을 수 없습니다: " + column.key);
      const original = column.key === "original";
      const expected = original ? "risk_signal" : "signal_absent";
      check(column.status === expected && row.dataset.status === expected,
        "안별 위험 신호 불일치: " + column.key);
      check(column.steps.length === (kind === "hierarchy" ? 2 : 3),
        "버튼 또는 가격 단계가 비교표에 빠졌습니다: " + column.key);
      const native = proposals.find(item => item.key === column.key);
      if (kind === "hierarchy") {
        check(column.steps.every(step =>
          native.transitions.some(edge => edge.from === column.frameId && edge.to === step.frameId && edge.label === step.label)),
        "비교표 버튼 문구나 목적지가 실제 프로토타입과 다릅니다: " + column.key);
        if (column.key === "minimal") {
          check(native.components.every((item, index) => item.parentId === column.frameId &&
            item.geometry.x === before.components[index].geometry.x && item.geometry.y === before.components[index].geometry.y),
          "최소 수정안의 버튼 위치가 바뀌었습니다.");
        } else if (column.key === "layout") {
          check(native.components[0].parentId === native.components[1].parentId &&
            native.components[0].parentId !== column.frameId,
          "배치 변경안에서 두 버튼의 비교 영역이 만들어지지 않았습니다.");
        }
      } else {
        const firstShown = column.steps.find(step => step.detail?.includes("필수 비용 3,000원"));
        check(firstShown?.key === (original ? "stage-2" : "stage-0") &&
          column.summary?.includes(firstShown.label) &&
          column.steps[0].detail?.includes(original ? "29,900원" : "32,900원"),
        "필수 비용을 처음 표시하는 단계 또는 첫 가격이 다릅니다: " + column.key);
        if (column.key === "layout") {
          check(column.steps[1].detail?.includes("필수 비용 3,000원"),
          "배치 변경안의 중간 단계에 필수 비용이 표시되지 않습니다.");
        }
      }
      for (const step of column.steps) {
        const link = Array.from(row.querySelectorAll("[data-proposal-step]")).find(button => button.dataset.proposalStep === step.key);
        check(link && link.textContent.includes(step.label) && link.textContent.includes(step.detail),
          "단계 이름이나 세부 정보가 표시되지 않았습니다: " + step.label);
        const { targetInView } = await command("pan-away-proposal", kind, step.frameId);
        check(!targetInView, "이동 전에 비교 단계가 계속 화면에 보입니다: " + step.label);
        link.click();
        await until(async () => {
          const { view } = await command("inspect", kind);
          return view.selected.length === 1 && view.selected[0].id === step.frameId && view.selected[0].inViewport;
        }, "비교 단계의 프레임으로 이동하지 못했습니다: " + step.label);
        log.steps.push({ column: column.key, ...step });
      }
    }
    const rescanned = await compareProposal(kind, "rescan");
    check(rescanned.rootId === board.start && rescanned.columns.every(column =>
      column.status === (column.key === "original" ? "risk_signal" : "signal_absent")),
    "시작점 고정 또는 수정 후 재검사 결괏값 불일치");
    log.after = rescanned.columns.map(({ key, status }) => ({ key, status }));
    log.passed = true;
  }
  async function runJourneys(report, compact = false) {
    for (const spec of cases) {
      status.textContent = spec.label + " 검사 중";
      const log = { journey: spec.key, passed: false };
      report.cases.push(log);
      await runOne(spec, log);
      if (compact) report.cases[report.cases.length - 1] = {
        journey: log.journey, passed: log.passed, root: log.root, manualScan: log.manualScan,
        before: log.before, after: log.after, evidence: log.evidence.map(layer => layer.id),
        panelBefore: log.panelBefore, panelAfter: log.panelAfter, alternativeCount: log.alternativeCount,
      };
    }
  }
  async function runNewUI(report) {
    status.textContent = "검증 여정 준비 중";
    await command("build");
    await runJourneys(report, true);

    status.textContent = "배송비 답변 다시 입력 검증 중";
    const price = { journey: "price-input", passed: false };
    const priceIndex = report.cases.push(price) - 1;
    await runPriceInput(price);
    report.cases[priceIndex] = { journey: price.journey, passed: price.passed, root: price.root, reset: price.reset };

    status.textContent = "배송 시안 보기 검증 중";
    const shipping = { journey: "shipping-design", passed: false };
    const shippingIndex = report.cases.push(shipping) - 1;
    await runShipping(shipping, true);
    report.cases[shippingIndex] = {
      journey: shipping.journey, passed: shipping.passed, action: shipping.action, thumbnails: shipping.thumbnails,
      frames: shipping.sideBySide.map(frame => frame.id), after: shipping.after,
    };
  }
  toolbar.addEventListener("click", async (event) => {
    const btn = event.target.closest("button");
    if (!btn || active) return;
    active = true;
    toolbar.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (["qa-run", "qa-run-new-ui", "qa-run-shipping", "qa-run-proposals", "qa-run-shipping-preview", "qa-run-price-input"].includes(btn.id)) {
        const report = {
          started: new Date().toISOString(),
          cases: [],
          passed: false,
        };
        try {
          if (btn.id === "qa-run-new-ui") {
            await runNewUI(report);
            status.textContent = "새 검사 화면 검증 통과";
          } else if (btn.id === "qa-run-price-input") {
            status.textContent = "가격 입력 검사 중";
            const log = { journey: "price-input", passed: false };
            report.cases.push(log);
            await runPriceInput(log);
            status.textContent = "가격 입력 2단계 통과";
          } else if (btn.id === "qa-run-shipping-preview") {
            await command("build");
            status.textContent = "배송 오버레이 검사 중";
            const log = { journey: "shipping-preview", passed: false };
            report.cases.push(log);
            await runShippingPreview(log);
            status.textContent = "배송 오버레이·채택 통과";
          } else if (btn.id === "qa-run-proposals") {
            await command("prepare-proposals");
            for (const kind of ["hierarchy", "price"]) {
              status.textContent = (kind === "hierarchy" ? "계층구조" : "가격") + " 수정안 검사 중";
              const log = { journey: kind + "-design", passed: false };
              report.cases.push(log);
              await runProposal(kind, log);
            }
            status.textContent = "계층구조·가격 수정안 통과";
          } else if (btn.id === "qa-run-shipping") {
            await command("build");
            status.textContent = "배송 수정안 검사 중";
            const log = { journey: "shipping-design", passed: false };
            report.cases.push(log);
            await runShipping(log);
            status.textContent = "배송 수정안 통과";
          } else {
            await command("build");
            await runJourneys(report);
            status.textContent = "세 여정 통과";
          }
          report.passed = true;
        } catch (error) {
          report.error = String(error.message || error);
          status.textContent = "중단 · " + report.error;
        }
        report.finished = new Date().toISOString();
        output.value = JSON.stringify(report, null, 2);
        toolbar.querySelector("details").open = true;
      } else {
        const reply = await command(btn.dataset.op, query("#qa-journey").value);
        output.value = JSON.stringify(reply, null, 2);
        status.textContent = btn.textContent + " 완료";
      }
    } catch (error) {
      status.textContent = "실패 · " + String(error.message || error);
    } finally {
      active = false;
      toolbar.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  });
})();

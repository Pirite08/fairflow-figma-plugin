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
    },
    {
      key: "hierarchy",
      pattern: "misleading_visual_hierarchy",
      label: "잘못된 계층구조",
      evidence: ["paid", "basic"],
      frames: 3,
      links: 2,
    },
    {
      key: "price",
      pattern: "drip_pricing",
      label: "순차공개 가격책정",
      evidence: ["first", "card", "fee", "total"],
      frames: 2,
      links: 1,
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
    lastComparison = null,
    comparisonCount = 0,
    lastError = null;
  window.addEventListener("message", (event) => {
    const message = getPluginMessage(event);
    if (!message) return;
    if (message.type === "result") {
      lastResult = message;
      resultCount++;
    }
    if (message.type === "shipping-comparison") {
      lastComparison = message.comparison;
      comparisonCount++;
    }
    if (["error", "notice", "shipping-error"].includes(message.type))
      lastError = message.message;
    if (message.type === "qa-reply" && pending.has(message.token)) {
      const accept = pending.get(message.token);
      pending.delete(message.token);
      accept(message);
    }
  });
  function command(operation, journey, targetId, columns) {
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
          },
        },
        "*",
      );
    });
  }
  function check(value, msg) {
    if (!value) throw Error(msg);
  }
  async function until(checkState, description) {
    const untilTime = Date.now() + 10000;
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
    const button = query(id);
    await until(
      () => !button.disabled && !button.hidden,
      "검사 버튼 비활성 " + id,
    );
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
  function cardFor(spec, expected) {
    const cards = Array.from(document.querySelectorAll(".finding")).filter(
      (n) => n.querySelector(".pattern")?.textContent === spec.label,
    );
    check(
      cards.length === 1,
      "결과 카드 개수: " + spec.label + " " + cards.length,
    );
    const card = cards[0];
    check(
      card.dataset.status === expected &&
        card.querySelector(".badge")?.textContent ===
          (expected === "risk_signal" ? "위험 신호" : "신호 없음"),
      spec.label +
        " 표시 상태: " +
        card.dataset.status +
        " (예상 " +
        expected +
        ")",
    );
    check(
      card.querySelector(".suggestion")?.textContent.trim(),
      "수정안이 비었습니다.",
    );
    return card;
  }
  async function runOne(spec, log) {
    const start = await command("risk", spec.key),
      board = start.board,
      name = start.rootName;
    log.root = { id: board.start, name };
    check(
      start.view.selected[0]?.id === board.start &&
        start.view.starts.some((p) => p.nodeId === board.start),
      "시작점 등록 또는 선택 실패",
    );
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
    const card = cardFor(spec, "risk_signal");
    log.before = card.dataset.status;
    if (!card.open) card.querySelector("summary").click();
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
    log.after = cardFor(spec, "signal_absent").dataset.status;
    const view = (await command("inspect", spec.key)).view;
    check(
      view.selected[0]?.id === pinnedEvidence,
      "재검사 중 선택 레이어가 변경되었습니다.",
    );
    log.selectionAfterRescan = view.selected[0].id;
    log.passed = true;
  }
  const shippingRow = (key) => query('[data-shipping-key="' + key + '"]');
  async function compareShipping(selector) {
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
  async function runShipping(log) {
    const { board, rootName } = await command("risk", "shipping");
    await scan("#scan-selection", rootName);
    log.diagnostics = (await command("read-journey", "shipping")).capture;
    cardFor(cases[0], "risk_signal");
    const original = { key: "original", frameId: board.start, fastReviewId: board.review, basicReviewId: board.freeReview };
    const originalBefore = (await command("inspect-shipping", "shipping", null, [original])).shipping[0];
    const action = await until(
      () => query("#shipping-create")?.id || query("#shipping-rescan")?.id,
      "배송 제안 작업을 열 수 없습니다.",
    );
    const comparison = await compareShipping("#" + action);
    log.action = action;
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
  toolbar.addEventListener("click", async (event) => {
    const btn = event.target.closest("button");
    if (!btn || active) return;
    active = true;
    toolbar.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (btn.id === "qa-run" || btn.id === "qa-run-shipping") {
        const report = {
          started: new Date().toISOString(),
          cases: [],
          passed: false,
        };
        try {
          await command("build");
          if (btn.id === "qa-run-shipping") {
            status.textContent = "배송 수정안 검사 중";
            const log = { journey: "shipping-design", passed: false };
            report.cases.push(log);
            await runShipping(log);
            status.textContent = "배송 수정안 통과";
          } else {
            for (const spec of cases) {
              status.textContent = spec.label + " 검사 중";
              const log = { journey: spec.key, passed: false };
              report.cases.push(log);
              await runOne(spec, log);
            }
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

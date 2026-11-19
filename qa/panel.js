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
    lastError = null;
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data && event.data.pluginMessage;
    if (!message) return;
    if (message.type === "result") {
      lastResult = message;
      resultCount++;
    }
    if (message.type === "error" || message.type === "notice")
      lastError = message.message;
    if (message.type === "qa-reply" && pending.has(message.token)) {
      const accept = pending.get(message.token);
      pending.delete(message.token);
      accept(message);
    }
  });
  function command(operation, journey, targetId) {
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
  toolbar.addEventListener("click", async (event) => {
    const btn = event.target.closest("button");
    if (!btn || active) return;
    active = true;
    toolbar.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (btn.id === "qa-run") {
        const report = {
          started: new Date().toISOString(),
          cases: [],
          passed: false,
        };
        try {
          await command("build");
          for (const spec of cases) {
            status.textContent = spec.label + " 검사 중";
            const log = { journey: spec.key, passed: false };
            report.cases.push(log);
            await runOne(spec, log);
          }
          report.passed = true;
          status.textContent = "세 여정 통과";
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

// Load the shipping entry, controller, reader and analyzer exactly as the public plugin does.
import "../src/main.js";
import { readJourney } from "../src/reader.js";
import { build, registered, state, useCurrentPage } from "./fixture/board.js";

function inView(rect) {
  const viewport = figma.viewport.bounds;
  return Boolean(
    rect &&
      viewport &&
      rect.x < viewport.x + viewport.width &&
      rect.x + rect.width > viewport.x &&
      rect.y < viewport.y + viewport.height &&
      rect.y + rect.height > viewport.y,
  );
}
function snapshot() {
  const page = figma.currentPage;
  const selected = page.selection.map((node) => ({
    id: node.id,
    name: node.name,
    inViewport: inView(node.absoluteBoundingBox),
  }));
  return { selected, page: page.id, starts: page.flowStartingPoints };
}

function destination(node) {
  const click = node.reactions.find(
    (reaction) => reaction.trigger?.type === "ON_CLICK",
  );
  return click?.actions?.find((action) => action.type === "NODE")?.destinationId;
}

async function frame(id) {
  const node = await figma.getNodeByIdAsync(id);
  if (node?.type !== "FRAME" || node.parent.id !== figma.currentPage.id)
    throw Error("배송 QA 프레임을 찾지 못했습니다: " + id);
  return node;
}

function geometry(node) {
  return { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height };
}

async function review(id) {
  const node = await frame(id);
  const labels = node.findAll((child) => child.type === "TEXT");
  return { ...geometry(node), labels: labels.map((label) => label.characters) };
}

async function shippingChoice(node, selectedKey) {
  const model = await node.getMainComponentAsync();
  return {
    ...geometry(node),
    parentId: node.parent.id,
    to: destination(node),
    selected: node.componentProperties[selectedKey]?.value,
    model: model?.id,
  };
}

async function inspectShipping(board, columns) {
  const originals = await Promise.all(
    [board.fast, board.free, board.confirm].map((id) => figma.getNodeByIdAsync(id)),
  );
  const result = [];
  for (const column of columns) {
    const delivery = await frame(column.frameId);
    const [fast, basic, next] = originals.map(
      (source) => delivery.findOne((node) => node.name === source.name),
    );
    if (!fast || !basic || !next || fast.type !== "INSTANCE" || basic.type !== "INSTANCE")
      throw Error("배송 옵션 또는 진행 레이어를 찾지 못했습니다: " + column.key);
    const [fastOption, basicOption, fastReview, basicReview] = await Promise.all([
      shippingChoice(fast, board.selectedKey),
      shippingChoice(basic, board.selectedKey),
      review(column.fastReviewId),
      review(column.basicReviewId),
    ]);
    result.push({
      key: column.key,
      delivery: geometry(delivery),
      fast: fastOption,
      basic: basicOption,
      next: { ...geometry(next), to: destination(next) },
      fastReview,
      basicReview,
    });
  }
  return result;
}

figma.ui.on("message", async (message) => {
  if (!message || message.type !== "qa-command") return;
  useCurrentPage();
  const { operation, journey, token } = message;
  try {
    if (operation === "build") await build();
    if (["risk", "start", "fix", "edit"].includes(operation)) {
      if (!["shipping", "hierarchy", "price"].includes(journey))
        throw Error("Unknown fixture journey");
      await state(
        journey,
        operation === "edit" ? "fix" : operation,
        operation !== "edit",
      );
    }
    const boards = registered();
    const board = boards && boards[journey];
    const root = board && (await figma.getNodeByIdAsync(board.start));
    const shipping = operation === "inspect-shipping" && journey === "shipping"
      ? await inspectShipping(board, message.columns) : undefined;
    const capture = operation === "read-journey" && root ? await readJourney(figma, root) : undefined;
    if (capture) {
      for (const state of capture.states) {
        state.nodes = state.nodes.map(({ node_id, name, role, text, checked, amount_krw }) =>
          ({ node_id, name, role, text, checked, amount_krw }));
      }
    }
    let targetInView;
    if (message.targetId) {
      if (!board || !Object.values(board).includes(message.targetId))
        throw Error("Unknown fixture layer.");
      const target = await figma.getNodeByIdAsync(message.targetId);
      const rect = target && target.absoluteBoundingBox;
      if (!rect) throw Error("Missing fixture layer bounds.");
      if (operation === "pan-away") {
        figma.viewport.center = {
          x: rect.x + rect.width + figma.viewport.bounds.width + 300,
          y: rect.y + rect.height / 2,
        };
      }
      targetInView = inView(rect);
    }
    figma.ui.postMessage({
      type: "qa-reply",
      token,
      view: snapshot(),
      targetInView,
      shipping,
      capture,
      board,
      rootName: root && root.name,
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "qa-reply",
      token,
      error: String(error.message || error),
    });
  }
});

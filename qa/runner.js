// Load the shipping entry, controller, reader and analyzer exactly as the public plugin does.
import "../src/main.js";
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

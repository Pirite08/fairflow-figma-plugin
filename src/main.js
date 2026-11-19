import { readJourney } from "./reader.js";
import { analyzeJourney } from "./analyze.js";
import { startPanel } from "./controller.js";
import { hasFastShipping, readShippingScenario } from "./shipping.js";
import { createShippingDesigns } from "./shipping-design.js";

figma.showUI(__html__, { width: 420, height: 620, themeColors: true });
startPanel(figma, async (frame, startConfirmedByDesigner) => {
  const journey = await readJourney(figma, frame);
  if (startConfirmedByDesigner) journey.flow_start_confirmed = true;
  const layerLabels = new Map();
  for (const state of journey.states) {
    const labels = new Map();
    for (const node of state.nodes) {
      const label = (node.text || node.name || node.role || "레이어").replace(/\s+/g, " ").trim().slice(0, 60);
      labels.set(node.node_id, label);
    }
    layerLabels.set(state.state_id, labels);
  }
  const findings = analyzeJourney(journey).map((finding) => ({
    ...finding,
    evidence: finding.evidence.map((item) => ({
      ...item,
      label: layerLabels.get(item.state_id)?.get(item.node_id) || "프레임 보기"
    }))
  }));
  return {
    frameName: frame.name,
    stateCount: journey.states.length,
    transitionCount: journey.transitions.length,
    canConfirmStart: !journey.flow_start_confirmed,
    warnings: journey.warnings || [],
    findings,
    shipping: readShippingScenario(journey, figma.currentPage.id),
    hasFastShipping: hasFastShipping(journey)
  };
}, createShippingDesigns);

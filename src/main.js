import { readJourney } from "./reader.js";
import { analyzeJourney } from "./analyze.js";
import { compareDetectors } from "./model.js";
import modelWeights from "./model-weights.json" with { type: "json" };
import { startPanel } from "./controller.js";
import { readShippingScenario } from "./shipping.js";
import { createShippingDesigns } from "./shipping-design.js";
import { createHierarchyProposals, readHierarchyProposal } from "./hierarchy-proposals.js";
import { createPricingProposals, readPricingProposal } from "./pricing-proposals.js";
import { reviewContent } from "./review-content.js";
import { editablePriceCopy } from "./review-previews.js";
import { preparePriceInput } from "./pricing-input.js";

figma.showUI(__html__, { width: 540, height: 700, themeColors: true });
startPanel(figma, async (frame, startConfirmedByDesigner, priceContext, submission) => {
  const journey = await readJourney(figma, frame);
  if (startConfirmedByDesigner) journey.flow_start_confirmed = true;
  const pricing = preparePriceInput(journey, modelWeights.patterns.drip_pricing, priceContext, submission);
  const ruleFindings = analyzeJourney(journey);
  const layerLabels = new Map();
  for (const state of journey.states) {
    const labels = new Map();
    for (const node of state.nodes) {
      const label = (node.text || node.name || node.role || "레이어").replace(/\s+/g, " ").trim().slice(0, 60);
      labels.set(node.node_id, label);
    }
    layerLabels.set(state.state_id, labels);
  }
  const findings = await Promise.all(ruleFindings.map(async (finding) => {
    const result = {
      ...finding,
      evidence: finding.evidence.map((item) => ({
        ...item,
        label: layerLabels.get(item.state_id)?.get(item.node_id) || "프레임 보기"
      }))
    };
    if (finding.pattern === "drip_pricing" && finding.status === "risk_signal") {
      result.copyEdit = await editablePriceCopy(finding, journey, figma);
    }
    const review = reviewContent(result);
    return review ? { ...result, review } : result;
  }));
  return {
    frameName: frame.name,
    stateCount: journey.states.length,
    transitionCount: journey.transitions.length,
    canConfirmStart: !journey.flow_start_confirmed,
    warnings: journey.warnings || [],
    findings,
    comparison: compareDetectors(journey, ruleFindings, modelWeights.patterns, pricing.priceInput?.score),
    ...pricing,
    shipping: readShippingScenario(journey, figma.currentPage.id),
    proposals: {
      hierarchy: readHierarchyProposal(journey, findings, figma.currentPage.id),
      price: readPricingProposal(journey, findings, figma.currentPage.id)
    }
  };
}, createShippingDesigns, { hierarchy: createHierarchyProposals, price: createPricingProposals });

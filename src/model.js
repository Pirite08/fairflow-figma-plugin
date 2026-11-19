import { FEATURE_NAMES, extractModelFeatures } from "./model-features.js";

export const MODEL_PATTERNS = Object.keys(FEATURE_NAMES);
export const modelThreshold = 0.5;

export function sigmoid(logit) {
  return 1 / (1 + Math.exp(-logit));
}

export function predictLogistic(values, model) {
  let logit = model.intercept;
  for (let i = 0; i < values.length; i++) {
    logit += model.weights[i] * (values[i] - model.means[i]) / model.scales[i];
  }
  return sigmoid(logit);
}

function ruleStatus(findings, pattern) {
  const matches = findings.filter(item => item.pattern === pattern);
  if (matches.some(item => item.status === "risk_signal")) return "risk_signal";
  if (matches.length && matches.every(item => item.status === "signal_absent")) return "signal_absent";
  return "needs_context";
}

export function compareDetectors(input, findings, models, priceInputScore) {
  const features = extractModelFeatures(input, priceInputScore === undefined);
  return MODEL_PATTERNS.map(pattern => {
    const { values, observed } = features[pattern];
    const model = models[pattern];
    const score = pattern === "drip_pricing" && priceInputScore !== undefined
      ? priceInputScore
      : observed && values.every(Number.isFinite) ? predictLogistic(values, model) : null;
    const modelStatus = score === null ? "needs_context" : score >= modelThreshold ? "risk_signal" : "signal_absent";
    return { pattern, ruleStatus: ruleStatus(findings, pattern), modelStatus, score };
  });
}

import { readFile } from "node:fs/promises";
import { analyzeJourney } from "../src/analyze.js";
import { compareDetectors, MODEL_PATTERNS } from "../src/model.js";
import weights from "../src/model-weights.json" with { type: "json" };

const dataset = new URL("../data/fairflow_public_cases.jsonl", import.meta.url);
const cases = (await readFile(dataset, "utf8")).trim().split(/\r?\n/)
  .filter(line => line.trim()).map(line => JSON.parse(line));
const sampleIds = new Set();

function compare(input, pattern) {
  const findings = analyzeJourney(input);
  return compareDetectors(input, findings, weights.patterns).find(row => row.pattern === pattern);
}

const results = cases.map(({ sample_id, pattern, reference, input }) => {
  if (sampleIds.has(sample_id) || !MODEL_PATTERNS.includes(pattern) ||
      ![null, "risk_signal", "signal_absent"].includes(reference) || input.scenario_terms) {
    throw Error("Invalid public case: " + sample_id);
  }
  sampleIds.add(sample_id);
  const { ruleStatus, modelStatus, score } = compare(input, pattern);
  return { id: sample_id, reference, ruleStatus, modelStatus, score };
});

// Isolate input recognition from the learned weights. These modified inputs
// are diagnostics and do not count as results on the published evidence.
const apparel = cases.find(item => item.sample_id === "kftc-apparel-delivery");
const input = structuredClone(apparel.input);
const first = input.states.find(state => state.state_id === "list");
first.nodes = first.nodes.filter(node => node.node_id !== "list-price");
const currentPriceOnly = compare(input, apparel.pattern);
const fee = input.states.find(state => state.state_id === "order").nodes.find(node => node.node_id === "fee");
fee.text = "필수 고정 " + fee.text;
const confirmedDeliveryFee = compare(input, apparel.pattern);
const diagnostics = [
  { input: "current price only", ...currentPriceOnly },
  { input: "current price only + explicit required/fixed fee", ...confirmedDeliveryFee }
];

const coverage = {
  cases: results.length,
  referenceRisk: results.filter(row => row.reference === "risk_signal").length,
  referenceAbsent: results.filter(row => row.reference === "signal_absent").length,
  noReference: results.filter(row => row.reference === null).length,
  rulesDecided: results.filter(row => row.ruleStatus !== "needs_context").length,
  modelScored: results.filter(row => row.score !== null).length
};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ coverage, results, diagnostics }, null, 2));
} else {
  console.log(coverage);
  console.table(results);
  console.log("Apparel case input diagnostics (excluded from public results)");
  console.table(diagnostics);
}

import { readFile, writeFile } from "node:fs/promises";
import { analyzeJourney } from "../src/analyze.js";
import { FEATURE_NAMES, extractModelFeatures } from "../src/model-features.js";
import { MODEL_PATTERNS, compareDetectors, modelThreshold, sigmoid } from "../src/model.js";

const weightsFile = new URL("../src/model-weights.json", import.meta.url);
const reportFile = new URL("../data/model-evaluation.json", import.meta.url);
const statuses = ["risk_signal", "signal_absent", "needs_context"];
const settings = { l2: 0.02, iterations: 4000, threshold: modelThreshold };
const round = number => Number(number.toFixed(10));

async function readRows(file, defaultSplit) {
  const contents = await readFile(new URL("../data/" + file, import.meta.url), "utf8");
  return contents.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      const split = defaultSplit ?? row.split;
      if (!row.sample_id || !row.group_id || !MODEL_PATTERNS.includes(row.target?.pattern) ||
          !statuses.includes(row.target.status) || !["train", "test"].includes(split) ||
          !Array.isArray(row.input?.states) || !Array.isArray(row.input?.transitions)) {
        throw Error("invalid example schema");
      }
      return [{ ...row, split }];
    } catch (error) {
      throw Error(`${file}:${index + 1} ${error.message}`);
    }
  });
}

function validateSplit(rows) {
  const ids = new Set();
  const groups = new Map();
  for (const row of rows) {
    if (ids.has(row.sample_id)) throw Error("Duplicate sample: " + row.sample_id);
    if (groups.has(row.group_id) && groups.get(row.group_id) !== row.split) {
      throw Error("Group appears in both splits: " + row.group_id);
    }
    ids.add(row.sample_id);
    groups.set(row.group_id, row.split);
  }
}

function fit(rows, names) {
  const columns = names.map((_, i) => rows.map(row => row.values[i]));
  const means = columns.map(values => values.reduce((sum, value) => sum + value, 0) / rows.length);
  const scales = columns.map((values, i) => {
    const variance = values.reduce((sum, value) => sum + (value - means[i]) ** 2, 0) / rows.length;
    return variance > 1e-12 ? Math.sqrt(variance) : 1;
  });
  const samples = rows.map(({ values, target }) => ({
    x: values.map((value, i) => (value - means[i]) / scales[i]),
    target
  }));
  const weights = names.map(() => 0);
  let intercept = 0;
  const step = 1 / (names.length + 1);
  for (let epoch = 0; epoch < settings.iterations; epoch++) {
    const gradient = names.map(() => 0);
    let interceptGradient = 0;
    for (const { x, target } of samples) {
      const estimate = sigmoid(weights.reduce((logit, weight, i) => logit + weight * x[i], intercept));
      const error = estimate - target;
      interceptGradient += error;
      for (let i = 0; i < weights.length; i++) gradient[i] += error * x[i];
    }
    intercept -= step * interceptGradient / samples.length;
    for (let i = 0; i < weights.length; i++) {
      weights[i] -= step * (gradient[i] / samples.length + settings.l2 * weights[i]);
    }
  }
  return { features: names, means: means.map(round), scales: scales.map(round), weights: weights.map(round), intercept: round(intercept) };
}

function train(trainRows) {
  return Object.fromEntries(MODEL_PATTERNS.map(pattern => {
    const patternRows = trainRows.filter(row => row.target.pattern === pattern);
    const samples = [];
    const unobserved = [];
    let needsContext = 0;
    for (const row of patternRows) {
      if (row.target.status === "needs_context") {
        needsContext++;
        continue;
      }
      const { values, observed } = extractModelFeatures(row.input)[pattern];
      if (values.length !== FEATURE_NAMES[pattern].length || !values.every(Number.isFinite)) {
        throw Error("Invalid features: " + row.sample_id);
      }
      if (!observed) {
        unobserved.push(row.sample_id);
        continue;
      }
      samples.push({ values, target: Number(row.target.status === "risk_signal") });
    }
    const risk = samples.filter(row => row.target === 1).length;
    const absent = samples.length - risk;
    if (!risk || !absent) throw Error("Training requires both binary classes for " + pattern);
    return [pattern, {
      ...fit(samples, FEATURE_NAMES[pattern]),
      training: { risk, absent, needsContext, unobserved }
    }];
  }));
}

function metrics(examples, key) {
  const confusion = Object.fromEntries(statuses.map(expected =>
    [expected, Object.fromEntries(statuses.map(actual => [actual, 0]))]));
  for (const example of examples) confusion[example.expected][example[key]]++;
  const correct = statuses.reduce((total, status) => total + confusion[status][status], 0);
  const tp = confusion.risk_signal.risk_signal;
  const fp = confusion.signal_absent.risk_signal + confusion.needs_context.risk_signal;
  const fn = confusion.risk_signal.signal_absent + confusion.risk_signal.needs_context;
  return {
    correct,
    accuracy: round(correct / examples.length),
    riskPrecision: tp + fp ? round(tp / (tp + fp)) : null,
    riskRecall: tp + fn ? round(tp / (tp + fn)) : null,
    riskF1: 2 * tp + fp + fn ? round(2 * tp / (2 * tp + fp + fn)) : null,
    confusion
  };
}

function evaluate(testRows, patterns) {
  const examples = testRows.map(row => {
    const { pattern, status: expected } = row.target;
    const result = compareDetectors(row.input, analyzeJourney(row.input), patterns)
      .find(result => result.pattern === pattern);
    return {
      id: row.sample_id, group: row.group_id, expected, ...result,
      score: result.score === null ? null : round(result.score)
    };
  });
  const summarize = subset => ({
    samples: subset.length,
    groups: new Set(subset.map(example => example.group)).size,
    disagreements: subset.filter(example => example.modelStatus !== example.ruleStatus).length,
    rules: metrics(subset, "ruleStatus"),
    model: metrics(subset, "modelStatus")
  });
  const byPattern = Object.fromEntries(MODEL_PATTERNS.map(pattern => {
    const subset = examples.filter(example => example.pattern === pattern);
    if (statuses.some(status => !subset.some(example => example.expected === status))) {
      throw Error("Test split requires all three labels for " + pattern);
    }
    return [pattern, summarize(subset)];
  }));
  return { overall: summarize(examples), byPattern, examples };
}

const json = value => JSON.stringify(value, null, 2) + "\n";
const rows = [
  ...await readRows("fairflow_examples.jsonl", "train"),
  ...await readRows("fairflow_training.jsonl")
];
validateSplit(rows);
const trainingRows = rows.filter(row => row.split === "train");
const testRows = rows.filter(row => row.split === "test");
const evaluateOnly = process.argv.includes("--evaluate");
const weights = evaluateOnly
  ? JSON.parse(await readFile(weightsFile, "utf8"))
  : { version: 1, settings, patterns: train(trainingRows) };
for (const pattern of MODEL_PATTERNS) {
  if (json(weights.patterns[pattern]?.features) !== json(FEATURE_NAMES[pattern])) {
    throw Error("Model features changed. Run npm run train:model.");
  }
}
const report = {
  synthetic: true,
  training: {
    samples: trainingRows.length,
    groups: new Set(trainingRows.map(row => row.group_id)).size,
    byPattern: Object.fromEntries(MODEL_PATTERNS.map(pattern => [pattern, weights.patterns[pattern].training]))
  },
  ...evaluate(testRows, weights.patterns)
};
if (!evaluateOnly) {
  await writeFile(weightsFile, json(weights), "utf8");
  await writeFile(reportFile, json(report), "utf8");
}
console.table(Object.entries({ overall: report.overall, ...report.byPattern }).map(([pattern, result]) => ({
  pattern,
  samples: result.samples,
  rulesCorrect: result.rules.correct,
  modelCorrect: result.model.correct,
  rulesF1: result.rules.riskF1,
  modelF1: result.model.riskF1,
  disagreements: result.disagreements
})));
if (evaluateOnly && json(report) !== (await readFile(reportFile, "utf8")).replace(/\r\n/g, "\n")) {
  throw Error("Evaluation snapshot is out of date. Run npm run train:model.");
}

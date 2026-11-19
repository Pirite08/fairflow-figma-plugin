import { won } from "./analyze.js";
import { predictLogistic } from "./model.js";
import { pricingVector } from "./model-features.js";
import { readPriceEvidence } from "./price-evidence.js";

const fact = {
  requiredForOrder: {
    label: "이 주문의 필수 비용",
    prompt: "이 주문 조건에서 이 배송비가 반드시 붙나요?"
  },
  calculableAtFirstOffer: {
    label: "첫 가격에서 비용 산정 가능",
    prompt: "첫 가격을 표시할 때 같은 주문 조건에서 이 금액을 계산할 수 있었나요?"
  },
  explicitOptIn: {
    label: "구매자가 직접 추가",
    prompt: "사용자가 이 비용이 붙는 옵션을 직접 선택했나요?"
  }
};

function compile({ first, total, fee }, answers) {
  const difference = total.amount - first.amount;
  const required = fee?.required ?? answers.requiredForOrder;
  const calculable = fee?.calculable ?? answers.calculableAtFirstOffer;
  const explicit = fee?.explicitOptIn ?? answers.explicitOptIn;
  const hold = (blocker, factId) => ({
    blocker,
    question: factId ? { id: factId, prompt: fact[factId].prompt } : null
  });
  if (difference < 0 || (difference && difference !== fee?.amount)) {
    return hold("첫 가격과 결제 합계의 차이를 읽어 낸 비용으로 설명할 수 없습니다.");
  }
  if (difference > 0) {
    if (explicit === true && required === true) return hold("필수 비용과 직접 선택 기록이 충돌합니다.");
    if (typeof required !== "boolean" && explicit !== true) {
      return hold("이 주문에 배송비가 필수인지 확인이 필요합니다.", "requiredForOrder");
    }
    if (required) {
      if (typeof calculable !== "boolean") {
        return hold("첫 가격 시점에 이 배송비를 계산할 수 있었는지 확인이 필요합니다.", "calculableAtFirstOffer");
      }
      if (!calculable) return hold("첫 가격 표시 시 계산할 수 없었던 비용의 적용 조건을 확인해 주세요.");
    } else {
      if (typeof explicit !== "boolean") {
        return hold("사용자가 이 추가 비용을 직접 고른 경로인지 확인이 필요합니다.", "explicitOptIn");
      }
      if (!explicit) return hold("금액이 증가한 경로의 추가 비용 적용 조건을 확인해 주세요.");
    }
  }
  const feeAmount = fee?.amount ?? 0;
  return { values: pricingVector(first.amount, total.amount, feeAmount,
    required && calculable ? feeAmount : 0, fee?.visibleAtFirst ? feeAmount : 0,
    !required && explicit ? feeAmount : 0) };
}

const observation = (label, amount, { state_id, node_id }) =>
  ({ label, value: won(amount), evidence: { state_id, node_id } });

export function preparePriceInput(journey, weights, previous, submission) {
  const record = readPriceEvidence(journey);
  if (!record) return { priceInput: null, priceContext: null };
  const { key, first, total, fee } = record;
  const unchanged = previous?.key === key;
  const answers = unchanged ? { ...previous.answers } : {};
  let packet = compile(record, answers);
  if (unchanged && submission && submission.factId === packet.question?.id && submission.answer !== "unknown") {
    answers[submission.factId] = submission.answer === "yes";
    packet = compile(record, answers);
  }
  const score = packet.values ? predictLogistic(packet.values, weights) : null;
  const observations = [observation("첫 판매가", first.amount, first)];
  if (fee) {
    const shown = fee.firstShown ?? fee;
    const label = fee.firstShown?.stateName ? "배송비 첫 공개 · " + fee.firstShown.stateName : "결제에 표시된 배송비";
    observations.push(observation(label, fee.amount, shown));
  }
  observations.push(observation("결제 합계", total.amount, total));
  return {
    priceInput: {
      status: packet.values ? "ready" : "needs_context",
      observations,
      signals: [
        { label: "첫 가격에서 결제까지 차이", value: won(total.amount - first.amount) },
        ...(fee ? [{ label: "첫 가격 화면에 표시된 비용", value: fee.visibleAtFirst ? won(fee.amount) : "표시 없음" }] : [])
      ],
      question: packet.question ?? null,
      confirmations: Object.entries(answers).map(([id, answer]) => ({ label: fact[id].label, value: answer ? "예" : "아니요" })),
      blockers: packet.blocker ? [packet.blocker] : [],
      score
    },
    priceContext: { key, answers }
  };
}

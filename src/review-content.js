import { won } from "./analyze.js";

export const lawUrl = "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031806317";

function law(item, criterion, connection) {
  return { citation: "전자상거래법 제21조의2 제1항 제" + item + "호", criterion, connection, url: lawUrl };
}

function label(finding, index) {
  const value = finding.evidence?.[index]?.label?.replace(/^[☐☑☒✓✔]\s*/u, "").trim();
  return value && value !== "프레임 보기" ? value : "";
}

function preselectionContent(finding) {
  const option = label(finding, 0) || "추가 유료 옵션";
  return {
    headline: "유료 옵션이 미리 선택되어 있습니다",
    explanation: "‘" + option + "’ 항목이 처음부터 선택되어 있습니다. 이대로 진행하면 추가 서비스에 동의한 상태로 보일 수 있습니다.",
    rule: law(2,
      "다른 상품이나 서비스를 신청할지 묻는 항목에서, 소비자가 직접 고르기 전에 신청 의사를 표시해 신청을 유도하면 안 됩니다.",
      "이 화면에서는 사용자가 직접 고르기 전에 유료 옵션이 선택되어 있습니다."),
    alternatives: [
      {
        kind: "design", title: "처음에는 선택 해제", visual: "checkbox",
        description: "유료 옵션을 해제하고, 사용자가 고를 때만 요금을 합계에 더하세요.",
        before: "처음부터 선택", after: "직접 고르면 적용", detail: option
      },
      {
        kind: "design", title: "옵션과 요금을 나란히", visual: "checkbox",
        description: "기본 옵션과 유료 옵션을 한곳에 두고 추가 요금을 옵션 옆에 표시하세요. 유료 옵션은 해제된 상태로 시작하세요.",
        after: "기본 옵션 / 추가 유료 옵션", detail: option
      }
    ]
  };
}

function hierarchyContent(finding) {
  const promoted = label(finding, 0) || "강조된 선택지";
  const alternative = label(finding, 1) || "다른 선택지";
  return {
    headline: "다른 선택지가 비활성처럼 보입니다",
    explanation: "‘" + alternative + "’도 선택할 수 있지만 ‘" + promoted + "’보다 작고 흐려 놓치기 쉽습니다.",
    rule: law(3,
      "선택지의 크기·모양·색에 큰 차이를 두어 특정 선택만 가능하거나 꼭 골라야 한다고 오해할 수 있는 경우를 다룹니다.",
      "누를 수 있는 선택지가 비활성처럼 보이면 강조된 선택만 가능하다고 오해할 수 있습니다."),
    alternatives: [
      {
        kind: "design", title: "다른 버튼의 가독성 높이기", visual: "buttons",
        description: "다른 버튼의 글자와 버튼 영역을 키우고 배경과의 대비를 높이세요. 두 버튼을 각각 원래 목적지로 연결하세요.",
        before: "작고 흐린 버튼", after: "읽기 쉬운 버튼", detail: alternative
      },
      {
        kind: "design", title: "두 선택을 한곳에 배치", visual: "buttons",
        description: "두 버튼을 같은 영역에 배치하고, 이름과 선택 결과를 함께 보여 주세요.",
        after: promoted + " / " + alternative
      }
    ]
  };
}

function editableCopy(copyEdit) {
  const fields = Array.isArray(copyEdit?.fields) ? copyEdit.fields : [copyEdit];
  const changes = fields.filter(field => typeof field?.before === "string" &&
    typeof field.after === "string" && field.after.trim() && field.before.trim() !== field.after.trim());
  if (!changes.length || changes.length !== fields.length) return null;
  return {
    kind: "copy", title: "기존 가격 문구 고치기",
    description: changes.length === 1 && changes[0].detail
      ? changes[0].detail
      : "첫 화면의 문구를 아래와 같이 바꾸세요.",
    before: changes.map(field => field.before).join("\n"),
    after: changes.map(field => field.after).join("\n"),
    changes
  };
}

function pricingContent(finding) {
  const pricing = finding.pricing;
  const feeAmount = pricing?.fee?.amount;
  const { firstAmount, finalAmount } = pricing || {};
  const known = [firstAmount, finalAmount, feeAmount].every(Number.isSafeInteger) &&
    firstAmount >= 0 && feeAmount > 0 && firstAmount + feeAmount === finalAmount;
  const fee = "필수 " + (pricing?.fee?.label || "비용");
  const copy = known && editableCopy(finding.copyEdit);
  return {
    headline: "첫 가격에 필수 비용이 빠져 있습니다",
    explanation: known
      ? "첫 가격은 " + won(firstAmount) + "입니다. 주문 화면에서 " + fee + " " + won(feeAmount) + "이 더해져 총 " + won(finalAmount) + "이 됩니다."
      : finding.reason,
    rule: law(1,
      "상품의 첫 가격 안내 화면에는 구매에 꼭 드는 비용을 합친 총액을 표시해야 합니다. 정당한 이유로 총액 표시가 어렵고 정해진 방법으로 그 이유를 알린 경우에는 예외가 있습니다.",
      "이 검사에서는 주문 화면에서 확인한 고정 필수 비용이 첫 가격에 포함되는지 비교했습니다."),
    alternatives: copy ? [copy] : [
      {
        kind: "design", title: "첫 가격 옆에 포함 비용 표시", visual: "price",
        description: "첫 가격을 필수 비용까지 합친 금액으로 바꾸고, 바로 옆에 포함된 비용을 적으세요.",
        before: known ? won(firstAmount) : "상품 가격",
        after: known ? won(finalAmount) : "필수 비용을 포함한 총액",
        detail: known ? fee + " " + won(feeAmount) + " 포함" : fee + " 포함"
      },
      {
        kind: "design", title: "가격 내역을 한곳에 표시", visual: "price",
        description: "상품 가격, 필수 비용, 총액을 첫 화면부터 같은 영역에 함께 보여 주세요.",
        after: known ? "총 " + won(finalAmount) : "총액",
        detail: known ? "상품 " + won(firstAmount) + " · " + fee + " " + won(feeAmount) : "상품 가격 · " + fee
      }
    ]
  };
}

export function reviewContent(finding) {
  if (finding?.status !== "risk_signal") return null;
  switch (finding.pattern) {
    case "paid_option_preselection": return preselectionContent(finding);
    case "misleading_visual_hierarchy": return hierarchyContent(finding);
    case "drip_pricing": return pricingContent(finding);
    default: return null;
  }
}

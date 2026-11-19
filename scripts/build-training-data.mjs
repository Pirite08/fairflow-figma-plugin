import { writeFileSync } from 'node:fs';

// Fictional scenario families. The split is assigned to the whole family so
// that a changed wording or layout of a test journey cannot appear in training.
const families = {
  paid_option_preselection: [
    ['grocery', 'train', '유기농 채소 상자', 26500, 3600, '새벽배송 옵션', '일반배송 무료', 'radio', '배송 방법 확인'],
    ['books', 'train', '독립 출판 도서', 18500, 2500, '오늘 받기', '일반 택배 0원', 'radio', '도착일 보기'],
    ['houseplant', 'train', '반려식물 화분', 32900, 4500, '지정일 배송 옵션', '일반배송 무료', 'radio', '배송 일정 확인'],
    ['appliance', 'train', '탁상용 선풍기', 78900, 12000, '설치 옵션', '직접 설치 0원', 'checkbox', '설치 방법 보기'],
    ['flower', 'train', '기념일 꽃다발', 38000, 2200, '선물 포장 서비스', '기본 포장 무료', 'toggle', '포장 옵션 보기'],
    ['rental', 'train', '접이식 캠핑의자 대여', 16000, 2800, '추가 파손 보장', '기본 구성 0원', 'checkbox', '보장 내용 확인'],
    ['bakery', 'test', '냉동 베이커리 세트', 31900, 4900, '빠른배송', '기본 배송 무료', 'radio', '수령 날짜 확인'],
    ['photo', 'test', '온라인 사진 인화', 14800, 3600, '우선 수령 서비스', '일반 수령 0원', 'checkbox', '매장 수령 안내'],
    ['repair', 'test', '휴대전화 화면 보호 필름', 19400, 1900, '주말 배송 옵션', '평일 배송 무료', 'toggle', '수령 방법 확인']
  ],
  misleading_visual_hierarchy: [
    ['recipe', 'train', '요리 레시피 이용권', '영상 이용권 추가', '기본 요금으로 계속', 7900, 3000, 'vertical'],
    ['storage', 'train', '자료 보관함', '공간 추가하고 계속', '추가 없이 계속', 15900, 3700, 'horizontal'],
    ['ticket-cover', 'train', '뮤지컬 입장권', '취소 보장 추가', '보장 추가 없이 예매', 45000, 3200, 'vertical'],
    ['ebook', 'train', '전자책 월정액', '오디오 혜택 받고 가입', '기본 구독으로 계속', 9800, 2700, 'horizontal'],
    ['mobile', 'train', '휴대전화 개통', '데이터 이용권 변경', '기본 데이터로 계속', 23000, 4300, 'vertical'],
    ['bike', 'train', '공유 자전거', '우선 배차 추가', '추가 없이 대여', 11900, 2700, 'horizontal'],
    ['music', 'test', '음원 스트리밍', '고음질 옵션 추가', '기본 음질로 계속', 8900, 2500, 'horizontal'],
    ['class', 'test', '온라인 공예 수업', '피드백 구독 가입', '피드백 추가 없이 신청', 34000, 7500, 'vertical'],
    ['rental-gear', 'test', '공구 대여', '배송 서비스 추가', '기본 구성으로 계속', 21000, 4700, 'horizontal']
  ],
  drip_pricing: [
    ['ceramic', 'train', '수제 도자기 컵', 26000, 3200, '포장비', '필수·고정', 'text'],
    ['rail', 'train', '관광열차 승차권', 40500, 1800, '발권비', '의무·정액', 'row'],
    ['shop', 'train', '주방 소품 세트', 24900, 3500, '배송비', '필수·일률', 'card'],
    ['craft', 'train', '유리 공방 체험', 56000, 4300, '예약 수수료', '모든 주문에 일괄 적용', 'text'],
    ['moving', 'train', '보관함 대여', 29800, 3800, '이용 수수료', '의무·고정', 'row'],
    ['tasting', 'train', '커피 시음 예약', 19500, 2400, '서비스 요금', '필수·정액', 'card'],
    ['exhibition', 'test', '미술 전시 주말 입장권', 23000, 2600, '발권비', '모든 구매에 고정 적용', 'card'],
    ['interior', 'test', '전신 거울', 68500, 6600, '배송비', '의무·일괄', 'row'],
    ['workshop', 'test', '소규모 베이킹 수업', 37000, 2800, '예약 수수료', '모든 주문에 정액 적용', 'text']
  ]
};

const rules = {
  paid_option_preselection: 'KR_ECOMMERCE_ACT_21_2_1_2',
  misleading_visual_hierarchy: 'KR_ECOMMERCE_ACT_21_2_1_3',
  drip_pricing: 'KR_ECOMMERCE_ACT_21_2_1_1'
};
const won = number => number.toLocaleString('en-US') + '원';
const node = (node_id, text, role = 'text', extra = {}) => ({ node_id, role, text, ...extra });
const money = (id, label, amount, extra) => node(id, label + won(amount), 'text', { amount_krw: amount, ...extra });
const frame = (state_id, name, ...nodes) => ({ state_id, frame_id: 'frame-' + state_id, name, nodes });
const click = (transition_id, from_state_id, node_id, to_state_id, uncertain = false) => ({
  transition_id, from_state_id, action: { type: 'click', node_id }, to_state_id, ...(uncertain ? { uncertain } : {})
});
const evidence = (state_id, node_ids, transition_id = null) => ({ state_id, node_ids, transition_id });
const journey = (states, transitions, flow_start_confirmed = true, warnings = []) => ({
  entry_state_id: states[0].state_id, flow_start_confirmed, states, transitions, warnings
});
const status = {
  risk: 'risk_signal',
  clear: 'signal_absent',
  incomplete: 'needs_context'
};

function shipping([scenario, split, product, base, fee, option, free, role, entryCta], variant) {
  const first = frame('listing', '상품', node('product', product), money('listed', '', base), node('open', entryCta, 'button'));
  const control = (id, text, y, checked) => node(id, text, role, {
    bounds: { x: 20, y, width: 340, height: 48 },
    ...(typeof checked === 'boolean' ? { checked } : {})
  });
  const options = (id, checked) => frame(id, '옵션 선택',
    node('heading', split === 'test' ? product + ' 수령 옵션' : '별도로 제공되는 선택 서비스'),
    control(id + '-paid', option + ' +' + won(fee), 232, checked),
    control(id + '-free', free, 164, role === 'radio' && typeof checked === 'boolean' ? !checked : undefined),
    node(id + '-next', '주문 요약 확인', 'button'));
  const checkout = (paid) => frame('order', '주문 확인',
    money('item', '상품 ', base),
    ...(paid ? [money('extra', option + ' ', fee)] : []),
    money('total', '결제 예정 금액 ', base + (paid ? fee : 0)));
  const openOptions = click('enter', 'listing', 'open', 'choice', scenario === 'repair' && variant === 'redacted');
  const initialScreens = (choice) => scenario === 'bakery' ? [choice] : [first, choice];
  const initialEdges = scenario === 'bakery' ? [] : [openOptions];
  const choiceEvidence = (ids) => evidence('choice', ids, scenario === 'bakery' ? null : 'enter');

  if (variant === 'midstream') {
    return [journey([options('choice', true), checkout(true)], [click('review', 'choice', 'choice-next', 'order')], false),
      status.incomplete, '현재 유료 항목이 선택되어 있다. 이 화면만 보면 첫 상태와 이전 선택 동작을 알 수 없다.',
      [evidence('choice', ['choice-paid'])], ['option_selection_history']];
  }
  if (variant === 'redacted') {
    const warnings = openOptions.uncertain ? ['조건부 연결을 실행에서 확인해야 합니다.'] : [];
    return [journey([...initialScreens(options('choice')), checkout(true)], [
      ...initialEdges, click('review', 'choice', 'choice-next', 'order')
    ], true, warnings),
    status.incomplete, '선택지와 주문 금액은 보이지만 선택 표시를 읽을 수 없어 기본 상태를 확인할 수 없다.',
    [choiceEvidence(['choice-paid', 'choice-free'])], ['initial_control_state']];
  }
  if (variant === 'explicit') {
    return [journey([...initialScreens(options('choice', false)), options('chosen', true), checkout(true)], [
      ...initialEdges, click('select', 'choice', 'choice-paid', 'chosen'),
      click('review', 'chosen', 'chosen-next', 'order')
    ]),
    status.clear, '유료 항목은 해제되어 있다가 그 항목을 직접 누른 뒤 선택된다. 추가 금액도 선택 후에 표시된다.',
    [choiceEvidence(['choice-paid']), evidence('chosen', ['chosen-paid'], 'select'), evidence('order', ['extra', 'total'], 'review')]];
  }
  if (variant === 'automatic') {
    const help = frame('help', '이용 안내', node('detail', '옵션은 다음 화면에서 변경할 수 있습니다.'), node('next', '확인하고 계속', 'button'));
    return [journey([first, help, options('choice', true), checkout(true)], [
      click('enter', 'listing', 'open', 'help'), click('continue', 'help', 'next', 'choice'),
      click('review', 'choice', 'choice-next', 'order')
    ]),
    status.risk, '일반 안내를 확인하는 버튼만 눌렀는데 유료 항목이 선택된다. 선택을 바꾸지 않고 주문을 확인하면 비용이 붙는다.',
    [evidence('help', ['next'], 'enter'), evidence('choice', ['choice-paid', 'choice-free'], 'continue'), evidence('order', ['extra', 'total'], 'review')]];
  }
  const preselected = variant === 'checked';
  return [journey([...initialScreens(options('choice', preselected)), checkout(preselected)], [
    ...initialEdges, click('review', 'choice', 'choice-next', 'order')
  ]),
  preselected ? status.risk : status.clear,
  preselected ? '유료 항목을 고르기 전부터 선택되어 있다. 그대로 주문을 확인하면 추가 금액이 포함된다.'
    : '첫 옵션 화면에서 유료 항목이 해제되어 있고, 선택을 바꾸지 않은 주문에 추가 금액이 없다.',
  [choiceEvidence(['choice-paid', 'choice-free']), evidence('order', preselected ? ['extra', 'total'] : ['total'], 'review')]];
}

function hierarchy([, split, product, accept, skip, base, fee, orientation], variant, index) {
  const horizontal = orientation === 'horizontal';
  const strongWidth = horizontal ? 164 + (index % 3) * 6 : 320 + (index % 4) * 8;
  const strongHeight = 46 + (index % 3) * 4;
  const font = 15 + index % 3;
  const y = 216 + (index % 4) * 13;
  const dark = split === 'test' && horizontal;
  const strongBg = ['#224874', '#363377', '#155B4C'][index % 3];
  let weakWidth = strongWidth - 12;
  let weakHeight = strongHeight;
  let weakFont = font;
  let weakColor = dark ? '#EFF3F8' : '#263449';
  let opacity = 1;
  let weakBackground = dark ? '#1C2028' : '#FFFFFF';
  let weakX = horizontal ? 200 : 18;
  let weakY = horizontal ? y : y + strongHeight + 14;
  if (variant === 'faint') {
    weakWidth = Math.round(strongWidth * (horizontal ? 0.61 : 0.45));
    weakHeight = 22 + (index % 3) * 3;
    weakFont = 9 + (index % 3);
    weakColor = dark ? '#454B56' : ['#AFB5BF', '#BEC4CC', '#C1C7D0'][index % 3];
    opacity = 0.78 + (index % 3) * 0.08;
  } else if (variant === 'subdued') {
    // Test designs use a wider low-contrast caption with an ambiguous visual
    // affordance, not the same small pale control used in the training families.
    weakWidth = Math.round(strongWidth * (split === 'test' ? 0.76 : 0.71));
    weakHeight = Math.round(strongHeight * (split === 'test' ? 0.72 : 0.68));
    weakFont = Math.round(font * 0.82);
    weakColor = dark ? '#555C68' : '#A8B0BD';
    opacity = split === 'test' ? 0.61 : 0.56;
    weakX = horizontal ? 210 : 18;
    weakY = y + strongHeight + (split === 'test' ? 95 : 58);
  } else if (variant === 'secondary') {
    // A compact text-style action is clearly legible and located with the
    // main action. Its smaller size alone is not evidence of deception.
    weakWidth = Math.round(strongWidth * 0.69);
    weakHeight = strongHeight - 9;
    weakFont = font - 2;
    weakColor = dark ? '#A1D2FF' : '#145199';
  } else if (variant === 'unmeasured') {
    weakBackground = undefined; // Unsupported background paint, e.g. gradient.
  }
  function button(id, label, x, top, width, height, fontSize, textColor, background, alpha) {
    return node(id, label, id === 'base' && ['secondary', 'subdued'].includes(variant) ? 'link' : 'button', {
      bounds: { x, y: top, width, height },
      style: {
        font_size_px: fontSize, text_color: textColor, opacity: alpha,
        ...(background ? { background_color: background } : {})
      }
    });
  }
  const first = frame('landing', '이용권 선택', node('title', product), node('detail', '구성 안내 보기', 'button'));
  const choices = frame('choices', '선택 서비스 안내', node('description', '원하면 이용 중에 구성을 바꿀 수 있습니다.'),
    button('promoted', accept + ' +' + won(fee), 18, y, strongWidth, strongHeight, font, '#FFFFFF', strongBg, 1),
    button('base', skip, weakX, weakY, weakWidth, weakHeight, weakFont, weakColor, weakBackground, opacity));
  if (split === 'test' && variant === 'subdued') {
    choices.nodes.splice(2, 0, node('footer', '고객센터  |  이용약관', 'text', {
      bounds: { x: 18, y: weakY - 32, width: 176, height: 18 }
    }));
  }
  const upgraded = frame('upgraded', '추가 구성 확인', node('chosen', '추가 서비스 포함'), money('premium-total', '주문 합계 ', base + fee));
  const basic = frame('basic', '기본 구성 확인', node('chosen', '추가 서비스 없음'), money('basic-total', '주문 합계 ', base));
  const edges = [click('enter', 'landing', 'detail', 'choices'), click('add', 'choices', 'promoted', 'upgraded')];
  if (variant !== 'unlinked') edges.push(click('skip', 'choices', 'base', 'basic'));
  const input = journey(variant === 'unlinked' ? [first, choices, upgraded] : [first, choices, upgraded, basic], edges);
  const proof = [evidence('choices', ['promoted', 'base'], 'enter'), evidence('upgraded', ['premium-total'], 'add')];
  if (variant !== 'unlinked') proof.push(evidence('basic', ['basic-total'], 'skip'));
  const verdicts = {
    faint: [status.risk, '기본 구성 버튼이 작고 흐려 비활성 상태처럼 보인다. 실제로는 선택할 수 있고 기본 주문으로 연결된다.'],
    subdued: [status.risk, '기본 선택의 글자가 배경에 묻히고 유료 버튼과 떨어져 있어 독립된 동작으로 알아보기 어렵다. 두 경로는 모두 작동한다.'],
    comparable: [status.clear, '기본 구성과 유료 구성 모두 같은 글자 크기로 보이고 각 주문으로 연결된다.'],
    secondary: [status.clear, '기본 구성이 보조 링크로 표시되지만 바로 옆에서 선명하게 읽히고 선택할 수 있다.'],
    unlinked: [status.incomplete, '기본 선택의 문구는 보이지만 버튼에 목적 화면이 연결되어 있지 않다.', ['base_plan_continuation_path']],
    unmeasured: [status.incomplete, '두 버튼은 서로 다른 주문으로 연결되지만 기본 버튼의 배경을 읽을 수 없어 글자 대비를 확인하기 어렵다.', ['base_plan_background']]
  };
  const [label, reason, missing] = verdicts[variant];
  return [input, label, reason, proof, missing];
}

function pricing([, split, product, base, fee, feeLabel, terms, layout], variant, index) {
  const final = base + fee;
  const identity = () => node('item-name', '상품명: ' + product);
  function itemOffer(price, showFee = false) {
    const action = layout === 'card' ? node('view', product, 'button') : node('view', '상세 보기', 'button');
    const tagged = layout === 'card' ? { parent_id: 'view', control_node_id: 'view' } : {};
    const display = index % 4 === 3
      ? node('listed', '₩' + price.toLocaleString('en-US'), 'text', { amount_krw: price, ...tagged })
      : money('listed', '', price, tagged);
    return frame('offer', '상품 목록', identity(), action, display,
      ...(showFee ? [node('notice', terms + ' ' + feeLabel + ' ' + won(fee) + ' 포함')] : []));
  }
  function feeNodes(mandatory) {
    const label = (mandatory ? terms + ' ' : '') + feeLabel;
    if (layout !== 'row') return [money('cost', label + ' ', fee)];
    return [node('cost-label', label, 'text', { parent_id: 'fee-detail' }),
      money('cost', '', fee, { parent_id: 'fee-detail' })];
  }
  function summary(mandatory, total = final) {
    return frame('checkout', '주문 확인', identity(), money('base', '상품 기본 요금 ', base), ...feeNodes(mandatory),
      money('total', '결제 예정 금액 ', total));
  }
  const feeProof = layout === 'row' ? ['cost-label', 'cost', 'total'] : ['cost', 'total'];
  const detail = frame('detail', '상품 상세', identity(), node('order', '구매 내용 확인', 'button'));
  const offerClick = click('view-detail', 'offer', 'view', 'detail');
  const review = click('review', 'detail', 'order', 'checkout');
  const proof = [evidence('offer', ['listed']), evidence('checkout', feeProof, 'review')];
  if (variant === 'ambiguous') {
    const first = itemOffer(base);
    first.nodes = [
      node('other-item', '같은 브랜드 상품 두 가지'), node('view', '상품 자세히 보기', 'button'),
      money('listed', '', base), money('other-price', '', base + 5900)
    ];
    return [journey([first, detail, summary(true)], [offerClick, review]), status.incomplete,
      '첫 화면에 두 가격이 있고 어느 가격이 주문한 상품과 연결되는지 표시되어 있지 않다.',
      [evidence('offer', ['listed', 'other-price']), proof[1]], ['first_price_item_association']];
  }
  if (variant === 'unconfirmed') {
    return [journey([itemOffer(base), detail, summary(false)], [offerClick, review]), status.incomplete,
      '결제 합계와 비용 항목은 보이지만 모든 주문에 같은 금액을 부과하는지 표시되어 있지 않다.',
      proof, ['fee_mandatory_status', 'fee_known_at_first_price']];
  }
  if (variant === 'optional') {
    const opt = '선택 ' + feeLabel;
    detail.nodes = [identity(), node('add', opt + ' +' + won(fee), 'checkbox', { checked: false }), node('without', '기본 구성 주문', 'button')];
    const chosen = frame('chosen', '추가 구성 선택', identity(),
      node('add-selected', opt + ' +' + won(fee), 'checkbox', { checked: true }), node('with', '선택한 구성 주문', 'button'));
    const basic = frame('basic', '기본 주문', identity(), money('basic-total', '주문 합계 ', base));
    return [journey([itemOffer(base), detail, chosen, basic, summary(false)], [
      offerClick, click('select', 'detail', 'add', 'chosen'), click('skip', 'detail', 'without', 'basic'),
      click('included', 'chosen', 'with', 'checkout')
    ]), status.clear, '첫 가격으로 기본 주문이 가능하다. 체크를 직접 바꾼 경로에서만 선택한 금액이 더해진다.',
    [proof[0], evidence('detail', ['add'], 'view-detail'), evidence('chosen', ['add-selected'], 'select'),
      evidence('basic', ['basic-total'], 'skip'), evidence('checkout', feeProof, 'included')]];
  }
  if (variant === 'included') {
    const first = itemOffer(final, index % 2 === 0);
    return [journey([first, detail, summary(true)], [offerClick, review]), status.clear,
      '첫 가격에 필수 비용이 합산되어 있다. 같은 상품을 주문할 때도 표시 금액이 같다.',
      [evidence('offer', first.nodes.some(n => n.node_id === 'notice') ? ['listed', 'notice'] : ['listed']), proof[1]]];
  }
  if (variant === 'later-details') {
    detail.nodes.push(node('late-fee', terms + ' ' + feeLabel + ' ' + won(fee)),
      money('late-total', '총 결제 ', final));
    if (split === 'test') {
      detail.nodes.push(node('continue', '예약 또는 배송 정보 입력', 'button'));
      const details = frame('recipient', '연락처 입력', identity(), node('proceed', '주문 검토', 'button'));
      detail.nodes = detail.nodes.filter(n => n.node_id !== 'order');
      return [journey([itemOffer(base), detail, details, summary(true)], [
        offerClick, click('continue-order', 'detail', 'continue', 'recipient'), click('review', 'recipient', 'proceed', 'checkout')
      ]), status.risk,
      '첫 가격은 상품 금액만 표시하고, 필수 비용을 합친 금액은 상세 화면부터 표시한다.',
      [proof[0], evidence('detail', ['late-fee', 'late-total'], 'view-detail'), proof[1]]];
    }
    // The initial card's prominent price excludes the charge. Displaying it
    // before checkout but after the first offer still labels this fixture risk.
    return [journey([itemOffer(base), detail, summary(true)], [offerClick, review]), status.risk,
      '처음 공개한 가격에 미리 정해진 필수 비용이 빠져 있다. 세부 화면으로 넘어간 다음에야 비용과 총액이 보인다.',
      [proof[0], evidence('detail', ['late-fee', 'late-total'], 'view-detail'), proof[1]]];
  }
  return [journey([itemOffer(base), detail, summary(true)], [offerClick, review]), status.risk,
    '첫 가격에는 상품 금액만 나와 있다. 주문 단계에서 처음 보이는 필수 비용은 모든 주문에서 같은 금액이다.', proof];
}

const builders = {
  paid_option_preselection: [shipping, ['checked', 'automatic', 'unchecked', 'explicit', 'redacted', 'midstream']],
  misleading_visual_hierarchy: [hierarchy, ['faint', 'subdued', 'comparable', 'secondary', 'unlinked', 'unmeasured']],
  drip_pricing: [pricing, ['checkout-only', 'later-details', 'included', 'optional', 'unconfirmed', 'ambiguous']]
};

const rows = [];
for (const [pattern, entries] of Object.entries(families)) {
  const [build, variants] = builders[pattern];
  for (const [index, family] of entries.entries()) {
    const [scenario, split, product] = family;
    const group_id = 'synthetic-' + scenario;
    for (const variant of variants) {
      const [input, label, reason_ko, proof, missing_evidence = []] = build(family, variant, index);
      rows.push({
        schema_version: 1,
        sample_id: group_id + '-' + variant,
        group_id, split,
        metadata: { source_type: 'synthetic_figma_fixture', seed: product, variant },
        input,
        target: {
          pattern, related_rule: rules[pattern], status: label,
          selected_before_option_choice: pattern === 'paid_option_preselection' && label !== status.incomplete ? label === status.risk : null,
          evidence: proof, reason_ko, missing_evidence, remediation: null
        }
      });
    }
  }
}

writeFileSync(new URL('../data/fairflow_training.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n');

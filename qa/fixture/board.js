const PAGE_KEY = "fairflowBoardV1";
let page;
export function useCurrentPage() {
  page = figma.currentPage;
}
const ink = "#153C33",
  green = "#155B47",
  muted = "#52675D",
  pale = "#E5F0E7",
  white = "#FFFFFF";
let regular, bold;
let placed = null;

async function fonts() {
  if (regular) return;
  const available = (await figma.listAvailableFontsAsync()).map(
    (item) => item.fontName,
  );
  for (const family of [
    "Pretendard",
    "Noto Sans KR",
    "Noto Sans CJK KR",
    "Malgun Gothic",
    "맑은 고딕",
    "Inter",
  ]) {
    const familyFonts = available.filter((f) => f.family === family);
    if (!familyFonts.length) continue;
    const r =
      familyFonts.find((f) => /^(regular|일반|normal|book)$/i.test(f.style)) ||
      familyFonts[0];
    const b =
      familyFonts.find((f) => /^(semi ?bold|bold|굵게)$/i.test(f.style)) || r;
    try {
      await figma.loadFontAsync(r);
      await figma.loadFontAsync(b);
      regular = r;
      bold = b;
      return;
    } catch (_) {}
  }
  throw Error("No usable UI font was available.");
}
function paint(hex) {
  return [
    {
      type: "SOLID",
      color: {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
      },
    },
  ];
}
function mount(n, owner, name, x, y) {
  owner.appendChild(n);
  n.name = name;
  n.x = x;
  n.y = y;
  if (owner === page && placed) placed.push(n);
  return n;
}
function box(owner, name, x, y, w, h, bg, r) {
  const n = mount(figma.createFrame(), owner, name, x, y);
  n.resize(w, h);
  n.fills = paint(bg);
  n.cornerRadius = r || 0;
  return n;
}
function words(owner, name, value, x, y, size, color, heavy) {
  const n = mount(figma.createText(), owner, name, x, y);
  n.fontName = heavy ? bold : regular;
  n.fontSize = size;
  n.fills = paint(color || ink);
  n.characters = value;
  return n;
}
function disk(owner, name, x, y, size, color) {
  const n = mount(figma.createEllipse(), owner, name, x, y);
  n.resize(size, size);
  n.fills = paint(color);
  return n;
}
function tile(owner, name, value, x, y, w, h, bg, fg, size) {
  const n = box(owner, name, x, y, w, h, bg, 10);
  const t = words(n, "버튼 문구", value, 14, 0, size, fg, true);
  t.y = Math.round((h - t.height) / 2);
  return [n, t];
}
function screen(name, x, y, step, title, subtitle) {
  const n = box(page, name, x, y, 360, 456, "#F9FAF6", 16);
  box(n, "상단 강조선", 0, 0, 360, 6, green);
  words(n, "스토어", "여백상점", 22, 25, 15, green, true);
  words(n, "단계", step, 22, 78, 12, muted);
  words(n, "제목", title, 22, 109, 25, ink, true);
  words(n, "도움말", subtitle, 22, 153, 14, muted);
  return n;
}
function receipt(name, x, y, step, title, caption) {
  const n = screen(name, x, y, step, title, caption);
  const card = box(n, "완료 안내", 22, 220, 316, 86, pale, 12);
  words(card, "진행상태", "접수 완료", 17, 19, 17, green, true);
  words(card, "안내", "주문 내역에서 다시 볼 수 있습니다.", 17, 48, 13, muted);
  return n;
}
function radioMaster(x, y) {
  const c = mount(figma.createComponent(), page, "QA / 배송 선택 행", x, y);
  c.resize(316, 55);
  c.cornerRadius = 10;
  c.fills = paint(white);
  const outer = disk(c, "라디오 테두리", 14, 17, 20, white);
  outer.strokes = paint(green);
  outer.strokeWeight = 1.5;
  const dot = disk(c, "선택 표시", 19, 22, 10, green);
  const key = c.addComponentProperty("Selected", "BOOLEAN", true);
  dot.componentPropertyReferences = { visible: key };
  const t = words(c, "옵션 문구", "빠른배송 +5,000원", 48, 14, 16, ink, true);
  const label = c.addComponentProperty("Label", "TEXT", t.characters);
  t.componentPropertyReferences = { characters: label };
  return { c, key, label };
}
function radio(owner, m, name, label, selected, y) {
  const n = mount(m.c.createInstance(), owner, name, 22, y);
  const props = {};
  props[m.key] = selected;
  props[m.label] = label;
  n.setProperties(props);
  return n;
}
async function link(node, dst) {
  await node.setReactionsAsync([
    {
      trigger: { type: "ON_CLICK" },
      actions: [
        {
          type: "NODE",
          destinationId: dst.id,
          navigation: "NAVIGATE",
          transition: null,
          preserveScrollPosition: false,
        },
      ],
    },
  ]);
}
export function registered() {
  const value = page.getPluginData(PAGE_KEY);
  return value ? JSON.parse(value) : null;
}
function focus(node) {
  page.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}
function extraStart(points, id, name) {
  return points.some((p) => p.nodeId === id)
    ? points
    : points.concat([{ nodeId: id, name: name }]);
}
export async function build() {
  const previous = registered();
  if (previous) {
    const ids = Object.values(previous).flatMap((journey) =>
      Object.entries(journey).filter(([key]) => key !== "selectedKey").map(([, id]) => id));
    const layers = await Promise.all(ids.map(id => figma.getNodeByIdAsync(id)));
    if (layers.every(node => node && !node.removed)) return;
  }
  await fonts();
  const offset = page.children.reduce(
    (edge, n) => Math.max(edge, n.x + n.width + 130),
    0,
  );
  placed = [];
  try {
    const x = offset,
      gap = 420;
    const sa = screen(
      "01A · 배송 방법",
      x,
      0,
      "주문 / 배송",
      "배송 방법",
      "주문에 적용할 배송 방법을 확인하세요.",
    );
    const sb = screen(
      "01B · 배송 확인",
      x + gap,
      0,
      "주문 / 확인",
      "배송 선택 내역",
      "선택한 배송 방법으로 주문을 진행합니다.",
    );
    const sc = screen(
      "01C · 일반배송 확인",
      x + 2 * gap,
      0,
      "주문 / 확인",
      "배송 선택 내역",
      "선택한 배송 방법으로 주문을 진행합니다.",
    );
    const master = radioMaster(x + 3 * gap, 0);
    const fast = radio(
      sa,
      master,
      "Radio / 빠른배송",
      "빠른배송 +5,000원",
      true,
      213,
    );
    const free = radio(
      sa,
      master,
      "Radio / 일반배송",
      "일반배송 무료",
      false,
      278,
    );
    const go = tile(
      sa,
      "Button / 주문 확인",
      "주문 확인",
      22,
      367,
      316,
      48,
      green,
      white,
      16,
    )[0];
    const sr = box(sb, "배송 명세", 22, 218, 316, 92, pale, 12);
    words(sr, "선택한 방법", "빠른배송", 15, 16, 18, ink, true);
    words(sr, "배송비", "배송비 5,000원", 15, 50, 14, muted);
    const freeReceipt = box(sc, "배송 명세", 22, 218, 316, 92, pale, 12);
    words(freeReceipt, "선택한 방법", "일반배송", 15, 16, 18, ink, true);
    words(freeReceipt, "배송비", "배송비 0원", 15, 50, 14, muted);
    await link(fast, sb);
    await link(free, sc);
    await link(go, sb);

    const h = 590;
    const ha = screen(
      "02A · 멤버십 선택",
      x,
      h,
      "멤버십 / 선택",
      "멤버십 혜택",
      "혜택을 더하거나 기본 요금으로 이용하세요.",
    );
    const hb = receipt(
      "02B · 멤버십 접수",
      x + gap,
      h,
      "멤버십 / 확인",
      "멤버십 신청 완료",
      "월간 멤버십이 신청되었습니다.",
    );
    const hc = receipt(
      "02C · 기본 요금 접수",
      x + 2 * gap,
      h,
      "기본 요금 / 확인",
      "기본 요금 적용",
      "현재 이용 중인 요금이 유지됩니다.",
    );
    const promoted = tile(
      ha,
      "Button / 멤버십 신청",
      "월 3,000원 추가하고 계속",
      22,
      258,
      316,
      52,
      green,
      white,
      16,
    )[0];
    const basic = tile(
      ha,
      "Button / 기본 요금",
      "기본 요금으로 계속",
      22,
      330,
      145,
      22,
      white,
      "#CFD3D0",
      9,
    );
    await link(promoted, hb);
    await link(basic[0], hc);

    const p = 1180;
    const pa = screen(
      "03A · 유리컵 상품",
      x,
      p,
      "상품 / 보기",
      "오늘의 유리잔",
      "아래 상품을 눌러 주문 내역을 확인하세요.",
    );
    const pb = screen(
      "03B · 유리컵 결제",
      x + gap,
      p,
      "주문 / 금액",
      "결제 명세",
      "유리컵 한 개의 금액 내역입니다.",
    );
    const card = box(pa, "상품 카드", 22, 211, 316, 154, pale, 12);
    words(card, "상품 이름", "유리컵", 17, 21, 19, ink, true);
    const first = words(
      card,
      "첫 표시 가격",
      "29,900원",
      17,
      68,
      26,
      green,
      true,
    );
    const included = words(
      card,
      "포함 비용 안내",
      "필수 배송비 포함",
      17,
      116,
      12,
      muted,
    );
    included.visible = false;
    const order = box(pb, "주문 명세", 22, 211, 316, 165, white, 12);
    words(order, "상품 가격", "상품 29,900원", 16, 18, 15, ink);
    const fixed = words(
      order,
      "고정 비용",
      "필수 고정 배송비 3,000원",
      16,
      55,
      15,
      ink,
    );
    box(order, "구분선", 16, 93, 284, 1, pale);
    const total = words(
      order,
      "결제 총액",
      "결제 예정 금액 32,900원",
      16,
      112,
      18,
      green,
      true,
    );
    await link(card, pb);
    // Give the starting screens human-readable labels without altering existing flows.
    let points = page.flowStartingPoints.slice();
    for (const pair of [
      [sa, "01 빠른배송"],
      [ha, "02 계층구조"],
      [pa, "03 가격"],
    ])
      points = extraStart(points, pair[0].id, pair[1]);
    page.flowStartingPoints = points;
    const data = {
      shipping: {
        start: sa.id,
        review: sb.id,
        freeReview: sc.id,
        confirm: go.id,
        fast: fast.id,
        free: free.id,
        selectedKey: master.key,
      },
      hierarchy: {
        start: ha.id,
        paid: promoted.id,
        basic: basic[0].id,
        label: basic[1].id,
        paidReview: hb.id,
        basicReview: hc.id,
      },
      price: {
        start: pa.id,
        checkout: pb.id,
        card: card.id,
        first: first.id,
        fee: fixed.id,
        total: total.id,
        included: included.id,
      },
    };
    page.setPluginData(PAGE_KEY, JSON.stringify(data));
    focus(sa);
    placed = null;
  } catch (error) {
    const nodes = placed || [];
    placed = null;
    for (const n of nodes.reverse()) if (!n.removed) n.remove();
    throw error;
  }
}
async function get(id) {
  const n = await figma.getNodeByIdAsync(id);
  if (!n || n.removed) throw Error("Fixture layer was removed: " + id);
  return n;
}
async function replaceText(id, text) {
  const n = await get(id);
  await figma.loadFontAsync(n.fontName);
  n.characters = text;
}
export async function state(which, operation, selectStart = true) {
  const data = registered();
  if (!data) throw Error("Build journeys first.");
  const row = data[which],
    start = await get(row.start);
  if (operation !== "start") {
    const fix = operation === "fix";
    if (which === "shipping") {
      const paid = await get(row.fast),
        free = await get(row.free);
      let props = {};
      props[row.selectedKey] = !fix;
      paid.setProperties(props);
      props = {};
      props[row.selectedKey] = fix;
      free.setProperties(props);
      await link(
        await get(row.confirm),
        await get(fix ? row.freeReview : row.review),
      );
    } else if (which === "hierarchy") {
      const basic = await get(row.basic),
        label = await get(row.label);
      await figma.loadFontAsync(label.fontName);
      basic.resize(fix ? 316 : 145, fix ? 52 : 22);
      basic.fills = paint(white);
      label.fontSize = fix ? 16 : 9;
      label.fills = paint(fix ? ink : "#CFD3D0");
      label.y = Math.round((basic.height - label.height) / 2);
    } else {
      await replaceText(row.first, fix ? "32,900원" : "29,900원");
      (await get(row.included)).visible = fix;
    }
  }
  if (selectStart) focus(start);
}

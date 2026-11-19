import test from 'node:test';
import assert from 'node:assert/strict';
import { readJourney } from '../src/reader.js';
import { analyzeJourney } from '../src/analyze.js';

const box = (x, y, width, height) => ({x, y, width, height});
const fill = (r, g, b) => [{type: 'SOLID', color: {r, g, b}}];
function layer(id, type, name, children = [], properties = {}) {
  const result = {id, type, name, visible: true, opacity: 1, ...properties};
  if (children.length || ['FRAME', 'INSTANCE', 'COMPONENT', 'GROUP', 'SECTION'].includes(type)) {
    result.children = children;
    for (const child of children) child.parent = result;
  }
  return result;
}
const caption = (id, text, extra) => layer(id, 'TEXT', 'Label', [], {characters: text, ...extra});
const screen = (id, name, children, extra) => layer(id, 'FRAME', name, children, extra);
const go = (destinationId, navigation = 'NAVIGATE') => ({type: 'NODE', destinationId, navigation});
const onClick = (...actions) => ({trigger: {type: 'ON_CLICK'}, actions});
function api(screens, startId) {
  const page = layer('page', 'PAGE', 'Design');
  page.flowStartingPoints = startId ? [{nodeId: startId, name: 'Shop'}] : [];
  const indexed = new Map();
  function index(node) {
    indexed.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  }
  for (const node of screens) { node.parent = page; index(node); }
  return {currentPage: page, getNodeByIdAsync: async id => indexed.get(id) ?? null};
}

test('reads visible labels, selected component properties and effective styles with real node IDs', async () => {
  const delivery = layer('radio', 'INSTANCE', 'Radio', [caption('radio-caption', '빠른배송 +5,000원')], {
    componentProperties: {'Selected#7:3': {type: 'BOOLEAN', value: false}}, absoluteBoundingBox: box(110, 128, 240, 48)
  });
  const button = layer('cta', 'FRAME', 'Button / Primary', [
    caption('cta-caption', '주문 확인', {fontSize: 16, fills: fill(1, 1, 1)})
  ], {absoluteBoundingBox: box(110, 200, 300, 52), fills: fill(0.2, 0.4, 0.6), opacity: 0.5});
  const hidden = layer('draft', 'FRAME', '미사용', [caption('draft-caption', '유료 옵션')], {visible: false});
  const root = screen('s1', '배송 옵션', [delivery, button, hidden], {absoluteBoundingBox: box(100, 100, 390, 800)});
  const input = await readJourney(api([root], root.id), root);
  assert.equal(input.entry_state_id, 's1');
  assert.equal(input.flow_start_confirmed, true);
  const nodes = input.states[0].nodes;
  assert.deepEqual(nodes.map(n => n.node_id), ['radio', 'cta']);
  assert.equal(nodes[0].text, '빠른배송 +5,000원');
  assert.equal(nodes[0].checked, false);
  assert.equal(nodes[0].role, 'radio');
  assert.equal(nodes[0].amount_krw, 5000);
  assert.deepEqual(nodes[1].bounds, box(10, 100, 300, 52));
  assert.equal(nodes[1].style.font_size_px, 16);
  assert.equal(nodes[1].style.text_color, '#FFFFFF');
  assert.equal(nodes[1].style.background_color, '#336699');
  assert.equal(nodes[1].style.opacity, 0.5);
});

test('follows branching links under sections and legacy single-action links and terminates cycles', async () => {
  const root = screen('s1', '가입', [
    layer('add', 'FRAME', '추가 버튼', [caption('add-label', '추가하고 계속')], {reactions: [onClick(go('s2'))]}),
    layer('base', 'FRAME', '기본 버튼', [caption('base-label', '기본 요금으로 계속')], {
      reactions: [{trigger: {type: 'ON_CLICK'}, action: go('s3')}]
    })
  ]);
  const second = screen('s2', '추가 주문', [
    caption('back-to-entry', '다시 고르기', {reactions: [onClick(go('s1'))]})
  ]);
  const third = screen('s3', '기본 주문', [caption('total', '결제 예정 9,900원')]);
  const container = layer('section', 'SECTION', '회원 가입', [second, third]);
  const input = await readJourney(api([root, container]), root);
  assert.equal(input.flow_start_confirmed, false);
  assert.deepEqual(input.states.map(s => s.state_id), ['s1', 's2', 's3']);
  assert.deepEqual(input.transitions.map(t => [t.from_state_id, t.action.node_id, t.action.type, t.to_state_id]), [
    ['s1', 'add', 'click', 's2'], ['s1', 'base', 'click', 's3'], ['s2', 'back-to-entry', 'click', 's1']
  ]);
  assert.equal(input.warnings.length, 0);
});

test('keeps conditional, hover, overlay and component-variant destinations tentative and reports missing destinations', async () => {
  const trigger = layer('change', 'FRAME', '버튼', [caption('go', '계속')], {reactions: [
    onClick({type: 'CONDITIONAL', conditionalBlocks: [{actions: [go('s2')]}]}),
    {trigger: {type: 'ON_HOVER'}, actions: [go('s3', 'OVERLAY')]},
    onClick(go('s4', 'CHANGE_TO')), onClick(go('deleted'))
  ]});
  const root = screen('s1', '시작', [trigger]);
  const variant = layer('s4', 'COMPONENT', 'State=Selected', []);
  const input = await readJourney(api([root, screen('s2', '분기', []), screen('s3', '팝업', []), variant]), root);
  assert.deepEqual(input.transitions.map(t => t.to_state_id), ['s2', 's3', 's4']);
  assert.ok(input.transitions.every(t => t.uncertain));
  assert.equal(input.transitions[1].action.type, 'other');
  assert.ok(input.warnings.length > 0);
});

test('ignores unrelated Boolean properties and unpainted drafts, preserves mixed settings as unknown', async () => {
  const option = layer('unknown', 'INSTANCE', '체크박스', [caption('option-label', '유료 케어')], {
    componentProperties: {'Show icon#123:3': {type: 'BOOLEAN', value: true}}
  });
  const root = screen('s', '일부 화면', [option,
    caption('two', '기본 9,900원 또는 월 12,900원', {fontSize: Symbol('mixed'), fills: Symbol('mixed')}),
    caption('zero', '숨은 레이어', {opacity: 0})
  ]);
  const input = await readJourney(api([root]), root);
  const [first, second] = input.states[0].nodes;
  assert.equal(first.checked, undefined);
  assert.equal(second.amount_krw, undefined);
  assert.equal(second.style.font_size_px, undefined);
  assert.equal(input.states[0].nodes.length, 2);
  assert.doesNotThrow(() => JSON.stringify(input));
});

test('associates an indicator with its visible sibling label and the enclosing row click target', async () => {
  const indicator = layer('indicator', 'INSTANCE', 'Checkbox', [], {
    componentProperties: {'Checked#1:0': {type: 'BOOLEAN', value: true}}
  });
  const row = layer('row', 'FRAME', 'Frame 82', [indicator, caption('name', '빠른배송'), caption('fee', '+5,000원')], {
    reactions: [onClick(go('review'))]
  });
  const root = screen('options', '배송 옵션', [row]);
  const input = await readJourney(api([root, screen('review', '주문 확인', [])]), root);
  assert.equal(input.states[0].nodes.length, 1);
  const [control] = input.states[0].nodes;
  assert.equal(control.role, 'checkbox');
  assert.equal(control.text, '빠른배송 +5,000원');
  assert.equal(control.checked, true);
  assert.equal(control.selection_node_id, 'indicator');
  assert.equal(input.transitions[0].action.node_id, control.node_id);
});

test('keeps two text hotspots in one named wrapper as two actions with separate labels', async () => {
  const wrapper = layer('wrapper', 'FRAME', 'Button', [
    caption('one', '월 3,000원 추가하고 계속', {reactions: [onClick(go('paid'))]}),
    caption('two', '기본 요금으로 계속', {reactions: [onClick(go('base'))]})
  ]);
  const root = screen('s1', '가입', [wrapper]);
  const input = await readJourney(api([root, screen('paid', '가입 완료', []), screen('base', '가입 완료', [])]), root);
  assert.deepEqual(input.states[0].nodes.map(n => n.node_id), ['one', 'two']);
  assert.deepEqual(input.transitions.map(t => t.action.node_id), ['one', 'two']);
});

test('recognizes an explicitly checked Boolean on a renamed instance, and does not invent one from unrelated state', async () => {
  const renamed = layer('extra', 'INSTANCE', '빠른배송', [caption('title', '빠른배송 +5,000원')], {
    componentProperties: {'Checked#1:2': {type: 'BOOLEAN', value: true}}
  });
  const root = screen('s1', '옵션', [renamed]);
  const input = await readJourney(api([root]), root);
  assert.equal(input.states[0].nodes[0].role, 'checkbox');
  assert.equal(input.states[0].nodes[0].checked, true);
});

test('truncated navigation has no dangling edges and still reports a partial read', async () => {
  const screens = Array.from({length: 45}, (_, i) => screen('s'+i, '화면 '+i, [
    caption('button'+i, '다음', {reactions: i < 44 ? [onClick(go('s'+(i+1)))] : []})
  ]));
  const input = await readJourney(api(screens), screens[0]);
  const ids = new Set(input.states.map(s => s.state_id));
  assert.ok(ids.size < screens.length);
  assert.ok(input.transitions.every(edge => ids.has(edge.from_state_id) && ids.has(edge.to_state_id)));
  assert.ok(input.warnings.some(warning => warning.includes('한도')));
});

test('exposes the unique price text of a clickable product card under its real layer ID', async () => {
  const card = layer('card', 'FRAME', '상품 카드', [caption('name', '티셔츠'), caption('price', '29,900원')], {
    reactions: [onClick(go('checkout'))]
  });
  const root = screen('listing', '첫 가격', [card]);
  const input = await readJourney(api([root, screen('checkout', '주문', [])]), root);
  const nodes = input.states[0].nodes;
  assert.equal(nodes.find(n => n.node_id === 'card').role, 'button');
  const price = nodes.find(n => n.node_id === 'price');
  assert.equal(price?.role, 'text');
  assert.equal(price.amount_krw, 29900);
  assert.equal(price.parent_id, 'card');
  assert.equal(price.control_node_id, 'card');
  assert.equal(input.transitions[0].action.node_id, 'card');
});

test('retains competing card prices as visible data for uncertainty rather than choosing one', async () => {
  const card = layer('card', 'FRAME', 'Product card',
    [caption('name', '티셔츠'), caption('regular', '39,900원'), caption('discount', '29,900원')],
    {reactions: [onClick(go('detail'))]});
  const root = screen('list', '상품 목록', [card]);
  const input = await readJourney(api([root, screen('detail', '상세', [])]), root);
  const source = input.states[0];
  assert.equal(source.nodes.find(n => n.node_id === 'card').amount_krw, undefined);
  assert.deepEqual(source.nodes.filter(n => n.role === 'text').map(n => n.amount_krw), [39900, 29900]);
});

test('records struck text on the actual nested price layer and keeps the combined reader label', async () => {
  const content = '  82,000원 62,000원';
  const prices = caption('mixed-price', content, {
    getStyledTextSegments(fields) {
      assert.deepEqual(fields, ['textDecoration']);
      return [
        { start: 0, end: 2, textDecoration: 'NONE' },
        { start: 2, end: 9, textDecoration: 'STRIKETHROUGH' },
        { start: 9, end: content.length, textDecoration: 'NONE' }
      ];
    }
  });
  const card = layer('card', 'FRAME', '상품 카드', [caption('name', '울 코트'), prices], {
    reactions: [onClick(go('checkout'))]
  });
  const root = screen('listing', '첫 가격', [card]);
  const input = await readJourney(api([root, screen('checkout', '주문', [])], root.id), root);
  const offer = input.states[0];
  assert.deepEqual(offer.nodes.map(node => node.node_id), ['card']);
  assert.equal(offer.nodes[0].text, '울 코트 82,000원 62,000원');
  assert.deepEqual(offer.price_texts.map(({node_id, control_node_id, text, struck_ranges}) =>
    ({node_id, control_node_id, text, struck_ranges})), [
    {node_id: 'mixed-price', control_node_id: 'card', text: content, struck_ranges: [[2, 9]]}
  ]);
});

test('reads a sibling button background when scanning a weak choice and its repair', async () => {
  const backdrop = layer('back', 'RECTANGLE', '버튼 배경', [], {
    absoluteBoundingBox: box(10, 10, 200, 48), fills: fill(0, 0, 0), cornerRadius: 6
  });
  const paid = layer('subscribe', 'FRAME', 'Button', [backdrop, caption('yes', '유료 가입', {
    absoluteBoundingBox: box(24, 22, 80, 24), fills: fill(1, 1, 1), fontSize: 16
  })], {absoluteBoundingBox: box(10, 10, 200, 48), reactions: [onClick(go('paid'))]});
  const basicText = caption('no', '나중에', {absoluteBoundingBox: box(24, 74, 50, 16), fills: fill(0.8, 0.8, 0.8), fontSize: 14});
  const basic = layer('skip', 'FRAME', 'Button', [basicText], {
    absoluteBoundingBox: box(10, 66, 90, 30), reactions: [onClick(go('free'))]
  });
  const root = screen('offer', '가입 제안', [paid, basic], {fills: fill(1, 1, 1)});
  const app = api([root, screen('paid', '유료', []), screen('free', '기본', [])], root.id);
  const inspect = async () => analyzeJourney(await readJourney(app, root))
    .find(finding => finding.pattern === 'misleading_visual_hierarchy');
  const risk = await inspect();
  assert.equal(risk.status, 'risk_signal');
  assert.deepEqual(risk.evidence.map(e => e.node_id), ['subscribe', 'skip']);
  basic.absoluteBoundingBox = box(10, 66, 200, 48);
  basicText.fills = fill(0.2, 0.2, 0.2);
  assert.equal((await inspect()).status, 'signal_absent');
});

test('uses visual stacking order and withholds contrast when sibling paint is ambiguous', async () => {
  const bounds = box(0, 0, 100, 40);
  const black = {absoluteBoundingBox: bounds, fills: fill(0, 0, 0)};
  const cases = [
    {name: 'reverse auto-layout', labelFirst: true, reverse: true, expected: '#000000'},
    {name: 'foreground rectangle', labelFirst: true},
    {name: 'partial text coverage', change: {absoluteBoundingBox: box(0, 0, 25, 40)}},
    {name: 'transparent shape', change: {opacity: 0.4}},
    {name: 'gradient', change: {fills: [{type: 'GRADIENT_LINEAR'}]}},
    {name: 'paint blended with page', change: {fills: [{...fill(0, 0, 0)[0], blendMode: 'SCREEN'}]}},
    {name: 'rotated rectangle', change: {absoluteTransform: [[0.7, -0.7, 0], [0.7, 0.7, 0]]}},
    {name: 'unpainted hotspot', labelFirst: true, change: {fills: []}, expected: '#FFFFFF'},
    {name: 'hidden foreground', labelFirst: true, change: {visible: false}, expected: '#FFFFFF'}
  ];
  for (const {name, labelFirst, reverse, change, expected} of cases) {
    const shape = layer('shape', 'RECTANGLE', '배경', [], {...black, ...change});
    const label = caption('text', '가입하기', {absoluteBoundingBox: box(15, 12, 60, 16), fontSize: 16, fills: fill(1, 1, 1)});
    const children = labelFirst ? [label, shape] : [shape, label];
    const button = layer('button', 'FRAME', 'Button', children, {
      absoluteBoundingBox: bounds, layoutMode: reverse ? 'HORIZONTAL' : 'NONE', itemReverseZIndex: Boolean(reverse)
    });
    const root = screen('offer', '가입', [button], {fills: fill(1, 1, 1)});
    const journey = await readJourney(api([root]), root);
    assert.equal(journey.states[0].nodes[0].style.background_color, expected, name);
  }
});

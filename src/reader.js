// Keep large canvases responsive. A partial read always carries a warning.
const MAX_STATES = 40;
const MAX_LAYERS = 6000;
const MAX_CONNECTIONS = 500;
const MAX_DEPTH = 100;
const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);
const CHOICES = new Set(['radio', 'checkbox', 'toggle']);

function namedRole(layer) {
  const name = (layer.name || '').toLowerCase();
  if (/(button|radio|checkbox|toggle|버튼|라디오|체크박스)\s*(group|list|set|그룹|목록|모음)/i.test(name)) return null;
  if (layer.type === 'TEXT') {
    if (/^[☐☑☒]/u.test(layer.characters.trim())) return 'checkbox';
    return null;
  }
  if (/radio|라디오/.test(name)) return 'radio';
  if (/check[\s_-]?box|체크[\s_-]?박스/.test(name)) return 'checkbox';
  if (/toggle|switch|토글|스위치/.test(name)) return 'toggle';
  if (layer.type === 'INSTANCE' && Object.keys(layer.componentProperties || {}).some(
    key => /^(is[\s_-]?)?(checked|체크)(\s*여부)?$/i.test(key.split('#')[0].trim()))) return 'checkbox';
  if (/button|\bbtn\b|버튼/.test(name)) return 'button';
  if (/(^|[\s/_-])link($|[\s/_-])|링크/.test(name)) return 'link';
  return null;
}

// Auto-layout often puts a radio indicator and its label in separate children.
// Associate only a small row with a single named choice and plain sibling text.
function rowIndicator(layer) {
  const children = layer.children || [];
  if (!children.length || children.length > 8) return null;
  let indicator = null;
  let labels = 0;
  for (const child of children) {
    if (child.visible === false || child.opacity === 0) continue;
    if (CHOICES.has(namedRole(child))) {
      if (indicator) return null;
      indicator = child;
    } else if (child.type === 'TEXT' && !child.reactions?.length) {
      labels++;
    } else return null;
  }
  return labels ? indicator : null;
}

function parseSelection(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (['selected', 'checked', 'true', 'on', '선택', '선택됨', '체크됨', '켜짐'].includes(token)) return true;
  if (['unselected', 'unchecked', 'deselected', 'false', 'off', '해제', '미선택', '선택해제', '체크해제', '꺼짐'].includes(token)) return false;
  return undefined;
}

function componentSelection(layer) {
  const properties = layer.componentProperties || {};
  for (const [key, property] of Object.entries(properties)) {
    const name = key.split('#')[0].trim();
    if (!/^(is[\s_-]?)?(checked|selected|선택|체크)(\s*여부)?$/i.test(name) &&
        !/^(selection|check state|선택 상태|state|상태)$/i.test(name)) continue;
    const value = parseSelection(property.value);
    if (value !== undefined) return value;
  }
  for (const [key, value] of Object.entries(layer.variantProperties || {})) {
    if (/^(state|selected|checked|선택|체크|상태|선택 상태)$/i.test(key)) {
      const selected = parseSelection(value);
      if (selected !== undefined) return selected;
    }
  }
  const tokens = (layer.name || '').split(/[,=/|]/);
  return tokens.length > 1 ? parseSelection(tokens[tokens.length - 1]) : undefined;
}

function priceFromText(text) {
  if (/[\d,]\s*[~–-]\s*[₩\d]/.test(text)) return undefined;
  const amounts = text.match(/(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원/gi) || [];
  if (amounts.length !== 1) return undefined;
  const value = Number(amounts[0].replace(/\D/g, ''));
  return Number.isSafeInteger(value) ? value : undefined;
}

// Transparent/mixed/gradient paints need a rendered image for a contrast calculation.
const visiblePaint = paint => paint.visible !== false && paint.opacity !== 0;

function solidColor(paints) {
  if (!Array.isArray(paints)) return undefined;
  const visible = paints.filter(visiblePaint);
  if (visible.length !== 1 || visible[0].type !== 'SOLID' || (visible[0].opacity ?? 1) !== 1 ||
      (visible[0].blendMode && visible[0].blendMode !== 'NORMAL')) return undefined;
  return '#' + ['r', 'g', 'b'].map(key => {
    const channel = Math.round(visible[0].color[key] * 255);
    return channel.toString(16).padStart(2, '0').toUpperCase();
  }).join('');
}

function intersects(rect, clip) {
  return !rect || !clip || (rect.x < clip.x + clip.width && rect.x + rect.width > clip.x &&
    rect.y < clip.y + clip.height && rect.y + rect.height > clip.y);
}

function rectangleBackdrop(shape, label) {
  const rect = shape.absoluteBoundingBox;
  if (shape.type !== 'RECTANGLE' || !rect || (shape.opacity ?? 1) !== 1 ||
      shape.effects?.some(effect => effect.visible !== false) || shape.strokes?.some(visiblePaint) ||
      (shape.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(shape.blendMode))) return undefined;
  const transform = shape.absoluteTransform;
  if (transform && (transform[0][1] !== 0 || transform[1][0] !== 0)) return undefined;
  const insetX = Math.min(label.x - rect.x, rect.x + rect.width - label.x - label.width);
  const insetY = Math.min(label.y - rect.y, rect.y + rect.height - label.y - label.height);
  const radius = shape.cornerRadius ?? 0;
  if (insetX < 0 || insetY < 0 || typeof radius !== 'number' ||
      (radius > 0 && (shape.cornerSmoothing || Math.max(insetX, insetY) < radius))) return undefined;
  return solidColor(shape.fills);
}

// Buttons often paint their background with a separate rectangle below the label.
// Only use a color when it covers the entire text and nothing paints over it.
function siblingBackdrop(label, inherited) {
  const parent = label.parent;
  const siblings = parent?.children;
  if (!siblings || siblings.length < 2) return inherited;
  const rect = label.absoluteBoundingBox;
  if (!rect || siblings.length > 64) return undefined;
  const reversed = ['HORIZONTAL', 'VERTICAL'].includes(parent.layoutMode) && parent.itemReverseZIndex;
  let behind = true;
  let color = inherited;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[reversed ? siblings.length - 1 - i : i];
    if (sibling.id === label.id) { behind = false; continue; }
    if (sibling.visible === false || sibling.opacity === 0) continue;
    if (sibling.isMask) return undefined;
    if (!intersects(rect, sibling.absoluteRenderBounds || sibling.absoluteBoundingBox)) continue;
    if (sibling.type === 'RECTANGLE' && Array.isArray(sibling.fills) && !sibling.fills.some(visiblePaint) &&
        !sibling.strokes?.some(visiblePaint) && !sibling.effects?.some(effect => effect.visible !== false)) continue;
    if (!behind) return undefined;
    color = rectangleBackdrop(sibling, rect);
  }
  return color;
}

function clipRect(rect, inherited) {
  if (!rect || !inherited) return rect || inherited;
  const x = Math.max(rect.x, inherited.x);
  const y = Math.max(rect.y, inherited.y);
  return {x, y, width: Math.min(rect.x + rect.width, inherited.x + inherited.width) - x,
    height: Math.min(rect.y + rect.height, inherited.y + inherited.height) - y};
}

function normalizeLayer(layer, role, origin, opacity, background) {
  const item = {node_id: layer.id, name: layer.name, role, text: '', style: {opacity}};
  if (background) item.style.background_color = background;
  if (layer.parent?.id) item.parent_id = layer.parent.id;
  const rect = layer.absoluteBoundingBox;
  if (rect) item.bounds = {x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height};
  return item;
}

function setTextStyle(item, layer, opacity, background) {
  const style = {opacity};
  if (typeof layer.fontSize === 'number') style.font_size_px = layer.fontSize;
  const color = solidColor(layer.fills);
  if (color) style.text_color = color;
  if (background) style.background_color = background;
  item.style = style;
}

function snapshot(frame, budget, warnings) {
  const nodes = [];
  const links = [];
  const origin = frame.absoluteBoundingBox || {x: 0, y: 0};
  function walk(layer, owner, parentOpacity, parentColor, clip, depth) {
    if (budget.layers === 0 || depth > MAX_DEPTH) {
      warnings.add('레이어 수 또는 중첩 깊이 한도에 도달해 일부 레이어를 생략했습니다.');
      return;
    }
    budget.layers--;
    const opacity = parentOpacity * (layer.opacity ?? 1);
    if (layer.visible === false || opacity === 0) return;
    const rect = layer.absoluteBoundingBox;
    if (!intersects(rect, clip)) {
      warnings.add('프레임 밖으로 완전히 잘린 레이어는 현재 화면에서 제외했습니다.');
      return;
    }
    const textLayer = layer.type === 'TEXT';
    const paints = layer.fills;
    let background = parentColor;
    const hasPaint = Array.isArray(paints) ? paints.some(visiblePaint) : Boolean(paints);
    if (!textLayer && hasPaint) {
      background = solidColor(paints);
    }
    if (textLayer) background = siblingBackdrop(layer, background);
    const reactions = layer.reactions || [];
    const isRoot = layer.id === frame.id;
    const ownRole = namedRole(layer);
    const indicator = !isRoot && !CHOICES.has(ownRole) && rowIndicator(layer);
    const role = indicator ? namedRole(indicator) : ownRole;
    const hasReactions = reactions.length > 0;
    const singleLabelHotspot = textLayer && owner && !owner.hasReactions && owner.onlyChildId === layer.id && !role;
    const embeddedIndicator = owner?.indicatorId === layer.id;
    const isControl = !singleLabelHotspot && !embeddedIndicator && (role || hasReactions);
    let part = owner;
    if ((isRoot ? hasReactions : isControl) || (textLayer && !owner)) {
      const item = normalizeLayer(layer, isRoot ? 'region' : role || (hasReactions ? 'button' : 'text'), origin, opacity, background);
      if (CHOICES.has(item.role)) {
        const selected = componentSelection(indicator || layer);
        if (selected !== undefined) item.checked = selected;
        if (indicator) item.selection_node_id = indicator.id;
      }
      const onlyChildId = layer.children?.length === 1 ? layer.children[0].id : null;
      part = {item, labels: [], longest: 0, onlyChildId, hasReactions, indicatorId: indicator?.id};
      nodes.push(part);
    }
    if (textLayer && part) {
      const text = layer.characters.trim();
      if (text) {
        part.labels.push(text);
        if (text.length > part.longest) {
          part.longest = text.length;
          setTextStyle(part.item, layer, opacity, background);
        }
        // Keep the control for navigation and its exact price label for evidence.
        // Multiple independent price labels remain individually available.
        if (owner === part && ['button', 'link'].includes(part.item.role) &&
            /^(?:(?:₩|KRW)\s*\d[\d,]*(?:\s*원)?|\d[\d,]*\s*원)$/i.test(text)) {
          const price = normalizeLayer(layer, 'text', origin, opacity, background);
          price.control_node_id = part.item.node_id;
          setTextStyle(price, layer, opacity, background);
          nodes.push({item: price, labels: [text]});
        }
      }
    }
    for (const reaction of reactions) {
      part.hasTrigger = true;
      links.push({nodeId: part.item.node_id, triggerNodeId: layer.id, reaction});
    }
    const activeOwner = isRoot ? null : part;
    const nextClip = layer.clipsContent ? clipRect(rect, clip) : clip;
    for (const child of layer.children || []) {
      if (!budget.layers) {
        warnings.add('레이어 수 또는 중첩 깊이 한도에 도달해 일부 레이어를 생략했습니다.');
        break;
      }
      walk(child, activeOwner, opacity, background, nextClip, depth + 1);
    }
  }
  walk(frame, null, 1, undefined, null, 0);
  return {
    state: {
      state_id: frame.id, frame_id: frame.id, name: frame.name,
      nodes: nodes.filter(part => part.labels.length || part.hasTrigger || CHOICES.has(part.item.role)).map(({item, labels}) => {
        item.text = labels.join(' ');
        const amount = priceFromText(item.text);
        if (amount !== undefined) item.amount_krw = amount;
        if (CHOICES.has(item.role) && item.checked === undefined && /^[☐☑☒]/u.test(item.text)) {
          item.checked = item.text[0] !== '☐';
        }
        return item;
      })
    },
    links
  };
}

function destinations(actions, warnings, conditional = false) {
  const edges = [];
  const variableDependent = actions.some(action => action?.type === 'SET_VARIABLE' || action?.type === 'SET_VARIABLE_MODE');
  for (const action of actions) {
    if (action?.type === 'CONDITIONAL') {
      warnings.add('조건이나 변수에 따라 바뀌는 화면은 프로토타입 실행에서 확인해야 합니다.');
      for (const block of action.conditionalBlocks || []) edges.push(...destinations(block.actions || [], warnings, true));
    } else if (action?.type === 'NODE' && action.destinationId && action.navigation !== 'SCROLL_TO') {
      const uncertain = conditional || variableDependent || action.navigation !== 'NAVIGATE';
      if (uncertain) warnings.add('조건부 연결, 오버레이 또는 컴포넌트 변형의 실제 표시 상태는 추가 확인이 필요합니다.');
      edges.push({id: action.destinationId, navigation: action.navigation, uncertain});
    } else {
      warnings.add('변수 변경, 뒤로 가기, 스크롤, 외부 링크 등 목적 화면을 확정할 수 없는 동작이 있습니다.');
    }
  }
  return edges;
}

export async function readJourney(figmaApi, rootFrame) {
  const states = [];
  const transitions = [];
  const warnings = new Set();
  const budget = {layers: MAX_LAYERS};
  const frames = [rootFrame];
  const resolved = new Map([[rootFrame.id, rootFrame]]);
  const queued = new Set([rootFrame.id]);
  let examined = 0;
  for (let i = 0; i < frames.length && budget.layers > 0; i++) {
    const frame = frames[i];
    const {state, links} = snapshot(frame, budget, warnings);
    states.push(state);
    for (const {nodeId, triggerNodeId, reaction} of links) {
      const actions = reaction.actions || (reaction.action ? [reaction.action] : []);
      for (const edge of destinations(actions, warnings)) {
        if (++examined > MAX_CONNECTIONS) {
          warnings.add('프로토타입 연결 수 한도에 도달해 일부 경로를 생략했습니다.');
          break;
        }
        if (!resolved.has(edge.id)) {
          let target = null;
          try { target = await figmaApi.getNodeByIdAsync(edge.id); } catch { /* library/deleted destination */ }
          resolved.set(edge.id, target);
        }
        const target = resolved.get(edge.id);
        if (!target || !SCREEN_TYPES.has(target.type) || target.visible === false) {
          warnings.add('목적 화면이 삭제되었거나 표시 상태를 읽을 수 없는 연결이 있습니다.');
          continue;
        }
        if (!queued.has(target.id)) {
          if (frames.length >= MAX_STATES) {
            warnings.add('연결된 화면 수 한도에 도달해 일부 경로를 생략했습니다.');
            continue;
          }
          queued.add(target.id);
          frames.push(target);
        }
        const clicked = reaction.trigger?.type === 'ON_CLICK';
        if (!clicked) warnings.add('클릭 이외의 트리거로 이어지는 경로는 실제 실행 조건을 확인해야 합니다.');
        transitions.push({
          transition_id: 't' + (transitions.length + 1), from_state_id: frame.id, to_state_id: target.id,
          action: {type: clicked ? 'click' : 'other', node_id: nodeId,
            ...(triggerNodeId === nodeId ? {} : {trigger_node_id: triggerNodeId})},
          ...(edge.uncertain || !clicked ? {uncertain: true} : {})
        });
      }
      if (examined > MAX_CONNECTIONS) break;
    }
  }
  if (states.length < frames.length) warnings.add('레이어 한도에 도달해 일부 연결 화면을 읽지 못했습니다.');
  const captured = new Set(states.map(s => s.state_id));
  return {
    entry_state_id: rootFrame.id,
    flow_start_confirmed: (figmaApi.currentPage.flowStartingPoints || []).some(point => point.nodeId === rootFrame.id),
    states, transitions: transitions.filter(t => captured.has(t.to_state_id)), warnings: [...warnings]
  };
}

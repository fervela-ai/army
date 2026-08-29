// 新手指南的圖示。全部用 SVG 現畫，顏色走 theme.css 的變數，跟棋盤同一套視覺。
// Lynch：「粗學者連逆時針、吃掉大本營的軍旗規則都不會，應該先了解這些。」
import { insignia } from './insignia.js?v=79';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const k of kids) n.appendChild(k);
  return n;
};
const svg = (w, h, kids) => el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'g-svg', width: '100%' }, kids);
const text = (x, y, s, cls = 'g-t') => {
  const t = el('text', { x, y, class: cls, 'text-anchor': 'middle' });
  t.textContent = s;
  return t;
};

// ① 四家座位與行棋順序：對面是隊友，順序逆時針
export function seatDiagram() {
  const box = (x, y, seat, label, note) => el('g', {}, [
    el('rect', { x, y, width: 74, height: 40, rx: 7, class: `g-seat g-seat${seat}` }),
    text(x + 37, y + 20, label, 'g-t g-t--seat'),
    note ? text(x + 37, y + 34, note, 'g-t g-t--tiny') : el('g'),
  ]);
  return svg(300, 220, [
    box(113, 6, 2, '對家', '你的隊友'),
    box(6, 90, 3, '左家', '敵人'),
    box(220, 90, 1, '右家', '敵人'),
    box(113, 172, 0, '你', ''),
    // 隊友連線
    el('path', { d: 'M 150 46 V 172', class: 'g-mate' }),
    text(150, 112, '隊友', 'g-t g-t--tiny'),
    // 逆時針：你 → 右家 → 對家 → 左家 → 你
    el('path', { d: 'M 194 192 H 250 V 130', class: 'g-arrow', 'marker-end': 'url(#ga)' }),
    el('path', { d: 'M 250 90 V 26 H 194', class: 'g-arrow', 'marker-end': 'url(#ga)' }),
    el('path', { d: 'M 113 26 H 43 V 90', class: 'g-arrow', 'marker-end': 'url(#ga)' }),
    el('path', { d: 'M 43 130 V 192 H 113', class: 'g-arrow', 'marker-end': 'url(#ga)' }),
    el('defs', {}, [
      el('marker', { id: 'ga', viewBox: '0 0 10 10', refX: 8, refY: 5,
        markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
        [el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'g-arrowhead' })]),
    ]),
    text(150, 214, '行棋順序：逆時針', 'g-t g-t--tiny'),
  ]);
}

// ② 軍旗與大本營：軍旗在兩個大本營之一，被碰到就全家出局
export function flagDiagram() {
  const hq = (x, withFlag) => el('g', {}, [
    el('path', { d: `M ${x} 14 h 56 v 28 l -28 16 l -28 -16 z`, class: 'g-hq' }),
    withFlag ? el('g', { transform: `translate(${x + 28},34)`, class: 'g-ins' }, [insignia('軍旗')]) : el('g'),
    text(x + 28, 74, withFlag ? '軍旗在這' : '（空的）', 'g-t g-t--tiny'),
  ]);
  return svg(300, 118, [
    hq(20, true), hq(180, false),
    text(150, 100, '軍旗只能在兩個大本營之一', 'g-t g-t--tiny'),
    text(150, 114, '任何棋子碰到軍旗 → 那一家全軍覆沒', 'g-t g-t--em'),
  ]);
}

// ③ 棋子大小：用遊戲裡同一套軍階符號
export function rankLadder() {
  const order = ['司令', '軍長', '師長', '旅長', '團長', '營長', '連長', '排長', '工兵'];
  const chip = (x, y, name) => el('g', {}, [
    el('rect', { x, y, width: 52, height: 40, rx: 6, class: 'g-chip' }),
    el('g', { transform: `translate(${x + 26},${y + 15})`, class: 'g-ins' }, [insignia(name)]),
    text(x + 26, y + 34, name, 'g-t g-t--tiny'),
  ]);
  const kids = [];
  order.forEach((n, i) => {
    const x = 6 + (i % 5) * 58, y = 6 + Math.floor(i / 5) * 52;
    kids.push(chip(x, y, n));
    if (i % 5 !== 4 && i !== order.length - 1) kids.push(text(x + 56, y + 24, '＞', 'g-t g-t--tiny'));
  });
  ['炸彈', '地雷', '軍旗'].forEach((n, i) => kids.push(chip(6 + (i + 2) * 58, 110, n)));
  kids.push(text(64, 134, '特殊棋子 →', 'g-t g-t--tiny'));
  return svg(300, 158, kids);
}

// ④ 地形：公路、鐵路、行營、大本營
export function terrainDiagram() {
  const node = (x, y) => el('rect', { x: x - 9, y: y - 9, width: 18, height: 18, rx: 3, class: 'g-node' });
  return svg(300, 150, [
    el('path', { d: 'M 30 26 H 110', class: 'g-road' }), node(30, 26), node(110, 26),
    text(200, 30, '公路（細線）一次走一格', 'g-t g-t--tiny'),

    el('path', { d: 'M 30 66 H 110', class: 'g-rail' }), node(30, 66), node(110, 66),
    text(206, 70, '鐵路（粗線）可以滑很多格', 'g-t g-t--tiny'),

    el('circle', { cx: 70, cy: 104, r: 13, class: 'g-camp' }),
    text(200, 108, '行營：待在裡面吃不到', 'g-t g-t--tiny'),

    el('path', { d: 'M 44 130 h 52 v 14 l -26 10 l -26 -10 z', class: 'g-hq' }),
    text(206, 142, '大本營：走進去就不能再動', 'g-t g-t--tiny'),
  ]);
}

// 新手指南的圖示。
//
// ⚠ 全部用遊戲真正的畫法產生，不再手繪示意圖——
// Lynch：「這不是我們的圖，我要真的我們的圖」「大本營形狀錯的」。
// 棋子用 insignia() ＋ 跟棋盤同一組 CSS class；棋盤地形直接把真棋盤裁一塊出來。
import { insignia } from './insignia.js?v=117';
import { createBoardView } from './board.js?v=117';
import { BOARD } from '../engine/src/board.mjs?v=117';
import { nodeXY } from '../engine/src/geometry.mjs?v=117';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const k of kids) n.appendChild(k);
  return n;
};

// 一顆棋子：跟棋盤上長得完全一樣（同樣的 class，所以同樣的配色與字體）
function tile(x, y, piece, seat = 0) {
  return el('g', { class: `piece piece--seat${seat}`, transform: `translate(${x},${y})` }, [
    el('rect', { class: 'piece-box', x: -21, y: -18, width: 42, height: 36, rx: 6,
      stroke: `var(--seat-${seat})`, 'stroke-width': 2.5 }),
    el('g', { transform: 'translate(0,-6)' }, [insignia(piece)]),
    (() => { const t = el('text', { class: 'piece-label', y: 9.5 }); t.textContent = piece; return t; })(),
  ]);
}

// 棋子大小：由大到小排一排，就是玩家在盤上會看到的樣子
export function rankLadder() {
  const order = ['司令', '軍長', '師長', '旅長', '團長', '營長', '連長', '排長', '工兵'];
  const kids = [];
  order.forEach((n, i) => {
    const x = 30 + (i % 5) * 54, y = 26 + Math.floor(i / 5) * 52;
    kids.push(tile(x, y, n));
    if (i % 5 !== 4 && i !== order.length - 1) {
      const t = el('text', { x: x + 27, y: y + 5, class: 'g-t g-t--tiny', 'text-anchor': 'middle' });
      t.textContent = '＞';
      kids.push(t);
    }
  });
  ['炸彈', '地雷', '軍旗'].forEach((n, i) => kids.push(tile(30 + (i + 2) * 54, 130, n)));
  const lab = el('text', { x: 84, y: 135, class: 'g-t g-t--tiny', 'text-anchor': 'middle' });
  lab.textContent = '特殊棋子 →';
  kids.push(lab);
  return el('svg', { viewBox: '0 0 300 160', class: 'g-svg board' }, kids);
}

// 完整的真棋盤，用走法提示的綠點標出要講的位置。
// （原本想裁一塊放大，但 nodeXY 的座標系跟棋盤 viewBox 不同，硬算會裁到空白處。
//   完整棋盤本來就是玩家會看到的東西，直接顯示反而更準。）
// showSeats=false 時不放任何棋子。這很重要：原本每個點位都塞了一顆同色棋子當「陣地底色」，
// 結果把地形本身蓋掉了——行營的圓形與大本營的五角形整個看不見，
// 使用者回饋的「我找不到綠色點點跟五角型」就是這樣來的。
function realBoard(mark = [], showSeats = true) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'g-svg board');
  const view = createBoardView(svg, { onNodeClick: () => {}, onPointerUp: () => {} });
  view.setBottomSeat(0);
  const at = {};
  if (showSeats) for (const [id, n] of BOARD.nodes) if (n.seat != null) at[id] = { seat: n.seat };
  view.render({ board: { at, turn: 0, revealedFlags: [] }, mySeats: [], viewerSeat: 0, moves: mark });
  return svg;
}

// 地形：只看自己的陣地，並且畫大。
// 真實使用者回饋：「我找不到綠色點點跟五角型」——原本畫整個四家棋盤，
// 縮到 400px 之後行營只有幾像素、五角形完全看不出來，那張圖等於沒有作用。
export function terrainDiagram() {
  const svg = realBoard([], false);

  // 點位的 .node-hit 方框帶著棋盤使用者座標的 x/y/w/h，用它就能同步算出裁切框與標籤位置，
  // 不必等 requestAnimationFrame、也不必量畫面。
  // （量畫面的版本寫過一次：量到的時機不對，標籤整個跑到角落，不要再走那條路。）
  const rects = [...svg.querySelectorAll('rect.node-hit[data-node^="P0-"]')];
  const box = (id) => {
    const n = svg.querySelector(`rect.node-hit[data-node="${id}"]`);
    if (!n) return null;
    const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
    return { cx: x + Number(n.getAttribute('width')) / 2, cy: y + Number(n.getAttribute('height')) / 2 };
  };

  // 直接把「行營」「大本營」寫在圖上。使用者回饋「我找不到綠色點點跟五角型」、
  // 「大本營的位置大家不夠清楚」——靠圖例文字去配對，第一次看的人根本對不起來。
  for (const [id, text, dy] of [
    ['P0-r4c2', '行營', -36],
    ['P0-r6c2', '大本營', 46],
    ['P0-r6c4', '大本營', 46],
  ]) {
    const b = box(id);
    if (!b) continue;
    const t = el('text', { x: b.cx, y: b.cy + dy, class: 'g-label', 'text-anchor': 'middle' });
    t.textContent = text;
    svg.appendChild(t);
  }

  // 鏡頭拉近到 P0 的陣地：整個四家棋盤縮到 400px 之後，行營只有幾像素、
  // 五角形完全看不出來，那張圖等於沒有作用。
  if (rects.length) {
    const xs = rects.map(n => Number(n.getAttribute('x')));
    const ys = rects.map(n => Number(n.getAttribute('y')));
    const x1 = Math.max(...rects.map(n => Number(n.getAttribute('x')) + Number(n.getAttribute('width'))));
    const y1 = Math.max(...rects.map(n => Number(n.getAttribute('y')) + Number(n.getAttribute('height'))));
    const pad = 34;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 + pad - x0} ${y1 + pad - y0}`);
  }
  return svg;
}

// 四家與逆時針：四塊顏色就是四家
export function seatDiagram() {
  return realBoard();
}

// 新手指南的圖示。
//
// ⚠ 全部用遊戲真正的畫法產生，不再手繪示意圖——
// Lynch：「這不是我們的圖，我要真的我們的圖」「大本營形狀錯的」。
// 棋子用 insignia() ＋ 跟棋盤同一組 CSS class；棋盤地形直接把真棋盤裁一塊出來。
import { insignia } from './insignia.js?v=102';
import { createBoardView } from './board.js?v=102';
import { BOARD } from '../engine/src/board.mjs?v=102';
import { nodeXY } from '../engine/src/geometry.mjs?v=102';

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
function realBoard(mark = []) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'g-svg board');
  const view = createBoardView(svg, { onNodeClick: () => {}, onPointerUp: () => {} });
  view.setBottomSeat(0);
  const at = {};
  for (const [id, n] of BOARD.nodes) if (n.seat != null) at[id] = { seat: n.seat };
  view.render({ board: { at, turn: 0, revealedFlags: [] }, mySeats: [], viewerSeat: 0, moves: mark });
  return svg;
}

// 地形：綠點標出一個行營與一個大本營
export function terrainDiagram() {
  return realBoard(['P0-r4c2', 'P0-r6c2']);
}

// 四家與逆時針：四塊顏色就是四家
export function seatDiagram() {
  return realBoard();
}

// 「軍旗在哪裡、要怎麼贏」的動畫示範。
//
// ⚠ 用的是**遊戲真正的棋盤元件**（createBoardView），不是另外手繪的示意圖——
// Lynch：「這不是我們的圖，我要真的我們的圖」「大本營形狀錯的」。
// 手繪版的大本營形狀跟實際盤面對不上，教錯了比不教更糟。
import { createBoardView } from './board.js?v=104';
import { referenceLayout } from '../engine/ai/reference-layout.mjs?v=104';

const board0 = () => {
  const at = {};
  for (const [id, piece] of Object.entries(referenceLayout(0))) at[id] = { seat: 0, piece };
  return at;
};

const STEPS = [
  { text: '這是你的陣地（下方藍色那一片），25 顆棋子。中間那五個紅圈是「行營」，開局必須空著。' },
  { text: '最下面一排有兩個五角形的格子，那是「大本營」。軍旗一定放在其中一個——這一局放在左邊。',
    mark: ['P0-r6c2'] },
  { text: '這一局的擺法是軍旗兩側各壓一顆地雷。規則只規定地雷要放在最後兩排，'
        + '放哪裡由你自己決定——護旗只是其中一種用法。'
        + '地雷不能移動，任何「軍人」撞上去都會陣亡（只有工兵拆得掉）。',
    mark: ['P0-r6c1', 'P0-r6c3'] },
  { text: '所以敵人要打進來，得先派工兵拆掉地雷——全場只有工兵拆得掉地雷。',
    foe: { from: 'P1-r1c1', to: 'P0-r6c1', piece: '工兵' } },
  { text: '雷被拆掉了，通往軍旗的路就開了。', remove: ['P0-r6c1'], foeAt: 'P0-r6c1' },
  { text: '接著任何一顆棋子碰到軍旗，這一家就出局了。',
    foe: { from: 'P0-r6c1', to: 'P0-r6c2', piece: '工兵' }, win: true },
  { text: '出局的那一家，棋子全部從盤上拿走——連還沒被吃到的大子和地雷都一起消失。'
        + '所以扛旗不只是贏一顆棋，是一次清掉對方整家。',
    win: true, wipe: true },
  { text: '要贏下整局，你和隊友必須拿下敵方「兩家」的軍旗。只扛掉一家不算贏。',
    win: true, wipe: true },
];

export function buildFlagDemo() {
  const wrap = document.createElement('div');
  wrap.className = 'demo';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'demo-board');
  wrap.appendChild(svg);
  const view = createBoardView(svg, { onNodeClick: () => {}, onPointerUp: () => {} });
  view.setBottomSeat(0);

  // 鏡頭拉近到自己的陣地。座標從**畫出來的元素**反推，不要用幾何模組——
  // nodeXY 的座標系跟棋盤 viewBox 不同，硬算會裁到空白處（踩過一次）。
  // 這裡用螢幕座標換算回 viewBox：SVG 是等比縮放，所以是線性關係。
  const cropToSeat0 = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number);
    const k = vw / r.width;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of svg.querySelectorAll('[data-node^="P0-"]')) {
      const b = n.getBoundingClientRect();
      x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
      x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
    }
    if (x0 > x1) return;
    const pad = 26;
    svg.setAttribute('viewBox',
      `${vx + (x0 - r.left) * k - pad} ${vy + (y0 - r.top) * k - pad} ` +
      `${(x1 - x0) * k + pad * 2} ${(y1 - y0) * k + pad * 2}`);
  };

  const caption = document.createElement('div');
  caption.className = 'demo-caption';
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  const prev = document.createElement('button');
  const next = document.createElement('button');
  const dots = document.createElement('span');
  prev.className = next.className = 'btn demo-btn';
  prev.textContent = '上一步';
  dots.className = 'demo-dots';
  bar.append(prev, dots, next);
  wrap.append(caption, bar);

  let i = 0, busy = false;
  const draw = async () => {
    const at = board0();
    // 把這一步之前發生過的事補上（拆掉的雷、走到哪的敵子）
    let foeNode = null;
    for (let k = 0; k <= i; k++) {
      for (const id of STEPS[k].remove ?? []) delete at[id];
      if (STEPS[k].wipe) for (const id of Object.keys(at)) if (id.startsWith('P0-')) delete at[id];
      if (STEPS[k].foeAt) foeNode = STEPS[k].foeAt;
      if (k < i && STEPS[k].foe) foeNode = STEPS[k].foe.to;
    }
    const s = STEPS[i];
    if (foeNode) at[foeNode] = { seat: 1 };            // 敵子蓋著，跟實戰一樣看不到身分
    const board = { at, turn: 0, revealedFlags: [] };

    if (s.foe) {
      // 起點先放上敵子，再用遊戲原本的動畫走過去
      const from = s.foe.from, to = s.foe.to;
      at[from] = { seat: 1 };
      delete at[to];
      view.render({ board, mySeats: [0], viewerSeat: 0, hide: [from] });
      busy = true;
      await view.animateMove({ from, to, seat: 1, outcome: s.win ? 'defenderDead' : 'defenderDead',
        piece: null, path: [from, to] });
      busy = false;
      delete at[from];
      at[to] = { seat: 1 };
      if (s.win) delete at['P0-r6c2'];
      view.render({ board, mySeats: [0], viewerSeat: 0, lastMove: { from, to, seat: 1 } });
    } else {
      view.render({ board, mySeats: [0], viewerSeat: 0, selected: null,
        moves: s.mark ?? [] });                        // 用走法提示的綠點來指位置
    }
    requestAnimationFrame(cropToSeat0);      // 畫完才量得到元素位置
    if (s.win) svg.classList.add('is-win'); else svg.classList.remove('is-win');
    caption.textContent = s.text;
    dots.textContent = `${i + 1} / ${STEPS.length}`;
    prev.disabled = i === 0;
    next.textContent = i === STEPS.length - 1 ? '再看一次' : '下一步';
  };
  prev.addEventListener('click', () => { if (!busy && i > 0) { i--; draw(); } });
  next.addEventListener('click', () => { if (busy) return; i = i === STEPS.length - 1 ? 0 : i + 1; draw(); });
  draw();
  return wrap;
}

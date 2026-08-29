// 「軍旗在哪裡、要怎麼贏」的動畫示範。
//
// ⚠ 用的是**遊戲真正的棋盤元件**（createBoardView），不是另外手繪的示意圖——
// Lynch：「這不是我們的圖，我要真的我們的圖」「大本營形狀錯的」。
// 手繪版的大本營形狀跟實際盤面對不上，教錯了比不教更糟。
import { createBoardView } from './board.js?v=79';
import { referenceLayout } from '../engine/ai/reference-layout.mjs?v=79';

const board0 = () => {
  const at = {};
  for (const [id, piece] of Object.entries(referenceLayout(0))) at[id] = { seat: 0, piece };
  return at;
};

const STEPS = [
  { text: '這是你的陣地（下方藍色那一片），25 顆棋子。中間那五個紅圈是「行營」，開局必須空著。' },
  { text: '最下面一排有兩個五角形的格子，那是「大本營」。軍旗一定放在其中一個——這一局放在左邊。',
    mark: ['P0-r6c2'] },
  { text: '軍旗兩側各壓一顆地雷擋住通路。地雷不能移動，任何棋子撞上去都會陣亡。',
    mark: ['P0-r6c1', 'P0-r6c3'] },
  { text: '所以敵人要打進來，得先派工兵拆掉地雷——全場只有工兵拆得掉地雷。',
    foe: { from: 'P1-r1c1', to: 'P0-r6c1', piece: '工兵' } },
  { text: '雷被拆掉了，通往軍旗的路就開了。', remove: ['P0-r6c1'], foeAt: 'P0-r6c1' },
  { text: '接著任何一顆棋子碰到軍旗，這一家就全軍覆沒——所有棋子立刻從盤上消失。',
    foe: { from: 'P0-r6c1', to: 'P0-r6c2', piece: '工兵' }, win: true },
  { text: '要贏下整局，你和隊友必須拿下敵方「兩家」的軍旗。只扛掉一家不算贏。' },
];

export function buildFlagDemo() {
  const wrap = document.createElement('div');
  wrap.className = 'demo';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'demo-board');
  wrap.appendChild(svg);
  const view = createBoardView(svg, { onNodeClick: () => {}, onPointerUp: () => {} });
  view.setBottomSeat(0);
  // 完整四家的棋盤太大，塞進視窗只看得到別人家。把鏡頭拉近到自己的陣地——
  // 這裡要教的是「軍旗在大本營、地雷擋路」，鏡頭要對準那裡。
  (() => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [id, n] of BOARD.nodes) {
      if (n.seat !== 0) continue;
      const p2 = nodeXY(id);
      if (!p2) continue;
      const { x, y } = p2;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const pad = 40;
    svg.setAttribute('viewBox',
      `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`);
  })();

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

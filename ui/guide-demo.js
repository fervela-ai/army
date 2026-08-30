// 新手教學的主流程：一塊棋盤、一顆「下一步」，從空盤一路帶到「怎麼贏」。
//
// ⚠ 用的是**遊戲真正的棋盤元件**（createBoardView），不是另外手繪的示意圖——
// Lynch：「這不是我們的圖，我要真的我們的圖」「大本營形狀錯的」。
// 手繪版的大本營形狀跟實際盤面對不上，教錯了比不教更糟。
//
// ⚠ 為什麼是「一個流程」而不是「一段段圖文」（Lynch 2026-08-30）：
// 原本上面是動畫、下面是圖文，等於有兩種「下一步」——動畫的按鈕一種、捲頁一種。
// Lynch：「我以為沒有下面，我根本不知道要捲動」「有點亂」。
// 現在整個基本規則就是這一個流程，不需要捲動，也只有一顆按鈕。
//
// 順序也是 Lynch 定的：先棋盤 → 大本營 → 後兩排 → 邊佈陣邊講棋子 → 走子 → 怎麼贏。
// 理由是新手第一屏就看到扛旗動畫，根本還不知道棋盤長什麼樣。
import { createBoardView } from './board.js?v=123';
import { referenceLayout } from '../engine/ai/reference-layout.mjs?v=123';
import { legalMoves } from '../engine/src/rules.mjs?v=123';
import { BOARD } from '../engine/src/board.mjs?v=123';

const NS = 'http://www.w3.org/2000/svg';
const L0 = referenceLayout(0);

// 佈陣：一步放一組，前面放過的會留著
const SETUP = [
  ['P0-r6c2', 'P0-r6c4'],
  ['P0-r6c1', 'P0-r6c3', 'P0-r5c4'],
  ['P0-r5c1', 'P0-r1c4', 'P0-r1c1', 'P0-r3c5'],
  ['P0-r1c5', 'P0-r5c2', 'P0-r1c3', 'P0-r5c5', 'P0-r2c1', 'P0-r4c5'],
  ['P0-r2c5', 'P0-r3c4', 'P0-r6c5', 'P0-r4c3', 'P0-r5c3'],
  ['P0-r2c3', 'P0-r4c1'],
  ['P0-r1c2', 'P0-r3c1', 'P0-r3c2'],
];

// 走子示範：可走的點直接問引擎，不要自己列（列錯就是教錯）
const reachable = (node, piece) =>
  legalMoves({ at: new Map([[node, { seat: 0, piece }]]) }, node);

const seatTint = () => {
  const at = {};
  for (const [id, n] of BOARD.nodes) if (n.seat != null) at[id] = { seat: n.seat };
  return at;
};

const setupAt = (upto) => {
  const at = {};
  for (let k = 0; k < upto; k++) for (const id of SETUP[k]) at[id] = { seat: 0, piece: L0[id] };
  return at;
};

const solo = (node, piece) => ({ [node]: { seat: 0, piece } });

const STEPS = [
  { crop: 'full', at: seatTint,
    text: '這是棋盤，<b>四個角落各一家</b>。你是下方藍色那一家，'
        + '<b>坐你對面的是隊友</b>，左右兩家是敵人。行棋順序<b>逆時針</b>：你 → 右家 → 對家 → 左家。'
        + '你看不到隊友的棋，他也看不到你的。' },

  { crop: 'seat0', at: () => ({}),
    text: '把鏡頭拉近到<b>你自己的陣地</b>。<b>紅色圓圈是「行營」</b>，共五個，是安全區——'
        + '待在裡面的棋子誰都吃不到，<b>開局必須空著</b>。'
        + '<b>粗線是鐵路</b>（可以一次滑很多格），<b>細線是公路</b>（一次走一格）。' },

  { crop: 'seat0', at: () => solo('P0-r6c4', '司令'), moves: ['P0-r6c4'],
    text: '最下面那排有兩個<b>五角形</b>的格子，叫「大本營」。先放一顆司令進去看看——'
        + '任何棋子只要進了大本營就<b>再也不能移動</b>，這顆司令從此動不了，白白少一顆最大的子。' },

  { crop: 'seat0', at: () => setupAt(1), moves: SETUP[0],
    text: '所以大本營是放<b>軍旗</b>的地方。軍旗一定在兩個大本營其中一個，'
        + '另一個通常放最不值錢的棋子（這裡是排長）。<b>軍旗被敵人碰到，你整家就出局。</b>' },

  { crop: 'seat0', at: () => setupAt(2), moves: SETUP[1],
    text: '<b>地雷只能放在最後兩排。</b>它不能移動，任何「軍人」撞上去都會陣亡——'
        + '全場<b>只有工兵拆得掉</b>。這一局兩顆貼著軍旗、一顆擺遠一點。' },

  { crop: 'seat0', at: () => setupAt(3), moves: SETUP[2],
    text: '接下來是軍人，從最大的開始：<b>司令</b>最大，然後<b>軍長</b>、<b>師長</b>。' },

  { crop: 'seat0', at: () => setupAt(4), moves: SETUP[3],
    text: '再來<b>旅長</b>、<b>團長</b>、<b>營長</b>。' },

  { crop: 'seat0', at: () => setupAt(5), moves: SETUP[4],
    text: '最後<b>連長</b>、<b>排長</b>。完整順序：'
        + '司令＞軍長＞師長＞旅長＞團長＞營長＞連長＞排長＞工兵。'
        + '<b>大的吃小的，一樣大就同歸於盡。</b>' },

  { crop: 'seat0', at: () => setupAt(6), moves: SETUP[5],
    text: '<b>炸彈</b>不算軍人：碰到誰都同歸於盡，<b>連司令也一起帶走</b>。'
        + '唯一的限制是不能放在第一排。' },

  { crop: 'seat0', at: () => setupAt(7), moves: SETUP[6],
    text: '<b>工兵</b>最小，但它有兩件別人做不到的事：<b>唯一能拆地雷</b>，'
        + '而且<b>唯一能在鐵路上任意轉彎</b>。所以工兵是進攻軍旗的關鍵棋子。' },

  { crop: 'seat0', at: () => setupAt(7),
    text: '25 顆佈完了。接下來看<b>怎麼走</b>。' },

  { crop: 'fit', at: () => solo('P0-r2c3', '連長'), movesOf: ['P0-r2c3', '連長'],
    text: '<b>公路（細線）：一次只能走一格。</b>綠點就是這顆連長走得到的地方。' },

  { crop: 'fit', at: () => solo('P0-r5c1', '團長'), movesOf: ['P0-r5c1', '團長'],
    text: '<b>鐵路（粗線）：可以沿著同一條直線滑很多格</b>，中間不能有任何棋子擋著（自己的也不行）。'
        + '鐵路是四家共用的，<b>你可以一路滑到別人家</b>。'
        + '但<b>一般棋子在鐵路上不能轉彎</b>——所以綠點幾乎都排在同一條直線上，'
        + '只有旁邊那兩三個是走公路的一格。' },

  { crop: 'fit', at: () => solo('P0-r5c1', '工兵'), movesOf: ['P0-r5c1', '工兵'],
    text: '同一格換成<b>工兵</b>：它<b>可以任意轉彎</b>，能到的地方一下子多了三倍。'
        + '代價是——<b>只要它轉了彎，全場都知道那顆是工兵</b>。這是這個遊戲最重要的資訊之一。' },

  { crop: 'seat0', at: () => setupAt(7),
    text: '知道怎麼走了，最後看<b>怎麼贏</b>：拿下敵方的軍旗。' },

  { crop: 'seat0', at: () => setupAt(7),
    foe: { from: 'P1-r1c1', to: 'P0-r6c1' },
    text: '敵人要打進來，得先派<b>工兵</b>拆掉地雷——全場只有工兵拆得掉。' },

  { crop: 'seat0', at: () => { const a = setupAt(7); delete a['P0-r6c1']; return a; }, foeAt: 'P0-r6c1',
    text: '雷被拆掉了，<b>通往軍旗的路就開了</b>。' },

  { crop: 'seat0', at: () => { const a = setupAt(7); delete a['P0-r6c1']; return a; },
    foe: { from: 'P0-r6c1', to: 'P0-r6c2' }, win: true,
    text: '接著<b>任何一顆棋子碰到軍旗</b>，這一家就出局了。' },

  { crop: 'seat0', at: () => ({}), win: true,
    text: '出局的那一家，<b>棋子全部從盤上拿走</b>——連還沒被吃到的大子和地雷都一起消失。'
        + '所以扛旗不只是贏一顆棋，是一次清掉對方整家。' },

  { crop: 'full', at: seatTint,
    text: '要贏下整局，你和隊友必須拿下敵方<b>兩家</b>的軍旗。只扛掉一家不算贏。'
        + '<br>看完了——按「開始玩」就可以下第一局。' },
];

// 鏡頭裁切：點位的 .node-hit 方框帶著棋盤使用者座標的 x/y/w/h，直接拿來算就好——
// 同步、不必等 requestAnimationFrame，也不必把螢幕座標換算回 viewBox。
// （量畫面的版本寫過：連按太快時上一步排的裁切會蓋掉這一步，而且量到的時機不對就整個歪掉。）
function cropTo(svg, full, ids) {
  if (!ids) { svg.setAttribute('viewBox', full); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const id of ids) {
    const n = svg.querySelector(`rect.node-hit[data-node="${id}"]`);
    if (!n) continue;
    const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + Number(n.getAttribute('width')));
    y1 = Math.max(y1, y + Number(n.getAttribute('height')));
  }
  if (x0 > x1) { svg.setAttribute('viewBox', full); return; }
  const pad = 34;
  svg.setAttribute('viewBox', `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`);
}

const SEAT0_IDS = [...BOARD.nodes.keys()].filter(id => id.startsWith('P0-'));

// 指到正中央那個行營，不要指邊上的：邊上的旁邊還有別的紅圈，第一次看的人分不出在指哪一顆。
const LABELS = [['P0-r3c3', '行營', -36], ['P0-r6c2', '大本營', 46], ['P0-r6c4', '大本營', 46]];

// 標籤畫在圖上，不要只寫在文字裡：使用者回饋「我找不到綠色點點跟五角型」、
// 「大本營的位置大家不夠清楚」——靠圖例去配對，第一次看的人根本對不起來。
// 位置取自點位 .node-hit 方框的 x/y（棋盤使用者座標），同步算得出來，不必量畫面。
function addLabels(svg) {
  for (const [id, text, dy] of LABELS) {
    const n = svg.querySelector(`rect.node-hit[data-node="${id}"]`);
    if (!n) continue;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', Number(n.getAttribute('x')) + Number(n.getAttribute('width')) / 2);
    t.setAttribute('y', Number(n.getAttribute('y')) + Number(n.getAttribute('height')) / 2 + dy);
    t.setAttribute('class', 'g-label');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = text;
    svg.appendChild(t);
  }
}

export function buildBasicsTour() {
  const wrap = document.createElement('div');
  wrap.className = 'demo';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'demo-board');
  wrap.appendChild(svg);
  const view = createBoardView(svg, { onNodeClick: () => {}, onPointerUp: () => {} });
  view.setBottomSeat(0);
  const FULL = svg.getAttribute('viewBox');

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
    const s = STEPS[i];
    const at = s.at();
    if (s.foeAt) at[s.foeAt] = { seat: 1 };              // 敵子蓋著，跟實戰一樣看不到身分
    const board = { at, turn: 0, revealedFlags: [] };
    const marks = s.movesOf ? reachable(s.movesOf[0], s.movesOf[1]) : (s.moves ?? []);

    if (s.foe) {
      const { from, to } = s.foe;
      at[from] = { seat: 1 };
      delete at[to];
      view.render({ board, mySeats: [0], viewerSeat: 0, hide: [from] });
      busy = true; next.disabled = prev.disabled = true;
      await view.animateMove({ from, to, seat: 1, outcome: 'defenderDead', piece: null, path: [from, to] });
      busy = false; next.disabled = false;
      delete at[from];
      at[to] = { seat: 1 };
      if (s.win) delete at['P0-r6c2'];
      view.render({ board, mySeats: [0], viewerSeat: 0, lastMove: { from, to, seat: 1 } });
    } else {
      view.render({ board, mySeats: [0], viewerSeat: 0, selected: null, moves: marks });
    }

    // 上一步的標籤要清掉，否則會累積，而且換成整盤視角時位置全錯
    for (const t of svg.querySelectorAll('.g-label')) t.remove();
    if (s.crop === 'seat0') { cropTo(svg, FULL, SEAT0_IDS); addLabels(svg); }
    else if (s.crop === 'fit') cropTo(svg, FULL, [s.movesOf[0], ...marks]);
    else cropTo(svg, FULL, null);

    svg.classList.toggle('is-win', !!s.win);
    caption.innerHTML = s.text;
    dots.textContent = `${i + 1} / ${STEPS.length}`;
    prev.disabled = i === 0;
    next.textContent = i === STEPS.length - 1 ? '再看一次' : '下一步 ›';
  };
  prev.addEventListener('click', () => { if (!busy && i > 0) { i--; draw(); } });
  next.addEventListener('click', () => { if (busy) return; i = i === STEPS.length - 1 ? 0 : i + 1; draw(); });
  draw();
  return wrap;
}

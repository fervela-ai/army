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
import { createBoardView } from './board.js?v=147';
import { referenceLayout } from '../engine/ai/reference-layout.mjs?v=147';
import { legalMoves, movePath } from '../engine/src/rules.mjs?v=147';
import { BOARD } from '../engine/src/board.mjs?v=147';

const NS = 'http://www.w3.org/2000/svg';
const L0 = referenceLayout(0);

// 佈陣：一步放一組，前面放過的會留著
const SETUP = [
  ['P0-r6c2'],                                                    // 軍旗
  ['P0-r6c4'],                                                    // 另一個大本營放最便宜的
  ['P0-r6c1', 'P0-r6c3', 'P0-r5c4'],                              // 地雷
  ['P0-r5c1', 'P0-r1c4', 'P0-r1c1', 'P0-r3c5'],                   // 司令、軍長、師長
  ['P0-r1c5', 'P0-r5c2', 'P0-r1c3', 'P0-r5c5', 'P0-r2c1', 'P0-r4c5'],
  ['P0-r2c5', 'P0-r3c4', 'P0-r6c5', 'P0-r4c3', 'P0-r5c3'],
  ['P0-r2c3', 'P0-r4c1'],                                         // 炸彈
  ['P0-r1c2', 'P0-r3c1', 'P0-r3c2'],                              // 工兵
];
const ALL = SETUP.length;

// 走子示範：可走的點直接問引擎，不要自己列（列錯就是教錯）
const reachable = (node, piece) =>
  legalMoves({ at: new Map([[node, { seat: 0, piece }]]) }, node);

const seatTint = (seats = [0, 1, 2, 3]) => {
  const at = {};
  for (const [id, n] of BOARD.nodes) if (n.seat != null && seats.includes(n.seat)) at[id] = { seat: n.seat };
  return at;
};

const setupAt = (upto) => {
  const at = {};
  for (let k = 0; k < upto; k++) for (const id of SETUP[k]) at[id] = { seat: 0, piece: L0[id] };
  return at;
};

const solo = (node, piece) => ({ [node]: { seat: 0, piece } });

// 動畫要走**真實路線**，不能給「起點→終點」兩個點——那會畫成一條穿過棋盤的斜線，
// 跟實際走法完全不一樣（Lynch：「不要綠色直線，可以做成工兵真實路線嗎？」）。
// movePath 就是遊戲裡在用的那一套，逐格、會轉彎、會順著鐵路的圓角滑。
const realPath = (at, from, to, piece, seat) => {
  const m = new Map(Object.entries(at));
  m.set(from, { seat, piece });
  try { return movePath({ at: m }, from, to) ?? [from, to]; } catch { return [from, to]; }
};

// 「怎麼贏」那幾步要用**殘局**，不能用剛佈好的滿盤 25 顆——
// Lynch：「這張圖超怪，要就應該弄個殘局。左邊的子拿掉多一點，搞得像真的殘局的樣子。」
// 滿盤時敵方工兵根本走不到你家門口，那張圖本身就在教錯的東西。
//
// 護旗用**三角雷**（軍旗正上、左、右各一顆），因為那是實戰最常見的護旗法，
// 也是 Lynch 指定要示範的：敵方工兵拆掉**最上面那顆**，就正好站到軍旗旁邊。
const ENDGAME = {
  'P0-r6c2': '軍旗',
  'P0-r5c2': '地雷', 'P0-r6c1': '地雷', 'P0-r6c3': '地雷',
  'P0-r6c4': '排長', 'P0-r6c5': '連長',
  'P0-r1c3': '團長', 'P0-r2c1': '營長',
};
const endgame = (drop = []) => {
  const at = {};
  for (const [id, piece] of Object.entries(ENDGAME)) if (!drop.includes(id)) at[id] = { seat: 0, piece };
  return at;
};

const STEPS = [
  { crop: 'full', at: seatTint,
    text: '這是棋盤，<b>四個角落各一家</b>。你是下方藍色那一家，'
        + '<b>坐你對面的是隊友</b>，左右兩家是敵人。行棋順序<b>逆時針</b>：你 → 右家 → 對家 → 左家。'
        + '你看不到隊友的棋，他也看不到你的。' },

  { crop: 'seat0', at: () => ({}), labels: ['行營', '大本營'],
    text: '把鏡頭拉近到<b>你自己的陣地</b>。<b>紅色圓圈是「行營」</b>，共五個，是安全區——'
        + '待在裡面的棋子誰都吃不到，<b>開局必須空著</b>。'
        + '<b>粗線是鐵路</b>（可以一次滑很多格），<b>細線是公路</b>（一次走一格）。' },

  // 大本營的講法順序是 Lynch 指定的：先講軍旗放這裡 → 這就是勝負條件 → 最後才講進去不能出來。
  // 先講「進去不能動」的話，聽的人還不知道大本營是幹嘛的。
  { crop: 'seat0', at: () => setupAt(1), labels: ['大本營'],
    text: '最下面那排有兩個<b>五角形</b>的格子，叫「大本營」。<b>你的軍旗一定放在其中一個</b>——'
        + '這一局放在左邊那個。' },

  { crop: 'seat0', at: () => setupAt(1), labels: ['大本營'],
    text: '<b>這就是整局的勝負條件</b>：敵人只要有<b>任何一顆</b>棋子碰到你的軍旗，你整家就出局；'
        + '反過來，你和隊友拿下<b>敵方兩家</b>的軍旗，就贏下整局。' },

  { crop: 'seat0', at: () => { const a = setupAt(1); a['P0-r6c4'] = { seat: 0, piece: '司令' }; return a; }, labels: ['大本營'],
    text: '另一個大本營要放什麼？先放一顆<b>司令</b>進去看看——'
        + '<b>任何棋子只要進了大本營，就再也不能移動</b>，這顆司令從此動不了。' },

  { crop: 'seat0', at: () => setupAt(2),
    text: '所以另一個大本營要放<b>最不值錢的棋子</b>，這一局放排長。'
        + '同樣的道理，打仗的時候也<b>不要把自己的大子走進大本營</b>——進去就等於報廢。' },

  { crop: 'seat0', at: () => setupAt(3),
    text: '<b>地雷只能放在最後兩排。</b>它不能移動，任何「軍人」撞上去都會陣亡——'
        + '全場<b>只有工兵拆得掉</b>。這一局兩顆貼著軍旗、一顆擺遠一點。' },

  { crop: 'seat0', at: () => setupAt(4),
    text: '接下來是軍人，從最大的開始：<b>司令</b>最大，然後<b>軍長</b>、<b>師長</b>。' },

  { crop: 'seat0', at: () => setupAt(5),
    text: '再來<b>旅長</b>、<b>團長</b>、<b>營長</b>。' },

  { crop: 'seat0', at: () => setupAt(6),
    text: '最後<b>連長</b>、<b>排長</b>。完整順序：'
        + '司令＞軍長＞師長＞旅長＞團長＞營長＞連長＞排長＞工兵。'
        + '<b>大的吃小的，一樣大就同歸於盡。</b>' },

  { crop: 'seat0', at: () => setupAt(7),
    text: '<b>炸彈</b>不算軍人：碰到誰都同歸於盡，<b>連司令也一起帶走</b>。'
        + '唯一的限制是不能放在第一排。' },

  { crop: 'seat0', at: () => setupAt(ALL),
    text: '<b>工兵</b>最小，但它有兩件別人做不到的事：<b>唯一能拆地雷</b>，'
        + '而且<b>唯一能在鐵路上任意轉彎</b>。所以工兵是進攻軍旗的關鍵棋子。' },

  { crop: 'seat0', at: () => setupAt(ALL),
    text: '25 顆佈完了。接下來看<b>怎麼走</b>。' },

  { crop: 'fit', at: () => solo('P0-r2c3', '連長'), movesOf: ['P0-r2c3', '連長'],
    text: '<b>公路（細線）：一次只能走一格。</b>框起來的格子就是這顆連長走得到的地方。' },

  { crop: 'fit', at: () => solo('P0-r5c1', '團長'), movesOf: ['P0-r5c1', '團長'],
    text: '<b>鐵路（粗線）：可以沿著同一條直線滑很多格</b>，中間不能有任何棋子擋著（自己的也不行）。'
        + '鐵路是四家共用的，<b>你可以一路滑到別人家</b>。'
        + '但<b>一般棋子在鐵路上不能轉彎</b>——所以框起來的格子幾乎都排在同一條直線上，'
        + '只有旁邊那兩三個是走公路的一格。' },

  // 工兵這一步不要畫「它能到的 74 個點」——整盤都被框起來，反而什麼都沒說。
  // 直接走一條**轉兩次彎**的路線，一般棋子做不到，一眼就懂差在哪。
  { crop: 'full', at: () => solo('P0-r5c1', '工兵'),
    walk: { from: 'P0-r5c1', to: 'P1-r5c1', piece: '工兵' },
    text: '同一格換成<b>工兵</b>：它可以<b>任意轉彎</b>，像這樣穿過中央九宮、轉兩次彎跑到右家去——'
        + '<b>一般棋子做不到</b>，只能直直走。'
        + '代價是：<b>只要它轉了彎，全場都知道那顆是工兵</b>。這是這個遊戲最重要的資訊之一。' },

  { crop: 'seat0', at: () => endgame(),
    text: '最後看一遍<b>敵人是怎麼打進來的</b>。這是打了一陣子之後的<b>殘局</b>——'
        + '你的子剩沒幾顆了，軍旗還靠<b>三角雷</b>護著——正上方、左邊、右邊各一顆。' },

  { crop: 'seat0', at: () => endgame(),
    foe: { from: 'P1-r1c1', to: 'P0-r5c2', piece: '工兵' },
    text: '敵人要打進來，得先拆雷，而<b>全場只有工兵拆得掉地雷</b>。'
        + '他派工兵來挖<b>軍旗正上方</b>那一顆。' },

  { crop: 'seat0', at: () => endgame(['P0-r5c2']), foeAt: 'P0-r5c2',
    text: '<b>地雷沒了，工兵還活著</b>，就站在原本那顆雷的位置上——'
        + '三角雷缺了一角，而且他現在<b>正好貼著你的軍旗</b>。' },

  // 吃到軍旗之後不要停在「旗沒了、其他子還在」那一格畫面——實戰不存在那個狀態，
  // Lynch：「實戰根本不會有這張圖，這只會讓人混亂。吃掉後直接就下一張了。」
  { crop: 'seat0', at: () => endgame(['P0-r5c2']),
    foe: { from: 'P0-r5c2', to: 'P0-r6c2', piece: '工兵' }, win: true, wipeAfter: true,
    text: '下一步他直接走上去。<b>任何一顆棋子碰到軍旗，這一家就出局</b>——'
        + '棋子<b>全部從盤上拿走</b>，連還沒被吃到的大子和地雷都一起消失。'
        + '所以扛旗不只是贏一顆棋，是一次清掉對方整家。' },

  // 直接畫出「贏了長什麼樣」：左右兩家整片消失，只剩你和隊友。
  // 只放一張四色棋盤講「要拿兩家」，看的人不會馬上抓到訴求（Lynch 回饋）。
  { crop: 'full', at: () => seatTint([0, 2]),
    text: '這就是贏的樣子：<b>左右兩家的軍旗都被拿下，整片從盤上消失</b>。'
        + '你和隊友必須<b>兩家都扛掉</b>才算贏，只扛一家不算。'
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

// 字要**壓在形狀本身上**，不能放在旁邊的空格——Lynch：「行營標示在這，會讓人以為文字的地方是行營」。
// 只標其中一個，另外幾個留著不擋，形狀本身才看得到（數量寫在說明文字裡）。
// 標註一律是「另一個顏色的大方框」＋方框上方的色塊文字（Lynch 指定）：
// 小藍點、藍圈圈都不行——綠圈疊在棋子上會變成一坨（「司令那一坨這麼亂」），
// 而字直接寫在盤面上會跟鐵路線疊在一起。色塊有底色，線就不會穿過字。
// 標註只出現在正在講它的那一步，講完就收掉——一路留著會疊到後面放上去的棋子
// （Lynch：「行營兩個字早就可以拿掉了，這樣都疊在一起了」）。
const LABELS = {
  行營: ['P0-r3c3'],
  大本營: ['P0-r6c4', 'P0-r6c2'],
};

const nodeBox = (svg, id) => {
  const n = svg.querySelector(`rect.node-hit[data-node="${id}"]`);
  if (!n) return null;
  const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
  const w = Number(n.getAttribute('width')), h = Number(n.getAttribute('height'));
  return { x, y, w, h, cx: x + w / 2 };
};

const svgEl = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

// 方框：畫在最外層，蓋過棋子與線
function annotate(svg, ids, text = null) {
  const boxes = ids.map(id => nodeBox(svg, id)).filter(Boolean);
  // 框要畫在格子**內側**：點位是連續鋪滿的（欄距等於格寬，中間沒有空隙），
  // 往外撐一定會壓到隔壁那格（Lynch：「框框有點大，壓到了」）。
  for (const b of boxes) {
    svg.appendChild(svgEl('rect', { class: 'g-mark', x: b.x + 3, y: b.y + 3,
      width: b.w - 6, height: b.h - 6, rx: 7 }));
  }
  if (!text || !boxes.length) return;
  const b = boxes[0];
  const w = text.length * 13 + 14, h = 20;
  const top = b.y - h - 3;
  svg.appendChild(svgEl('rect', { class: 'g-chip', x: b.cx - w / 2, y: top, width: w, height: h, rx: 6 }));
  const t = svgEl('text', { class: 'g-chip-text', x: b.cx, y: top + h - 6, 'text-anchor': 'middle' });
  t.textContent = text;
  svg.appendChild(t);
}

// 有棋子的大本營就不標——字壓在棋子上就看不懂了；兩個大本營哪個還空著就標哪個。
function addLabels(svg, at, names) {
  for (const name of names) {
    const id = (LABELS[name] ?? []).find(x => !at[x]);
    if (id) annotate(svg, [id], name);
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
    // 說明文字先換，動畫後播：不然動畫在跑的時候，畫面上還是上一步的字，
    // 看的人不知道自己正在看什麼。
    caption.innerHTML = s.text;
    dots.textContent = `${i + 1} / ${STEPS.length}`;
    next.textContent = i === STEPS.length - 1 ? '再看一次' : '下一步 ›';
    const at = s.at();
    if (s.foeAt) at[s.foeAt] = { seat: 1 };              // 敵子蓋著，跟實戰一樣看不到身分
    const board = { at, turn: 0, revealedFlags: [] };
    const marks = s.movesOf ? reachable(s.movesOf[0], s.movesOf[1]) : (s.moves ?? []);

    if (s.walk) {
      // 自己的棋子走一段真實路線（路徑由引擎算，動畫跟實戰同一套）
      const { from, to, piece } = s.walk;
      view.render({ board, mySeats: [0], viewerSeat: 0 });
      cropTo(svg, FULL, null);
      busy = true; next.disabled = prev.disabled = true;
      await view.animateMove({ from, to, seat: 0, outcome: null, piece,
        path: realPath(at, from, to, piece, 0) });
      busy = false;
      delete at[from];
      at[to] = { seat: 0, piece };
      // 不畫「上一手」指示線：那是起點連終點的直線，轉彎路線上看起來像穿牆
      view.render({ board, mySeats: [0], viewerSeat: 0 });
    } else if (s.foe) {
      const { from, to } = s.foe;
      at[from] = { seat: 1 };
      // 目標格的棋子要留到動畫結束才拿掉。先刪的話，地雷在工兵還沒走到就消失了
      // （Lynch：「第18步，工兵還沒走到地雷就先消失了」）。
      view.render({ board, mySeats: [0], viewerSeat: 0, hide: [from] });
      busy = true; next.disabled = prev.disabled = true;
      await view.animateMove({ from, to, seat: 1, outcome: 'defenderDead', piece: null,
        path: realPath(at, from, to, s.foe.piece ?? '工兵', 1) });
      busy = false; next.disabled = false;
      delete at[from];
      delete at[to];                                   // 這時候才吃掉（地雷／軍旗）
      if (s.wipeAfter) for (const id of Object.keys(at)) if (id.startsWith('P0-')) delete at[id];
      at[to] = { seat: 1 };
      view.render({ board, mySeats: [0], viewerSeat: 0, lastMove: { from, to, seat: 1 } });
    } else {
      view.render({ board, mySeats: [0], viewerSeat: 0, selected: null });
    }

    // 上一步的標籤要清掉，否則會累積，而且換成整盤視角時位置全錯
    for (const t of svg.querySelectorAll('.g-mark, .g-chip, .g-chip-text')) t.remove();
    if (s.crop === 'seat0') { cropTo(svg, FULL, SEAT0_IDS); addLabels(svg, at, s.labels ?? []); }
    else if (s.crop === 'fit') {
      cropTo(svg, FULL, [s.movesOf[0], ...marks]);
      annotate(svg, marks);                     // 可走的點也用方框，不用小藍點
    } else cropTo(svg, FULL, null);
    for (const [ids, text] of s.notes ?? []) annotate(svg, ids, text);

    svg.classList.toggle('is-win', !!s.win);
    // 兩顆按鈕的狀態統一在這裡收尾。動畫途中會暫時停用，如果只在某一個分支裡解鎖，
    // 漏掉的那個分支就會讓「下一步」永遠按不下去（工兵走子那一步實際發生過）。
    prev.disabled = i === 0;
    next.disabled = false;
  };
  prev.addEventListener('click', () => { if (!busy && i > 0) { i--; draw(); } });
  next.addEventListener('click', () => { if (busy) return; i = i === STEPS.length - 1 ? 0 : i + 1; draw(); });
  draw();
  return wrap;
}

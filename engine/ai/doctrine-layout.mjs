// 產生佈陣：**四種各自完整的風格，每局隨機挑一種**。
//
// Lynch 的指正（2026-08-29）：「四國軍棋的樂趣就在於沒有所謂最好，實戰都是心理戰，
// 要讓對手猜不透。」三角雷、師長→工兵→炸彈、司令不站第一排都只是「其中一種」。
//
// ⚠ 但「多樣」不等於「隨機」：我曾把佈陣改成幾乎完全隨機，勝率立刻掉到 11%。
// 正解是**準備幾套各自成立的路數**，像真人有自己的幾套慣用陣型——
// 每一套內部都有章法，套與套之間差異夠大，對手才猜不透。
class Retry extends Error {}

import { BOARD } from '../src/board.mjs';
import { PIECES, validateSetup } from '../src/rules.mjs';

const isCamp = (r, c) => BOARD.nodes.get(`P0-r${r}c${c}`).kind === 'camp';

function makeBoard(seat, rnd) {
  const layout = {};
  const used = new Set();
  const put = (r, c, piece) => {
    if (c < 1 || c > 5 || r < 1 || r > 6) return false;
    const id = `P${seat}-r${r}c${c}`;
    if (used.has(id) || isCamp(r, c)) return false;
    layout[id] = piece; used.add(id); return true;
  };
  const free = () => {
    const out = [];
    for (let r = 1; r <= 6; r++) for (let c = 1; c <= 5; c++)
      if (!isCamp(r, c) && !used.has(`P${seat}-r${r}c${c}`)) out.push({ r, c });
    return out;
  };
  const remaining = () => {
    const out = [];
    for (const [name, def] of Object.entries(PIECES)) {
      const already = Object.values(layout).filter(p => p === name).length;
      for (let i = 0; i < def.count - already; i++) out.push(name);
    }
    return out;
  };
  // 把剩下的棋子填完：depth 決定大子偏前還是偏後（每套風格自己決定）
  const fillRest = (bigForward) => {
    const rank = (p) => PIECES[p].rank ?? 0;
    const rest = remaining().sort((a, b) => (rank(b) - rank(a)) * (bigForward ? 1 : -1) + (rnd() - 0.5) * 2);
    const slots = free().sort((a, b) => (a.r - b.r) + (rnd() - 0.5) * 0.8);
    if (rest.length !== slots.length) return false;
    rest.forEach((p, i) => put(slots[i].r, slots[i].c, p));
    return true;
  };
  // 結構性擺放用 must()：放不下就中止這次嘗試重來。
  // 用 put() 靜默失敗過——風格想把司令放側翼，位置被地雷佔走，司令就被隨手填到第一排，
  // 整個風格等於沒實現（實測勝率 0.4%）。
  const must = (r, c, piece) => { if (!put(r, c, piece)) throw new Retry(); };

  // 軍旗旁邊一定要有東西擋。三角雷只是其中一種擺法，但「軍旗裸奔」不是風格，是漏洞：
  // 敵人用小兵換掉旁邊的炸彈，下一步就直接取旗（實測這種陣型勝率 0.4%）。
  const guardFlag = (flagCol) => {
    const around = [[6, flagCol - 1], [6, flagCol + 1], [5, flagCol]]
      .filter(([r, c]) => c >= 1 && c <= 5 && !isCamp(r, c));
    let placed = 0;
    for (const [r, c] of around) if (placed < 3 && put(r, c, '地雷')) placed++;
    return placed;
  };

  // 另一個大本營一定要先放便宜的棋子。大本營的棋子永遠不能移動，
  // 讓填充程式隨手把司令或工兵塞進去，等於開局就少一顆關鍵棋（實測勝率掉到 0.4%）。
  const reserveSpareHQ = (flagCol) => put(6, flagCol === 2 ? 4 : 2, '排長');

  return { layout, put, must, free, fillRest, reserveSpareHQ, guardFlag };
}

// ── 四種風格 ──────────────────────────────────────────────
// 每一套都完整：軍旗、地雷、炸彈、工兵各有安排，差別在「章法」不同。

const STYLES = [
  // 1. 三角雷護旗 + 大子前壓：正面硬碰，靠前排大子換掉對方主力
  function triangleRush(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc); b.guardFlag(fc);
    b.must(5, 1, '工兵'); b.must(5, 5, '工兵');
    b.must(4, 1, '炸彈'); b.must(4, 5, '炸彈');
    return b.fillRest(true) ? b.layout : null;
  },
  // 2. 一字雷 + 前排小兵屏障：大子縮在二三排，用小兵探路，反擊型
  function lineGuard(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc); b.guardFlag(fc);
    b.must(1, 1, '排長'); b.must(1, 5, '排長'); b.must(1, 3, '連長');   // 前排小兵當屏障
    b.must(3, 2, '炸彈'); b.must(4, 3, '工兵');
    return b.fillRest(true) ? b.layout : null;
  },
  // 3. 側翼司令（Lynch 的路數）：司令縮在側邊鐵路底端，隨時能沿縱列一口氣飛上前線
  function flankCommander(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc); b.guardFlag(fc);
    const side = rnd() < 0.5 ? 1 : 5;
    b.must(5, side, '司令');      // 司令縮在側邊鐵路底端，隨時能沿縱列飛上前線
    b.must(4, side, '炸彈');
    b.must(3, side, '工兵');
    b.must(1, 3, '軍長');
    return b.fillRest(true) ? b.layout : null;
  },
  // 4. 炸彈前置：把炸彈放在前兩排當陷阱，專炸衝進來的大子
  function bombTrap(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc); b.guardFlag(fc);
    b.must(2, 1, '炸彈'); b.must(2, 5, '炸彈');   // 炸彈前置當陷阱
    b.must(1, 1, '師長'); b.must(1, 5, '師長');
    b.must(5, 1, '工兵'); b.must(5, 5, '工兵');
    return b.fillRest(true) ? b.layout : null;
  },
];

export const LAYOUT_STYLES = STYLES.map(f => f.name);

// 目前輪替使用的風格。側翼司令（index 2）暫時不用——那套需要「等時機一口氣飛上前線」
// 的戰術，AI 還不會，硬用只會把自己的側邊鐵路堵死（實測勝率 4.9%）。
// 等 sim/tune-layout.mjs 調出能駕馭它的權重再放回來。
const ACTIVE = [0, 1, 3];

export function doctrineLayout(seat, rnd = Math.random, styleIndex = null) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const style = STYLES[styleIndex ?? ACTIVE[Math.floor(rnd() * ACTIVE.length)]];
    const fc = rnd() < 0.5 ? 2 : 4;
    let layout = null;
    try { layout = style(seat, rnd, fc); } catch (e) { if (!(e instanceof Retry)) throw e; }
    if (layout && validateSetup(seat, layout).ok) return layout;
  }
  throw new Error('產生佈陣失敗');
}

// 第二層：往前看一步的風險評估。
// 一步評分 AI 最大的破綻是「只看我這步吃到什麼，不看走完之後對方能吃掉我什麼」。
// 這支模組回答：把棋子放到某格，下一手被幹掉的機率有多高、賠多少。
import { TEAM_OF } from '../src/board.mjs';
import { BOARD } from '../src/board.mjs';
import { PIECES, legalMoves } from '../src/rules.mjs';

// 棋子的身價。軍旗無價（被扛就輸），地雷不可移動但很值錢（它擋住整條路）。
// 量測用開關：VALUES=old 可以切回舊表，做 A/B 才有對照組。
const OLD_VALUES = (globalThis.process?.env?.VALUES ?? '') === 'old';

// 身價表。兩處是 Lynch 指正的：
//   炸彈要大於師長——炸彈能換掉司令軍長，一顆師長換不到那個。
//   工兵一開始就比團長重要——全隊只有三顆，而且是唯一能拆地雷的。
export const VALUE = OLD_VALUES ? {
  司令: 100, 軍長: 70, 師長: 45, 旅長: 32, 團長: 24, 營長: 18,
  連長: 12, 排長: 8, 工兵: 20, 地雷: 30, 炸彈: 40, 軍旗: 1000,
} : {
  司令: 100, 軍長: 70, 師長: 45, 旅長: 32, 團長: 24, 營長: 18,
  連長: 12, 排長: 8, 工兵: 28,        // 開局就贏過團長
  地雷: 30, 炸彈: 52, 軍旗: 1000,     // 炸彈壓過師長
};

// 場上「還能動」的棋子裡，比我大的比例是多少。
// 地雷與軍旗不會移動，所以會主動來吃我的一定不是它們——這個推論本身就很有價值。
const MOVABLE = Object.entries(PIECES).filter(([n, d]) => d.movable && n !== '軍旗');
const MOVABLE_TOTAL = MOVABLE.reduce((n, [, d]) => n + d.count, 0);   // 21

// 工兵的身價不是固定的，而是「越少越貴」。
// 三顆的時候死一顆就是損失一顆；最後一顆死掉損失的不是一顆棋，是整局——
// 從那一刻起，藏在地雷後面的軍旗永遠拿不到，那局只能走向和局。
// 量出來的病因就是這個：98% 的和局裡至少一隊工兵全滅（sim/why-draw.mjs）。
// 只數「自己這一家」的工兵：隊友的身分在暗棋裡本來就看不到，不能拿來算。
// 量測用開關：ENG_SCARCITY=0 可以把「越少越貴」關掉，做 A/B 才有對照組。
const SCARCITY = (globalThis.process?.env?.ENG_SCARCITY ?? '1') !== '0';

export function engineerValue(game, seat) {
  if (!SCARCITY) return VALUE.工兵;
  let alive = 0;
  for (const [, o] of game.at) if (o.seat === seat && o.piece === '工兵') alive++;
  const base = VALUE.工兵;
  return alive >= 3 ? base : alive === 2 ? base * 1.4 : alive === 1 ? base * 3.2 : base;
}

// 要算「我這顆賠掉值多少」一律走這裡，別直接讀 VALUE——工兵是動態的。
export function valueOf(game, seat, piece) {
  return piece === '工兵' ? engineerValue(game, seat) : (VALUE[piece] ?? 10);
}

export function pLoseAgainstUnknown(myPiece) {
  const myRank = PIECES[myPiece].rank;
  if (myPiece === '炸彈') return 1;                    // 炸彈碰誰都同歸於盡
  let lose = 0;
  for (const [name, def] of MOVABLE) {
    if (name === '炸彈') { lose += def.count; continue; }        // 對面是炸彈 → 我死
    if (name === '工兵') continue;                                // 工兵吃不掉任何能動的子
    if (def.rank > myRank) lose += def.count;
    else if (def.rank === myRank) lose += def.count * 0.5;        // 同階同歸於盡，算半條命
  }
  return lose / MOVABLE_TOTAL;
}

// 敵方下一手構得到的所有格子。算一次給整輪用，不要每個候選走法都重算。
// 這顆敵方棋子「有沒有可能會動」——只准用公開資訊判斷。
//
// 原本直接查 PIECES[o.piece].movable，但那是**偷看**：movable 只有地雷和軍旗是 false，
// 等於 AI 免費知道哪些敵子是地雷。真人得自己提心吊膽，AI 不該有這個特權。
// 公開可知的不能動只有兩種：大本營裡的棋子（規則明訂只進不出，格子位置公開），
// 以及已經顯露的軍旗。其餘一律當成「可能會動」。
export function mightMove(game, id, o) {
  if (BOARD.nodes.get(id)?.kind === 'hq') return false;        // 大本營裡的棋子不能再動
  if (game.revealedFlags?.has(o.seat) && o.piece === '軍旗') return false;  // 已公開的軍旗
  return true;
}

export function threatMap(game, seat) {
  const map = new Map();                               // 格子 → 威脅它的敵方棋子數
  for (const [id, o] of game.at) {
    if (TEAM_OF(o.seat) === TEAM_OF(seat)) continue;
    if (!mightMove(game, id, o)) continue;
    for (const to of legalMoves(game, id)) map.set(to, (map.get(to) ?? 0) + 1);
  }
  return map;
}

// 把棋子放到 to 這格，預期會賠多少。
// 注意：這裡用的是「敵方棋子能不能構到那格」——那是公開資訊，不需要知道它們是什麼。
export function hangRisk(game, seat, { piece, to }, threats, memory) {
  const attackers = threats.get(to) ?? 0;
  if (!attackers) return 0;
  const value = valueOf(game, seat, piece);
  // 威脅者越多，越可能其中一顆比我大
  const p = 1 - Math.pow(1 - pLoseAgainstUnknown(piece), Math.min(attackers, 3));
  return value * p;
}

// 信念表：對每一顆看不見的敵方棋子，維護「它可能是什麼」的機率分布。
//
// 為什麼需要：現在的推理是一堆分開的布林事實（這格是工兵、那格至少是師長…），
// 彼此不相通，也沒有「不確定性」的概念。AI 不知道「這顆有四成是炸彈」，
// 更不知道「走這一步會讓對方對我的認知從三成確定變成九成確定」。
// 有了機率分布，才談得上資訊價值。
//
// 鐵律：只用公開資訊 + 自己棋子的身分。絕不可以偷看 game.at 裡別人的 piece。
import { BOARD, TEAM_OF } from '../src/board.mjs';
import { PIECES } from '../src/rules.mjs';

const TYPES = Object.keys(PIECES);
const isBackRow = (id) => /r[56]c/.test(id);
const isHQ = (id) => BOARD.nodes.get(id)?.kind === 'hq';

// 某一顆棋子「可能是什麼」——先用硬約束砍掉不可能的，再給權重
function candidates(id, mem) {
  const known = mem?.weakKnown?.get(id);
  if (known) return { [known]: 1 };

  const moved = mem?.moved?.has(id);
  const notMine = mem?.notMine?.has(id);
  const notFlag = mem?.notFlag?.has(id);
  const floor = mem?.bigThreat?.get(id) ?? 0;      // 我方這個階級的子死在它手上

  const out = {};
  for (const t of TYPES) {
    const def = PIECES[t];
    if (t === '軍旗') { if (!isHQ(id) || moved || notFlag) continue; }
    else if (t === '地雷') { if (!isBackRow(id) || moved || notMine) continue; }
    else if (floor > 0 && t !== '炸彈' && (def.rank ?? 0) < floor) continue;
    out[t] = 1;
  }
  if (!Object.keys(out).length) out['排長'] = 1;   // 約束互相矛盾時的保底

  // 位置先驗：從沒動過又在後兩排，地雷的機率高一些（但不是定律）
  if (out['地雷'] && !moved) out['地雷'] *= 2.2;
  if (out['軍旗'] && !moved) out['軍旗'] *= 1.5;
  return out;
}

// 這一家還剩幾顆某種棋子沒被確認死亡。我們看不到別人陣亡的身分，
// 所以用「盤上這家還有幾顆」回推總量上限，這仍然是公開資訊。
function remainingCounts(game, seat) {
  const alive = [...game.at.values()].filter(o => o.seat === seat).length;
  const total = 25;
  const scale = alive / total;
  const counts = {};
  for (const [t, def] of Object.entries(PIECES)) counts[t] = def.count * scale;
  return counts;
}

/**
 * 建立某一家（或所有敵方）的信念表。
 * 回傳 Map<nodeId, Map<piece, 機率>>。
 */
export function buildBelief(game, seat, memory, opts = {}) {
  const { include = (o) => TEAM_OF(o.seat) !== TEAM_OF(seat) } = opts;
  const nodes = [];
  for (const [id, o] of game.at) {
    if (!include(o)) continue;
    nodes.push({ id, seat: o.seat, w: candidates(id, memory) });
  }

  // 用反覆縮放讓「每格的機率和為 1」與「每種棋子的總量不超過剩餘量」同時近似成立。
  // 這是 Sinkhorn 那類做法的簡化版，跑十輪就夠穩定。
  const perSeatCounts = new Map();
  for (const s of new Set(nodes.map(n => n.seat))) perSeatCounts.set(s, remainingCounts(game, s));

  for (let iter = 0; iter < 10; iter++) {
    for (const n of nodes) {                            // 每格正規化
      const sum = Object.values(n.w).reduce((a, b) => a + b, 0) || 1;
      for (const k of Object.keys(n.w)) n.w[k] /= sum;
    }
    for (const [s, counts] of perSeatCounts) {          // 每種棋子的總量約束
      const seatNodes = nodes.filter(n => n.seat === s);
      for (const t of TYPES) {
        const expected = seatNodes.reduce((a, n) => a + (n.w[t] ?? 0), 0);
        if (expected <= 1e-9) continue;
        const factor = Math.min(3, Math.max(0.05, (counts[t] ?? 0) / expected));
        for (const n of seatNodes) if (n.w[t] != null) n.w[t] *= factor;
      }
    }
  }

  const belief = new Map();
  for (const n of nodes) {
    const sum = Object.values(n.w).reduce((a, b) => a + b, 0) || 1;
    belief.set(n.id, new Map(Object.entries(n.w).map(([k, v]) => [k, v / sum])));
  }
  return belief;
}

// 不確定性：整張信念表的資訊熵（bits）。越高代表我對敵方越不了解。
export function entropy(belief) {
  let h = 0;
  for (const dist of belief.values())
    for (const p of dist.values()) if (p > 0) h -= p * Math.log2(p);
  return h;
}

// 我這顆去打那一格，輸的機率是多少（含同歸於盡算半條命）
export function pLose(belief, node, myPiece) {
  const dist = belief.get(node);
  if (!dist) return 0.5;
  const myRank = PIECES[myPiece].rank ?? 0;
  let lose = 0;
  for (const [t, p] of dist) {
    if (t === '軍旗') continue;                          // 取旗直接贏
    if (t === '炸彈') { lose += p; continue; }
    if (t === '地雷') { lose += myPiece === '工兵' ? 0 : p; continue; }
    const r = PIECES[t].rank ?? 0;
    if (myPiece === '炸彈') { lose += p; continue; }      // 炸彈同歸於盡
    if (r > myRank) lose += p;
    else if (r === myRank) lose += p * 0.5;
  }
  return lose;
}

export const pIs = (belief, node, piece) => belief.get(node)?.get(piece) ?? 0;


// ── 資訊價值 ──────────────────────────────────────────────
// 第二階段的核心：把「我洩漏多少」與「我獲得多少」變成可以加進評分的數字。

const H = (dist) => {
  let h = 0;
  for (const p of dist.values()) if (p > 0) h -= p * Math.log2(p);
  return h;
};

/**
 * 別人眼中的我：用同一套公開約束，建立敵方對我方棋子的機率分布。
 * 這是「洩漏成本」的基礎——沒有這張表，就不知道自己走一步暴露了多少。
 */
export function buildSelfBelief(game, seat, memory) {
  return buildBelief(game, seat, memory, { include: (o) => o.seat === seat });
}

/**
 * 這一步會洩漏多少資訊（bits）。
 *   - 光是移動：等於宣告「我不是地雷、不是軍旗」
 *   - 轉彎移動：等於宣告「我是工兵」，那一顆的不確定性直接歸零
 * 回傳「對方的不確定性下降了多少」。
 */
export function leakOf(selfBelief, from, piece, revealing) {
  const dist = selfBelief?.get(from);
  if (!dist) return 0;

  // 洩漏量＝對方看到這個事件所獲得的資訊量 = -log2(該事件的機率)。
  // ⚠ 不要用「熵下降」來算：移除一個可能性之後，剩下的反而可能更平均、熵更高，
  //   會算出 0，等於偵測不到洩漏（第一版就是這樣寫錯的）。
  const surprisal = (p) => (p > 1e-9 ? -Math.log2(Math.min(1, p)) : 8);

  if (revealing) return surprisal(dist.get('工兵') ?? 0.02);   // 轉彎移動＝宣告我是工兵

  // 光是移動，就等於宣告「我不是地雷、也不是軍旗」
  const stationary = (dist.get('地雷') ?? 0) + (dist.get('軍旗') ?? 0);
  return surprisal(1 - stationary);
}

/**
 * 打這一格，預期能問出多少資訊（bits）。
 * 交手結果會把對方的分布切成「比我大／比我小／同階」三塊，
 * 期望的熵下降就是這一擊的情報價值。
 */
export function infoGainOf(belief, node, myPiece) {
  const dist = belief?.get(node);
  if (!dist) return 0;
  const myRank = PIECES[myPiece].rank ?? 0;
  const before = H(dist);

  const buckets = new Map();                    // 結果 → [機率, 該結果下的條件分布]
  for (const [t, p] of dist) {
    let key;
    if (t === '軍旗') key = 'flag';
    else if (t === '炸彈') key = 'both';
    else if (t === '地雷') key = myPiece === '工兵' ? 'win' : 'lose';
    else {
      const r = PIECES[t].rank ?? 0;
      key = r > myRank ? 'lose' : r === myRank ? 'both' : 'win';
    }
    if (!buckets.has(key)) buckets.set(key, [0, new Map()]);
    const b = buckets.get(key);
    b[0] += p; b[1].set(t, (b[1].get(t) ?? 0) + p);
  }

  let expected = 0;
  for (const [, [w, sub]] of buckets) {
    if (w <= 0) continue;
    const norm = new Map([...sub].map(([t, p]) => [t, p / w]));
    expected += w * H(norm);
  }
  return Math.max(0, before - expected);
}

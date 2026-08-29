// 搜尋層：對每個候選走法，抽樣多種「敵方可能的樣子」，各往下推演一段再平均。
// 這是縮小版 AlphaZero 的搜尋部分（determinized Monte Carlo）——
// 差別在於評估函式是手寫的材料計算，不是訓練出來的神經網路。
import { SEATS, TEAM_OF } from '../src/board.mjs';
import { PIECES } from '../src/rules.mjs';
import { movesForSeat, applyMove } from '../src/game.mjs';
import { determinize } from './determinize.mjs';
import { VALUE } from './lookahead.mjs';
import { scoreMove } from './ai.mjs';

export const SEARCH = {
  candidates: 12,       // 只深入評估最有希望的幾步，其餘用啟發式淘汰
  worlds: 24,           // 每步想像幾種敵方配置
  rolloutPlies: 40,     // 每次推演走幾手
  captureBias: 0.75,    // 推演時偏好吃子的程度（越接近真實對局越準）
  blend: 0.06,          // 推演結果的權重（相對於啟發式評分）——靠實驗決定
  mode: 'minimax',      // rollout = 隨機推演；minimax = 精算對手最強回應（實測後者訊號乾淨得多）
};

// 局面評分：我方陣營的材料優勢 + 出局狀況。軍旗另外算，因為被扛就直接輸。
function evaluate(state, seat) {
  let mine = 0, theirs = 0;
  for (const o of state.at.values()) {
    const v = VALUE[o.piece] ?? 10;
    if (o.piece === '軍旗') continue;
    (TEAM_OF(o.seat) === TEAM_OF(seat) ? mine += v : theirs += v);
  }
  for (const s of state.eliminated)
    (TEAM_OF(s) === TEAM_OF(seat) ? mine -= 400 : theirs -= 400);
  if (state.status === 'ended' && state.result?.type === 'win')
    return TEAM_OF(seat) === state.result.team ? 5000 : -5000;
  return mine - theirs;
}

// 推演用的快速策略：偏好吃子，其餘隨機。夠快才跑得動夠多次。
function rolloutMove(state, seat, rnd) {
  const moves = movesForSeat(state, seat);
  if (!moves.length) return null;
  const caps = moves.filter(m => state.at.has(m.to));
  const pool = (caps.length && rnd() < SEARCH.captureBias) ? caps : moves;
  return pool[Math.floor(rnd() * pool.length)];
}

function rollout(state, seat, rnd, plies) {
  for (let i = 0; i < plies && state.status === 'playing'; i++) {
    const mv = rolloutMove(state, state.turn, rnd);
    if (!mv) break;
    try { applyMove(state, mv.from, mv.to); } catch { break; }
  }
  return evaluate(state, seat);
}

// 在假想盤面上算「我走這步之後，對手最強的一步能拿走多少」。
// 比隨機推演乾淨得多：隨機推演會瘋狂互換棋子，最後的材料差距反映不出這一步的價值。
function opponentBestReply(state, seat) {
  const before = evaluate(state, seat);
  const foe = state.turn;
  if (foe === seat || state.status !== 'playing') return before;
  const moves = movesForSeat(state, foe);
  if (!moves.length) return before;
  let worst = before;
  for (const mv of moves) {
    const snap = new Map([...state.at].map(([k, v]) => [k, { ...v }]));
    const meta = { status: state.status, turn: state.turn, plies: state.plies,
      pliesSinceCapture: state.pliesSinceCapture, result: state.result };
    try {
      applyMove(state, mv.from, mv.to);
      const after = evaluate(state, seat);
      if (after < worst) worst = after;
    } catch { /* 不合法就跳過 */ }
    state.at = snap;
    Object.assign(state, meta);
    state.eliminated = new Set(state.eliminated);
  }
  return worst;
}

// 主入口。budgetMs 是每步的時間預算，超過就用目前算到的結果。
//
// 關鍵設計：最終分數 = 啟發式評分 + BLEND × 推演結果（置中後）。
// 純靠推演會把所有紀律丟掉（工兵別亂動、炸彈留給大子…），
// 而推演次數有限、雜訊又大，結果就是在候選裡近乎亂挑——實測比純啟發式還弱。
export function searchMove(game, seat, memory, { rnd = Math.random, budgetMs = 250, now = () => Date.now(), blend = SEARCH.blend } = {}) {
  const all = movesForSeat(game, seat);
  if (!all.length) return null;
  if (all.length === 1) return all[0];

  const ranked = all
    .map(m => ({ m, h: scoreMove(game, seat, memory, m) }))
    .sort((a, b) => b.h - a.h)
    .slice(0, SEARCH.candidates);

  const totals = ranked.map(() => ({ sum: 0, n: 0 }));
  const deadline = now() + budgetMs;

  outer:
  for (let round = 0; round < SEARCH.worlds; round++) {
    const imagined = determinize(game, seat, memory, rnd);   // 一種可能的敵方配置
    for (let i = 0; i < ranked.length; i++) {
      if (now() >= deadline) break outer;
      const state = {
        ...imagined,
        at: new Map([...imagined.at].map(([k, v]) => [k, { ...v }])),
        eliminated: new Set(imagined.eliminated),
        revealedFlags: new Set(imagined.revealedFlags),
        log: [],
      };
      const { from, to } = ranked[i].m;
      if (!state.at.has(from)) continue;
      try { applyMove(state, from, to); } catch { continue; }
      totals[i].sum += SEARCH.mode === 'minimax'
        ? opponentBestReply(state, seat)
        : rollout(state, seat, rnd, SEARCH.rolloutPlies);
      totals[i].n++;
    }
  }

  // 把推演結果置中：只比較「相對於其他候選的好壞」，避免不同局面的絕對值差異影響混合比例
  const means = totals.map(t => (t.n ? t.sum / t.n : null));
  const seen = means.filter(v => v != null);
  if (!seen.length) return ranked[0].m;
  const centre = seen.reduce((a, b) => a + b, 0) / seen.length;

  let best = ranked[0].m, bestValue = -Infinity;
  for (let i = 0; i < ranked.length; i++) {
    const roll = means[i] == null ? 0 : (means[i] - centre);
    const value = ranked[i].h + blend * roll;
    if (value > bestValue) { bestValue = value; best = ranked[i].m; }
  }
  return best;
}

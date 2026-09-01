// 產生合法的隨機佈局（對應 CYC 的「預設亂數佈陣」，也供自動對打壓力測試使用）
import { BOARD } from './board.mjs';
import { PIECES, legalMoves } from './rules.mjs';

export const mulberry32 = (seed) => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const pick = (arr, rnd) => arr.splice(Math.floor(rnd() * arr.length), 1)[0];

export function randomLayout(seat, rnd = Math.random) {
  const nodes = [...BOARD.nodes.values()].filter(n => n.seat === seat && n.kind !== 'camp');
  const free = nodes.map(n => n.id);
  const rowOf = id => BOARD.nodes.get(id).row;
  const kindOf = id => BOARD.nodes.get(id).kind;
  const layout = {};
  const take = (pool) => { const id = pick(pool, rnd); free.splice(free.indexOf(id), 1); return id; };

  // 大本營：軍旗放一個，另一個只能放地雷或排長（Lynch）。
  // 走進大本營的棋子就再也不能動，所以擺大子等於當場報廢一顆——真人不會這樣下。
  // 亂數佈陣原本會把司令、軍長塞進去，那不是「多樣」，是不合理。
  const hqs = free.filter(id => kindOf(id) === 'hq');
  layout[take(hqs)] = '軍旗';                                                   // 軍旗只能在大本營
  const spareHQ = free.find(id => kindOf(id) === 'hq');
  const spare = rnd() < 0.5 ? '地雷' : '排長';
  if (spareHQ) layout[take([spareHQ])] = spare;                                 // 另一個大本營
  // 已經放進大本營的那一顆要從後面的配額扣掉，否則總數會多一顆（實測 400/400 不合法）
  const mines = PIECES.地雷.count - (spare === '地雷' ? 1 : 0);
  for (let i = 0; i < mines; i++) layout[take(free.filter(id => rowOf(id) >= 5))] = '地雷';
  for (let i = 0; i < PIECES.炸彈.count; i++) layout[take(free.filter(id => rowOf(id) !== 1))] = '炸彈';
  const rest = [];
  for (const [name, def] of Object.entries(PIECES)) {
    if (['軍旗', '地雷', '炸彈'].includes(name)) continue;
    rest.push(...Array(def.count - (spare === name ? 1 : 0)).fill(name));
  }
  while (rest.length) layout[take([...free])] = pick(rest, rnd);
  return polish(layout, seat, rnd);
}

// ── 佈陣心法（Lynch 2026-09-01 指定）──────────────────────────────
// 亂數合法不代表好。這兩條是他要求隨機佈陣也要遵守的：
//   1. 炸彈要「一步就靠得到」師長或軍長——大子被吃時炸彈才報得了仇。
//      佈陣時沒放在能報仇的位置，就會出現「師長死了卻炸不到」那種最虧的局面。
//   2. 第 3～6 排不要有一樣大的子黏在一起，前後要大小交錯。
//      同階的子擠成一團，對方試出一顆就等於試出一片。
//
// 做法是先亂數擺完再「修」：算出違規數，隨機交換兩顆合法的棋子，變好就留下。
// 修不完就用當下最好的——寧可有一兩處不完美，也不要卡在這裡（有解不保證找得到）。
const BIG = new Set(['司令', '軍長', '師長', '旅長']);
const SMALL = new Set(['團長', '營長', '連長', '排長', '工兵']);

// 想做 A/B 時可以關掉：LAYOUT_POLISH=off（跟專案其他開關同樣的做法）
const POLISH_ON = typeof process === 'undefined' || process.env?.LAYOUT_POLISH !== 'off';

function polish(layout, seat, rnd) {
  if (!POLISH_ON) return layout;
  const rowOf = id => BOARD.nodes.get(id).row;
  const colOf = id => BOARD.nodes.get(id).col;
  const kindOf = id => BOARD.nodes.get(id).kind;
  const ids = Object.keys(layout);

  // 這一顆能不能換到那一格（大本營、地雷、炸彈、軍旗各有自己的限制）
  const canPlace = (piece, id) => {
    if (kindOf(id) === 'hq') return piece === '軍旗' || piece === '地雷' || piece === '排長';
    if (piece === '軍旗') return false;
    if (piece === '地雷') return rowOf(id) >= 5;
    if (piece === '炸彈') return rowOf(id) !== 1;
    return true;
  };

  const bombOK = (L) => {
    const targets = ids.filter(id => L[id] === '師長' || L[id] === '軍長');
    const bombs = ids.filter(id => L[id] === '炸彈');
    return bombs.some(b => {
      const at = new Map([[b, { seat, piece: '炸彈' }]]);
      let reach;
      try { reach = legalMoves({ at }, b); } catch { return false; }
      return targets.some(t => reach.includes(t));
    });
  };

  const cost = (L) => {
    let n = bombOK(L) ? 0 : 4;                       // 炸彈那條比較重要，權重高一點
    for (const id of ids) {
      if (rowOf(id) < 3) continue;
      const piece = L[id];
      if (!piece || piece === '軍旗' || piece === '地雷') continue;
      for (const nb of BOARD.adj.get(id) ?? []) {
        if (!L[nb] || rowOf(nb) < 3 || nb <= id) continue;   // 每一對只算一次
        if (L[nb] === piece) n += 1;                         // 一樣大的黏在一起
        if (colOf(nb) === colOf(id)) {                       // 前後（同一直行）要交錯
          if (BIG.has(piece) && BIG.has(L[nb])) n += 1;
          if (SMALL.has(piece) && SMALL.has(L[nb])) n += 1;
        }
      }
    }
    return n;
  };

  let best = { ...layout }, bestCost = cost(best);
  for (let step = 0; step < 400 && bestCost > 0; step++) {
    const a = ids[Math.floor(rnd() * ids.length)];
    const b = ids[Math.floor(rnd() * ids.length)];
    if (a === b) continue;
    if (!canPlace(best[a], b) || !canPlace(best[b], a)) continue;
    const trial = { ...best, [a]: best[b], [b]: best[a] };
    const c = cost(trial);
    if (c <= bestCost) { best = trial; bestCost = c; }
  }
  return best;
}

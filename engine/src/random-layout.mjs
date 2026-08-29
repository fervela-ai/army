// 產生合法的隨機佈局（對應 CYC 的「預設亂數佈陣」，也供自動對打壓力測試使用）
import { BOARD } from './board.mjs';
import { PIECES } from './rules.mjs';

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
  return layout;
}

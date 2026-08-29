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

  layout[take(free.filter(id => kindOf(id) === 'hq'))] = '軍旗';                 // 軍旗只能在大本營
  for (let i = 0; i < PIECES.地雷.count; i++) layout[take(free.filter(id => rowOf(id) >= 5))] = '地雷';
  for (let i = 0; i < PIECES.炸彈.count; i++) layout[take(free.filter(id => rowOf(id) !== 1))] = '炸彈';
  const rest = [];
  for (const [name, def] of Object.entries(PIECES))
    if (!['軍旗', '地雷', '炸彈'].includes(name)) rest.push(...Array(def.count).fill(name));
  while (rest.length) layout[take([...free])] = pick(rest, rnd);
  return layout;
}

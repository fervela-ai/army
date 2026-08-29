// 預設起始佈局：不是亂數，是一個看得懂、方便玩家在上面調整的有序陣形。
// 規則（Lynch 指定）：
//   軍旗放左下大本營 r6c2；三顆地雷圍成三角護旗（r5c2 正上、r6c1 左、r6c3 右）；
//   右下大本營 r6c4 放排長——進大本營的棋子永遠不能再動，所以放最便宜的；
//   工兵雖然階級更低但要留著拆雷，不能浪費在這裡。
//   其餘 20 顆從左上 r1c1 起、由大到小依序往右往下排。炸彈無階級，排在最後（自然避開第一排）。
import { BOARD } from './board.mjs';

export const FLAG_NODE = (seat) => `P${seat}-r6c2`;
export const MINE_NODES = (seat) => [`P${seat}-r5c2`, `P${seat}-r6c1`, `P${seat}-r6c3`];
export const SPARE_HQ_NODE = (seat) => `P${seat}-r6c4`;   // 右下大本營：放最便宜的棋子

const ORDER = [
  '司令', '軍長', '師長', '師長', '旅長', '旅長', '團長', '團長', '營長', '營長',
  '連長', '連長', '連長', '排長', '排長', '工兵', '工兵', '工兵', '炸彈', '炸彈',
];

export function defaultLayout(seat) {
  const layout = { [FLAG_NODE(seat)]: '軍旗', [SPARE_HQ_NODE(seat)]: '排長' };
  for (const id of MINE_NODES(seat)) layout[id] = '地雷';

  const slots = [];
  for (let row = 1; row <= 6; row++)
    for (let col = 1; col <= 5; col++) {
      const id = `P${seat}-r${row}c${col}`;
      if (BOARD.nodes.get(id).kind === 'camp') continue;   // 行營開局必須空著
      if (layout[id]) continue;                            // 軍旗與地雷已佔位
      slots.push(id);
    }
  if (slots.length !== ORDER.length) throw new Error(`預設佈局位置數 ${slots.length} 與棋子數 ${ORDER.length} 不符`);
  slots.forEach((id, i) => { layout[id] = ORDER[i]; });
  return layout;
}

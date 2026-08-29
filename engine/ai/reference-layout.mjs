// Lynch 的實戰陣型（2026-08-29 提供）。他的說法：「不敢說最強但至少是標準，不是亂下」。
// 拿來當基準陣型，也拿來跟程式產生的心法陣型對打驗證。
//
// 讀得出來的幾個原則：
//   * 軍旗放左下大本營，兩側各一顆地雷夾住（一字雷），第三顆守另一個大本營
//   * 司令縮在 r5c1——側邊鐵路的底端，可以沿著縱列一口氣飛上前線
//   * 軍長、師長、團長、旅長全部擺第一排：前線就是主力，不是拿小兵墊
//   * 炸彈放在主力後方（r2c3 在團長後、r4c1 在工兵後、司令前）
//   * 三顆工兵集中在左半邊，隨時支援拆雷
import { validateSetup } from '../src/rules.mjs';

const GRID = [
  ['師長', '工兵', '團長', '軍長', '旅長'],
  ['營長', null,  '炸彈', null,  '連長'],
  ['工兵', '工兵', null,  '連長', '師長'],
  ['炸彈', null,  '排長', null,  '營長'],
  ['司令', '旅長', '排長', '地雷', '團長'],
  ['地雷', '軍旗', '地雷', '排長', '連長'],
];

export function referenceLayout(seat) {
  const layout = {};
  GRID.forEach((row, i) => row.forEach((piece, j) => {
    if (piece) layout[`P${seat}-r${i + 1}c${j + 1}`] = piece;
  }));
  const v = validateSetup(seat, layout);
  if (!v.ok) throw new Error(`參考陣型不合法：${v.errors.join('；')}`);
  return layout;
}

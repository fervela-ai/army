// 棋盤的畫面座標：唯一來源。產圖腳本與前端 UI 都從這裡取，避免兩邊各抄一份而不一致。
// 單位座標，原點在棋盤正中央（中宮）。y 軸向上為正；要畫成 SVG 時再翻轉。
import { SEATS } from './board.mjs';

// P0（下家）視角的陣地座標：col 1..5 由左至右，row 1..6 由前線往己方底線。
const localXY = (row, col) => ({ x: col - 3, y: -(row + 2) });

// 逆時針旋轉 90 度 × times（P0 下、P1 右、P2 上、P3 左）
const rotate = ({ x, y }, times) => {
  for (let i = 0; i < times; i++) [x, y] = [-y, x];
  return { x, y };
};

export function buildGeometry() {
  const xy = new Map();
  for (const s of SEATS)
    for (let row = 1; row <= 6; row++)
      for (let col = 1; col <= 5; col++)
        xy.set(`P${s}-r${row}c${col}`, rotate(localXY(row, col), s));
  // 中央九宮：與陣地的 c1/c3/c5 對齊，間距 2
  for (let r = 1; r <= 3; r++)
    for (let c = 1; c <= 3; c++)
      xy.set(`M-r${r}c${c}`, { x: (c - 2) * 2, y: (2 - r) * 2 });
  return xy;
}

export const GEOMETRY = buildGeometry();
export const nodeXY = (id) => GEOMETRY.get(id);

// 相鄰兩家前線之間的轉角弧線（正式鐵路，一般棋子可走且不計為轉彎）。
// 控制點取內側轉角並稍微外推，弧形朝棋盤內側彎。
export const ARCS = SEATS.map(s => {
  const from = `P${s}-r1c5`, to = `P${(s + 1) % 4}-r1c1`;
  const a = nodeXY(from), b = nodeXY(to);
  // 圓角的作用是「我的左路平順地接到左家的右路」，所以它的切線必須貼合兩家的側邊縱列。
  // 要做到這件事，圓心一定在**外側**轉角（弧線因此往棋盤中心凸）。
  // 圓心放內側會變成切線貼合前線橫排，那是另一種棋盤，不是四國軍棋。
  const center = {
    x: Math.abs(a.x) > Math.abs(b.x) ? a.x : b.x,
    y: Math.abs(a.y) > Math.abs(b.y) ? a.y : b.y,
  };
  const radius = Math.hypot(a.x - center.x, a.y - center.y);
  const cross = (a.x - center.x) * (b.y - center.y) - (a.y - center.y) * (b.x - center.x);
  return { from, to, center, radius, sweep: cross > 0 ? 0 : 1 };
});

export const BOUNDS = (() => {
  const xs = [...GEOMETRY.values()].map(p => p.x), ys = [...GEOMETRY.values()].map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
})();

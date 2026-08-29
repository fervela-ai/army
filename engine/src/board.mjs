// 棋盤圖：129 點位、鄰接關係、鐵路「直行線」。
// 對應規格 RULES-V1.md §0–§1。純資料結構，無任何遊戲狀態。

export const SEATS = [0, 1, 2, 3];                 // P0 下、P1 右、P2 上、P3 左（逆時針）
export const TEAM_OF = s => s % 2;                 // 隊 A = {P0,P2}，隊 B = {P1,P3}

const CAMPS = new Set(['2,2', '2,4', '3,3', '4,2', '4,4']);
const HQS = new Set(['6,2', '6,4']);

const nid = (s, row, col) => `P${s}-r${row}c${col}`;
const mid = (r, c) => `M-r${r}c${c}`;

// 各家前線 c1/c3/c5 對應到的中央九宮點位（依 §1.2 的實際幾何）
const GATES = {
  0: [mid(3, 1), mid(3, 2), mid(3, 3)],
  1: [mid(3, 3), mid(2, 3), mid(1, 3)],
  2: [mid(1, 3), mid(1, 2), mid(1, 1)],
  3: [mid(1, 1), mid(2, 1), mid(3, 1)],
};

export function buildBoard() {
  const nodes = new Map();
  const addNode = (id, kind, seat, row = null, col = null) => nodes.set(id, { id, kind, seat, row, col });

  for (const s of SEATS)
    for (let row = 1; row <= 6; row++)
      for (let col = 1; col <= 5; col++) {
        const k = `${row},${col}`;
        addNode(nid(s, row, col), CAMPS.has(k) ? 'camp' : HQS.has(k) ? 'hq' : 'post', s, row, col);
      }
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) addNode(mid(r, c), 'center', null);

  // ---- 鐵路直行線 ----
  // 「直行線」＝幾何上真正的一條直線。棋盤中央那三條縱貫線與三條橫貫線，
  // 是把兩個對家的側邊縱列與中央九宮串成同一條直線——所以從自己陣地筆直往前
  // 穿過九宮打到對家，全程不算轉彎。
  // 轉角弧線不屬於任何一條直行線，另外記在 arcs 裡：一般棋子最多可以借用一次（§3.3）。
  const lines = [];
  const col = (s, c) => [5, 4, 3, 2, 1].map(r => nid(s, r, c));      // 由己方底線往前線

  // 三條縱貫線：P0 ↔ P2
  lines.push([...col(0, 1), mid(3, 1), mid(2, 1), mid(1, 1), ...col(2, 5).reverse()]);
  lines.push([nid(0, 1, 3), mid(3, 2), mid(2, 2), mid(1, 2), nid(2, 1, 3)]);
  lines.push([...col(0, 5), mid(3, 3), mid(2, 3), mid(1, 3), ...col(2, 1).reverse()]);
  // 三條橫貫線：P3 ↔ P1
  lines.push([...col(3, 5), mid(3, 1), mid(3, 2), mid(3, 3), ...col(1, 1).reverse()]);
  lines.push([nid(3, 1, 3), mid(2, 1), mid(2, 2), mid(2, 3), nid(1, 1, 3)]);
  lines.push([...col(3, 1), mid(1, 1), mid(1, 2), mid(1, 3), ...col(1, 5).reverse()]);
  // 每家的前線橫排與 r5 橫排
  for (const s of SEATS) {
    lines.push([1, 2, 3, 4, 5].map(c => nid(s, 1, c)));
    lines.push([1, 2, 3, 4, 5].map(c => nid(s, 5, c)));
  }

  // 轉角弧線：相鄰兩家前線的端點相連。屬於鐵路，但不在任何直行線上。
  const arcs = SEATS.map(s => [nid(s, 1, 5), nid((s + 1) % 4, 1, 1)]);

  // ---- 鄰接圖 ----
  const adj = new Map([...nodes.keys()].map(id => [id, new Set()]));
  const link = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };

  for (const s of SEATS) {
    for (let row = 1; row <= 6; row++)
      for (let col = 1; col <= 5; col++) {
        if (col < 5) link(nid(s, row, col), nid(s, row, col + 1));
        if (row < 6) link(nid(s, row, col), nid(s, row + 1, col));
      }
    for (const k of CAMPS) {                                      // 行營的四條斜線
      const [row, col] = k.split(',').map(Number);
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) link(nid(s, row, col), nid(s, row + dr, col + dc));
    }
    [1, 3, 5].forEach((c, i) => link(nid(s, 1, c), GATES[s][i]));      // 前線接九宮
  }
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);
  for (const [a, b] of arcs) link(a, b);

  // ---- 鐵路邊與鐵路點 ----
  const lineIndex = new Map();                                    // 點位 → 它所屬的直行線
  lines.forEach((line, li) => line.forEach(id => {
    if (!lineIndex.has(id)) lineIndex.set(id, []);
    lineIndex.get(id).push(li);
  }));

  const railEdges = new Set();
  const ekey = (a, b) => [a, b].sort().join('|');
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) railEdges.add(ekey(line[i], line[i + 1]));
  for (const [a, b] of arcs) railEdges.add(ekey(a, b));
  const railNodes = new Set([...lines.flat(), ...arcs.flat()]);

  // 弧線是實體的圓角轉彎，有「切線方向」：
  //   沿縱貫／橫貫線抵達端點 → 過弧後接對面的縱貫／橫貫線；
  //   沿某家前線橫排抵達端點 → 過弧後接鄰家的前線橫排。
  // 不能過了弧線再換另一條線，那等於轉兩次彎。
  const isRowLine = (li, seat) => lines[li].every(id => id.startsWith(`P${seat}-`));
  const linesAt = (id) => lineIndex.get(id) ?? [];
  const arcHops = new Map();                    // `${node}|${lineId}` → { to, line }
  for (const [a, b] of arcs) {
    const sa = Number(a[1]), sb = Number(b[1]);
    const rowA = linesAt(a).find(li => isRowLine(li, sa));
    const rowB = linesAt(b).find(li => isRowLine(li, sb));
    const longA = linesAt(a).find(li => li !== rowA);
    const longB = linesAt(b).find(li => li !== rowB);
    // 弧角是實體的圓角，它接的是兩家的「側邊縱列」。
    // 不論你是沿前線橫排還是沿側邊縱列走到轉角，繞過去之後都是接鄰家的側邊縱列，
    // 不會接到鄰家的前線橫排——那等於在轉角處又轉了一次。
    // 弧角只接兩家的「側邊縱列」，而且只有沿著縱列走過來的棋子能順著滑過去。
    // 從前線橫排要彎進鄰家，本身就已經轉了一次彎，不能再借弧角（Lynch 實戰指正）。
    arcHops.set(`${a}|${longA}`, { to: b, line: longB });
    arcHops.set(`${b}|${longB}`, { to: a, line: longA });
  }

  const arcEdges = new Set(arcs.map(([a, b]) => ekey(a, b)));
  return {
    nodes, adj, lines, lineIndex, railNodes, arcs, arcHops,
    isRailEdge: (a, b) => railEdges.has(ekey(a, b)),
    isArcEdge: (a, b) => arcEdges.has(ekey(a, b)),      // 弧角本身就是圓角，走它不算轉彎
  };
}

export const BOARD = buildBoard();

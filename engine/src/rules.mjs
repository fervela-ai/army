// 棋子、佈局驗證、走子生成、吃子裁判。對應規格 RULES-V1.md §2–§5。
import { BOARD, TEAM_OF } from './board.mjs';
import { nodeXY } from './geometry.mjs';

export const PIECES = {
  司令: { rank: 9, count: 1, movable: true },
  軍長: { rank: 8, count: 1, movable: true },
  師長: { rank: 7, count: 2, movable: true },
  旅長: { rank: 6, count: 2, movable: true },
  團長: { rank: 5, count: 2, movable: true },
  營長: { rank: 4, count: 2, movable: true },
  連長: { rank: 3, count: 3, movable: true },
  排長: { rank: 2, count: 3, movable: true },
  工兵: { rank: 1, count: 3, movable: true },
  地雷: { rank: null, count: 3, movable: false },
  炸彈: { rank: null, count: 2, movable: true },
  軍旗: { rank: null, count: 1, movable: false },
};
export const TOTAL_PIECES = Object.values(PIECES).reduce((n, p) => n + p.count, 0);   // 25

// ---- §2 佈局驗證 ----
export function validateSetup(seat, layout) {                 // layout: Map/物件 nodeId → 棋子名
  const errors = [];
  const entries = Object.entries(layout);
  const seen = Object.fromEntries(Object.keys(PIECES).map(k => [k, 0]));

  for (const [id, piece] of entries) {
    const n = BOARD.nodes.get(id);
    if (!n) { errors.push(`未知點位 ${id}`); continue; }
    if (n.seat !== seat) { errors.push(`${id} 不屬於 P${seat} 的陣地`); continue; }
    if (!PIECES[piece]) { errors.push(`未知棋子 ${piece}`); continue; }
    seen[piece]++;
    if (n.kind === 'camp') errors.push(`行營內不可放子：${id}`);
    if (piece === '軍旗' && n.kind !== 'hq') errors.push(`軍旗只能放在大本營：${id}`);
    if (piece === '地雷' && n.row < 5) errors.push(`地雷只能放在後兩排：${id}`);
    if (piece === '炸彈' && n.row === 1) errors.push(`炸彈不可放在第一排：${id}`);
  }
  if (entries.length !== TOTAL_PIECES) errors.push(`必須放滿 ${TOTAL_PIECES} 子，目前 ${entries.length}`);
  for (const [name, def] of Object.entries(PIECES))
    if (seen[name] !== def.count) errors.push(`${name} 應為 ${def.count} 枚，實際 ${seen[name]}`);

  return { ok: errors.length === 0, errors };
}

// ---- §3 走子生成 ----
// 弧角是實體的圓角，只能「順著行進方向」滑過去。
// 若允許在弧角掉頭，就會出現「沿橫貫線一路往西，到了左家門口卻往東南折回來」
// 這種銳角迴轉的走法（Lynch 實戰抓到）。
const unit = (from, to) => {
  const p = nodeXY(from), q = nodeXY(to);
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
};
const forward = (prevNode, cur, next) => {
  if (!prevNode) return true;                       // 起點就站在弧角上，沒有行進方向可比
  const a = unit(prevNode, cur), b = unit(cur, next);
  return a.x * b.x + a.y * b.y > 0.05;              // 夾角必須小於 90 度
};
// state.at: Map nodeId → { seat, piece }
const occupant = (state, id) => state.at.get(id) ?? null;
const isEmpty = (state, id) => !state.at.has(id);

function canLandOn(state, id, seat) {
  const n = BOARD.nodes.get(id);
  const tgt = occupant(state, id);
  if (!tgt) return true;
  if (TEAM_OF(tgt.seat) === TEAM_OF(seat)) return false;        // 不可吃同盟或自己的子
  if (n.kind === 'camp') return false;                          // §1.3 行營內不可被攻擊
  return true;
}

// asPiece：用別的棋種的走法規則來算。AI 需要它來回答一個問題——
// 「這一步如果是普通棋子，走得出來嗎？」走不出來就代表這一步暴露了工兵身分。
export function legalMoves(state, from, { asPiece = null } = {}) {
  const occ = occupant(state, from);
  if (!occ) return [];
  const me = asPiece ? { ...occ, piece: asPiece } : occ;
  const n = BOARD.nodes.get(from);
  if (!PIECES[me.piece].movable) return [];                     // 地雷、軍旗
  if (n.kind === 'hq') return [];                               // §1.4 走入大本營只進不出

  const out = new Set();
  for (const nb of BOARD.adj.get(from)) if (canLandOn(state, nb, me.seat)) out.add(nb);   // 一步（公路或鐵路）

  if (BOARD.railNodes.has(from)) {
    if (me.piece === '工兵') {                                  // §3.4 全盤鐵路 BFS
      const seen = new Set([from]), queue = [from];
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of BOARD.adj.get(cur)) {
          if (!BOARD.railNodes.has(nb) || !BOARD.isRailEdge(cur, nb) || seen.has(nb)) continue;
          seen.add(nb);
          if (isEmpty(state, nb)) { out.add(nb); queue.push(nb); }
          else if (canLandOn(state, nb, me.seat)) out.add(nb);   // 可吃，但不可穿越
        }
      }
    } else {
      // §3.3 一般棋子：沿同一條直行線任意距離；經過外環弧角可以借一次彎，之後不能再轉。
      // 過弧角之後只能繼續遠離轉角。否則會出現「繞過弧角再掉頭穿回九宮」這種
      // 幾何上是 U 形迴轉、卻被誤判成直線的走法。
      const continueAfterArc = (cornerId, hop) => {
        const line = BOARD.lines[hop.line];
        const k = line.indexOf(hop.to);
        for (const d of [-1, 1]) {
          const nb = line[k + d];
          if (nb && forward(cornerId, hop.to, nb)) walk(hop.line, k, d, true);
        }
      };

      const walk = (lineId, index, dir, usedArc) => {
        const line = BOARD.lines[lineId];
        for (let j = index + dir; j >= 0 && j < line.length; j += dir) {
          const id = line[j];
          if (!isEmpty(state, id)) {
            if (canLandOn(state, id, me.seat)) out.add(id);
            return;                                          // 阻擋：不可穿越
          }
          out.add(id);
          if (usedArc) continue;
          const hop = BOARD.arcHops.get(`${id}|${lineId}`);   // 走到弧角端點，可以轉進弧線
          if (!hop) continue;
          if (!forward(line[j - dir], id, hop.to)) continue;  // 弧角不能拿來掉頭
          if (!isEmpty(state, hop.to)) {
            if (canLandOn(state, hop.to, me.seat)) out.add(hop.to);
            continue;
          }
          out.add(hop.to);
          continueAfterArc(id, hop);
        }
      };
      for (const li of BOARD.lineIndex.get(from) ?? []) {
        const idx = BOARD.lines[li].indexOf(from);
        for (const dir of [-1, 1]) walk(li, idx, dir, false);
      }
      const startHop = [...BOARD.lineIndex.get(from) ?? []]
        .map(li => BOARD.arcHops.get(`${from}|${li}`)).filter(Boolean);
      for (const hop of startHop) {                           // 自己就站在弧角端點上
        if (!isEmpty(state, hop.to)) { if (canLandOn(state, hop.to, me.seat)) out.add(hop.to); continue; }
        out.add(hop.to);
        continueAfterArc(from, hop);
      }
    }
  }
  out.delete(from);
  return [...out];
}

// ---- §4 吃子裁判 ----
// 回傳 { attacker: 'live'|'dead', defender: 'live'|'dead' }
export function resolveCombat(attackerPiece, defenderPiece) {
  const A = PIECES[attackerPiece], D = PIECES[defenderPiece];
  if (defenderPiece === '軍旗') return { attacker: 'live', defender: 'dead', flagTaken: true };
  if (attackerPiece === '炸彈' || defenderPiece === '炸彈') return { attacker: 'dead', defender: 'dead' };
  if (defenderPiece === '地雷')
    return attackerPiece === '工兵'
      ? { attacker: 'live', defender: 'dead' }                   // 工兵拆雷
      : { attacker: 'dead', defender: 'live' };                  // 地雷留在原地
  if (attackerPiece === '地雷') return { attacker: 'live', defender: 'dead' }; // 地雷不會主動攻擊，防禦性保留
  if (A.rank === D.rank) return { attacker: 'dead', defender: 'dead' };
  return A.rank > D.rank ? { attacker: 'live', defender: 'dead' } : { attacker: 'dead', defender: 'live' };
}

// ---- §4.6 視角過濾：伺服器送給玩家的盤面，絕不可含他人棋子身分 ----
// seatOrSeats：四人版是單一座位；雙人版是該玩家操控的兩個座位（自己＋對家，彼此可見）。
export function viewFor(state, seatOrSeats) {
  const own = new Set(Array.isArray(seatOrSeats) ? seatOrSeats : [seatOrSeats]);
  const revealed = state.revealedFlags ?? new Set();
  const at = {};
  for (const [id, o] of state.at) {
    // §5.1 司令陣亡後，該家的軍旗對全場顯露——這是唯一會外洩他人棋子身分的規則。
    const show = own.has(o.seat) || (o.piece === '軍旗' && revealed.has(o.seat));
    at[id] = show ? { seat: o.seat, piece: o.piece } : { seat: o.seat };
  }
  return { at, turn: state.turn, revealedFlags: [...(state.revealedFlags ?? [])] };
}


// ---- 走子路徑 ----
// 動畫需要知道棋子「實際經過哪些格」，不是只有起點終點。
// 工兵在鐵路上會拐彎，直線滑過去會看起來像瞬間移動。
export function movePath(state, from, to) {
  const me = occupant(state, from);
  if (!me) return [from, to];
  if (BOARD.adj.get(from)?.has(to)) return [from, to];          // 相鄰一步
  if (!BOARD.railNodes.has(from)) return [from, to];

  if (me.piece === '工兵') {
    // 工兵在鐵路網上找路。不是單純的最短路徑——真人拿棋子是順著圓角滑過去的，
    // 能走弧角就不會硬拐直角，所以直角轉彎要算一點代價，讓路線看起來像人走的。
    // 轉彎代價刻意設得很小：它只用來在「一樣長的路線」之間偏好圓角，
    // 絕不能讓工兵為了少轉彎而繞遠路（給 0.4 時它會多走三四格去繞弧線，Lynch 實戰抓到）。
    const TURN_COST = 0.05;
    const dir = (a, b) => {
      const p = nodeXY(a), q = nodeXY(b);
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    };
    const turnPenalty = (prevNode, cur, next) => {
      if (!prevNode) return 0;
      // 弧角就是實體的圓角，順著它滑過去不算「拐彎」
      if (BOARD.isArcEdge(prevNode, cur) || BOARD.isArcEdge(cur, next)) return 0;
      const a = dir(prevNode, cur), b = dir(cur, next);
      const cos = a.x * b.x + a.y * b.y;
      return cos < 0.9 ? TURN_COST : 0;                         // 方向改變就算轉彎
    };

    const best = new Map();                                     // `${node}|${prev}` → 成本
    const startKey = `${from}|`;
    const pq = [{ node: from, prev: null, cost: 0, path: [from] }];
    best.set(startKey, 0);
    let found = null;
    while (pq.length) {
      pq.sort((x, y) => x.cost - y.cost);
      const cur = pq.shift();
      if (cur.node === to) { found = cur.path; break; }
      for (const nb of BOARD.adj.get(cur.node)) {
        if (!BOARD.isRailEdge(cur.node, nb)) continue;
        if (nb !== to && !isEmpty(state, nb)) continue;          // 只能經過空格
        const cost = cur.cost + 1 + turnPenalty(cur.prev, cur.node, nb);
        const key = `${nb}|${cur.node}`;
        if (best.has(key) && best.get(key) <= cost) continue;
        best.set(key, cost);
        pq.push({ node: nb, prev: cur.node, cost, path: [...cur.path, nb] });
      }
    }
    return found ?? [from, to];
  }

  // 一般棋子：沿直行線走，必要時借一次弧角
  const trace = (lineId, index, dir, usedArc, acc) => {
    const line = BOARD.lines[lineId];
    let best = null;
    const keep = (route) => { if (route && (!best || route.length < best.length)) best = route; };
    for (let j = index + dir; j >= 0 && j < line.length; j += dir) {
      const id = line[j];
      const next = [...acc, id];
      if (id === to) { keep(next); break; }        // 直走就到了，但仍要跟弧線路線比長度
      if (!isEmpty(state, id)) break;              // 被擋住，這個方向到此為止
      if (!usedArc) {
        const hop = BOARD.arcHops.get(`${id}|${lineId}`);
        if (hop) {
          const viaArc = [...next, hop.to];
          if (hop.to === to) keep(viaArc);
          else if (isEmpty(state, hop.to)) {
            const nl = BOARD.lines[hop.line], k = nl.indexOf(hop.to);
            for (const d of [-1, 1]) {
              if (!nl[k + d]) continue;
              keep(trace(hop.line, k, d, true, viaArc));
            }
          }
          // ⚠ 這裡不能因為「繞弧線也到得了」就直接回傳——
          // 曾經如此，結果炸彈從 P0-r2c5 到 M-r3c3 的動畫繞進右家轉角，
          // 走了 3 步，其實直走 2 步就到（Lynch 實戰抓到）。
        }
      }
      acc = next;
    }
    return best;
  };
  // 一律回傳最短的那條。原本找到第一條就回傳，會畫出繞遠路的詭異動畫。
  let best = null;
  const keep = (route) => { if (route && (!best || route.length < best.length)) best = route; };

  for (const li of BOARD.lineIndex.get(from) ?? [])
    for (const dir of [-1, 1])
      keep(trace(li, BOARD.lines[li].indexOf(from), dir, false, [from]));

  // 棋子本來就站在弧角端點上：直接從弧線出發也是一條路。
  // 少了這段，站在轉角的棋子繞弧線走時會找不到路徑，動畫就變成直線瞬移。
  for (const li of BOARD.lineIndex.get(from) ?? []) {
    const hop = BOARD.arcHops.get(`${from}|${li}`);
    if (!hop) continue;
    const viaArc = [from, hop.to];
    if (hop.to === to) { keep(viaArc); continue; }
    if (!isEmpty(state, hop.to)) continue;
    const nl = BOARD.lines[hop.line], k = nl.indexOf(hop.to);
    for (const d of [-1, 1]) if (nl[k + d]) keep(trace(hop.line, k, d, true, viaArc));
  }
  return best ?? [from, to];
}

// 局面狀態機：輪轉、亮旗、扛旗、勝負與和局。對應規格 RULES-V1.md §5–§6。
import { BOARD, SEATS, TEAM_OF } from './board.mjs';
import { PIECES, validateSetup, legalMoves, resolveCombat } from './rules.mjs';

// —— 以下兩個常數是刻意的規則決定，不是隨手寫死的數字，經 Lynch 對照 CYC 實際體驗確認 ——
// 「60 步」是四家累計的總出手數，不是每家各 60 步。
export const NO_CAPTURE_DRAW_MOVES = 60;
// 認輸後該家棋子全部從盤上移除，與被扛旗的處理一致。
export const RESIGN_REMOVES_PIECES = true;

export function createGame(layouts) {          // layouts: { [seat]: {nodeId: 棋子名} }
  const at = new Map();
  for (const s of SEATS) {
    const v = validateSetup(Number(s), layouts[s]);
    if (!v.ok) throw new Error(`P${s} 佈局不合法：${v.errors.join('；')}`);
    for (const [id, piece] of Object.entries(layouts[s])) at.set(id, { seat: Number(s), piece });
  }
  return {
    at, turn: 0, status: 'playing',
    eliminated: new Set(), revealedFlags: new Set(),
    plies: 0, pliesSinceCapture: 0, result: null, log: [],
  };
}

export const isActive = (state, seat) => !state.eliminated.has(seat);

export function movesForSeat(state, seat) {
  if (!isActive(state, seat)) return [];
  const out = [];
  for (const [id, o] of state.at)
    if (o.seat === seat) for (const to of legalMoves(state, id)) out.push({ from: id, to });
  return out;
}

const flagNodeOf = (state, seat) => {
  for (const [id, o] of state.at) if (o.seat === seat && o.piece === '軍旗') return id;
  return null;
};

function killPiece(state, id, events) {         // 移除單一棋子，並處理司令亮旗
  const o = state.at.get(id);
  if (!o) return;
  state.at.delete(id);
  if (o.piece === '司令' && isActive(state, o.seat) && !state.revealedFlags.has(o.seat)) {
    state.revealedFlags.add(o.seat);            // §5.1 司令滅亡 → 軍旗顯露
    events.push({ type: 'flagRevealed', seat: o.seat, node: flagNodeOf(state, o.seat) });
  }
}

function eliminate(state, seat, reason, events) {   // §5.2 該家棋子全部毀滅、轉觀戰
  if (state.eliminated.has(seat)) return;
  state.eliminated.add(seat);
  for (const [id, o] of [...state.at]) if (o.seat === seat) state.at.delete(id);
  events.push({ type: 'eliminated', seat, reason });
}

export function applyMove(state, from, to) {
  if (state.status !== 'playing') throw new Error('遊戲已結束');
  const mover = state.at.get(from);
  if (!mover) throw new Error(`${from} 沒有棋子`);
  if (mover.seat !== state.turn) throw new Error(`現在輪到 P${state.turn}`);
  if (!legalMoves(state, from).includes(to)) throw new Error(`不合法的走法 ${from}→${to}`);

  const events = [];
  const target = state.at.get(to);
  let outcome = 'moved';
  // 這一步「普通棋子做不做得到」？做不到就代表移動的是工兵——
  // 這是全場都看得到的公開推理（只有工兵能在鐵路上任意拐彎），不是偷看身分。
  const revealing = !legalMoves(state, from, { asPiece: '排長' }).includes(to);

  if (!target) {
    state.at.delete(from); state.at.set(to, mover);
  } else {
    const r = resolveCombat(mover.piece, target.piece);
    const defenderSeat = target.seat;
    if (r.defender === 'dead') killPiece(state, to, events);
    if (r.attacker === 'dead') killPiece(state, from, events);
    else { state.at.delete(from); if (r.defender === 'dead') state.at.set(to, mover); }
    outcome = r.attacker === 'dead' && r.defender === 'dead' ? 'bothDead'
      : r.attacker === 'dead' ? 'attackerDead' : 'defenderDead';
    if (r.flagTaken) eliminate(state, defenderSeat, 'flagTaken', events);
    state.pliesSinceCapture = 0;
  }
  if (outcome === 'moved') state.pliesSinceCapture++;
  state.plies++;
  // 不含任何棋子身分；revealing 是公開可推得的資訊（走法本身暴露了它是工兵）
  events.unshift({ type: 'move', seat: mover.seat, from, to, outcome, revealing });
  state.log.push(...events);

  checkEnd(state, events);
  if (state.status === 'playing') advanceTurn(state);
  return events;
}

export function advanceTurn(state) {             // §6 逆時針；出局或無步可走者跳過
  for (let i = 1; i <= 4; i++) {
    const next = (state.turn + i) % 4;
    if (isActive(state, next) && movesForSeat(state, next).length > 0) { state.turn = next; return; }
  }
  state.status = 'ended';                        // 沒有任何一家能走 → 和局
  state.result = { type: 'draw', reason: 'noMoves' };
}

export function checkEnd(state, events = []) {
  for (const team of [0, 1]) {
    const seats = SEATS.filter(s => TEAM_OF(s) === team);
    if (seats.every(s => state.eliminated.has(s))) {
      state.status = 'ended';
      state.result = { type: 'win', team: 1 - team, reason: 'teamEliminated' };
      events.push({ type: 'end', ...state.result });
      return;
    }
  }
  if (state.pliesSinceCapture >= NO_CAPTURE_DRAW_MOVES) {
    state.status = 'ended';
    state.result = { type: 'draw', reason: 'noCapture' };
    events.push({ type: 'end', ...state.result });
  }
}

// §5.6 認輸：與被扛旗同樣處理（棋子全滅、轉觀戰），同盟國續戰
export function surrender(state, seat) {
  const events = [];
  if (!RESIGN_REMOVES_PIECES) throw new Error('尚未實作「認輸但保留棋子」的規則變體');
  eliminate(state, seat, 'surrender', events);
  checkEnd(state, events);
  if (state.status === 'playing' && state.turn === seat) advanceTurn(state);
  return events;
}

// §6 超時：隨機走一步（房間層用，連 5 步超時後改由 AI 託管）
export function randomMove(state, seat, rnd = Math.random) {
  const ms = movesForSeat(state, seat);
  return ms.length ? ms[Math.floor(rnd() * ms.length)] : null;
}

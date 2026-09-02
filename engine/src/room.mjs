// 房間層：邀請連結、暱稱、選座位、佈陣倒數、開局。對應規格 RULES-V1.md §6、§8、§9。
// 刻意不依賴任何網路或計時器：時間一律由呼叫端傳入 now(毫秒)，方便測試與移植到 Durable Object。
//
// 座位模型（通用版）：一個玩家持有 1~2 個座位，且兩個座位必須同隊。
//   四人到齊 → 每人一家；兩人 → 各持一隊兩家；三人 → 缺對手那隊的人一人玩兩家。
//   人數不足不用 AI 補位，由同隊隊友接手空位（Lynch 的決定：弱 AI 隊友比自己控兩家更難玩）。
import { SEATS, TEAM_OF } from './board.mjs';
import { validateSetup, viewFor } from './rules.mjs';
import { MODES, SETUP_SECONDS_BY_SEATS, MAX_SEATS_PER_PLAYER, seatsOfTeam } from './modes.mjs';
import { defaultLayout } from './default-layout.mjs';
import { createGame, applyMove } from './game.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 去掉易混淆的 I/L/O/0/1
export const makeInviteCode = (rnd = Math.random, len = 6) =>
  Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)]).join('');

export const NICKNAME_MAX = 12;
// 暱稱會顯示給同房所有人看。前端一律以純文字渲染（textContent），這裡只再擋一層角括號與控制字元，
// 避免任何地方不小心用 innerHTML 就變成注入點。不要過度過濾——像 R&B 這種正常名字要留得住。
export const cleanNickname = (raw) => {
  const kept = [...String(raw ?? '')].filter(ch => ch.codePointAt(0) > 31 && ch !== '<' && ch !== '>');
  return kept.join('').trim().slice(0, NICKNAME_MAX) || '無名氏';
};

// AI 座位用一個假玩家表示，這樣 seatsOf／stateForPlayer／play 全部不用改。
// 為什麼是「假玩家」而不是另一套分支：房間層對「誰持有這個座位」只認 playerId，
// 讓 AI 也有一個 id，整條規則路徑就完全共用，將來抽掉 AI 也不會留下疤痕。
// ⚠ engine/src 不可以 import engine/ai（單向相依），所以這裡只記「哪些座位是 AI」，
//    真正的走子由呼叫端（伺服器）算好再送進 play()。
export const AI_PLAYER = 'ai';

export function createRoom({ mode = 'four', code, fill = 'mate', rnd = Math.random } = {}) {
  if (!MODES[mode]) throw new Error(`未知模式 ${mode}`);
  return {
    code: code ?? makeInviteCode(rnd),
    // fill：人不滿時空位怎麼補。
    //   'mate'＝由同隊隊友接手（Lynch 定的預設：AI 太弱時，跟 AI 當隊友比自己控兩家更難玩）
    //   'ai'  ＝空位交給電腦（雙人合作模式就是兩人一隊打兩家電腦）
    mode, fill, host: null,
    status: 'lobby',            // lobby → setup → playing → ended
    players: new Map(),         // playerId → { id, nickname, connected }
    seats: new Map(),           // seat 0..3 → playerId
    layouts: {}, ready: new Set(),
    setupSeconds: null, setupDeadline: null, game: null,
  };
}

export const seatsOf = (room, playerId) => SEATS.filter(s => room.seats.get(s) === playerId);
const teamsOf = (room, playerId) => new Set(seatsOf(room, playerId).map(TEAM_OF));
const playersOfTeam = (room, team) =>
  [...new Set(seatsOfTeam(team).map(s => room.seats.get(s)).filter(Boolean))];

export function join(room, { playerId, nickname }) {
  const existing = room.players.get(playerId);
  if (existing) { existing.connected = true; return existing; }      // 斷線重連
  if (room.status !== 'lobby') throw new Error('遊戲已開始，無法加入');
  const p = { id: playerId, nickname: cleanNickname(nickname), connected: true };
  room.players.set(playerId, p);
  room.host ??= playerId;                                            // 第一個進來的人是主持人
  return p;
}

export function claimSeat(room, playerId, seat) {
  if (room.status !== 'lobby') throw new Error('遊戲已開始，無法換位');
  if (!room.players.has(playerId)) throw new Error('尚未進入房間');
  if (!SEATS.includes(seat)) throw new Error('沒有這個座位');
  const taker = room.seats.get(seat);
  if (taker && taker !== playerId) throw new Error('這個位置已經有人了');
  const mine = seatsOf(room, playerId);
  if (mine.includes(seat)) return room;
  if (mine.length >= MAX_SEATS_PER_PLAYER) throw new Error(`一個人最多只能坐 ${MAX_SEATS_PER_PLAYER} 個位置`);
  const teams = teamsOf(room, playerId);
  if (teams.size && !teams.has(TEAM_OF(seat))) throw new Error('兩個位置必須在同一隊（對家才是隊友）');
  room.seats.set(seat, playerId);
  return room;
}

export function releaseSeat(room, playerId, seat) {
  if (room.seats.get(seat) === playerId) room.seats.delete(seat);
  return room;
}

export const isFull = (room) => room.seats.size === 4;

// 開局條件：兩隊各至少要有一個人。空位由同隊隊友接手（持有座位較少的人優先）。
export function canStart(room) {
  if (room.status !== 'lobby') return { ok: false, reason: '遊戲已經開始了' };
  // fill='ai' 時空位交給電腦，所以一整隊都沒人也可以開（雙人合作模式就是這樣：
  // 兩個人一隊，對面兩家全是電腦）。fill='mate' 才需要兩隊都有人。
  if (room.fill !== 'ai')
    for (const team of [0, 1])
      if (playersOfTeam(room, team).length === 0)
        return { ok: false, reason: `${team === 0 ? '隊A（上下家）' : '隊B（左右家）'}還沒有人` };
  if (!seatsOf(room, room.host).length && ![...room.seats.values()].some(Boolean))
    return { ok: false, reason: '還沒有人入座' };
  return { ok: true };
}

function fillEmptySeats(room) {
  for (const seat of SEATS) {
    if (room.seats.has(seat)) continue;
    if (room.fill === 'ai') {                      // 空位交給電腦
      if (!room.players.has(AI_PLAYER))
        room.players.set(AI_PLAYER, { id: AI_PLAYER, nickname: '電腦', connected: true, ai: true });
      room.seats.set(seat, AI_PLAYER);
      continue;
    }
    const team = TEAM_OF(seat);
    const candidates = playersOfTeam(room, team)
      .filter(pid => seatsOf(room, pid).length < MAX_SEATS_PER_PLAYER)
      .sort((a, b) => seatsOf(room, a).length - seatsOf(room, b).length);
    if (!candidates.length) throw new Error(`座位 P${seat} 沒有人能接手`);
    room.seats.set(seat, candidates[0]);
  }
}

// 這一步輪到電腦嗎？伺服器用它決定要不要代打。
export const isAiTurn = (room) =>
  room.status === 'playing' && room.seats.get(room.game.turn) === AI_PLAYER;

// AI 佔的座位（伺服器要幫它們交佈陣）
export const aiSeats = (room) => SEATS.filter(s => room.seats.get(s) === AI_PLAYER);

// 主持人按開局（或四人坐滿）→ 補齊空位、進入佈陣階段。
export function startSetup(room, now, { by = null, layoutFactory = defaultLayout } = {}) {
  const can = canStart(room);
  if (!can.ok) throw new Error(can.reason);
  if (by && by !== room.host && !isFull(room)) throw new Error('人不滿時只有主持人可以開局');
  fillEmptySeats(room);
  const maxSeats = Math.max(...[...new Set(room.seats.values())].map(pid => seatsOf(room, pid).length));
  room.setupSeconds = SETUP_SECONDS_BY_SEATS[maxSeats];
  room.status = 'setup';
  room.setupDeadline = now + room.setupSeconds * 1000;
  for (const s of SEATS) room.layouts[s] = layoutFactory(s);
  room.ready.clear();
  return room;
}

export function submitLayout(room, playerId, layoutsBySeat) {
  if (room.status !== 'setup') throw new Error('現在不是佈陣階段');
  const seats = seatsOf(room, playerId);
  if (!seats.length) throw new Error('沒有座位');
  for (const seat of seats) {
    const layout = layoutsBySeat?.[seat];
    if (!layout) continue;                                  // 沒交的沿用亂數預設
    const v = validateSetup(seat, layout);
    if (!v.ok) throw new Error(`P${seat} 佈局不合法：${v.errors.join('；')}`);
    room.layouts[seat] = layout;
  }
  room.ready.add(playerId);
  return room;
}

const seatedPlayers = (room) => [...new Set(room.seats.values())].filter(pid => pid !== AI_PLAYER);
export const allReady = (room) => seatedPlayers(room).every(pid => room.ready.has(pid));

// 全部按完成、或倒數結束 → 開局（§8：都完成就直接開始，不必等倒數結束）
export function maybeStartGame(room, now) {
  if (room.status !== 'setup') return false;
  if (!allReady(room) && now < room.setupDeadline) return false;
  room.game = createGame(room.layouts);
  room.status = 'playing';
  return true;
}

export function play(room, playerId, from, to) {
  if (room.status !== 'playing') throw new Error('遊戲尚未開始');
  if (!seatsOf(room, playerId).includes(room.game.turn)) throw new Error('還沒輪到你');
  const events = applyMove(room.game, from, to);
  if (room.game.status === 'ended') room.status = 'ended';
  return events;
}

// 公開資訊：座位與暱稱。玩家要看得出「右家是哪一位朋友」，所以這一段不經視角過濾。
export function publicState(room) {
  const seats = {};
  for (const [seat, pid] of room.seats) {
    const p = room.players.get(pid);
    seats[seat] = { nickname: p.nickname, connected: p.connected, ai: !!p.ai,
      playsTwoSeats: seatsOf(room, pid).length > 1 };
  }
  return {
    code: room.code, mode: room.mode, host: room.host, status: room.status,
    seats, setupSeconds: room.setupSeconds, setupDeadline: room.setupDeadline,
    readySeats: [...room.ready].flatMap(pid => seatsOf(room, pid)),
    result: room.game?.result ?? null,
    // 以下都是公開資訊（手數、誰出局了），畫面要用來算提和門檻與顯示戰況。
    // 不含任何棋子身分，所以放在公開狀態裡沒有問題。
    plies: room.game?.plies ?? 0,
    pliesSinceCapture: room.game?.pliesSinceCapture ?? 0,
    eliminated: [...(room.game?.eliminated ?? [])],
  };
}

// 送給單一玩家的完整畫面：公開資訊 + 只屬於他的棋子身分。
// 持有兩個座位的人，兩家的棋子都看得到——這是 Lynch 明確接受的失衡；
// 日後要平衡的話，旋鈕就在這一行（只給第二家操作權、不給可見度）。
export function stateForPlayer(room, playerId) {
  const pub = publicState(room);
  const p = room.players.get(playerId);
  const mySeats = seatsOf(room, playerId);
  const you = p ? { nickname: p.nickname, seats: mySeats, isHost: room.host === playerId } : null;
  // 佈陣階段要把**他自己那幾家的佈陣**送給他，否則他看不到自己的棋子、無從調整。
  // 這不算洩漏：那本來就是他的棋。別人的佈陣一個字都不送。
  const yourLayouts = {};
  for (const s of mySeats) if (room.layouts[s]) yourLayouts[s] = { ...room.layouts[s] };
  if (!room.game) return { ...pub, you, yourLayouts, board: null };
  return { ...pub, you, yourLayouts, board: viewFor(room.game, mySeats),
    yourTurn: mySeats.includes(room.game.turn) };
}

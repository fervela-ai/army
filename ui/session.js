// 對局連線層。畫面只透過這裡拿資料，拿到的永遠是「這個座位看得到的」盤面。
//
// 為什麼要有這一層：AI 之後要跑在伺服器上（更新方便，也不會被抓走演算法），
// 而且暗棋的裁判本來就該在伺服器——身分留在瀏覽器裡，理論上打開開發者工具就能偷看。
// 這一層把「房間怎麼跑的」跟「畫面怎麼畫」切開：今天是 localSession（全部在瀏覽器裡跑），
// 之後加一個 remoteSession（fetch 到 Cloudflare Worker），畫面那邊一行都不用改。
//
// 所有方法都是 async——即使本機版根本不用等。這樣換成連線版時，呼叫端不必重寫。
import { SEATS } from '../engine/src/board.mjs?v=54';
import { legalMoves, validateSetup, movePath } from '../engine/src/rules.mjs?v=54';
import {
  createRoom, join, claimSeat, startSetup, submitLayout, maybeStartGame,
  play, stateForPlayer,
} from '../engine/src/room.mjs?v=54';
import { doctrineLayout } from '../engine/ai/doctrine-layout.mjs?v=54';
import { chooseMove, createMemory, observe, noteOwnMove } from '../engine/ai/ai.mjs?v=54';
import { searchMove } from '../engine/ai/search.mjs?v=54';

export function localSession({ solo = true, useSearch = () => false, names }) {
  const room = createRoom({ mode: 'four', code: 'LOCAL1' });
  for (const s of SEATS) {
    join(room, { playerId: `p${s}`, nickname: names[s] });
    claimSeat(room, `p${s}`, s);
  }
  startSetup(room, Date.now());
  const memories = Object.fromEntries(SEATS.map(s => [s, createMemory(s)]));
  const record = [];
  const isAI = (seat) => solo && seat !== 0;

  // 電腦不用等你，開場就照心法把自己的陣排好
  if (solo) {
    for (const s of [1, 2, 3]) {
      room.layouts[s] = doctrineLayout(s);
      submitLayout(room, `p${s}`, { [s]: room.layouts[s] });
    }
  }

  const snapshot = (viewer) => ({
    status: room.status,
    turn: room.game?.turn ?? null,
    plies: room.game?.plies ?? 0,
    setupDeadline: room.setupDeadline,
    ready: new Set(room.ready),
    board: stateForPlayer(room, `p${viewer}`).board,
    result: room.game?.result ?? null,
    eliminated: new Set(room.game?.eliminated ?? []),
    revealedFlags: new Set(room.game?.revealedFlags ?? []),
  });

  return {
    isAI,
    snapshot: async (viewer) => snapshot(viewer),
    // 只有本人拿得到自己的佈陣。伺服器版也會是這樣。
    layout: async (seat) => ({ ...room.layouts[seat] }),

    // 走法由這一層算。伺服器版也是這樣——前端沒有完整盤面，本來就算不出來，
    // 而且「哪些格子能走」問伺服器要，也順便擋掉前端偽造走法。
    legalMoves: async (seat, from) => {
      if (room.status !== 'playing' || room.game.at.get(from)?.seat !== seat) return [];
      return legalMoves(room.game, from);
    },

    setLayout: async (seat, layout) => {
      const v = validateSetup(seat, layout);
      if (!v.ok) return { ok: false, error: v.errors[0] };
      room.layouts[seat] = { ...layout };
      return { ok: true };
    },

    swap: async (seat, a, b) => {
      const layout = { ...room.layouts[seat] };
      [layout[a], layout[b]] = [layout[b], layout[a]];
      const v = validateSetup(seat, layout);
      if (!v.ok) return { ok: false, error: v.errors[0] };
      room.layouts[seat] = layout;
      return { ok: true };
    },

    confirmSetup: async (seat) => {
      submitLayout(room, `p${seat}`, { [seat]: room.layouts[seat] });
      return { started: maybeStartGame(room, Date.now()) };
    },
    tick: async (now) => ({ started: room.status === 'setup' && maybeStartGame(room, now) }),

    // 走一步。回傳的事件已經替 viewer 過濾好：看不到的身分就是 null。
    move: async (seat, from, to, { viewer, reveal = false } = {}) => {
      const known = reveal || seat === viewer;
      const piece = known ? room.game.at.get(from)?.piece ?? null : null;
      const truePiece = room.game.at.get(from)?.piece ?? null;   // 進棋譜用，不給畫面
      const path = movePath(room.game, from, to);
      const before = stateForPlayer(room, `p${viewer}`).board;
      const events = play(room, `p${seat}`, from, to);
      for (const s of SEATS) observe(memories[s], events);       // AI 只吸收公開事件
      const mv = events.find(e => e.type === 'move');
      record.push({ seat, from, to, piece: truePiece, outcome: mv.outcome, ply: room.game.plies });
      return { events, move: { ...mv, path, piece }, before };
    },

    // 輪到電腦時問它下哪。想什麼、記得什麼，全留在這一層裡。
    aiMove: async (seat) => {
      const mv = useSearch()
        ? searchMove(room.game, seat, memories[seat], { budgetMs: 220 })
        : chooseMove(room.game, seat, memories[seat]);
      if (!mv) return null;
      memories[seat].pending = { to: mv.to, piece: room.game.at.get(mv.from).piece };
      noteOwnMove(memories[seat], mv);
      return mv;
    },

    record: async () => ({ layouts: room.layouts, moves: record }),
    // 全部掀開只有單機練習給——連線版不會有這個入口
    revealAll: async () => {
      if (!solo || !room.game) return null;
      const at = {};
      for (const [id, o] of room.game.at) at[id] = { seat: o.seat, piece: o.piece };
      return { at, turn: room.game.turn, revealedFlags: [...room.game.revealedFlags] };
    },
    // 佈陣階段的盤面：只有正在排的那家看得到自己的棋子身分
    setupBoard: async (seat) => {
      const at = {};
      for (const s of SEATS)
        for (const [id, piece] of Object.entries(room.layouts[s]))
          at[id] = s === seat ? { seat: s, piece } : { seat: s };
      return { at, turn: seat, revealedFlags: [] };
    },
  };
}

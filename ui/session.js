// 對局連線層。畫面只透過這裡拿資料，拿到的永遠是「這個座位看得到的」盤面。
//
// 為什麼要有這一層：AI 之後要跑在伺服器上（更新方便，也不會被抓走演算法），
// 而且暗棋的裁判本來就該在伺服器——身分留在瀏覽器裡，理論上打開開發者工具就能偷看。
// 這一層把「房間怎麼跑的」跟「畫面怎麼畫」切開：今天是 localSession（全部在瀏覽器裡跑），
// 之後加一個 remoteSession（fetch 到 Cloudflare Worker），畫面那邊一行都不用改。
//
// 所有方法都是 async——即使本機版根本不用等。這樣換成連線版時，呼叫端不必重寫。
import { SEATS, TEAM_OF } from '../engine/src/board.mjs?v=190';
import { gameStats } from '../engine/src/game-stats.mjs?v=190';
import { legalMoves, validateSetup, movePath } from '../engine/src/rules.mjs?v=190';
import {
  createRoom, join, claimSeat, startSetup, submitLayout, maybeStartGame,
  play, stateForPlayer,
} from '../engine/src/room.mjs?v=190';
import { doctrineLayout } from '../engine/ai/doctrine-layout.mjs?v=190';
import { VALUE } from '../engine/ai/lookahead.mjs?v=190';
import { chooseMove, createMemory, observe, noteOwnMove } from '../engine/ai/ai.mjs?v=190';
import { searchMove } from '../engine/ai/search.mjs?v=190';

// controllers：四個座位分別由誰控制。'ai' 或玩家代號（'A'、'B'）。
// 所有模式都只是這張表的不同填法——引擎那層本來就是用「座位→玩家」在跑的：
//   單人          ['A', 'ai', 'ai', 'ai']
//   雙人合作      ['A', 'ai', 'B', 'ai']    兩個真人同一隊，打兩家電腦
//   雙人敵對各配AI ['A', 'B', 'ai', 'ai']   兩個真人分屬兩隊，各帶一個電腦隊友
//   雙人敵對各控兩家 ['A', 'B', 'A', 'B']   一人控一整隊（規格 §8）
export function localSession({ controllers = ['A', 'ai', 'ai', 'ai'], useSearch = () => false, names }) {
  const room = createRoom({ mode: 'four', code: 'LOCAL1' });
  // 同一個真人持有的座位要掛在同一個 playerId 底下，
  // 引擎才知道「這兩家是同一個人」——佈陣時限與視野都靠這個。
  const pidOf = (seat) => (controllers[seat] === 'ai' ? `ai${seat}` : `h${controllers[seat]}`);
  const joined = new Set();
  for (const s of SEATS) {
    const pid = pidOf(s);
    if (!joined.has(pid)) { join(room, { playerId: pid, nickname: names[s] }); joined.add(pid); }
    claimSeat(room, pid, s);
  }
  startSetup(room, Date.now());
  const memories = Object.fromEntries(SEATS.map(s => [s, createMemory(s)]));
  const record = [];
  const isAI = (seat) => controllers[seat] === 'ai';
  const ownerOf = (seat) => controllers[seat];
  // 這個人持有哪些座位（視野要一次給齊：自己兩家的棋子彼此看得到）
  const seatsOwnedBy = (who) => SEATS.filter(s => controllers[s] === who);

  // 電腦不用等人，開場就照心法把自己的陣排好
  for (const s of SEATS) {
    if (!isAI(s)) continue;
    room.layouts[s] = doctrineLayout(s);
    submitLayout(room, pidOf(s), { [s]: room.layouts[s] });
  }

  const snapshot = (viewer) => ({
    status: room.status,
    turn: room.game?.turn ?? null,
    plies: room.game?.plies ?? 0,
    setupDeadline: room.setupDeadline,
    pliesSinceCapture: room.game?.pliesSinceCapture ?? 0,
    // 還在場上的家數。提和的門檻是「家數 × 8 回合」——出局一家之後，
    // 同樣的手數其實代表更多輪，用固定手數會問得太晚（Lynch）。
    liveSeats: room.game ? SEATS.filter(s => !room.game.eliminated.has(s)).length : 4,
    // 用「座位」表示誰佈陣好了。房間內部記的是 playerId，
    // 但畫面關心的是座位——一人控兩家時兩者不是一對一。
    readySeats: new Set(SEATS.filter(s => room.ready.has(pidOf(s)))),
    board: stateForPlayer(room, pidOf(viewer)).board,
    result: room.game?.result ?? null,
    eliminated: new Set(room.game?.eliminated ?? []),
    revealedFlags: new Set(room.game?.revealedFlags ?? []),
  });

  return {
    isAI, ownerOf, seatsOwnedBy, controllers,
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
      submitLayout(room, pidOf(seat), { [seat]: room.layouts[seat] });
      return { started: maybeStartGame(room, Date.now()) };
    },
    tick: async (now) => ({ started: room.status === 'setup' && maybeStartGame(room, now) }),

    // 走一步。回傳的事件已經替 viewer 過濾好：看不到的身分就是 null。
    move: async (seat, from, to, { viewer, reveal = false } = {}) => {
      const known = reveal || seat === viewer;
      const piece = known ? room.game.at.get(from)?.piece ?? null : null;
      const truePiece = room.game.at.get(from)?.piece ?? null;   // 進棋譜用，不給畫面
      const victim = room.game.at.get(to)?.piece ?? null;        // 被吃掉的是什麼，統計要用
      const path = movePath(room.game, from, to);
      const before = stateForPlayer(room, pidOf(viewer)).board;
      const events = play(room, pidOf(seat), from, to);
      for (const s of SEATS) observe(memories[s], events);       // AI 只吸收公開事件
      const mv = events.find(e => e.type === 'move');
      record.push({ seat, from, to, piece: truePiece, victim, outcome: mv.outcome, ply: room.game.plies });
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

    // 提和：60 手無吃子才判和，對人來說太久了（Lynch）。過了一半就可以問。
    // 電腦怎麼決定？看盤面棋力差——明顯領先的一方沒有理由接受和局，
    // 這跟真人一樣：你占上風時不會答應對手求和。
    offerDraw: async (seat) => {
      if (!room.game || room.status !== 'playing') return { accepted: false };
      const mine = [], theirs = [];
      for (const [, o] of room.game.at)
        (TEAM_OF(o.seat) === TEAM_OF(seat) ? mine : theirs).push(VALUE[o.piece] ?? 10);
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      const edge = sum(theirs) - sum(mine);        // 正數＝對手占上風
      // 對手明顯占上風就不接受（門檻約等於一顆師長）
      const accepted = edge < 45;
      if (accepted) {
        room.game.result = { type: 'draw', reason: 'agreed' };
        room.status = 'ended';
      }
      return { accepted, edge };
    },

    // 認輸：走進死棋時要有出口。沒有出口的話玩家只能按「重新開局」，
    // 那會讓這一局的棋譜被下一局蓋掉——而「人玩不下去的那一局」正是最該留下的資料。
    resign: async (seat) => {
      if (!room.game || room.status !== 'playing') return null;
      room.game.result = { type: 'win', team: TEAM_OF(seat) === 0 ? 1 : 0, reason: 'resign' };
      room.status = 'ended';
      return room.game.result;
    },

    // 對戰統計。只有連線層算得出來——它才知道每顆棋子的真實身分。
    // Lynch 要的三項：殘子（1/2/3）、出兵勝率、炸彈換到 1/2 的獎勵。
    // 這也是之後要做積分／獎勵系統的地基。
    stats: async (seat) => gameStats({
      pieces: room.game ? [...room.game.at.values()] : [],
      moves: record, seat, plies: room.game?.plies ?? 0,
    }),

    record: async () => ({ layouts: room.layouts, moves: record }),
    // 全部掀開只有單機練習給——連線版不會有這個入口
    revealAll: async () => {
      if (!room.game) return null;
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

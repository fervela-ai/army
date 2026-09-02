// 連線版的對局：跟 localSession 長得一模一樣，所以 app.js 一行都不用改。
//
// 這條界線是當初就鋪好的（CLAUDE.md「架構決定：AI 跑在伺服器」）：
// 畫面只跟這一層要「我看得到的東西」，不碰房間、不碰別人的棋子身分。
//
// 兩邊真正的差別只有一個：**權威在誰身上**。
//   localSession：房間就在瀏覽器裡，說了算。
//   remoteSession：伺服器說了算，這裡只是把動作送出去、把推回來的狀態存起來。
// 所以這裡不做任何「先假裝走了」的樂觀更新——暗棋一旦前後端狀態不一致，
// 玩家會看到自己的棋子跳回去，比慢半秒難受得多。
import { SEATS } from '../engine/src/board.mjs?v=187';
import { legalMoves as calcLegalMoves, validateSetup, movePath } from '../engine/src/rules.mjs?v=187';
import { GAME_WS } from './config.js?v=187';
import { ensureAccount } from './account.js?v=187';
import { randomLayout } from '../engine/src/random-layout.mjs?v=187';

export async function remoteSession({ code, nickname, onState, onError } = {}) {
  const acc = await ensureAccount();
  let state = null;                  // 伺服器推來的最新狀態
  let events = [];                   // 最近一手的事件（給動畫）
  let draft = {};                    // 佈陣階段自己那幾家的暫存陣型
  const waiters = [];                // 等下一則狀態的人

  const ws = new WebSocket(
    `${GAME_WS}/room/${encodeURIComponent(code)}/ws` +
    `?token=${encodeURIComponent(acc.token)}&nick=${encodeURIComponent(nickname ?? '')}`);

  const nextState = () => new Promise((resolve) => waiters.push(resolve));

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('連不上伺服器')), { once: true });
  });

  ws.addEventListener('message', (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'error') { onError?.(msg.message); return; }
    if (msg.type !== 'state') return;
    state = msg.state;
    events = msg.events ?? [];
    // 佈陣階段：第一次拿到自己的陣型就存成草稿，之後以本機的草稿為準
    // （玩家正在拖曳，不能被伺服器推來的預設陣型蓋掉）。
    for (const [seat, layout] of Object.entries(state.yourLayouts ?? {}))
      draft[seat] ??= { ...layout };
    // ⚠ 伺服器沒給我的陣型時，自己先生一份——不然佈陣畫面上一顆棋子都沒有，
    //    玩家完全動不了（實際踩過：Worker 版本較舊，yourLayouts 是空的）。
    //    這不是猜伺服器的狀態：按下「確定佈陣」時送出去的本來就是這份草稿，送出即為準。
    if (state.status === 'setup')
      for (const seat of state.you?.seats ?? []) draft[seat] ??= randomLayout(seat);
    while (waiters.length) waiters.shift()(state);
    onState?.(state);
  });

  ws.addEventListener('close', () => onError?.('與伺服器的連線中斷'));

  const send = (action) => ws.send(JSON.stringify(action));
  const mySeats = () => state?.you?.seats ?? [];
  const seatSet = (arr) => new Set(arr ?? []);

  // 走法在本機算得出來——自己棋子的身分本來就在手上，位置又是公開的。
  // 這不是信任前端：伺服器收到走子時會**再驗一次**，前端算錯或造假都過不了。
  const gameLike = () => {
    if (!state?.board) return null;
    const at = new Map(Object.entries(state.board.at));
    return { at, turn: state.board.turn, revealedFlags: new Set(state.board.revealedFlags ?? []) };
  };

  return {
    // 連線版沒有「本機的 AI」——電腦在伺服器上跑
    isAI: () => false,
    ownerOf: (seat) => (mySeats().includes(seat) ? 'me' : 'other'),
    seatsOwnedBy: () => mySeats(),
    get controllers() { return SEATS.map(s => (mySeats().includes(s) ? 'me' : 'other')); },

    // 座位上顯示的名字：連線版要顯示真人的暱稱，而不是「你／對家」這種固定字串
    seatNames: () => SEATS.map(s => {
      const info = state?.seats?.[s];
      if (!info) return `P${s}`;
      const mine = mySeats().includes(s);
      // 電腦那家的暱稱本來就是「電腦」，不要再加一次括號變成「電腦（電腦）」
      return info.ai ? info.nickname
        : mine ? `${info.nickname}（你）`
        : info.connected ? info.nickname : `${info.nickname}（離線）`;
    }),

    // 房間資訊（大廳畫面要用）
    roomInfo: () => (state ? {
      code: state.code, mode: state.mode, status: state.status,
      seats: state.seats, you: state.you, isHost: !!state.you?.isHost,
    } : null),

    snapshot: async () => ({
      status: state?.status ?? 'lobby',
      turn: state?.board?.turn ?? null,
      plies: state?.plies ?? 0,
      setupDeadline: state?.setupDeadline ?? null,
      pliesSinceCapture: state?.pliesSinceCapture ?? 0,
      liveSeats: 4 - (state?.eliminated?.length ?? 0),
      readySeats: seatSet(state?.readySeats),
      board: state?.board ?? null,
      result: state?.result ?? null,
      eliminated: seatSet(state?.eliminated),
      revealedFlags: seatSet(state?.board?.revealedFlags),
    }),

    layout: async (seat) => ({ ...(draft[seat] ?? {}) }),

    legalMoves: async (seat, from) => {
      const g = gameLike();
      if (!g || state.status !== 'playing') return [];
      if (g.at.get(from)?.seat !== seat) return [];
      try { return calcLegalMoves(g, from); } catch { return []; }
    },

    setLayout: async (seat, layout) => {
      const v = validateSetup(seat, layout);
      if (!v.ok) return { ok: false, error: v.errors[0] };
      draft[seat] = { ...layout };
      return { ok: true };
    },

    swap: async (seat, a, b) => {
      const layout = { ...(draft[seat] ?? {}) };
      [layout[a], layout[b]] = [layout[b], layout[a]];
      const v = validateSetup(seat, layout);
      if (!v.ok) return { ok: false, error: v.errors[0] };
      draft[seat] = layout;
      return { ok: true };
    },

    confirmSetup: async () => {
      send({ type: 'layout', layouts: draft });
      const s = await nextState();
      return { started: s.status === 'playing' };
    },

    // 倒數由伺服器的鬧鐘處理，前端不需要推它——但介面要留著，app.js 會叫。
    tick: async () => ({ started: state?.status === 'playing' }),

    move: async (seat, from, to) => {
      const g = gameLike();
      const before = g ? { at: Object.fromEntries(g.at), turn: g.turn } : null;
      let path = [from, to];
      try { if (g) path = movePath(g, from, to); } catch { /* 伺服器會再算一次 */ }
      send({ type: 'move', from, to });
      await nextState();
      const mv = events.find(e => e.type === 'move');
      return { events, move: mv ? { ...mv, path: mv.path ?? path } : null, before };
    },

    // 電腦在伺服器上自己走，前端不必問
    aiMove: async () => null,

    offerDraw: async () => {
      send({ type: 'offerDraw' });
      await nextState();
      return { accepted: state?.result?.type === 'draw' };
    },

    resign: async () => {
      send({ type: 'resign' });
      await nextState();
      return state?.result ?? null;
    },

    // 統計要看全場真實身分，只有伺服器算得出來。還沒接，先回 null，
    // app.js 收到 null 就不畫統計那一段（結算畫面仍然會出現）。
    stats: async () => null,
    record: async () => null,
    revealAll: async () => null,           // 連線版永遠不給：那是單機除錯用的

    setupBoard: async (seat) => {
      const at = {};
      for (const [s, layout] of Object.entries(draft))
        for (const [id, piece] of Object.entries(layout))
          at[id] = Number(s) === seat ? { seat: Number(s), piece } : { seat: Number(s) };
      return { at, turn: seat, revealedFlags: [] };
    },

    // 大廳階段的動作（入座、開始）沒有回傳值，直接送出去等伺服器推新狀態。
    // 不做成一個個方法是因為那只是轉發，包起來反而多一層要維護。
    send: (action) => send(action),

    close: () => ws.close(),
  };
}

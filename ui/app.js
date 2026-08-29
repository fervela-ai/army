// 本機測試版。預設「單人（三家電腦）」：你坐下家，其餘三家由 AI 操作。
// 也可以切成熱座四人（四個人輪流用同一台電腦），那時走完會等你按「換手」才轉視角——
// 立刻轉視角會讓人看不到自己剛剛走了什麼。
import { SEATS } from '../engine/src/board.mjs?v=48';
import { randomLayout } from '../engine/src/random-layout.mjs?v=48';
import { localSession } from './session.js?v=48';
import { RECORD_ENDPOINT, AI_VERSION } from './config.js?v=48';
import { createBoardView } from './board.js?v=48';
import { SFX, setEnabled } from './sound.js?v=48';

const NAMES = ['你', '右家', '對家', '左家'];
const SAVE_KEY = 'army-online:layouts:v2';
const GAMES_KEY = 'army-online:games';
const PLAYER_KEY = 'army-online:player';      // 玩家代稱，問過一次就記住
const CURRENT_KEY = 'army-online:current';   // 進行中的棋局，中途中斷也不會遺失        // 保留最近幾局的完整棋譜，供事後分析   // { 名稱: { seat, layout, savedAt } }
const els = Object.fromEntries(['board', 'turn', 'seats', 'log', 'revealAll', 'restart', 'soloMode', 'soundOn',
  'setupbar', 'setupWho', 'setupTimer', 'setupHint', 'btnRandom', 'btnSave', 'btnLoad', 'btnConfirm',
  'overlay', 'overlayEmblem', 'overlayTitle', 'overlaySub', 'overlayAgain',
  'modal', 'modalTitle', 'modalBody', 'modalActions', 'useSearch']
  .map(id => [id, document.getElementById(id)]));

// session = 這場對局的連線層（見 session.js）。畫面只跟它要「我看得到的東西」，
// 不再自己抱著整個房間——AI 之後要搬到伺服器，這裡就只換成 remoteSession。
let session = null, selected = null, moves = [], logLines = [], setupSeat = 0, ticker = null;
let myLayout = {}, busy = false, viewSeatOverride = null, lastMove = null;
// S = 最近一次的快照。refresh() 是同步的，所以畫面永遠畫 S，由 sync() 負責更新它。
let S = { status: 'setup', turn: null, plies: 0, setupDeadline: 0, ready: new Set(),
  board: null, displayBoard: null, result: null, eliminated: new Set(), revealedFlags: new Set() };

// 每一局一個代號。朋友回報「我第三局那個 bug」時，才對得上是哪一局棋譜。
// 用不會看錯的字母（拿掉 0/O/1/I），代號才唸得出來、抄得對。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newGameCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}
let gameCode = newGameCode();

const playerName = () => localStorage.getItem(PLAYER_KEY) || '';

// 進站先問一次代稱，之後每局自動帶入。問了才知道棋譜是誰下的。
function askNickname() {
  return new Promise((resolve) => {
    if (playerName()) { resolve(); return; }
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.className = 'modal-input';
    input.placeholder = '例如：老王、阿明';
    input.maxLength = 12;
    const note = document.createElement('div');
    note.className = 'modal-note';
    // 說清楚會留下什麼。朋友有權知道自己打的字會被存起來。
    note.textContent = '代稱會跟你的棋譜一起存起來，用來改進電腦的棋力。請不要用真名。';
    wrap.append(input, note);
    showModal({
      title: '你怎麼稱呼？',
      body: wrap,
      actions: [{
        label: '開始', primary: true, onClick: () => {
          localStorage.setItem(PLAYER_KEY, input.value.trim().slice(0, 12) || '無名氏');
          closeModal();
          resolve();
        },
      }],
    });
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') wrap.parentElement?.querySelector('.btn--primary')?.click(); });
  });
}

const solo = () => els.soloMode.checked;
const isAI = (seat) => session?.isAI(seat) ?? false;

async function sync() {
  S = await session.snapshot(viewSeat());
  S.displayBoard = S.status === 'setup' ? await session.setupBoard(setupSeat)
    : (els.revealAll.checked ? await session.revealAll() : S.board);
  refresh();
}

async function newGame() {
  clearInterval(ticker);
  gameCode = newGameCode();
  // 電腦用心法佈陣（三角雷護旗、大子後接工兵再接炸彈）。
  // 同一個 AI 換成心法佈陣後，對上亂數佈陣的勝率是 96.5%——佈陣的影響非常大。
  session = localSession({ solo: solo(), useSearch: () => els.useSearch.checked, names: NAMES });
  setupSeat = 0;
  myLayout = await session.layout(0);
  selected = null; moves = []; logLines = []; busy = false; viewSeatOverride = null;
  resultShown = false; lastMove = null; els.overlay.hidden = true;

  if (solo()) addLog('單人練習：你對三家電腦', true);
  addLog('佈陣開始，兩分鐘倒數');
  startTicker();
  await sync();
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(async () => {
    if (S.status !== 'setup') { clearInterval(ticker); return; }
    if ((await session.tick(Date.now())).started) {
      clearInterval(ticker);
      addLog('佈陣時間到，開局', true);
      await sync();
      afterStart();
      return;
    }
    renderTimer();          // 只改倒數那一行字。整盤重畫會把點擊吃掉，佈陣就變得很難點。
  }, 250);
}

function renderTimer() {
  if (S.status !== 'setup') return;
  const left = Math.max(0, S.setupDeadline - Date.now());
  els.setupTimer.textContent =
    `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
  els.setupTimer.classList.toggle('is-urgent', left < 30000);
}

const currentSeat = () => S.turn;
const viewSeat = () => viewSeatOverride ?? (S.status === 'setup' ? setupSeat
  : (solo() ? 0 : (S.turn ?? 0)));

function addLog(text, big = false) {
  logLines.unshift({ text, big });
  logLines = logLines.slice(0, 60);
}
function hint(text, isError = false) {
  els.setupHint.textContent = text;
  els.setupHint.classList.toggle('is-error', isError);
  if (isError) SFX.reject();
}

// ---- 佈陣 ----
async function trySwap(a, b) {
  const r = await session.swap(setupSeat, a, b);
  if (!r.ok) { hint(r.error, true); return false; }
  myLayout = await session.layout(setupSeat);
  hint('已互換');
  SFX.select();
  return true;
}

// 佈陣點選：選取會一直留著，直到你點了另一顆自己的棋子完成互換，或再點一次取消。
// 中間點到空白、點到別家陣地都不會把選取弄丟——那會讓人一直要重點。
async function onSetupClick(id) {
  if (!id.startsWith(`P${setupSeat}-`) || !myLayout[id]) {
    hint(selected ? '這裡不能換，選取還留著' : '只能排自己的陣地', true);
    return;
  }
  // 同一顆再按一次不取消選取。使用者沒看到反應時會直覺再按一下，
  // 如果第二下把選取取消掉，感覺就是「按了三四次才有反應」。取消請按空白處或 Esc。
  if (selected === id) { hint('已選取，點另一顆交換'); return; }
  if (!selected) { selected = id; hint('再點另一顆棋子交換位置'); SFX.select(); await sync(); return; }
  if (await trySwap(selected, id)) selected = null;    // 換失敗時保留選取，方便直接改點別顆
  await sync();
}

async function confirmSetup() {
  selected = null;
  const { started } = await session.confirmSetup(setupSeat);
  if (started) {
    clearInterval(ticker);
    addLog('開局', true);
    await sync();
    afterStart();
    return;
  }
  S = await session.snapshot(viewSeat());
  const next = SEATS.find(s => !S.ready.has(`p${s}`));
  setupSeat = next ?? setupSeat;
  myLayout = await session.layout(setupSeat);
  hint(`換 ${NAMES[setupSeat]} 佈陣`);
  await sync();
}

// ---- 對戰 ----
const OUTCOME_TEXT = {
  moved: '移動', defenderDead: '吃掉對方的棋子',
  attackerDead: '自己的棋子陣亡', bothDead: '同歸於盡',
};
// 同歸於盡多半是炸彈或同階互撞，用爆炸聲
const SFX_BY_OUTCOME = {
  moved: SFX.move, defenderDead: SFX.capture,
  attackerDead: SFX.bounce, bothDead: SFX.explode,
};

async function doMove(seat, from, to) {
  // 連線層一次給齊：走之前的盤面（動畫期間要維持舊畫面，棋子才是「慢慢移過去」）、
  // 實際經過哪些格、以及這顆棋子在「我這個視角」看不看得到身分。
  const { events, move, before: beforeBoard } =
    await session.move(seat, from, to, { viewer: viewSeat(), reveal: els.revealAll.checked });
  const { path, piece } = move;

  moves = []; selected = null; lastMove = null;
  // 動畫期間畫的是舊盤面，並把移動中的那顆藏起來（由分身代勞）
  view.render({ board: beforeBoard, mySeats: [viewSeat()], selected: null, moves: [], hide: [from], viewerSeat: viewSeat() });
  (SFX_BY_OUTCOME[move.outcome] ?? SFX.move)(path.length - 1, view.STEP_MS);
  await view.animateMove({ from, to, seat, outcome: move.outcome, piece, path });

  lastMove = { from, to, seat, path };                       // 留下痕跡，讓大家看清楚誰動了什麼
  // 棋譜含實際身分（連線層才知道），事後才分析得出「這一步好不好」
  try {
    const rec = await session.record();
    localStorage.setItem(CURRENT_KEY, JSON.stringify({
      at: Date.now(), code: gameCode, player: playerName(), aiVersion: AI_VERSION,
      ...rec, plies: S.plies,
      ai: els.useSearch.checked ? 'search' : 'heuristic',
    }));
  } catch { /* 存不下不影響遊戲 */ }
  for (const e of events) {
    if (e.type === 'move') addLog(`${NAMES[e.seat]}：${OUTCOME_TEXT[e.outcome]}`);
    if (e.type === 'flagRevealed') { addLog(`${NAMES[e.seat]} 司令陣亡，軍旗顯露`, true); SFX.alarm(); }
    if (e.type === 'eliminated') { addLog(`${NAMES[e.seat]} 被扛旗，全軍覆沒`, true); SFX.flag(); }
    if (e.type === 'end') addLog(e.team != null ? `隊${e.team === 0 ? 'A' : 'B'} 獲勝` : '和局', true);
  }
  await sync();
}

async function runAIs() {
  while (S.status === 'playing' && isAI(currentSeat())) {
    busy = true; refresh();
    await new Promise(r => setTimeout(r, 420));             // 讓人看得清楚電腦在下哪一步
    const seat = currentSeat();
    const mv = await session.aiMove(seat);                  // 想什麼、記得什麼都在連線層裡
    if (!mv) break;
    await doMove(seat, mv.from, mv.to);
  }
  busy = false;
  refresh();
}

const afterStart = () => { if (solo()) runAIs(); };

function clearSelection() {
  if (!selected && !moves.length) return;
  selected = null; moves = [];
  refresh();
}

async function onPlayClick(id) {
  if (S.status !== 'playing' || busy) return;
  const seat = currentSeat();
  if (isAI(seat)) return;
  const occ = S.board?.at[id];

  if (selected && moves.includes(id)) {
    busy = true;
    await doMove(seat, selected, id);
    busy = false;
    if (solo()) await runAIs();
    else { viewSeatOverride = seat; refresh(); }            // 熱座：先停在自己的視角，按換手才轉
    return;
  }
  // 「這顆能走去哪」問連線層——前端沒有完整盤面，本來就算不出來
  if (occ && occ.piece && occ.seat === seat) {
    const ms = await session.legalMoves(seat, id);
    selected = ms.length ? id : null;
    moves = ms;
    if (ms.length) SFX.select();
  } else { selected = null; moves = []; }
  refresh();
}

// 互動一律走 pointerdown（按下就反應），pointerup 只負責「拖過去放開」這種用法。
let pressedOn = null;
const view = createBoardView(els.board, {
  onNodeClick: (id) => {
    pressedOn = id;
    return S.status === 'setup' ? onSetupClick(id) : onPlayClick(id);
  },
  onPointerUp: (id) => {
    const from = pressedOn;
    pressedOn = null;
    if (!from || from === id) return;                  // 原地放開＝單純點一下，前面已經處理過
    if (S.status === 'setup') {                        // 拖拉互換
      if (!id.startsWith(`P${setupSeat}-`) || !myLayout[id]) return;
      trySwap(from, id).then(ok => { if (ok) selected = null; return sync(); });
    } else if (S.status === 'playing' && moves.includes(id)) {
      onPlayClick(id);                                 // 對戰時也可以直接把棋子拖到目標
    }
  },
});
window.addEventListener('pointerup', () => { pressedOn = null; });
// 按空白處或 Esc 取消選取
els.board.addEventListener('pointerdown', (e) => {
  if (!e.target.closest?.('[data-node]')) clearSelection();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSelection(); });

function refresh() {
  const inSetup = S.status === 'setup';
  const seat = viewSeat();
  view.setBottomSeat(seat);
  els.setupbar.hidden = !inSetup;

  const board = S.displayBoard;
  view.render({
    board, mySeats: inSetup ? [setupSeat] : [seat],
    selected, moves, revealedFlags: board?.revealedFlags ?? [],
    lastMove: inSetup ? null : lastMove, viewerSeat: seat,
  });

  if (inSetup) {
    els.setupWho.textContent = `${NAMES[setupSeat]} 佈陣中`;
    renderTimer();
    els.turn.textContent = '佈陣階段';
  } else if (S.status === 'ended') {
    els.turn.textContent = S.result.type === 'win'
      ? `隊${S.result.team === 0 ? 'A' : 'B'} 獲勝` : '和局';
  } else if (viewSeatOverride != null) {
    els.turn.textContent = `你走完了，換 ${NAMES[currentSeat()]}`;
  } else {
    els.turn.textContent = busy ? `${NAMES[currentSeat()]} 思考中…` : `輪到 ${NAMES[currentSeat()]}`;
  }

  els.seats.replaceChildren(...SEATS.map(s => {
    const li = document.createElement('li');
    const ready = S.ready.has(`p${s}`);
    li.className = ['seat', S.turn != null && s === currentSeat() ? 'is-turn' : '',
      ready && inSetup ? 'is-ready' : '',
      S.eliminated.has(s) ? 'is-out' : ''].filter(Boolean).join(' ');
    const dot = document.createElement('span');
    dot.className = 'seat-dot';
    dot.style.background = `var(--seat-${s})`;
    const name = document.createElement('span');
    name.textContent = NAMES[s] + (isAI(s) ? '（電腦）' : '');
    const note = document.createElement('span');
    note.className = 'seat-note';
    note.textContent = inSetup ? (ready ? '已完成' : '')
      : (S.revealedFlags.has(s) ? '軍旗已顯露' : '');
    li.append(dot, name, note);
    return li;
  }));

  els.log.replaceChildren(...logLines.map(l => {
    const li = document.createElement('li');
    li.textContent = l.text;
    if (l.big) li.className = 'is-big';
    return li;
  }));

  showResult();

  // 熱座模式：走完先停在自己視角，按了才換手
  let handoff = document.getElementById('handoff');
  if (viewSeatOverride != null && !handoff) {
    handoff = document.createElement('button');
    handoff.id = 'handoff';
    handoff.className = 'btn btn--primary handoff';
    handoff.textContent = `換 ${NAMES[currentSeat()]} 接手`;
    handoff.addEventListener('click', () => { viewSeatOverride = null; handoff.remove(); refresh(); });
    document.querySelector('.stage').appendChild(handoff);
  } else if (viewSeatOverride == null && handoff) handoff.remove();
}

// 結局畫面：贏了要有贏的樣子，不能只在標題列寫一行小字。
let resultShown = false;
function showResult() {
  if (S.status !== 'ended') { els.overlay.hidden = true; resultShown = false; return; }
  if (resultShown) return;
  resultShown = true;
  const r = S.result;
  saveGameRecord(r);
  const myTeam = 0;                                   // 你永遠坐 P0，隊A
  const win = r.type === 'win' && r.team === myTeam;
  const draw = r.type === 'draw';
  els.overlayEmblem.textContent = draw ? '🤝' : (win ? '🏆' : '💀');
  els.overlayTitle.textContent = draw ? '和局' : (win ? '獲勝' : '落敗');
  els.overlayTitle.className = `overlay-title ${draw ? '' : (win ? 'is-win' : 'is-lose')}`;
  els.overlaySub.textContent = draw
    ? (r.reason === 'noCapture' ? '連續 60 步沒有吃子，判和' : '四家都無步可走，判和')
    : `${win ? '你和對家' : '左右兩家'}拿下了對方兩面軍旗　共 ${S.plies} 步`;
  els.overlay.hidden = false;
  (draw ? SFX.flag : (win ? SFX.victory : SFX.defeat))();
}
els.overlayAgain.addEventListener('click', () => { els.overlay.hidden = true; askNickname().then(newGame); });

// 把整局棋譜存起來（含開局佈陣與每一步），最多留 10 局。
// 這是之後分析「人類怎麼下」的原料——沒有棋譜就只能憑印象猜。
// 回傳給本機伺服器存檔。localStorage 是各瀏覽器獨立的，只存在瀏覽器裡我讀不到。
function uploadRecord(record) {
  try {
    fetch(RECORD_ENDPOINT || '/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => { /* 沒有伺服器就算了，不影響遊戲 */ });
  } catch { /* 同上 */ }
}

async function saveGameRecord(result) {
  try {
    const rec = await session.record();
    const all = JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]');
    all.unshift({
      at: Date.now(),
      code: gameCode,
      player: playerName(),
      aiVersion: AI_VERSION,
      mode: solo() ? 'solo' : 'hotseat',
      ai: els.useSearch.checked ? 'search' : 'heuristic',
      result,
      ...rec,
      plies: S.plies,
    });
    localStorage.setItem(GAMES_KEY, JSON.stringify(all.slice(0, 10)));
    uploadRecord(all[0]);
  } catch { /* 棋譜存不下不該影響遊戲 */ }
}

// 除錯掛鉤：本機測試用，方便把局面直接推到某個狀態來驗畫面。
// 連線版不會有這個——正式版的盤面在伺服器上，前端拿不到別人的棋子。
window.__debug = { get session() { return session; }, get snapshot() { return S; },
  refresh, showResult, newGame,
  games: () => JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]'),
  current: () => JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null') };

// 開頁時把先前存過、還沒回傳的棋譜補傳一次（例如伺服器當時還不支援）
(function backfillRecords() {
  try {
    const all = JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]');
    const sent = new Set(JSON.parse(localStorage.getItem(GAMES_KEY + ':sent') ?? '[]'));
    for (const g of all) if (!sent.has(g.at)) { uploadRecord(g); sent.add(g.at); }
    const cur = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null');
    if (cur && !sent.has(cur.at)) uploadRecord({ ...cur, result: null, unfinished: true });
    localStorage.setItem(GAMES_KEY + ':sent', JSON.stringify([...sent]));
  } catch { /* 補傳失敗不影響遊戲 */ }
})();

els.btnRandom.addEventListener('click', async () => {
  await session.setLayout(setupSeat, randomLayout(setupSeat));
  myLayout = await session.layout(setupSeat);
  selected = null; hint('已隨機重排'); await sync();
});
// ── 陣型管理：可以存很多套、各自取名 ──
const loadAll = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}'); } catch { return {}; } };
const saveAll = (all) => localStorage.setItem(SAVE_KEY, JSON.stringify(all));

function showModal({ title, body, actions }) {
  els.modalTitle.textContent = title;
  els.modalBody.replaceChildren(body);
  els.modalActions.replaceChildren(...actions.map(a => {
    const b = document.createElement('button');
    b.className = `btn${a.primary ? ' btn--primary' : ''}${a.danger ? ' btn--danger' : ''}`;
    b.textContent = a.label;
    b.addEventListener('click', () => { a.onClick?.(); });
    return b;
  }));
  els.modal.hidden = false;
}
const closeModal = () => { els.modal.hidden = true; };

els.btnSave.addEventListener('click', () => {
  const wrap = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '幫這套陣型取個名字';
  input.value = `陣型 ${Object.keys(loadAll()).length + 1}`;
  const note = document.createElement('div');
  note.className = 'modal-empty';
  note.textContent = '同名會覆蓋掉舊的那一套。';
  wrap.append(input, note);
  showModal({
    title: '儲存陣型',
    body: wrap,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '儲存', primary: true, onClick: () => {
          const name = input.value.trim() || '未命名';
          const all = loadAll();
          all[name] = { seat: setupSeat, layout: myLayout, savedAt: Date.now() };
          saveAll(all);
          closeModal();
          hint(`已儲存「${name}」`);
        },
      },
    ],
  });
  input.focus(); input.select();
});

els.btnLoad.addEventListener('click', () => {
  const all = loadAll();
  const names = Object.keys(all).sort((x, y) => all[y].savedAt - all[x].savedAt);
  const list = document.createElement('div');
  list.style.display = 'grid';
  list.style.gap = '8px';

  if (!names.length) {
    const empty = document.createElement('div');
    empty.className = 'modal-empty';
    empty.textContent = '還沒有存過任何陣型。排好之後按「儲存陣型」就會出現在這裡。';
    list.append(empty);
  }
  for (const name of names) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const n = document.createElement('span');
    n.className = 'saved-name';
    n.textContent = name;                          // 純文字，名稱不會被當成標記
    const d = document.createElement('span');
    d.className = 'saved-date';
    d.textContent = new Date(all[name].savedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const load = document.createElement('button');
    load.className = 'btn';
    load.textContent = '讀取';
    load.addEventListener('click', async () => {
      const saved = all[name].layout;
      // 存檔也要重新驗證：規則可能已經改過，或是換了座位。驗證在連線層做，
      // 前端說了不算——正式版的佈陣一樣要伺服器點頭。
      const remapped = Object.fromEntries(Object.entries(saved).map(([id, p]) =>
        [id.replace(/^P\d+-/, `P${setupSeat}-`), p]));
      const r = await session.setLayout(setupSeat, remapped);
      if (!r.ok) { hint(`「${name}」不合法：${r.error}`, true); return; }
      myLayout = await session.layout(setupSeat);
      selected = null;
      closeModal();
      hint(`已讀取「${name}」`);
      await sync();
    });
    const del = document.createElement('button');
    del.className = 'btn btn--danger';
    del.textContent = '刪除';
    del.addEventListener('click', () => {
      const rest = loadAll();
      delete rest[name];
      saveAll(rest);
      row.remove();
      hint(`已刪除「${name}」`);
    });
    row.append(n, d, spacer, load, del);
    list.append(row);
  }
  showModal({ title: '讀取陣型', body: list, actions: [{ label: '關閉', onClick: closeModal }] });
});

els.btnConfirm.addEventListener('click', confirmSetup);
els.revealAll.addEventListener('change', sync);
els.soundOn.addEventListener('change', () => setEnabled(els.soundOn.checked));
els.soloMode.addEventListener('change', newGame);
els.restart.addEventListener('click', newGame);
newGame();

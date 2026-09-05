// 本機測試版。預設「單人（三家電腦）」：你坐下家，其餘三家由 AI 操作。
// 也可以切成熱座四人（四個人輪流用同一台電腦），那時走完會等你按「換手」才轉視角——
// 立刻轉視角會讓人看不到自己剛剛走了什麼。
import { SEATS, TEAM_OF, BOARD } from '../engine/src/board.mjs?v=198';
import { randomLayout } from '../engine/src/random-layout.mjs?v=198';
import { localSession } from './session.js?v=198';
import { remoteSession } from './remote-session.js?v=198';
import { createRoom, ensureAccount, currentAccount, redeem, rotateRecovery } from './account.js?v=198';
import { RECORD_ENDPOINT, AI_VERSION } from './config.js?v=198';
import { buildGuide } from './guide.js?v=198';
import { checkAchievements, ACHIEVEMENTS, unlockedIds, titleFor, noteGame } from './achievements.js?v=198';
import { createBoardView } from './board.js?v=198';
import { SFX, setEnabled, VARIANTS, getChoice, setVariant, preview } from './sound.js?v=198';

// 座位名稱隨模式而變：合作模式的對家是「夥伴」，敵對模式的對家可能是「你自己的另一家」。
// 名字錯了，玩家會看不懂戰報在講誰。
const nameOf = (s) => NAMES_OF()[s] ?? ['你', '右家', '對家', '左家'][s];
// 我坐哪一家。單機版永遠是 0；連線版由伺服器分配，可能是任一家。
const mySeat = () => session?.seatsOwnedBy?.()?.[0] ?? 0;
const SAVE_KEY = 'army-online:layouts:v2';
const GAMES_KEY = 'army-online:games';
const PLAYER_KEY = 'army-online:player';      // 玩家代稱，問過一次就記住
const CURRENT_KEY = 'army-online:current';   // 進行中的棋局，中途中斷也不會遺失        // 保留最近幾局的完整棋譜，供事後分析   // { 名稱: { seat, layout, savedAt } }
const els = Object.fromEntries(['board', 'turn', 'seats', 'log', 'revealAll', 'restart', 'mode', 'soundOn', 'home',
  'setupbar', 'setupWho', 'setupTimer', 'setupHint', 'btnRandom', 'btnSave', 'btnLoad', 'btnConfirm', 'btnOtherSeat',
  'overlay', 'overlayEmblem', 'overlayTitle', 'overlaySub', 'overlayCode', 'overlayAgain',
  'modal', 'modalTitle', 'modalBody', 'modalActions', 'useSearch', 'gameCode', 'resign', 'guide', 'debugTools', 'modeTools', 'sfx', 'uiVer', 'online']
  .map(id => [id, document.getElementById(id)]));

// 版本號顯示在標題旁邊：Lynch「V123 我想要標示在某處，這樣方便我看」。
// 值從自己的 import URL 取（?v=198），bump-ui-version.sh 一改就跟著動，不會忘記同步。
const UI_VERSION = new URL(import.meta.url).searchParams.get('v') ?? '?';
if (els.uiVer) els.uiVer.textContent = `v${UI_VERSION}`;

// 自己去看有沒有新版。GitHub Pages 給 index.html 的是 cache-control: max-age=600，
// 所以推上去之後十分鐘內，回訪的人拿到的還是舊頁（Lynch：「我瀏覽器打開還是 V141」）。
// 硬重整解得掉，但朋友不會知道要那樣做——讓頁面自己講。
async function checkForUpdate() {
  try {
    const html = await (await fetch('index.html', { cache: 'no-store' })).text();
    const latest = html.match(/app\.js\?v=(\d+)/)?.[1];
    if (!latest || latest === UI_VERSION || !els.uiVer) return;
    els.uiVer.textContent = `有新版 v${latest}・點我更新`;   // 手機的標題列很窄，寫短一點
    els.uiVer.title = `目前 v${UI_VERSION}，最新 v${latest}`;
    els.uiVer.classList.add('is-stale');
    els.uiVer.addEventListener('click', () => {
      // 帶一個變動的參數，繞過 index.html 那層快取
      location.href = `${location.pathname}?v=${latest}`;
    }, { once: true });
  } catch { /* 離線或擋掉都無所謂，維持現狀就好 */ }
}
checkForUpdate();

// 手機棋盤放大：實驗中，只有網址帶 ?big=1 的人看得到，朋友的體驗不受影響。
// 整盤縮到 375px 時一顆棋只有 20px，手指點不準；只框自己的陣地＋中央九宮是 60px。
// 代價是看不到另外兩家的細節，所以一定要有一顆切回全盤的按鈕。
// 開過一次就記住：更新按鈕會把網址改寫成 ?v=NNN，會把 big=1 洗掉，
// 每次都要重打一次網址很煩（Lynch 實際踩到）。?big=0 可以關掉。
const bigParam = new URLSearchParams(location.search).get('big');
if (bigParam === '1') { try { localStorage.setItem('army-online:big', '1'); } catch {} }
if (bigParam === '0') { try { localStorage.removeItem('army-online:big'); } catch {} }
let BIG_MODE = false;
try { BIG_MODE = localStorage.getItem('army-online:big') === '1'; } catch {}
// 三段大小，每一段都能拖曳平移（Lynch 指定）。記在本機，下一局還是同一個習慣。
const ZOOMS = [['小', 'full'], ['中', 'mid'], ['大', 'big']];
let zoomLevel = 2;
try { zoomLevel = Number(localStorage.getItem('army-online:zoom') ?? 2); } catch {}
if (!Number.isInteger(zoomLevel) || zoomLevel < 0 || zoomLevel > 2) zoomLevel = 2;
if (BIG_MODE) {
  const box = document.createElement('span');
  box.className = 'zoombox';
  box.id = 'zoomToggle';
  const btns = ZOOMS.map(([label], i) => {
    const b = document.createElement('button');
    b.className = 'btn zoom-btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      zoomLevel = i;
      try { localStorage.setItem('army-online:zoom', String(i)); } catch {}
      sync();
      view.setCamera(ZOOMS[i][1], true);   // 按了按鈕才覆蓋自己縮放出來的大小
      refresh();
    });
    return b;
  });
  const sync = () => btns.forEach((b, i) => b.classList.toggle('is-on', i === zoomLevel));
  sync();
  box.append(...btns);
  els.guide.before(box);
}

// session = 這場對局的連線層（見 session.js）。畫面只跟它要「我看得到的東西」，
// 不再自己抱著整個房間——AI 之後要搬到伺服器，這裡就只換成 remoteSession。
let session = null, selected = null, moves = [], logLines = [], setupSeat = 0, ticker = null;
let myLayout = {}, busy = false, viewSeatOverride = null, lastMove = null;
// 從「你上次出手」到現在，其他家走過的每一步。你一出手就清空重新累積。
// 只留最後一步的話，三家在你兩次出手之間各走一步，你只看得到最後那家做了什麼。
let recentMoves = [];
let drawAskedAt = -1;                 // 上次問過「要不要和局」是第幾手，避免一直跳視窗
// S = 最近一次的快照。refresh() 是同步的，所以畫面永遠畫 S，由 sync() 負責更新它。
let S = { status: 'setup', turn: null, plies: 0, setupDeadline: 0, readySeats: new Set(),
  board: null, displayBoard: null, result: null, eliminated: new Set(), revealedFlags: new Set() };

// 每一局一個代號，格式 YYMMDD-XXX（例如 260829-A7K）。
// 日期用玩家本地時間，這樣在棋譜清單裡一眼就知道是哪一天下的——
// 純亂碼（舊版的 AHX-S6H）看不出時間，要對照時間戳才知道。
// 後三碼用不會看錯的字母（拿掉 0/O/1/I），代號才唸得出來、抄得對。
// 注意：伺服器端另有流水號（2608290001），那由 Worker 列清單時當場算，
// 前端不知道今天已經有幾局，算不出來，也不該猜。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newGameCode() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const day = `${two(d.getFullYear() % 100)}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  let tail = '';
  for (let i = 0; i < 3; i++) tail += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${day}-${tail}`;
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
    // 第一眼先講這是什麼、可以馬上玩，再問代稱。
    // 一進站就要人填名字、還馬上提「用來改進電腦棋力」，看起來像在收資料（外部回饋）。
    const lead = document.createElement('div');
    lead.className = 'modal-lead';
    lead.textContent = '四人兩隊的暗棋，你和對家一組，打三家電腦。取個代稱就可以開始。';
    const note = document.createElement('div');
    note.className = 'modal-note';
    // 說清楚會留下什麼。朋友有權知道自己打的字會被存起來。
    note.textContent = '代稱會跟這局的棋譜一起存起來，只用來看棋局怎麼下的。請不要用真名。';
    wrap.append(lead, input, note);
    showModal({
      title: '四國軍棋　試玩版',
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

// 四種模式其實是同一張「座位歸屬表」的不同填法。
// 兩個真人的模式先用熱座（同一台電腦輪流），介面驗順了再接連線。
const MODES = {
  solo:     { controllers: ['A', 'ai', 'ai', 'ai'], names: ['你', '右家（電腦）', '對家（電腦）', '左家（電腦）'] },
  coop:     { controllers: ['A', 'ai', 'B', 'ai'],  names: ['你', '右家（電腦）', '夥伴', '左家（電腦）'] },
  duelAI:   { controllers: ['A', 'B', 'ai', 'ai'],  names: ['你', '對手', '你的電腦隊友', '對手的電腦隊友'] },
  duelTeam: { controllers: ['A', 'B', 'A', 'B'],    names: ['你', '對手', '你（對家）', '對手（對家）'] },
};
const mode = () => MODES[els.mode.value] ?? MODES.solo;
// 座位歸誰、叫什麼名字，一律向連線層問——本機版與連線版共用同一條路。
// 本機版回傳的就是上面那張表；連線版回傳的是伺服器分配的座位與真人暱稱。
// （session 還沒建立時退回本機那張表，newGame 一開始就會用到。）
const controllers = () => session?.controllers ?? mode().controllers;
const solo = () => els.mode.value === 'solo';
const humansInGame = () => [...new Set(controllers().filter(c => c !== 'ai'))];
// 熱座：現在坐在電腦前面的是誰（'A' 或 'B'）
let activeHuman = 'A';
const mySetupSeats = () => SEATS.filter(s => controllers()[s] === activeHuman);
const ownerOfSeat = (s) => controllers()[s];
const isAI = (seat) => session?.isAI(seat) ?? false;
const NAMES_OF = () => session?.seatNames?.() ?? mode().names;

async function sync() {
  S = await session.snapshot(viewSeat());
  S.displayBoard = S.status === 'setup' ? await session.setupBoard(setupSeat)
    : (els.revealAll.checked ? await session.revealAll() : S.board);
  refresh();
}

async function newGame() {
  clearInterval(ticker);
  // 從連線局按「重新開局」：一定要先把連線收掉。
  // 不收的話，舊房間還在推狀態，一推就把新開的這一局蓋回去——
  // 畫面上就是「按了重新開局沒反應」（Lynch 實測）。
  // 重新開局一律回到單人練習（模式選單預設 solo）；要再打連線局就按「多人連線」。
  if (online) {
    try { session?.close?.(); } catch { /* 已經斷了就算了 */ }
    online = null;
    remoteChain = Promise.resolve();
    // 網址上的 ?room= 也要清掉，否則重新載入又跳回那一間
    if (new URLSearchParams(location.search).has('room'))
      history.replaceState(null, '', location.pathname);
  }
  session = null;               // controllers() 要退回本機那張表，不能沿用連線層的座位
  gameCode = newGameCode();
  els.gameCode.textContent = gameCode;      // 留在畫面上，截圖才帶得走
  // 電腦用心法佈陣（三角雷護旗、大子後接工兵再接炸彈）。
  // 同一個 AI 換成心法佈陣後，對上亂數佈陣的勝率是 96.5%——佈陣的影響非常大。
  session = localSession({ controllers: controllers(), useSearch: () => els.useSearch.checked, names: NAMES_OF() });
  activeHuman = 'A';
  setupSeat = mySetupSeats()[0] ?? 0;
  myLayout = await session.layout(0);
  selected = null; moves = []; logLines = []; busy = false; viewSeatOverride = null;
  resultShown = false; lastMove = null; recentMoves = []; drawAskedAt = -1; els.overlay.hidden = true;

  hint('');
  addLog({
    solo: '單人練習：你對三家電腦',
    coop: '雙人合作：你和夥伴同一隊，對抗兩家電腦',
    duelAI: '雙人敵對：你和對手各帶一個電腦隊友',
    duelTeam: '雙人敵對：兩邊各控一整隊',
  }[els.mode.value] ?? '', true);
  addLog('佈陣開始，兩分鐘倒數');
  startTicker();
  await sync();
}

// ── 連線對局 ──────────────────────────────────────────────
// 跟 newGame 幾乎一樣，差別只在 session 換成 remoteSession、而且不由前端驅動電腦。
// 座位、暱稱、誰先走全部由伺服器決定，這裡只負責「拿到狀態就重畫」。
let online = null;                 // { code } ——非 null 代表這局是連線局

async function startOnline(code) {
  clearInterval(ticker);
  online = { code };
  gameCode = code;
  els.gameCode.textContent = code;
  try {
    session = await remoteSession({
      code,
      nickname: playerName(),
      onState: (u) => { queueRemote(u); },
      onError: (msg) => { addLog(msg, true); refresh(); },
    });
  } catch (e) {
    online = null;
    showModal({ title: '連不上房間', body: textBlock(e.message ?? '請確認邀請連結是否正確'),
      actions: [{ label: '好', primary: true, onClick: closeModal }] });
    return;
  }
  activeHuman = 'me';
  selected = null; moves = []; logLines = []; busy = false; viewSeatOverride = null;
  resultShown = false; lastMove = null; recentMoves = []; drawAskedAt = -1; els.overlay.hidden = true;
  addLog(`連線對局　房間代號 ${code}`, true);
  await syncOnline();
}

// 伺服器推來的狀態要**一則一則播完**，不能一收到就直接重畫：
// 別人那一手也要有動畫，而動畫是有長度的。伺服器已經幫我們把每一手分開推、
// 並在每手之間留好停頓（見 server/worker.mjs 的 driveAi），所以這裡只要排隊播。
let remoteChain = Promise.resolve();
const queueRemote = (u) => {
  remoteChain = remoteChain.then(() => playRemote(u)).catch((e) => { console.error(e); });
};

let myAnim = Promise.resolve();          // 自己那一手的動畫（別人的手要等它播完才播）

async function playRemote({ prev, events }) {
  if (!online) return;
  await myAnim.catch(() => {});         // 別讓兩段動畫同時在盤上跑
  const mv = (events ?? []).find(e => e.type === 'move');
  const mine = session.seatsOwnedBy?.() ?? [];
  // 自己那一手已經在 doMove 裡播過了；大廳／佈陣階段沒有動畫可播
  const animatable = mv && !mine.includes(mv.seat) && prev?.board && S?.status === 'playing';
  if (animatable) {
    const seat = viewSeat();
    const piece = prev.board.at?.[mv.from]?.piece ?? null;   // 敵子沒有身分，就用暗棋的樣子飛
    const path = mv.path?.length >= 2 ? mv.path : [mv.from, mv.to];
    moves = []; selected = null;
    // 動畫期間畫的是「他動之前」的盤面，並把移動中的那顆藏起來（由分身代勞）
    view.render({ board: prev.board, mySeats: [seat], selected: null, moves: [],
      revealedFlags: prev.board.revealedFlags ?? [], lastMove: null,
      recentMoves, viewerSeat: seat, hide: [mv.from] });
    SFX.move(path.length - 1, view.STEP_MS);
    await view.animateMove({ from: mv.from, to: mv.to, seat: mv.seat, outcome: mv.outcome, piece, path });
    (SFX_BY_OUTCOME[mv.outcome] ?? null)?.();
    lastMove = { from: mv.from, to: mv.to, seat: mv.seat, path };
    recentMoves = [...recentMoves.filter(m => m.seat !== mv.seat), lastMove].slice(-4);
    for (const e of events) {
      if (e.type === 'move') addLog(`${nameOf(e.seat)}：${OUTCOME_TEXT[e.outcome]}`);
      if (e.type === 'flagRevealed') { addLog(`${nameOf(e.seat)} 司令陣亡，軍旗顯露`, true); SFX.alarm(); }
      if (e.type === 'eliminated') { addLog(`${nameOf(e.seat)} 被扛旗，全軍覆沒`, true); SFX.flag(); }
      if (e.type === 'end') addLog(e.team != null ? `隊${e.team === 0 ? 'A' : 'B'} 獲勝` : '和局', true);
    }
  }
  await syncOnline();
}

// 伺服器推來新狀態就重畫。大廳階段顯示座位表，開始佈陣之後就走原本那條路。
async function syncOnline() {
  const info = session?.roomInfo?.();
  if (!info) return;
  if (info.status === 'lobby') { renderLobby(info); return; }
  closeModalIfLobby();
  setupSeat = session.seatsOwnedBy()[0] ?? 0;
  if (!Object.keys(myLayout ?? {}).length || S?.status !== info.status)
    myLayout = await session.layout(setupSeat);
  await sync();
  if (info.status === 'setup') startTicker();
}

let lobbyOpen = false;
const closeModalIfLobby = () => { if (lobbyOpen) { lobbyOpen = false; closeModal(); } };

const textBlock = (t) => { const d = document.createElement('div'); d.className = 'modal-lead'; d.textContent = t; return d; };

// 大廳：誰坐哪、邀請連結、開始。每次伺服器推狀態就整個重畫（人少、很便宜）。
function renderLobby(info) {
  const wrap = document.createElement('div');
  const link = `${location.origin}${location.pathname}?room=${info.code}`;

  wrap.append(textBlock('把下面這個連結傳給朋友，他點開就會進到這一間。'));
  const box = document.createElement('div');
  box.className = 'report-code';
  box.textContent = link;
  box.title = '點一下複製';
  box.addEventListener('click', () => {
    navigator.clipboard?.writeText(link);
    box.textContent = '已複製　' + link;
  });
  wrap.append(box);

  const table = document.createElement('div');
  table.className = 'lobby-seats';
  for (const seat of SEATS) {
    const row = document.createElement('div');
    row.className = 'lobby-row';
    const who = info.seats?.[seat];
    const label = document.createElement('span');
    label.className = `lobby-seat ind-seat${seat}`;
    label.textContent = ['你這方', '右家', '對家', '左家'][seat];
    const name = document.createElement('span');
    name.className = 'lobby-name';
    name.textContent = who ? (who.ai ? `${who.nickname}（電腦）` : who.nickname) : '（空位）';
    row.append(label, name);
    if (!who) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '坐這裡';
      b.addEventListener('click', () => session.send({ type: 'seat', seat }));
      row.append(b);
    }
    table.append(row);
  }
  wrap.append(table);

  const actions = [];
  if (info.isHost) actions.push({ label: '開始遊戲', primary: true,
    onClick: () => session.send({ type: 'start' }) });
  actions.push({ label: '離開', onClick: () => { session?.close?.(); online = null; closeModal(); newGame(); } });

  lobbyOpen = true;
  showModal({ title: `房間 ${info.code}`, body: wrap, actions });
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
// 看誰的視角：佈陣時看正在排的那家；對局時看「輪到的那家」，
// 但如果輪到電腦，就停在現在坐在電腦前面那個人的座位上——
// 不然電腦走棋時畫面會跳到別人家，玩家會瞬間失去方向。
const viewSeat = () => {
  if (viewSeatOverride != null) return viewSeatOverride;
  if (S.status === 'setup') return setupSeat;
  const t = S.turn;
  if (t != null && !isAI(t) && ownerOfSeat(t) === activeHuman) return t;
  return mySetupSeats()[0] ?? t ?? 0;
};

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
// 大本營只放軍旗、地雷或排長——跟自動佈陣同一條規則。
// 規則上其他棋子放得進去，但進去就永遠不能動，等於當場報廢一顆。
// Lynch：「為什麼不讓他點的時候就不能點進去？」——能擋就不要事後問，
// 而且擋下來的時候要說原因，不然玩家只會覺得「怎麼點不動」。
const HQ_OK = ['軍旗', '地雷', '排長'];
const isHQ = (id) => /-r6c[24]$/.test(id);
function hqBlocked(a, b) {
  for (const [from, to] of [[a, b], [b, a]]) {
    const piece = myLayout[from];
    if (isHQ(to) && piece && !HQ_OK.includes(piece)) return piece;
  }
  return null;
}

async function trySwap(a, b) {
  const blocked = hqBlocked(a, b);
  if (blocked) {
    hint(`大本營不能放${blocked}——走進大本營的棋子就再也不能動了，只放軍旗、地雷或排長`, true);
    return false;
  }
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
  // 點同一顆＝取消選取（Lynch 指定）。
  // 註：早期為了修「按了沒反應」曾經改成「再按一次不取消」，但那是 click 事件掉按鍵造成的；
  // 改用 pointerdown 之後反應是即時的，取消就該照直覺走。
  if (selected === id) { selected = null; hint('已取消選取'); sync(); return; }
  if (!selected) { selected = id; hint('再點另一顆交換位置，點同一顆取消'); SFX.select(); await sync(); return; }
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
  // 先把自己還沒排完的座位排完（一人控兩家時會有兩個）
  const mine = mySetupSeats().find(x => !S.readySeats.has(x));
  if (mine != null) {
    setupSeat = mine;
    myLayout = await session.layout(setupSeat);
    hint(`換你的另一家（${nameOf(setupSeat)}）佈陣`);
    await sync();
    return;
  }
  // 連線版每個人有自己的裝置，沒有「把電腦交給誰」這回事。
  // （remoteSession 的 isAI() 一律回 false——電腦在伺服器上，前端分不出來，
  //   所以下面那條「找一個不是電腦的座位」在連線版會把對手甚至電腦都當成要交接的人。）
  if (online) { await sync(); return; }
  // 自己排完了，換另一個人。要先擋一下畫面，否則他一按確定就看到你的陣。
  const other = SEATS.find(x => !S.readySeats.has(x) && !isAI(x));
  if (other == null) { await sync(); return; }
  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent = `請把電腦交給 ${nameOf(other)}。按下「我準備好了」之前，先不要看螢幕。`;
  showModal({
    title: '換人佈陣',
    body: note,
    actions: [{ label: '我準備好了', primary: true, onClick: async () => {
      closeModal();
      activeHuman = ownerOfSeat(other);
      setupSeat = other;
      selected = null;
      myLayout = await session.layout(setupSeat);
      hint(`${nameOf(setupSeat)} 佈陣中`);
      await sync();
    } }],
  });
}

// ---- 對戰 ----
const OUTCOME_TEXT = {
  moved: '移動', defenderDead: '吃掉對方的棋子',
  attackerDead: '自己的棋子陣亡', bothDead: '同歸於盡',
};
// 同歸於盡多半是炸彈或同階互撞，用爆炸聲
// 只有「碰到」才有聲音；單純移動不再額外播一次（鐵軌聲已經在走的時候播了）
const SFX_BY_OUTCOME = {
  defenderDead: SFX.capture,
  attackerDead: SFX.bounce,
  bothDead: SFX.explode,
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
  // 走的過程放鐵軌聲；**輸贏的聲音要等碰到才播**。
  // 原本兩種都在動畫開始前一起播，等於棋子還沒走到就先知道結果了（Lynch 指出這是最嚴重的問題）。
  SFX.move(path.length - 1, view.STEP_MS);
  myAnim = view.animateMove({ from, to, seat, outcome: move.outcome, piece, path });
  await myAnim;
  (SFX_BY_OUTCOME[move.outcome] ?? null)?.();

  lastMove = { from, to, seat, path };                       // 留下痕跡，讓大家看清楚誰動了什麼
  // 你自己出手＝把上一輪的痕跡清掉，重新累積這一輪其他家的走法
  if (seat === 0) recentMoves = [lastMove];
  else recentMoves = [...recentMoves.filter(m => m.seat !== seat), lastMove].slice(-4);
  // 棋譜含實際身分（連線層才知道），事後才分析得出「這一步好不好」
  try {
    const rec = await session.record();
    localStorage.setItem(CURRENT_KEY, JSON.stringify({
      at: Date.now(), code: gameCode, player: playerName(), aiVersion: AI_VERSION, uiVersion: UI_VERSION,
      ...rec, plies: S.plies,
      ai: els.useSearch.checked ? 'search' : 'heuristic',
    }));
  } catch { /* 存不下不影響遊戲 */ }
  for (const e of events) {
    if (e.type === 'move') addLog(`${nameOf(e.seat)}：${OUTCOME_TEXT[e.outcome]}`);
    if (e.type === 'flagRevealed') { addLog(`${nameOf(e.seat)} 司令陣亡，軍旗顯露`, true); SFX.alarm(); }
    if (e.type === 'eliminated') { addLog(`${nameOf(e.seat)} 被扛旗，全軍覆沒`, true); SFX.flag(); }
    if (e.type === 'end') addLog(e.team != null ? `隊${e.team === 0 ? 'A' : 'B'} 獲勝` : '和局', true);
  }
  await sync();
  maybeAskDraw();
}

// 60 手無吃子才判和，對人來說太久了（Lynch）。
// 門檻用「還在場的家數 × 8 回合」：出局一家之後，同樣的手數代表更多輪。
function maybeAskDraw() {
  if (S.status !== 'playing' || els.modal.hidden === false) return;
  // ?drawAsk=N 可以把門檻調低，方便驗證這個視窗真的會跳（正式玩不會帶這個參數）
  const override = Number(new URLSearchParams(location.search).get('drawAsk'));
  const threshold = Number.isFinite(override) && override > 0 ? override : (S.liveSeats ?? 4) * 8;
  if (S.pliesSinceCapture < threshold) return;
  if (drawAskedAt >= 0 && S.pliesSinceCapture - drawAskedAt < threshold) return;   // 問過就隔一輪再問
  drawAskedAt = S.pliesSinceCapture;
  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent = `已經 ${S.pliesSinceCapture} 手沒有人吃子（場上還有 ${S.liveSeats} 家）。`
    + '要向其他家提和嗎？對方明顯占上風的話不會答應。';
  showModal({
    title: '要提和嗎？',
    body: note,
    actions: [
      { label: '繼續下', onClick: closeModal },
      { label: '提和', primary: true, onClick: async () => {
        closeModal();
        const { accepted } = await session.offerDraw(0);
        addLog(accepted ? '對方同意和局' : '對方不同意和局，繼續下', true);
        if (!accepted) SFX.reject();
        await sync();
      } },
    ],
  });
}

async function runAIs() {
  while (S.status === 'playing' && currentSeat() != null && isAI(currentSeat())) {
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

const afterStart = () => { runAIs(); };

function clearSelection() {
  if (!selected && !moves.length) return;
  selected = null; moves = [];
  refresh();
}

async function onPlayClick(id) {
  if (S.status !== 'playing' || busy) return;
  const seat = currentSeat();
  if (isAI(seat)) return;
  // 連線版：只看「現在輪到的那家是不是我的」。沒輪到就什麼都別做。
  if (online) {
    if (!session.seatsOwnedBy().includes(S.turn)) { hint('還沒輪到你'); return; }
  } else if (ownerOfSeat(seat) !== activeHuman) {
    // 熱座：輪到另一個人時，要先按「換手」才能動棋，避免替別人下錯
    hint(`輪到 ${nameOf(seat)}，請先按換手`); return;
  }
  const occ = S.board?.at[id];

  if (selected && moves.includes(id)) {
    busy = true;
    await doMove(seat, selected, id);
    busy = false;
    await runAIs();                                          // 先讓電腦把它們的棋走完
    // 換人了才停下來等交接。同一個人接著走（例如一人控兩家）就不用停。
    if (!online && S.status === 'playing' && !isAI(currentSeat()) && ownerOfSeat(currentSeat()) !== activeHuman) {
      viewSeatOverride = seat;
      refresh();
    }
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
    // 佈陣不再支援拖曳互換：拖曳需要獨占單指手勢，那樣手機放大後就無法平移棋盤。
    // 改成純點選——點一顆亮起來，再點一顆交換，點同一顆取消（Lynch 的解法）。
    if (S.status === 'setup') {
      return;
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

// 選到一顆棋子時，用白話講它「吃得到誰、怕誰」。
// 三位新手的共同回饋：記不住九個軍階，點下去卻沒有任何提示，不知道自己在動哪隻兵。
const RANK_ORDER = ['司令', '軍長', '師長', '旅長', '團長', '營長', '連長', '排長', '工兵'];
function pieceBrief(piece) {
  if (piece === '炸彈') return ['碰到誰都同歸於盡', '連司令也一起帶走，所以拿來換大子', '不能放在第一排'];
  if (piece === '地雷') return ['不能移動', '任何軍人撞上去都會陣亡', '只有工兵拆得掉'];
  if (piece === '軍旗') return ['不能移動', '被敵人碰到，你整家就出局', '所以要用地雷擋住通往它的路'];
  if (piece === '工兵') return ['最小的軍人，碰到誰都輸', '但全場只有它拆得掉地雷', '鐵路上可以任意轉彎', '（一轉彎就會被看出是工兵）'];
  const i = RANK_ORDER.indexOf(piece);
  if (i < 0) return [];
  const below = RANK_ORDER[i + 1];
  const above = RANK_ORDER[i - 1];
  return [
    below ? `吃得到 ${below} 以下的軍人` : '吃不贏任何軍人',
    above ? `怕 ${above} 以上、還有炸彈和地雷` : '誰都吃得到，只怕炸彈和地雷',
    `碰到同樣是 ${piece} 就同歸於盡`,
  ];
}

function refresh() {
  const inSetup = S.status === 'setup';
  const seat = viewSeat();
  view.setBottomSeat(seat);
  els.setupbar.hidden = !inSetup;

  const board = S.displayBoard;
  view.render({
    board, mySeats: inSetup ? [setupSeat] : [seat],
    selected, moves, revealedFlags: board?.revealedFlags ?? [],
    lastMove: inSetup ? null : lastMove,
    recentMoves: inSetup ? [] : recentMoves, viewerSeat: seat,
  });
  view.setCamera(BIG_MODE ? ZOOMS[zoomLevel][1] : 'full');

  // 選到自己的棋子就介紹它（看不到身分的敵子當然沒有）。
  // 只畫在桌機的盤邊空地。手機版試過在棋盤下方加一行，但那一行一出現就把整個版面往下推——
  // Lynch 實機回報「一按我的棋子就跳畫面」，體驗比沒有還差，所以手機不做。
  const selPiece = selected ? board?.at?.[selected]?.piece ?? null : null;
  view.setInfo(selPiece ? { piece: selPiece, lines: pieceBrief(selPiece) } : null);

  if (inSetup) {
    els.setupWho.textContent = `${nameOf(setupSeat)} 佈陣中`;
    // 一人控兩家時，兩家都要排完再按一次確定——「準備好了」是記在玩家身上，不是座位。
    els.btnOtherSeat.hidden = mySetupSeats().length < 2;
    renderTimer();
    els.turn.textContent = '佈陣階段';
  } else if (S.status === 'ended') {
    els.turn.textContent = S.result.type === 'win'
      ? `隊${S.result.team === 0 ? 'A' : 'B'} 獲勝` : '和局';
  } else if (viewSeatOverride != null) {
    els.turn.textContent = `你走完了，換 ${nameOf(currentSeat())}`;
  } else {
    els.turn.textContent = busy ? `${nameOf(currentSeat())} 思考中…` : `輪到 ${nameOf(currentSeat())}`;
  }

  els.seats.replaceChildren(...SEATS.map(s => {
    const li = document.createElement('li');
    const ready = S.readySeats.has(s);
    li.className = ['seat', S.turn != null && s === currentSeat() ? 'is-turn' : '',
      ready && inSetup ? 'is-ready' : '',
      S.eliminated.has(s) ? 'is-out' : ''].filter(Boolean).join(' ');
    const dot = document.createElement('span');
    dot.className = 'seat-dot';
    dot.style.background = `var(--seat-${s})`;
    const name = document.createElement('span');
    name.textContent = nameOf(s);
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

  // 熱座模式：走完先停在自己視角，按了才換手。
  // 只要「輪到的那家不屬於現在坐在電腦前的人」就一定要出現換手鈕——
  // 少了這個條件，佈陣交接之後開局第一手會卡死：棋動不了、按鈕也不出現。
  const needHandoff = !online && S.status === 'playing' && S.turn != null
    && !isAI(S.turn) && ownerOfSeat(S.turn) !== activeHuman;
  let handoff = document.getElementById('handoff');
  if ((viewSeatOverride != null || needHandoff) && !handoff) {
    handoff = document.createElement('button');
    handoff.id = 'handoff';
    handoff.className = 'btn btn--primary handoff';
    handoff.textContent = `換 ${nameOf(currentSeat())} 接手`;
    handoff.addEventListener('click', () => {
      const next = currentSeat();
      if (next != null && !isAI(next)) activeHuman = ownerOfSeat(next);   // 換人坐上來
      viewSeatOverride = null;
      handoff.remove();
      sync();
    });
    document.querySelector('.stage').appendChild(handoff);
  } else if (viewSeatOverride == null && !needHandoff && handoff) handoff.remove();
}

// 結局畫面：贏了要有贏的樣子，不能只在標題列寫一行小字。
let resultShown = false;
function showResult() {
  if (S.status !== 'ended') { els.overlay.hidden = true; resultShown = false; return; }
  if (resultShown) return;
  resultShown = true;
  const r = S.result;
  saveGameRecord(r);
  // ⚠ 連線版的座位是伺服器分配的，可能是 1 或 3（隊B）。
  //    這裡原本寫死「你永遠坐 P0」，在連線局會把勝負講反。
  const myTeam = TEAM_OF(mySeat());
  const win = r.type === 'win' && r.team === myTeam;
  const draw = r.type === 'draw';
  els.overlayEmblem.textContent = draw ? '🤝' : (win ? '🏆' : '💀');
  els.overlayTitle.textContent = draw ? '和局' : (win ? '獲勝' : '落敗');
  els.overlayTitle.className = `overlay-title ${draw ? '' : (win ? 'is-win' : 'is-lose')}`;
  els.overlaySub.textContent = draw
    ? (r.reason === 'noCapture' ? '連續 60 步沒有吃子，判和' : '四家都無步可走，判和')
    : r.reason === 'resign'
      ? `你認輸離開　共 ${S.plies} 步（棋譜已保留）`
      : `${win ? '你和對家' : '左右兩家'}拿下了對方兩面軍旗　共 ${S.plies} 步`;
  els.overlayCode.textContent = gameCode ? `局名 ${gameCode}` : '';
  els.overlay.hidden = false;
  (draw ? SFX.flag : (win ? SFX.victory : SFX.defeat))();
  showStats();
}
els.overlayAgain.addEventListener('click', () => { els.overlay.hidden = true; newGame(); });

// 對戰統計：結束後附在結果畫面下方。
// Lynch 要的三項：殘子（1/2/3）、出兵勝率、炸彈換到 1/2 的獎勵。
async function showStats() {
  let box = document.getElementById('stats');
  if (!box) {
    box = document.createElement('div');
    box.id = 'stats';
    box.className = 'stats';
    els.overlay.querySelector('.overlay-card')?.appendChild(box)
      ?? els.overlay.appendChild(box);
  }
  box.replaceChildren();
  let st;
  try { st = await session.stats(mySeat()); } catch { return; }

  const row = (label, value, note = '') => {
    const li = document.createElement('li');
    const k = document.createElement('span');
    k.className = 'stats-k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'stats-v';
    v.textContent = value;
    li.append(k, v);
    if (note) {
      const n = document.createElement('span');
      n.className = 'stats-note';
      n.textContent = note;
      li.append(n);
    }
    return li;
  };
  const big = (o) => `${o.司令 ? '司令×' + o.司令 + '　' : ''}${o.軍長 ? '軍長×' + o.軍長 + '　' : ''}${o.師長 ? '師長×' + o.師長 : ''}`.trim() || '全滅';

  const ul = document.createElement('ul');
  ul.className = 'stats-list';
  ul.append(
    row('出兵勝率', st.winRate == null ? '—' : `${Math.round(st.winRate * 100)}%`,
      st.attacks ? `出手 ${st.attacks}　吃掉 ${st.won}　同歸於盡 ${st.traded}（算贏，不虧）　陣亡 ${st.lost}` : '這局沒有出手'),
    row('總手數', String(st.plies)),
  );
  if (st.bombBonus) {
    ul.append(row('炸彈獎勵', `＋${st.bombBonus}`, `炸掉${st.bombKills.join('、')}——全場最划算的一擊`));
  }
  if (st.minesDug) ul.append(row('工兵拆雷', `${st.minesDug} 顆`));
  const h = document.createElement('div');
  h.className = 'stats-title';
  h.textContent = '本局統計';
  box.append(h, ul);

  // 殘存大子做成表格：縱軸四家、橫軸 1／2／3／炸彈（Lynch 指定）
  if (st.bySeat) {
    const t = document.createElement('table');
    t.className = 'alive-table';
    const head = document.createElement('tr');
    head.append(document.createElement('th'));
    for (const label of ['司令', '軍長', '師長', '炸彈']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }
    t.append(head);
    SEATS.forEach((seat) => {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.className = 'alive-seat';
      name.textContent = nameOf(seat);
      name.style.color = `var(--seat-${seat})`;
      tr.append(name);
      for (const k of ['司令', '軍長', '師長', '炸彈']) {
        const td = document.createElement('td');
        const n = st.bySeat[seat]?.[k] ?? 0;
        td.textContent = n || '—';
        if (!n) td.className = 'is-none';
        tr.append(td);
      }
      t.append(tr);
    });
    const cap = document.createElement('div');
    cap.className = 'stats-note';
    cap.textContent = '各家還剩下的大子與炸彈';
    box.append(cap, t);
  }

  const res = { win: S.result?.type === 'win' && S.result.team === 0 };

  // 這一局的頭銜：每局都有，講「你這局打得怎麼樣」。
  // 成就是收集（拿過就不再跳），頭銜是即時評語——Lynch 要的是後者
  //（「這場我勝率 86% 真的是超級高的」，那種當下就想被認可的感覺）。
  const run = noteGame(res);
  const title = titleFor(st, res);
  if (title) {
    const tw = document.createElement('div');
    tw.className = 'title-card';
    const n = document.createElement('div');
    n.className = 'title-name';
    n.textContent = title.name;
    const d = document.createElement('div');
    d.className = 'title-desc';
    d.textContent = title.desc;
    tw.append(n, d);
    if (run.streak >= 2) {
      const st2 = document.createElement('div');
      st2.className = 'title-streak';
      st2.textContent = `連勝 ${run.streak} 場`;
      tw.append(st2);
    }
    box.prepend(tw);
  }

  // 新解鎖的成就：只跳沒拿過的，拿過的第二次就沒有感覺了
  const fresh = checkAchievements(st, res, run);
  if (fresh.length) {
    const wrap = document.createElement('div');
    wrap.className = 'ach';
    const t = document.createElement('div');
    t.className = 'ach-title';
    t.textContent = fresh.length > 1 ? `解鎖 ${fresh.length} 項成就` : '解鎖成就';
    wrap.append(t);
    for (const a of fresh) {
      const li = document.createElement('div');
      li.className = 'ach-item';
      const n = document.createElement('span');
      n.className = 'ach-name';
      n.textContent = a.name;
      const d = document.createElement('span');
      d.className = 'ach-desc';
      d.textContent = a.desc;
      li.append(n, d);
      wrap.append(li);
    }
    const done = unlockedIds().length;
    const p2 = document.createElement('div');
    p2.className = 'ach-progress';
    p2.textContent = `已解鎖 ${done} / ${ACHIEVEMENTS.length}`;
    wrap.append(p2);
    box.append(wrap);
    SFX.victory();
  }
}

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
      aiVersion: AI_VERSION, uiVersion: UI_VERSION,
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

// 代號按一下就複製。討論棋局時要嘛丟截圖、要嘛貼代號，兩條路都要順手。
els.gameCode.addEventListener('click', async () => {
  const done = () => {
    const keep = els.gameCode.textContent;
    els.gameCode.textContent = '已複製';
    els.gameCode.classList.add('is-copied');
    setTimeout(() => {
      els.gameCode.textContent = keep;
      els.gameCode.classList.remove('is-copied');
    }, 900);
  };
  try {
    await navigator.clipboard.writeText(gameCode);
    done();
  } catch {
    // 沒有剪貼簿權限（或不是安全連線）時的退路：用選取＋execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = gameCode;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch { hint('複製失敗，請手動選取代號', true); }
  }
});

els.btnOtherSeat.addEventListener('click', async () => {
  const other = mySetupSeats().find(x => x !== setupSeat);
  if (other == null) return;
  setupSeat = other;
  selected = null;
  myLayout = await session.layout(setupSeat);
  hint(`現在排的是 ${nameOf(setupSeat)}。兩家都排好再按確定佈陣。`);
  await sync();
});

// 除錯開關預設藏起來——要公開給朋友玩，實驗性與除錯用的東西不該露出來。
// 網址加 ?debug=1 就會出現（自己測試時用）。
// 雙人模式目前只有熱座（同一台電腦輪流），還不適合給朋友玩，先一起藏起來。
if (new URLSearchParams(location.search).has('debug')) {
  els.debugTools.hidden = false;
  els.modeTools.hidden = false;
  els.sfx.hidden = false;
}

// 規則說明：新手是「打開就想玩」，願意先讀一頁規則的很少，
// 所以放在按得到的地方，卡住時才會去看。
function openGuide() {
  // 教學的「上一步／下一步」搬到跟「開始玩」同一排。切到別的分頁時那一排會消失，
  // 切回來再放回去（每次 show() 都會回報現在這頁有沒有導覽列）。
  const place = (bar) => {
    els.modalActions.querySelector('.demo-bar')?.remove();
    if (bar) els.modalActions.prepend(bar);
  };
  let bar = null;
  const body = buildGuide({ onNav: (b) => { bar = b; place(b); } });
  showModal({
    title: '四國軍棋　新手指南',
    body,
    actions: [{ label: '開始玩', primary: true, onClick: closeModal }],
  });
  place(bar);            // showModal 會重建動作列，所以要再放一次
}
els.guide.addEventListener('click', openGuide);

// 回報問題的入口。畫面上叫人「回報時附上代號」，卻沒有地方可以回報（外部回饋指出）。
// 不做表單也不收信箱：把該附的東西湊好、一鍵複製，傳給邀請他來玩的人就行。
function openReport() {
  const wrap = document.createElement('div');
  const p = (t) => { const e = document.createElement('p'); e.textContent = t; return e; };
  const info = `對局代號 ${gameCode}　版本 v${UI_VERSION}`;
  const box = document.createElement('div');
  box.className = 'report-code';
  box.textContent = info;
  wrap.append(
    p('遇到怪怪的地方？把下面這行、加上你看到的情況（最好附一張截圖），傳給找你來玩的人就可以了。'),
    box,
    p('這兩個東西是我們對得上是哪一局、哪一版的唯一線索，沒有它們很難查。'),
  );
  showModal({
    title: '回報問題',
    body: wrap,
    actions: [
      { label: '複製', onClick: () => { navigator.clipboard?.writeText(info); box.textContent = '已複製　' + info; } },
      { label: '關閉', primary: true, onClick: closeModal },
    ],
  });
}
// 多人連線：選一種玩法就開一間房，拿到邀請連結丟給朋友。
// 三種對應到伺服器的兩個參數：mode 決定是雙人還是四人局，fill 決定空位由誰補。
const ONLINE_MODES = [
  { label: '四人局（找三位朋友）', mode: 'four', fill: 'mate',
    desc: '人不滿也可以開始，空位由同隊的人接手' },
  { label: '雙人合作（兩人一隊打電腦）', mode: 'two', fill: 'ai',
    desc: '你和朋友同一隊，對面兩家是電腦' },
  { label: '雙人敵對（各控一整隊）', mode: 'two', fill: 'mate',
    desc: '你和朋友各自操控一整隊兩家' },
];

function openOnlineMenu() {
  const wrap = document.createElement('div');
  wrap.append(textBlock('開一間房，把連結傳給朋友就能一起玩。'));
  for (const m of ONLINE_MODES) {
    const b = document.createElement('button');
    b.className = 'btn online-choice';
    b.innerHTML = `<b>${m.label}</b><span>${m.desc}</span>`;
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.querySelector('b').textContent = '開房中…';
      try {
        const code = await createRoom({ mode: m.mode, fill: m.fill });
        closeModal();
        await startOnline(code);
      } catch (e) {
        b.disabled = false;
        b.querySelector('b').textContent = m.label;
        hint(e.message ?? '開房失敗', true);
      }
    });
    wrap.append(b);
  }
  showModal({ title: '多人連線', body: wrap,
    actions: [{ label: '取消', primary: true, onClick: closeModal }] });
}
els.online.addEventListener('click', openOnlineMenu);

els.gameCode.addEventListener('click', openReport);
els.gameCode.title = '點一下：回報問題要附的資訊';

// 音效試聽：每個事件都有幾種版本，聽了直接選。選擇存在瀏覽器裡。
const SFX_EVENTS = [
  ['move', '出兵移動', '走的過程。想要更像火車就選第二個。'],
  ['capture', '吃掉對方（贏）', '併吞的聲音，要聽起來開心。'],
  ['bounce', '自己陣亡（輸）', '撞到冰塊或金屬。'],
  ['explode', '同歸於盡（和）', '跟炸彈一樣的爆炸聲。'],
  ['alarm', '司令陣亡、軍旗顯露', '要有威嚇感的「燈燈燈」。'],
  ['flag', '滅掉一家', '要有儀式感。'],
];
els.sfx.addEventListener('click', () => {
  const wrap = document.createElement('div');
  wrap.className = 'sfxpick';
  const chosen = getChoice();
  for (const [key, label, note] of SFX_EVENTS) {
    const box = document.createElement('div');
    box.className = 'sfx-group';
    const h = document.createElement('div');
    h.className = 'sfx-title';
    h.textContent = label;
    const n = document.createElement('div');
    n.className = 'modal-note';
    n.textContent = note;
    box.append(h, n);
    (VARIANTS[key] ?? []).forEach((v, i) => {
      const row = document.createElement('label');
      row.className = 'sfx-row';
      const r = document.createElement('input');
      r.type = 'radio'; r.name = `sfx-${key}`;
      r.checked = (chosen[key] ?? 0) === i;
      r.addEventListener('change', () => { setVariant(key, i); preview(key, i); });
      const t = document.createElement('span');
      t.className = 'sfx-name';
      t.textContent = v.name;
      const play = document.createElement('button');
      play.className = 'btn sfx-play';
      play.type = 'button';
      play.textContent = '試聽';
      play.addEventListener('click', (e) => { e.preventDefault(); preview(key, i); });
      row.append(r, t, play);
      box.append(row);
    });
    wrap.append(box);
  }
  showModal({
    title: '音效：聽聽看，選你喜歡的',
    body: wrap,
    actions: [{ label: '完成', primary: true, onClick: closeModal }],
  });
});

els.btnConfirm.addEventListener('click', confirmSetup);
els.revealAll.addEventListener('change', sync);
els.soundOn.addEventListener('change', () => setEnabled(els.soundOn.checked));
els.mode.addEventListener('change', newGame);
// 認輸離開：走進死棋時要有出口。順帶把這一局的棋譜結算掉——
// 沒有這個按鈕的話，玩家只能按「重新開局」，那會讓這局被下一局蓋掉。
els.resign.addEventListener('click', () => {
  if (S.status !== 'playing') { hint('這一局還沒開始或已經結束了'); return; }
  showModal({
    title: '認輸離開這一局？',
    body: (() => {
      const d = document.createElement('div');
      d.className = 'modal-note';
      d.textContent = '這一局會判你落敗並結算。棋譜會完整保留下來——'
        + '「玩不下去的那一局」對改進電腦棋力特別有用。';
      return d;
    })(),
    actions: [
      { label: '再想想', onClick: closeModal },
      { label: '認輸', primary: true, onClick: async () => {
        closeModal();
        await session.resign(0);
        addLog('你認輸離開，這一局結束', true);
        await sync();          // sync 會走到 showResult()，棋譜在那裡結算並回傳
      } },
    ],
  });
});

// 重新開局前，先把還沒下完的這一局結算掉，否則它會被下一局蓋掉。
els.restart.addEventListener('click', async () => {
  if (S.status === 'playing') {
    try {
      const rec = await session.record();
      uploadRecord({ at: Date.now(), code: gameCode, player: playerName(), aiVersion: AI_VERSION, uiVersion: UI_VERSION,
        mode: solo() ? 'solo' : 'hotseat', ai: els.useSearch.checked ? 'search' : 'heuristic',
        result: null, unfinished: true, abandoned: true, ...rec, plies: S.plies });
    } catch { /* 回傳失敗不該擋住重新開局 */ }
  }
  newGame();
});
// 第一次進站的人不知道規則說明在哪，開局時直接跳給他看；看過一次就不再跳。
const SEEN_GUIDE = 'army-online:seen-guide';

// ── 進場畫面 ────────────────────────────────────────────────
// Lynch 2026-09-05：「我希望我四國軍棋進場畫面也要是類似這樣好看的。」
// 進來先看到它，按了才開局——原本是一進站就自動開一局單人的，
// 那等於還沒說「這是什麼」就把人丟進棋盤。
// 背景那盤棋是真的棋盤（同一支 board.js），所以配色一改它也跟著改，不必維護一張圖。
function paintLandingBoard() {
  const svg = document.getElementById('landingBoard');
  if (!svg) return;
  try {
    const view = createBoardView(svg, { onNodeClick() {}, onPointerUp() {} });
    const at = {};
    for (const [id, node] of BOARD.nodes) {
      const m = /^P(\d)-r(\d)c\d$/.exec(id);
      if (!m || node.kind === 'camp') continue;
      const seat = Number(m[1]);
      if (Number(m[2]) >= 4) at[id] = { seat };            // 全部畫成暗棋：這是暗棋遊戲的樣子
    }
    view.setBottomSeat(0);
    view.render({ board: { at, revealedFlags: [] }, mySeats: [], viewerSeat: 0,
      selected: null, moves: [], recentMoves: [], lastMove: null });
    view.setCamera('full');
  } catch { /* 純裝飾，畫不出來就算了，不能擋住進場 */ }
}

const landing = document.getElementById('landing');
const hideLanding = () => { if (landing) landing.hidden = true; };
async function enterGame(kind) {
  hideLanding();
  await askNickname();
  if (kind === 'online') { openOnlineMenu(); return; }
  await newGame();
  if (localStorage.getItem(SEEN_GUIDE)) return;
  try { localStorage.setItem(SEEN_GUIDE, '1'); } catch { /* 存不下不影響 */ }
  openGuide();
  // 第一次進站的人直接開始播。三個沒玩過的朋友的回饋是「還沒看完說明頭就暈了」——
  // 要他們自己一步一步按，等於還是在讀說明書；讓它自己演一遍才像「先看一下怎麼玩」。
  setTimeout(() => document.querySelector('.demo-play')?.click(), 400);
}
// 回首頁：把進行中的局收乾淨（連線局要斷線，不然舊房間還在推狀態），再把首頁叫出來。
document.getElementById('home')?.addEventListener('click', () => {
  if (S?.status === 'playing' && !confirm('回首頁會離開這一局，確定嗎？')) return;
  clearInterval(ticker);
  if (online) {
    try { session?.close?.(); } catch { /* 已經斷了就算了 */ }
    online = null; remoteChain = Promise.resolve();
    if (new URLSearchParams(location.search).has('room'))
      history.replaceState(null, '', location.pathname);
  }
  els.overlay.hidden = true;
  if (landing) landing.hidden = false;
});
document.getElementById('ldSolo')?.addEventListener('click', () => enterGame('solo'));
document.getElementById('ldOnline')?.addEventListener('click', () => enterGame('online'));
document.getElementById('ldGuide')?.addEventListener('click', () => openGuide());
const ldVer = document.getElementById('ldVer');
if (ldVer) ldVer.textContent = `v${UI_VERSION}`;

// 帶著邀請連結進來的人，直接進那一間房——不要先擋一個進場畫面。
const joinCode = new URLSearchParams(location.search).get('room');
if (joinCode) {
  hideLanding();
  askNickname().then(() => startOnline(joinCode.toUpperCase()));
} else {
  if (landing) landing.hidden = false;
  paintLandingBoard();
}

// 本機測試版。預設「單人（三家電腦）」：你坐下家，其餘三家由 AI 操作。
// 也可以切成熱座四人（四個人輪流用同一台電腦），那時走完會等你按「換手」才轉視角——
// 立刻轉視角會讓人看不到自己剛剛走了什麼。
import { SEATS, TEAM_OF } from '../engine/src/board.mjs?v=249';
import { randomLayout } from '../engine/src/random-layout.mjs?v=249';
import { nicknameProblem } from '../engine/src/room.mjs?v=249';
import { PRIVACY_HTML } from './privacy.js?v=249';
import { TERMS_HTML } from './terms.js?v=249';
import { nativeShare, haptic } from './native.js?v=249';
import { localSession } from './session.js?v=249';
import { remoteSession } from './remote-session.js?v=249';
import { createRoom, ensureAccount, currentAccount, redeem, rotateRecovery, deleteAccount } from './account.js?v=249';
import { RECORD_ENDPOINT, GAME_ENDPOINT, AI_VERSION } from './config.js?v=249';
import { buildGuide } from './guide.js?v=249';
import { checkAchievements, ACHIEVEMENTS, unlockedIds, titleFor, noteGame } from './achievements.js?v=249';
import { createBoardView } from './board.js?v=249';
import { SFX, setEnabled, VARIANTS, getChoice, setVariant, preview } from './sound.js?v=249';
import { recordGame, readStats, statsLine } from './tally.js?v=249';

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
  'setupbar', 'setupWho', 'setupTimer', 'setupHint', 'btnRandom', 'btnName', 'btnSave', 'btnLoad', 'btnConfirm', 'btnOtherSeat',
  'overlay', 'overlayEmblem', 'overlayTitle', 'overlaySub', 'overlayCode', 'overlayAgain', 'overlayShare',
  'modal', 'modalTitle', 'modalBody', 'modalActions', 'useSearch', 'gameCode', 'turnBanner', 'moreBtn', 'moreBox', 'resign', 'guide', 'debugTools', 'modeTools', 'sfx', 'uiVer', 'online']
  .map(id => [id, document.getElementById(id)]));

// 版本號顯示在標題旁邊：Lynch「V123 我想要標示在某處，這樣方便我看」。
// 值從自己的 import URL 取（?v=249），bump-ui-version.sh 一改就跟著動，不會忘記同步。
const UI_VERSION = new URL(import.meta.url).searchParams.get('v') ?? '?';
// 漏斗套件可能被廣告阻擋；載入失敗也不能擋住遊戲。
// 套件還沒載入前叫到的步驟先排著，載入後補送；被擋就永遠只是排著，不影響任何畫面。
// 本機（localhost）送到不存在的路徑，資料只留在裝置的暫存，不會灌進正式收集端。
const funnelEarly = [];
const funnel = { step: (s) => { if (funnelEarly.length < 10) funnelEarly.push(s); } };
const FUNNEL_LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
import('./fvs.js?v=249').then(m => {
  const F = m.default ?? m.FervelaFunnel;
  F.init({ product: 'army', version: UI_VERSION, platform: 'web',
    endpoint: FUNNEL_LOCAL ? '/__funnel_dev' : 'https://t.fervela.ai/e',
    allow: ['首次打開', '取好代稱', '進入棋局', '確定佈陣', '第一個成果', '按分享', '從分享進來'] });
  funnel.step = (s) => { try { F.step(s); } catch {} };
  funnelEarly.splice(0).forEach(funnel.step);
}).catch(() => {});
// 從邀請或分享連結進來的：記一步「從分享進來」，然後把 from 從網址拿掉（房號在 # 後面，不動），
// 免得他再分享出去時又帶著同一個來源。
{
  const q = new URLSearchParams(location.search);
  if (q.has('from')) {
    funnel.step('從分享進來');
    q.delete('from');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
}
// 告訴 index.html 的看門狗：程式已經跑起來了（沒跑起來它會在首頁顯示「載入失敗」的提示）
window.__armyBooted = true;
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
if (bigParam === '1') { try { localStorage.removeItem('army-online:big'); } catch {} }
if (bigParam === '0') { try { localStorage.setItem('army-online:big', '0'); } catch {} }
// 棋盤大小的三段式**預設打開**（原本要 ?big=1 才有）。
// GPT 實測手機上棋子只有約 21×20px，而縮放本來就是解法——只是新玩家看不到那組按鈕。
let BIG_MODE = true;
try { if (localStorage.getItem('army-online:big') === '0') BIG_MODE = false; } catch {}
// 三段大小，每一段都能拖曳平移（Lynch 指定）。記在本機，下一局還是同一個習慣。
const ZOOMS = [['小', 'full'], ['中', 'mid'], ['大', 'big']];
// 第一次來的人：手機給「中」（整盤看得到、棋子也看得清），桌機給「小」（整盤剛好放得下）。
const NARROW = globalThis.matchMedia?.('(max-width: 620px)')?.matches ?? false;
let zoomLevel = NARROW ? 1 : 0;
try {
  const saved = localStorage.getItem('army-online:zoom');
  if (saved != null) zoomLevel = Number(saved);
} catch {}
if (!Number.isInteger(zoomLevel) || zoomLevel < 0 || zoomLevel > 2) zoomLevel = NARROW ? 1 : 0;
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
  // 棋盤大小屬於低頻設定，收進「⋯」那一組（手機）；桌機上那組是 display:contents，
  // 所以它照樣排在工具列上。
  if (els.moreBox) els.moreBox.prepend(box); else els.guide.before(box);
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
// 遊戲分級標示（遊戲軟體分級管理辦法第 11、13 條；法遵 10/14）：
// 起始畫面要看得到普遍級標識（至少 45×45）和兩句警語。
// 首頁寫在 index.html；從 #lobby 直接進來的人不會經過首頁，所以取代稱和大廳也各放一份。
// 標識圖要用主管機關公告的原圖（rating-general.png），不要自己畫。
function ratingNote() {
  const src = document.getElementById('ldRating');
  return src ? Object.assign(src.cloneNode(true), { id: '' }) : document.createElement('div');
}

function askNickname({ force = false, lead: leadText = null } = {}) {
  return new Promise((resolve) => {
    if (playerName() && !force) { resolve(); return; }
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.className = 'modal-input';
    input.placeholder = '例如：老王、阿明';
    input.maxLength = 12;
    input.value = playerName();          // 改名時先帶入現在的代稱
    // 第一眼先講這是什麼、可以馬上玩，再問代稱。
    // 一進站就要人填名字、還馬上提「用來改進電腦棋力」，看起來像在收資料（外部回饋）。
    const lead = document.createElement('div');
    lead.className = 'modal-lead';
    lead.textContent = leadText ?? '四人兩隊的暗棋，你和對家一組，打三家電腦。取個代稱就可以開始。';
    const note = document.createElement('div');
    note.className = 'modal-note';
    // 說清楚會留下什麼。朋友有權知道自己打的字會被存起來。
    note.textContent = '代稱會被同桌和大廳的人看見，也會存進對局紀錄，請不要用真名。';  // 法遵 10/19：普遍級，小朋友最容易填真名
    wrap.append(lead, input, note, ratingNote());
    showModal({
      title: '四國軍棋',
      body: wrap,
      actions: [{
        label: force ? '改好了' : '開始', primary: true, onClick: () => {
          const bad = nicknameProblem(input.value);
          if (bad) { note.textContent = bad; note.classList.add('is-warn'); input.focus(); return; }
          localStorage.setItem(PLAYER_KEY, input.value.trim().slice(0, 12) || '無名氏');
          funnel.step('取好代稱');
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
    if (location.hash || new URLSearchParams(location.search).has('room'))
      history.replaceState(null, '', location.pathname + location.search);
  }
  session = null;               // controllers() 要退回本機那張表，不能沿用連線層的座位
  myLayoutSeat = null;
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
    solo: '單人練習：你和電腦隊友一隊，對抗兩家電腦',
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
let myLayoutSeat = null;           // myLayout 現在裝的是哪一家的陣型

// 使用條款（法遵 10/21 定稿，App Store 1.2）：第一次玩多人連線前按一次「同意」，記在本機。
// 原稿 docs/法遵文字/使用條款.md，顯示用 ui/terms.js，測試逐字比對。
const TERMS_KEY = 'army-online:terms-v1';
function agreeTerms() {
  try { if (localStorage.getItem(TERMS_KEY)) return Promise.resolve(true); } catch { /* 無痕模式：每次都問 */ }
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'terms-body';
    body.innerHTML = TERMS_HTML;
    showModal({ title: '四國軍棋 使用條款', body, actions: [
      { label: '不同意', onClick: () => { closeModal(); resolve(false); } },
      { label: '同意，開始連線', primary: true, onClick: () => {
        try { localStorage.setItem(TERMS_KEY, String(Date.now())); } catch { /* 無痕模式 */ }
        closeModal(); resolve(true);
      } },
    ] });
  });
}
function openTerms() {
  const body = document.createElement('div');
  body.className = 'terms-body';
  body.innerHTML = TERMS_HTML;
  showModal({ title: '四國軍棋 使用條款', body, actions: [{ label: '知道了', primary: true, onClick: closeModal }] });
}
document.getElementById('ldTerms')?.addEventListener('click', (event) => { event.preventDefault(); openTerms(); });

async function startOnline(code, { seat = null } = {}) {
  clearInterval(ticker);
  if (!(await agreeTerms())) {
    // 不同意就不連線：回首頁單機（網址上的房號也拿掉，免得一重整又被問）
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* 不影響 */ }
    lbHide?.(); online = null; newGame();
    hint('沒有同意使用條款，先跟電腦下一局；想連線時再按「多人連線」');
    return;
  }
  // 換一間房就把上一間的錯誤訊息清掉。原本會一路帶過來：
  // 9/29 CEO 在配對大廳的公開桌看到「隊B（左右家）還沒有人」，那句只有「雙人敵對」房會出現，
  // 很可能是之前某一間房留下的，進新房時又被畫出來（10/10 查到）。
  lobbyError = '';
  online = { code };
  gameCode = code;
  els.gameCode.textContent = code;
  try {
    session = await remoteSession({
      code,
      nickname: playerName(),
      onState: (u) => { queueRemote(u); },
      // 重連時把戰報接回來（Lynch 實測：重新整理之後，先前的紀錄整個消失）。
      // 只用公開資訊重建：誰、從哪走到哪、結果——沒有任何棋子身分。
      onHistory: (history) => {
        if (!history?.length || logLines.some(l => l.move)) return;
        for (const m of history) {
          if (!OUTCOME_TEXT[m.outcome]) continue;
          logLines.unshift({ text: `${nameOf(m.seat)}：${OUTCOME_TEXT[m.outcome]}`, big: false,
            move: { from: m.from, to: m.to, seat: m.seat } });
        }
        logLines = logLines.slice(0, 60);
        addLog(`接回這一局先前的 ${history.length} 步紀錄`, true);
      },
      onError: (msg) => {
        if (msg === ignoreLobbyError) { ignoreLobbyError = ''; return; }
        addLog(msg, true);
        if (lobbyOpen) { lobbyError = msg; renderLobby(session.roomInfo()); return; }
        refresh();
      },
    });
  } catch (e) {
    online = null;
    // 從配對大廳點座位進來卻連不上：大廳頁要收掉，下面的「連不上這間房」才有路可走
    if (lbJoining) { lbJoining = false; lbHide(); }
    // 連不上要有路可以回去——原本按「好」之後就停在一個空棋盤上，
    // 想再打一次房號還得自己找路（GPT 實測回饋）。
    showModal({
      title: '連不上這間房',
      body: textBlock((e.message ?? '請確認邀請連結是否正確')
        + '　房號可能打錯了，或這間房已經結束。'),
      actions: [
        { label: '重新輸入房號', primary: true, onClick: () => { closeModal(); openOnlineMenu(code); } },
        { label: '回首頁', onClick: () => { closeModal(); if (landing) landing.hidden = false; } },
      ],
    });
    return;
  }
  activeHuman = 'me';
  // 網址帶上房號：重新整理（或不小心上一頁）之後才回得到同一間房。
  // Lynch：「重新整理很容易跳回首頁，這很糟糕。」自己開房的人網址上原本什麼都沒有，
  // 一重整就變成從頭開始。順帶好處是網址列本身就是可以直接複製的邀請連結。
  try { history.replaceState(null, '', `${location.pathname}${location.search}#${code}`); } catch { /* 不影響對局 */ }
  selected = null; moves = []; logLines = []; busy = false; viewSeatOverride = null;
  resultShown = false; lastMove = null; recentMoves = []; drawAskedAt = -1; els.overlay.hidden = true;
  addLog(`連線對局　房間代號 ${code}`, true);
  // 從配對大廳點座位進來的：連上就直接坐下。座位被別人搶先的話，
  // 伺服器會回「這個位置已經有人了」，玩家留在這一桌的等待畫面自己挑別的位置。
  if (seat != null) session.send({ type: 'seat', seat });
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
      if (e.type === 'move') addLog(`${nameOf(e.seat)}：${OUTCOME_TEXT[e.outcome]}`, false,
        { from: e.from, to: e.to, seat: e.seat });
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
  if (session.seatsOwnedBy()?.length) funnel.step('進入棋局');
  if (info.status === 'lobby') { renderLobby(info); return; }
  closeLobbyPageIfOpen();
  setupSeat = session.seatsOwnedBy()[0] ?? 0;
  // ⚠ 一定要在「座位換了」的時候重抓陣型。
  //    只看 status 有沒有變是不夠的：先玩過一局單人再進房間的人，myLayout 還是上一局
  //    0 號位的陣型，而他這局坐 1 號位——每點一顆自己的棋子都會被判成
  //    「只能排自己的陣地」，整個佈陣階段動不了（Lynch 實機：有一台電腦無法佈陣）。
  if (myLayoutSeat !== setupSeat || !Object.keys(myLayout ?? {}).length || S?.status !== info.status) {
    myLayout = await session.layout(setupSeat);
    myLayoutSeat = setupSeat;
  }
  await sync();
  if (info.status === 'setup') startTicker();
}

// 戰報上被點開的那一則（在棋盤上亮出起點與終點）。再點一次就取消。
let pinnedLog = null;
let lobbyOpen = false;            // 等人畫面（某一間房的座位表）正開著
// 從配對大廳點座位、正在連那一桌：連上之前大廳頁先留著，連上後由等人畫面接手；
// 萬一那一桌已經開打，syncOnline 要記得把大廳頁收掉（否則它會蓋在棋盤上）。
let lbJoining = false;
// 大廳裡被伺服器拒絕的訊息要顯示在大廳上。原本只寫進戰報，而戰報被大廳視窗蓋住，
// 玩家按了沒反應又看不到理由（Lynch：「我怎麼好像不能選位置」）。
let lobbyError = '';
let ignoreLobbyError = '';        // 已知可以忽略的一則錯誤（例如舊伺服器不認得 rename）
const closeLobbyPageIfOpen = () => {
  if (lobbyOpen || lbJoining) { lobbyOpen = false; lbJoining = false; lbHide(); }
};

const textBlock = (t) => { const d = document.createElement('div'); d.className = 'modal-lead'; d.textContent = t; return d; };

// ── 大廳滿版頁（v232，B 款「暖木棋館」，WO-army-1015-03）──────────────────
// 配對大廳與等人畫面原本是彈出框裡排方框，產品長 10/15 體檢說「陽春」、跟首頁風格斷掉。
// 改成蓋住整個視窗的一頁：背景是 GPT 畫的空桌場景圖，四個座位是疊在椅子上的真按鈕
// （產品長條件一：不能整張圖當背景就結束）。
// ⚠ 流程（坐下、離座、準備、請離座、提早開局、離開）完全沿用原本那一套，這裡只管「畫在哪、長什麼樣」。
const lobbyPage = document.getElementById('lobbyPage');
// 畫面位置 → 小人的顏色。跟背景椅子一致：下藍、右綠、上紅、左黃。
const LB_FIGURE = { bottom: 'blue', right: 'green', top: 'red', left: 'yellow' };
const lb = (() => {
  const mk = (tag, cls = '', text = null) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const backdrop = mk('div', 'lb-backdrop');
  const scene = mk('div', 'lb-scene');
  const head = mk('header', 'lb-head');
  const foot = mk('footer', 'lb-foot');
  lobbyPage?.append(backdrop, scene, head, foot);
  // 上方標題區、下方按鈕區的實際高度交給 CSS，場景圖就縮放到兩者中間（見 theme.css 的 .lb-scene）。
  // 量的是真實高度，所以字型、戰績卡、錯誤訊息長短變了也不會讓椅子被按鈕蓋住。
  const fit = () => {
    if (!lobbyPage || lobbyPage.hidden) return;
    lobbyPage.style.setProperty('--top-res', `${Math.ceil(head.offsetHeight)}px`);
    lobbyPage.style.setProperty('--bot-res', `${Math.ceil(foot.offsetHeight)}px`);
  };
  try { const ro = new ResizeObserver(fit); ro.observe(head); ro.observe(foot); } catch { /* 舊瀏覽器：用 CSS 的預設值 */ }
  return { mk, scene, head, foot, fit };
})();
function lbShow(kind) {
  if (!lobbyPage) return;
  lobbyPage.dataset.kind = kind;
  lobbyPage.hidden = false;
}
function lbHide() {
  if (!lobbyPage) return;
  lobbyPage.hidden = true;
  lobbyPage.dataset.kind = '';
}
const lbButton = (cls, label, onClick) => {
  const b = lb.mk('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

// 上方：（返回）＋代稱，小字標籤，深綠大標題，人數膠囊。extra 放在膠囊下面（戰績卡）。
function lbHead({ label, title, pill, onBack = null, onRename, pillSide = null, extra = null }) {
  const { mk } = lb;
  const bar = mk('div', 'lb-bar');
  bar.append(onBack ? lbButton('lb-back', '‹ 返回', onBack) : mk('span'));
  // 「改代稱」保留，但放在不搶眼的右上角小字
  const nm = lbButton('lb-name', null, onRename);
  nm.title = '改代稱';
  nm.append('你的代稱：', mk('b', '', playerName() || '（還沒取名）'), mk('span', 'lb-name-edit', '改'));
  bar.append(nm);
  const pillRow = mk('div', 'lb-pill-row');
  const p = mk('div', 'lb-pill');
  p.append(mk('span', 'lb-pill-icon'), mk('span', '', pill));
  pillRow.append(p);
  if (pillSide) pillRow.append(pillSide);
  lb.head.replaceChildren(bar, mk('div', 'lb-label', label), mk('h2', 'lb-title', title), pillRow,
    ...(extra ? [extra] : []));
}

// 戰績小卡（照 戰績小卡.png）：三格＋一行「跟真人／跟電腦」。資料只讀 tally.js（原 stats.js），不改它的格式。
// 勝率的算法跟首頁那行（statsLine）一致：贏 ÷（贏＋輸），和局不算。
function lbStatsCard() {
  const { mk } = lb;
  let st;
  try { st = readStats(localStorage); } catch { st = { played: 0 }; }
  const card = mk('div', 'lb-stats');
  card.append(mk('div', 'lb-stats-title', '你的戰績'));
  if (!st.played) {
    card.classList.add('is-empty');
    card.append(mk('div', 'lb-stats-empty', '還沒下過，先來一局吧'));
    return card;
  }
  const decided = st.wins + st.losses;
  const rate = decided ? Math.round(st.wins / decided * 100) : 0;
  const cell = (k, n, unit) => {
    const c = mk('div', 'lb-stats-cell');
    c.append(mk('span', 'lb-stats-k', k), mk('b', 'lb-stats-n', String(n)), mk('span', 'lb-stats-u', unit));
    return c;
  };
  const cells = mk('div', 'lb-stats-cells');
  cells.append(cell('已下', st.played, '局'), cell('贏', st.wins, '局'), cell('勝率', rate, '%'));
  card.append(cells, mk('div', 'lb-stats-sub', `跟真人 ${st.vsHuman} 局・跟電腦 ${st.vsAI} 局`));
  return card;
}

// 一個座位：疊在背景椅子上的元素。三種狀態——
//   空位：「坐這裡」小牌＋呼吸光暈（整張椅子都可以點）；已經坐下的人看到的空位是「等待中」，不能點。
//   有人：Q 版小人＋名字小牌；電腦補位顯示「電腦」、小人半透明。
//   自己：小人＋「你」小牌（醒目）＋小小的「離座」。
// meta 是名字下面那行小字（隊友／敵方・準備狀態），action 是名字旁邊的小按鈕（離座／請離座）。
function lbSeat({ pos, who = null, onSit = null, plate = null, meta = '', action = null, ready = false }) {
  const { mk } = lb;
  const el = mk(onSit ? 'button' : 'div', `lb-seat lb-seat--${pos}`);
  el.dataset.pos = pos;
  const info = mk('span', 'lb-info');
  const row = mk('span', 'lb-row');
  info.append(row);
  if (!who) {
    el.classList.add('is-empty');
    if (onSit) { el.type = 'button'; el.addEventListener('click', onSit); el.classList.add('is-open'); }
    el.append(mk('span', 'lb-glow'));
    row.append(mk('span', 'lb-plate', plate ?? (onSit ? '坐這裡' : '等待中')));
  } else {
    if (who.me) el.classList.add('is-me');
    if (who.ai) el.classList.add('is-ai');
    if (ready) el.classList.add('is-ready');
    const img = mk('img', 'lb-fig');
    img.src = `img/lobby/player-${LB_FIGURE[pos]}.webp`;
    img.alt = '';
    img.draggable = false;
    el.append(img);
    row.append(mk('span', 'lb-plate', who.name));
    if (action) row.append(lbButton('btn btn--tiny lb-act', action.label, action.onClick));
  }
  if (meta) info.append(mk('span', 'lb-meta', meta));
  el.append(info);
  return el;
}

// 下方：（房號大字＋複製邀請連結）、一行說明（有錯誤時換成錯誤）、主按鈕、次按鈕、（規則說明）。
// 說明那一行永遠佔一行：錯誤出現或消失時，按鈕跟椅子都不會被推動。
function lbFoot({ room = null, hint = '', error = '', primary = null, secondary = null, links = false, report = null }) {
  const { mk } = lb;
  const parts = [];
  if (room) parts.push(room);
  const line = mk('div', `lb-hint${error ? ' is-error' : ''}`, error || hint || ' ');
  if (error) line.setAttribute('role', 'alert');
  parts.push(line);
  const acts = mk('div', 'lb-actions');
  if (primary) {
    const b = lbButton(`btn ${primary.done ? '' : 'btn--primary '}lb-btn lb-btn--main${primary.done ? ' is-done' : ''}`,
      primary.label, primary.onClick);
    b.disabled = !!primary.disabled;
    acts.append(b);
  }
  if (secondary) acts.append(lbButton('btn lb-btn', secondary.label, secondary.onClick));
  parts.push(acts);
  if (report && !links) {
    const lk = mk('div', 'lb-links');
    lk.append(lbButton('lb-link', '檢舉代稱', report));
    parts.push(lk);
  }
  if (links) {
    const lk = mk('div', 'lb-links');
    lk.append(lbButton('lb-link', '規則說明', () => openGuide()));
    if (report) lk.append(lbButton('lb-link', '檢舉代稱', report));
    // 分級標示：首頁有一份完整的；這裡留一個小的，免得從 #lobby 直接進來的人一次都沒看到
    const rate = mk('span', 'lb-rating');
    const img = mk('img');
    img.src = 'rating-general.png'; img.width = 20; img.height = 20; img.alt = '普遍級';
    rate.append(img, '普遍級');
    lk.append(rate);
    parts.push(lk);
  }
  lb.foot.replaceChildren(...parts);
}

// 大廳：誰坐哪、邀請連結、開始。每次伺服器推狀態就整個重畫（人少、很便宜）。
let lobbyKickTimer = null;
function renderLobby(info) {
  clearTimeout(lobbyKickTimer);
  lbJoining = false;
  // 配對大廳的公開桌才有 lobby（準備／請離座，Lynch 2026-09-29）；朋友房沒有這一層
  const pub = info.lobby ?? null;
  if (info.you?.kicked) {
    lobbyOpen = false;
    lbKickedFrom.add(info.code);        // 回大廳後不要再把這一桌擺到他面前（他坐不回去）
    showModal({ title: `房間 ${info.code}`, body: textBlock('桌主請你離開這一桌了。回大廳換一桌吧。'),
      actions: [{ label: '回大廳', primary: true, onClick: () => {
        session?.close?.(); online = null;
        // 網址還掛著這一桌的房號，一重整又會被帶回這張把他請走的桌子（10/13 本機實測）
        try { history.replaceState(null, '', `${location.pathname}${location.search}#lobby`); } catch { /* 不影響 */ }
        openMatchLobby();
      } }] });
    return;
  }
  // 封鎖過的人坐進這一桌（還沒開局）：替他離開，回大廳或首頁。開局後就不打斷，下一桌再擋。
  const blockedHere = info.status === 'lobby'
    && SEATS.some(x => info.seats?.[x]?.tag && blockedTags().has(info.seats[x].tag));
  if (blockedHere) {
    lobbyOpen = false;
    lbKickedFrom.add(info.code);
    // 先讓出座位再斷線：朋友房斷線會替人保留座位，不讓的話桌主那邊會卡著一個空殼
    for (const seat of info.you?.seats ?? []) try { session?.send?.({ type: 'unseat', seat }); } catch { /* 斷線也無妨 */ }
    setTimeout(() => { session?.close?.(); }, 300);
    online = null;
    showModal({ title: `房間 ${info.code}`, body: textBlock('這一桌有你封鎖的玩家，已經幫你離開。'),
      actions: [{ label: pub ? '回大廳' : '回首頁', primary: true, onClick: () => {
        try { history.replaceState(null, '', `${location.pathname}${location.search}${pub ? '#lobby' : ''}`); } catch { /* 不影響 */ }
        if (pub) openMatchLobby(); else { closeModal(); lbHide(); newGame(); }
      } }] });
    return;
  }
  // 用 # 而不是 ?room=：短、好念、好打，而且靜態站不需要任何路由設定就吃得下。
  // Lynch：「我希望網址精簡一點，譬如不要有 ?room 這樣太難打字。」
  const link = `${location.origin}${location.pathname}?from=invite#${info.code}`;   // from：只分來源，不帶人

  // 座位照棋盤的相對位置擺在四張椅子上。已經入座的人：自己一定在下方，其餘照行棋順序
  // 逆時針擺（右、對面、左）——那正是開局後畫面會呈現的樣子。還沒入座的人：以 1 號位為基準。
  const mine = info.you?.seats ?? [];
  const base = mine[0] ?? 0;
  const at = (offset) => (base + offset) % 4;
  let kickDue = Infinity;               // 最早一個「可以請離座」的時間，到時重畫一次讓按鈕出現
  const seatEl = (seat, pos) => {
    const who = info.seats?.[seat];
    const isMine = mine.includes(seat);
    // 隊別用「隊友／敵方」講，比「隊A／隊B」直覺——但沒入座時還沒有「你」，那就照實寫成 A／B 兩隊。
    // 還沒坐下：有人先坐了（多半是邀請你的朋友），空椅子就直接講「跟他同隊／對手」，
    // 被邀請的人一眼找得到隊友位（產品長 10/21 建議）。沒人坐才照實寫 A／B 隊。
    const firstHuman = SEATS.find(x => info.seats?.[x] && !info.seats[x].ai);
    const team = mine.length
      ? (TEAM_OF(seat) === TEAM_OF(base) ? (isMine ? '' : '隊友') : '敵方')
      : firstHuman != null && !who
        ? (TEAM_OF(seat) === TEAM_OF(firstHuman) ? `${info.seats[firstHuman].nickname}的隊友` : `${info.seats[firstHuman].nickname}的對手`)
        : (TEAM_OF(seat) === 0 ? 'A 隊' : 'B 隊');
    if (!who) {
      return lbSeat({ pos, meta: team,
        onSit: mine.length ? null : () => { lobbyError = ''; session.send({ type: 'seat', seat }); } });
    }
    let meta = team, action = null, ready = false;
    if (pub && !who.ai) {
      const hostSeat = info.you?.isHost ? mine[0] : null;
      ready = pub.ready.includes(seat);
      const st = pub.hostSeat === seat ? '桌主' : (ready ? '已準備 ✓' : '還沒準備');
      meta = [team, st].filter(Boolean).join('・');
      // 桌主：坐下滿 30 秒還沒準備的人，可以請他離座（時間到才出現按鈕）
      if (info.isHost && !isMine && !ready && hostSeat != null) {
        const due = pub.kickAt[seat] ?? Infinity;
        if (Date.now() >= due) action = { label: '請離座', onClick: () => { lobbyError = ''; session.send({ type: 'kick', seat }); } };
        else kickDue = Math.min(kickDue, due);
      }
    }
    if (isMine) action = { label: '離座', onClick: () => { lobbyError = ''; session.send({ type: 'unseat', seat }); } };
    return lbSeat({ pos, meta, action, ready,
      who: { name: who.ai ? '電腦' : (isMine ? '你' : who.nickname), ai: !!who.ai, me: isMine } });
  };
  const seatEls = [seatEl(at(2), 'top'), seatEl(at(3), 'left'), seatEl(at(1), 'right'), seatEl(at(0), 'bottom')];
  if (kickDue < Infinity)
    lobbyKickTimer = setTimeout(() => { if (lobbyOpen && session) renderLobby(session.roomInfo()); }, kickDue - Date.now() + 50);

  // 現在幾個人、空位怎麼辦——一顆膠囊講完（原本彈出框裡那兩段長說明刪掉，只留下面一行）
  const humans = SEATS.filter(x => info.seats?.[x] && !info.seats[x].ai).length;
  const pill = pub ? `${humans}／4，坐滿自動開局`
    : (humans < 4 ? `${humans}／4，人不滿也可以開始` : '4／4，到齊了');

  // 朋友房：房號大字＋邀請朋友。公開桌不必找人，不放這一列。
  let room = null;
  if (!pub) {
    room = lb.mk('div', 'lb-room');
    const box = lb.mk('div', 'lb-room-code');
    box.append(lb.mk('span', 'lb-room-k', '房號'), lb.mk('b', '', info.code));
    const copy = lbButton('btn lb-copy', '邀請朋友');
    copy.addEventListener('click', async () => {
      funnel.step('按分享');
      if (nativeShare({ title: '四國軍棋', text: '來跟我下一局四國軍棋：點連結直接坐下，不用下載、不用註冊', url: link })) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: '四國軍棋',
            text: '來跟我下一局四國軍棋：點連結直接坐下，不用下載、不用註冊',
            url: link,
          });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
      navigator.clipboard?.writeText(link);
      copy.textContent = '已複製 ✓';
      setTimeout(() => { copy.textContent = '邀請朋友'; }, 1600);
    });
    room.append(box, copy);
  }

  let hint;
  const myReady = pub && mine.length ? pub.ready.includes(mine[0]) : false;
  if (!mine.length) hint = '點一張空椅子坐下';
  else if (pub) hint = info.isHost ? '其他人都按了「我準備好了」，就能提早開局'
    : (myReady ? '等桌主開局，坐滿四人也會自動開始' : '按「我準備好了」，桌主就能提早開局');
  else hint = '對面是隊友，左右是敵人；開局後你一律在下方';

  let primary = null;
  if (info.isHost) primary = { label: pub ? '提早開局（空位由電腦補）' : '開始遊戲',
    onClick: () => { lobbyError = ''; session.send({ type: 'start' }); } };
  else if (pub && mine.length) {
    primary = myReady
      ? { label: '已準備 ✓　再按一下取消', done: true, onClick: () => { lobbyError = ''; session.send({ type: 'ready', ready: false }); } }
      : { label: '我準備好了', onClick: () => { lobbyError = ''; session.send({ type: 'ready', ready: true }); } };
  }
  const secondary = { label: '離開', onClick: () => {
    session?.close?.(); online = null; lobbyOpen = false; lbHide(); newGame();
  } };

  lobbyOpen = true;
  lbShow('room');
  lbHead({ label: pub ? '配對大廳' : `房間 ${info.code}`, title: mine.length ? '等人到齊' : '選個位置坐下',
    pill, onRename: renameMe });
  lb.scene.replaceChildren(...seatEls);
  // 檢舉代稱（法遵 10/21、App Store：公開給陌生人看的文字要能檢舉）：只列同桌其他真人
  const others = othersInRoom(info, mine);
  lbFoot({ room, hint, error: lobbyError, primary, secondary,
    report: others.length ? () => openReportNickname(others, info.code) : null });
  lb.fit();
}

// 同桌其他真人（給檢舉／封鎖用）：同一個人控兩家只列一次
function othersInRoom(info, mine = info.you?.seats ?? []) {
  const seen = new Map();
  for (const x of SEATS) {
    const p = info.seats?.[x];
    if (!p || p.ai || mine.includes(x) || !p.tag) continue;
    if (!seen.has(p.tag)) seen.set(p.tag, { name: p.nickname, tag: p.tag });
  }
  return [...seen.values()];
}

// 封鎖（App Store 1.2，法遵 10/21）：只存在這台裝置，記對方的短代碼、不記代稱。
const BLOCK_KEY = 'army-online:blocked';
const blockedTags = () => { try { return new Set(JSON.parse(localStorage.getItem(BLOCK_KEY) ?? '[]')); } catch { return new Set(); } };
const blockTag = (tag) => {
  const all = blockedTags(); all.add(tag);
  try { localStorage.setItem(BLOCK_KEY, JSON.stringify([...all].slice(-200))); } catch { /* 無痕模式 */ }
};

// 檢舉代稱：送到伺服器存 90 天，有人看過就處理（改成無名氏或刪帳號）。
// 不送檢舉人的帳號，只送房號與被檢舉的代稱。封鎖只在本機。
function openReportNickname(players, code) {
  const wrap = document.createElement('div');
  const p = (t) => { const e = document.createElement('p'); e.textContent = t; return e; };
  const msg = document.createElement('div');
  msg.className = 'modal-empty';
  wrap.append(p('代稱不恰當（罵人、色情、冒充官方、用了別人的真名），或不想再跟某人同桌？檢舉不會讓對方知道是誰；封鎖之後，他坐進你的桌子你會自動離開，大廳也不會再排他的桌子給你。'));
  for (const who of players) {
    const row = document.createElement('div');
    row.className = 'report-row';
    const rep = document.createElement('button');
    rep.className = 'btn';
    rep.textContent = `檢舉「${who.name}」`;
    rep.addEventListener('click', async () => {
      rep.disabled = true;
      try {
        const acc = await ensureAccount();
        const res = await fetch(`${GAME_ENDPOINT}/report`, { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${acc.token}` },
          body: JSON.stringify({ code, nickname: who.name }) });
        if (!res.ok) throw new Error(String(res.status));
        msg.textContent = '已送出，謝謝你。不想跟他同桌，可以按「封鎖」或「離開」。';
      } catch {
        rep.disabled = false;
        msg.textContent = '沒有送出（可能是網路斷了）。請再試一次，或寫信到 contact@fervela.ai 附上房號和代稱。';
      }
    });
    const blk = document.createElement('button');
    blk.className = 'btn btn--danger';
    blk.textContent = blockedTags().has(who.tag) ? '已封鎖' : '封鎖';
    blk.disabled = blockedTags().has(who.tag);
    blk.addEventListener('click', () => {
      blockTag(who.tag);
      blk.textContent = '已封鎖'; blk.disabled = true;
      msg.textContent = `已封鎖「${who.name}」。還沒開局就會幫你離開這一桌；已經開局的話，這一局照常下完。之後不會再跟他同桌。`;
      // 還在等人：馬上照封鎖名單重畫一次，該離開就離開
      if (lobbyOpen && session?.roomInfo) setTimeout(() => { if (lobbyOpen) renderLobby(session.roomInfo()); }, 900);
    });
    row.append(rep, blk);
    wrap.append(row);
  }
  wrap.append(msg);
  showModal({ title: '檢舉或封鎖', body: wrap, actions: [{ label: '關閉', primary: true, onClick: closeModal }] });
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

// move：這一則對應的走子（{ from, to, seat }）。有帶的話，戰報那一行點下去
// 會在棋盤上把起點與終點亮出來——位置本來就是公開資訊，不會洩漏任何身分。
function addLog(text, big = false, move = null) {
  logLines.unshift({ text, big, move });
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
  funnel.step('確定佈陣');
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
  haptic('light');
  myAnim = view.animateMove({ from, to, seat, outcome: move.outcome, piece, path });
  await myAnim;
  (SFX_BY_OUTCOME[move.outcome] ?? null)?.();
  if (move.outcome !== 'moved') haptic('heavy');

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
    if (e.type === 'move') addLog(`${nameOf(e.seat)}：${OUTCOME_TEXT[e.outcome]}`, false,
      { from: e.from, to: e.to, seat: e.seat });
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

let wasMyTurn = false;
// 輪到自己要一眼看得出來（Lynch：「輪到自己，我覺得看不太出來」）。
// 做法刻意避開「多一塊東西」：標題那行本來就在，只是換色＋加一顆會呼吸的點；
// 棋盤用 inset 的外框發光。兩者都不佔版面，手機上棋盤不會被推動。
function paintTurn(myTurn) {
  els.turn.classList.toggle('is-my-turn', myTurn);
  els.board.classList.toggle('is-my-turn', myTurn);
  // 側邊那條橫幅：Lynch 要「換你囉」這種話出現在旁邊，不是只有標題變色。
  if (els.turnBanner) {
    els.turnBanner.classList.toggle('is-my-turn', myTurn);
    els.turnBanner.textContent =
      S.status === 'setup' ? '佈陣中'
      : S.status === 'ended' ? '這一局結束了'
      : myTurn ? '換你囉'
      : S.turn != null ? `等 ${nameOf(S.turn)} 出手…`
      : '';
  }
  // 連線版才提示聲：那時你可能在做別的事，等對手等很久。
  if (myTurn && !wasMyTurn && online && els.soundOn.checked) SFX.select();
  wasMyTurn = myTurn;
}

function refresh() {
  const inSetup = S.status === 'setup';
  const seat = viewSeat();
  view.setBottomSeat(seat);
  els.setupbar.hidden = !inSetup;

  paintTurn(S.status === 'playing' && S.turn != null && !isAI(S.turn)
    && (online ? (session.seatsOwnedBy?.() ?? []).includes(S.turn)
               : ownerOfSeat(S.turn) === activeHuman));

  const board = S.displayBoard;
  // 戰報上點開的那一手優先顯示（點第二次取消）——它就是拿來回看「剛剛那步走去哪」的。
  const pinned = pinnedLog != null ? logLines[pinnedLog]?.move : null;
  view.render({
    board, mySeats: inSetup ? [setupSeat] : [seat],
    selected, moves, revealedFlags: board?.revealedFlags ?? [],
    lastMove: inSetup ? null : (pinned ?? lastMove),
    recentMoves: inSetup ? [] : (pinned ? [] : recentMoves), viewerSeat: seat,
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
    els.turn.textContent = busy ? `${nameOf(currentSeat())} 思考中…`
      : NARROW ? nameOf(currentSeat()) : `輪到 ${nameOf(currentSeat())}`;
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

  els.log.replaceChildren(...logLines.map((l, i) => {
    const li = document.createElement('li');
    li.textContent = l.text;
    li.className = [l.big ? 'is-big' : '', l.move ? 'is-clickable' : '',
      pinnedLog === i ? 'is-pinned' : ''].filter(Boolean).join(' ');
    if (l.move) {
      li.title = '點一下看這步走到哪';
      li.addEventListener('click', () => {
        pinnedLog = pinnedLog === i ? null : i;
        refresh();
      });
    }
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
      ? `你認輸離開${S.plies ? `　共 ${S.plies} 步` : ''}（棋譜已保留）`
      : `${win ? '你和對家' : '左右兩家'}拿下了對方兩面軍旗${S.plies ? `　共 ${S.plies} 步` : ''}`;
  els.overlayCode.textContent = gameCode ? `局名 ${gameCode}` : '';
  // 自然推廣（決策紀錄第 1047 行）：贏的那一刻最想講，給一顆「找朋友來」。
  // 只在贏的時候出現、不自己跳、不擋「再玩一局」。分享內容不帶代稱與棋步。
  els.overlayShare.hidden = !win;
  els.overlayShare.dataset.plies = String(S.plies);
  els.overlay.hidden = false;
  (draw ? SFX.flag : (win ? SFX.victory : SFX.defeat))();
  showStats();
}
els.overlayAgain.addEventListener('click', () => { els.overlay.hidden = true; newGame(); });
els.overlayShare.addEventListener('click', async () => {
  funnel.step('按分享');
  // win.html 只換 LINE／FB 預覽圖成「我贏了」卡，打開就轉回 ./?from=share。
  const url = new URL('win.html', location.href).href;
  const plies = Number(els.overlayShare.dataset.plies) || 0;
  const text = `我剛在四國軍棋贏了一局${plies ? `（${plies} 步）` : ''}。`
    + '不用下載、不用註冊，點開就能玩，來跟我一隊：';
  if (nativeShare({ title: '四國軍棋', text, url })) return;
  if (navigator.share) {
    try { await navigator.share({ title: '四國軍棋', text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  navigator.clipboard?.writeText(`${text}${url}`);
  els.overlayShare.textContent = '已複製，貼給朋友 ✓';
  setTimeout(() => { els.overlayShare.textContent = '找朋友來下一局'; }, 1800);
});

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
    ...(st.plies ? [row('總手數', String(st.plies))] : []),
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
  if (result != null) funnel.step('第一個成果');
  try {
    const rec = await session.record();
    const all = JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]');
    const at = Date.now();
    all.unshift({
      at,
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
    try {
      const room = online ? session.roomInfo() : null;
      const people = (room?.seats ?? []).filter(s => s && !s.ai);
      const humans = online
        ? room?.mode === 'four' ? people.length
          : new Set(people.map(s => s.playerId ?? s.id ?? s.nickname)).size
        : humansInGame().length;
      // 同一間房可以連下好幾局，只用房號會把第二局當成重複；加上步數區分
      recordGame(localStorage, { code: `${gameCode}:${S.plies}`, at, result,
        myTeam: !online && humans > 1 ? null : TEAM_OF(mySeat()), humans });
      paintLandingStats();
    } catch { /* 戰績存不下也不影響棋局或棋譜 */ }
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
// 「⋯」：只有手機看得到（CSS 控制）。用絕對定位浮出來，不佔版面、不會推動棋盤。
// 手機：「戰報」按鈕開關座位／戰報面板（桌機沒有這顆按鈕）
document.getElementById('sideBtn')?.addEventListener('click', () => document.body.classList.toggle('side-open'));
els.moreBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  els.moreBox.classList.toggle('is-open');
});
document.addEventListener('click', (e) => {
  if (!els.moreBox?.classList.contains('is-open')) return;
  if (els.moreBox.contains(e.target) || e.target === els.moreBtn) return;
  els.moreBox.classList.remove('is-open');
});

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
  // Lynch 2026-09-06：「三人玩的時候，沒玩的直接當 AI，不是一人玩兩家。」
  // 原本空位是給同隊的人接手（一人控兩家），但那樣他會看到隊友那家的全部棋子，
  // 等於整局多一半的資訊——三個人在線上玩的時候那很奇怪。改成電腦補位。
  { label: '四人局（找三位朋友）', mode: 'four', fill: 'ai',
    desc: '人不滿也可以開始，空位由電腦補上' },
  { label: '雙人合作（兩人一隊打電腦）', mode: 'two', fill: 'ai',
    desc: '你和朋友同一隊，對面兩家是電腦' },
  { label: '雙人敵對（各控一整隊）', mode: 'two', fill: 'mate',
    desc: '你和朋友各自操控一整隊兩家' },
];

// ── 配對大廳（Lynch 2026-09-25）──────────────────────────────
// 不認識的人也能湊一桌：點空位就坐下，進到那一桌的等待畫面。
// 坐滿四個真人自動開局；人不夠時第一個坐下的人（桌主）可以提早開，空位補電腦。
// 清單每 3 秒刷新一次。
// v232（B 款）：畫面是一張桌子四張椅子，所以一次只畫「一桌」——有人在等的桌子優先
// （人最多的那桌），都沒人就是那張永遠留著的空桌。別桌也有人在等時，膠囊旁邊出現「換一桌」。
// 選中的桌子刷新時不換（照桌號記住），手指下面的座位不會突然變成另一桌的。
const LOBBY_POLL_MS = 3000;
let matchToken = 0;
const lbKickedFrom = new Set();         // 被請離座的桌子：伺服器不讓他坐回去，大廳也就不再選這一桌給他看                     // 每開一次大廳就換號，舊的輪詢看到號碼不對就自己停
function openMatchLobby() {
  closeModal();                         // 從「多人連線」或「被請離座」的彈出框過來的，先把它收掉
  lobbyOpen = false;
  const token = ++matchToken;
  let timer = null, tables = null, failed = false, pickCode = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  const alive = () => token === matchToken && lobbyPage && !lobbyPage.hidden && lobbyPage.dataset.kind === 'match';
  const sitAt = async (code, seat) => {
    stop();
    matchToken++;                       // 還在路上的那次輪詢回來也不要再畫
    await askNickname();                // 還沒取名的人先取名：大廳上別人看到的就是這個
    lbJoining = true;                   // 大廳頁留著，連上那一桌後由等人畫面接手
    await startOnline(code, { seat });
  };
  const seated = (t) => t.seats.filter(Boolean).length;
  const hasRoom = (t) => t.status === 'waiting' && t.seats.some(s => !s) && !lbKickedFrom.has(t.code)
    && !(t.tags ?? []).some(g => g && blockedTags().has(g));    // 坐著我封鎖的人的桌子不排給我
  const pickTable = () => {
    const open = (tables ?? []).filter(hasRoom);
    let tb = open.find(t => t.code === pickCode);
    if (!tb) tb = [...open].sort((a, b) => seated(b) - seated(a))[0] ?? null;   // sort 是穩定的：同人數照開桌先後
    pickCode = tb?.code ?? null;
    return tb;
  };
  const POS = ['bottom', 'right', 'top', 'left'];   // 座位位置照棋盤：1 號位在下、2 右、3 上、4 左
  let lastKey = '';
  const render = () => {
    if (!alive()) return;
    const tb = pickTable();
    const n = tb ? seated(tb) : 0;
    // 別桌也有人在等：給一顆「換一桌」，依開桌先後輪著看
    const others = (tables ?? []).filter(t => hasRoom(t) && seated(t) > 0 && t.code !== tb?.code);
    const playing = (tables ?? []).filter(t => t.status !== 'waiting').length;
    // 每 3 秒刷新一次，但畫面沒變就不要重建：按鈕在手指按下去的那一刻被換掉，
    // 這一下點擊就不算了（本機實測：剛好撞上刷新的那一按沒反應）。
    const key = JSON.stringify([!!tables, failed, tb?.code, tb?.seats, others.length, playing,
      (tables ?? []).map(t => t.status === 'waiting' ? seated(t) : -1), playerName()]);
    if (key === lastKey) return;
    lastKey = key;
    let swap = null;
    if (others.length) {
      swap = lbButton('lb-swap', `換一桌（還有 ${others.length} 桌有人等）`, () => {
        const list = (tables ?? []).filter(t => hasRoom(t) && seated(t) > 0);
        const i = list.findIndex(t => t.code === pickCode);
        pickCode = list[(i + 1) % list.length]?.code ?? pickCode;
        lastKey = '';
        render();
      });
    }
    lbHead({ label: '配對大廳', title: '配對大廳',
      pill: tables ? `${n}／4，坐滿自動開局` : '讀取桌子中…',
      // 對局中的桌子不畫出來，只在膠囊旁邊寫一句「另有 N 桌對局中」（放進下方那行會在手機上被截斷）
      pillSide: swap ?? (playing ? lb.mk('span', 'lb-side-note', `另有 ${playing} 桌對局中`) : null),
      onBack: () => { stop(); lbHide(); openOnlineMenu(); },
      onRename: async () => { await renameMe(); lastKey = ''; render(); },
      extra: lbStatsCard() });
    lb.scene.replaceChildren(...POS.map((pos, seat) => {
      const who = tb?.seats[seat];
      if (who) return lbSeat({ pos, who: { name: who } });
      return lbSeat({ pos, plate: tb ? null : '…', onSit: tb ? () => sitAt(tb.code, seat) : null });
    }));
    const waiting = (tables ?? []).filter(t => t.status === 'waiting').reduce((k, t) => k + seated(t), 0);
    const hint = !tables ? '讀取桌子中…'
      : (waiting ? `現在有 ${waiting} 個人在等` : '還沒有人在等，你先坐下，有人來就自動開局');
    const firstEmpty = tb ? tb.seats.findIndex(s => !s) : -1;
    lbFoot({ hint, error: failed ? '連不上大廳，稍後自動重試…' : '',
      primary: { label: '坐下等人', disabled: firstEmpty < 0, onClick: () => { if (tb && firstEmpty >= 0) sitAt(tb.code, firstEmpty); } },
      secondary: { label: '先跟電腦下一局', onClick: () => {
        stop(); lbHide();
        // 從約桌連結（#lobby）進來的：網址要清掉，否則下到一半重新整理又被帶回大廳
        if (location.hash === '#lobby') try { history.replaceState(null, '', location.pathname + location.search); } catch { /* 不影響 */ }
        newGame();
      } },
      links: true });
    lb.fit();
  };
  let first = true;                     // 第一次輪詢帶 ?open=1，伺服器才數得出「打開大廳幾次」
  const poll = async () => {
    if (!alive()) return stop();
    try {
      const res = await fetch(`${GAME_ENDPOINT}/lobby${first ? '?open=1' : ''}`);
      first = false;
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.tables)) throw new Error();
      tables = data.tables;
      failed = false;
    } catch {
      failed = true;
    }
    if (!alive()) return stop();
    render();
    timer = setTimeout(poll, LOBBY_POLL_MS);
  };

  lbShow('match');
  render();
  poll();
}

function openOnlineMenu(prefill = '') {
  const wrap = document.createElement('div');
  const lobbyBtn = document.createElement('button');
  lobbyBtn.className = 'btn online-choice online-choice--lobby';
  lobbyBtn.innerHTML = '<b>配對大廳</b><span>跟線上的人湊一桌，點空位就坐下</span>';
  lobbyBtn.addEventListener('click', openMatchLobby);
  wrap.append(lobbyBtn);
  wrap.append(textBlock('或者自己開一間房，把連結傳給朋友。'));
  for (const m of ONLINE_MODES) {
    const b = document.createElement('button');
    b.className = 'btn online-choice';
    b.innerHTML = `<b>${m.label}</b><span>${m.desc}</span>`;
    b.addEventListener('click', async () => {
      // 條款要在開房「之前」問：朋友房只活在伺服器記憶體，開好房沒人連進去，幾秒就被收掉
      // （10/21 驗收踩到：讀條款的十幾秒裡房間就沒了，按同意後「連不上這間房」）
      closeModal();
      if (!(await agreeTerms())) return;
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
  // ── 加入別人開的房：打房號就好，不必等人傳連結 ──
  // Lynch 2026-09-06：「可以選一個是加入遊戲，打遊戲代號就可以進入。」
  const join = document.createElement('div');
  join.className = 'join-box';
  const jt = document.createElement('div');
  jt.className = 'modal-note';
  jt.textContent = '已經有房號了？輸入六位數字直接進去。';
  const jrow = document.createElement('div');
  jrow.className = 'join-row';
  const jin = document.createElement('input');
  jin.className = 'modal-input join-input';
  jin.placeholder = '例如 483102';
  jin.value = prefill;                 // 連不上之後回來，號碼還在，直接改就好
  jin.inputMode = 'numeric';            // 手機直接跳數字鍵盤
  jin.autocomplete = 'off';
  jin.maxLength = 8;
  const jb = document.createElement('button');
  jb.className = 'btn btn--primary';
  jb.textContent = '加入';
  // 錯誤要分類，而且不能把玩家丟到空棋盤上（GPT 實測：打 123 進去變成空盤，
  // 最後只說「連不上伺服器」，關掉之後也回不到輸入框）。
  // 三種情況分開講，而且輸入框留著、內容留著。
  const jerr = document.createElement('div');
  jerr.className = 'join-error';
  jerr.hidden = true;
  join.append(jerr);
  const fail = (msg) => {
    jerr.textContent = msg; jerr.hidden = false;
    jb.disabled = false; jb.textContent = '加入';
    jin.focus(); jin.select();
  };
  const doJoin = async () => {
    const code = jin.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!code) { jin.focus(); return; }
    if (!/^[0-9]{6}$/.test(code) && !/^[A-Z0-9]{6}$/.test(code))
      return fail('房號是六位數字，再確認一下。');
    jerr.hidden = true;
    jb.disabled = true; jb.textContent = '確認中…';
    // 先問這間房在不在，才分得出「打錯號碼」與「連不上」
    try {
      const res = await fetch(`${GAME_ENDPOINT}/room/${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      // ⚠ 舊版伺服器沒有這個端點，它對任何未知路徑都回 404 {error:'not found'}。
      //    只有明確說「房間不存在」才算真的找不到，否則就照舊直接連連看——
      //    否則伺服器還沒更新的期間，所有人都會被擋在門外。
      if (res.status === 404 && data.error === '房間不存在')
        return fail('找不到這間房。號碼再確認一下，或請對方重開一間。');
    } catch {
      return fail('連不上伺服器，檢查一下網路再試一次。');
    }
    jb.textContent = '連線中…';
    closeModal();
    await startOnline(code);            // 連不上時 startOnline 會自己跳「連不上房間」
  };
  jb.addEventListener('click', doJoin);
  jin.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  jrow.append(jin, jb);
  join.append(jt, jrow);
  wrap.append(join);

  showModal({ title: '多人連線', body: wrap,
    // 取消之後要回得去：從首頁按進來時還沒有任何一局，直接關掉會停在一個空棋盤
    // （Lynch 實測：「按取消會變成這樣，感覺怪怪的」）。
    // 取消是次按鈕：B 款規定金色主按鈕只給「往前走」的那一顆（10/15 iPhone 實測看到取消是金色）
    actions: [{ label: '取消', onClick: () => {
      closeModal();
      if (!session && landing) landing.hidden = false;
    } }] });
}
els.online.addEventListener('click', () => openOnlineMenu());

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
// v234（B 款暖木）：背景改用 GPT 畫的棋館場景圖（theme.css 的 .landing），圖裡桌上已經有一盤棋，
// 原本用 board.js 斜擺畫的那盤（舊的 paintLandingBoard）拿掉，避免兩盤棋疊在一起。

const landing = document.getElementById('landing');
const hideLanding = () => { if (landing) landing.hidden = true; };
function paintLandingStats() {
  const el = document.getElementById('ldStats');
  if (!el) return;
  try { el.textContent = statsLine(readStats(localStorage)); }
  catch { el.textContent = statsLine({ played: 0 }); }
}
paintLandingStats();
async function enterGame(kind) {
  hideLanding();
  await askNickname();
  if (kind === 'online') { openOnlineMenu(); return; }
  await newGame();
  funnel.step('進入棋局');
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
    if (location.hash || new URLSearchParams(location.search).has('room'))
      history.replaceState(null, '', location.pathname + location.search);
  }
  els.overlay.hidden = true;
  if (landing) landing.hidden = false;
});
document.getElementById('ldSolo')?.addEventListener('click', () => enterGame('solo'));
document.getElementById('ldOnline')?.addEventListener('click', () => enterGame('online'));
document.getElementById('ldGuide')?.addEventListener('click', () => openGuide());
const ldVer = document.getElementById('ldVer');
if (ldVer) ldVer.textContent = `v${UI_VERSION}`;
document.getElementById('ldPrivacy')?.addEventListener('click', (event) => {
  event.preventDefault();
  const body = document.createElement('div');
  body.innerHTML = PRIVACY_HTML;
  showModal({ title: '隱私說明', body,
    actions: [{ label: '知道了', primary: true, onClick: closeModal }] });
});

// 我的帳號：看還原碼、用還原碼接回、刪除帳號（App Store 規定 App 內要能自己刪）。
// 首頁頁尾與「⋯」都進得來。帳號只在第一次玩多人連線時才會建立。
function openAccount() {
  const acc = currentAccount();
  const wrap = document.createElement('div');
  const p = (t) => { const e = document.createElement('p'); e.textContent = t; return e; };
  if (acc?.token) {
    wrap.append(p('你的匿名帳號是第一次玩多人連線時自動開的，沒有名字、信箱或密碼。'));
    if (acc.recovery) {
      wrap.append(p('換手機時，在新手機打開這裡、輸入下面這組還原碼，就能接回同一個帳號。請抄下來，不要給別人看。'));
      const box = document.createElement('div');
      box.className = 'report-code';
      box.textContent = acc.recovery;
      wrap.append(box);
    } else {
      wrap.append(p('這台裝置沒有存還原碼，換手機時接不回來；不影響在這台裝置上玩。'));
    }
  } else {
    wrap.append(p('你還沒有線上帳號：只有第一次玩多人連線時才會自動開一個。'));
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '從舊手機接回：輸入還原碼';
  input.autocomplete = 'off';
  const msg = document.createElement('div');
  msg.className = 'modal-empty';
  wrap.append(input, msg);
  const actions = [
    { label: '接回', onClick: async () => {
      if (!input.value.trim()) { msg.textContent = '先輸入還原碼'; return; }
      msg.textContent = '接回中…';
      try { await redeem(input.value.trim()); msg.textContent = '已接回舊帳號 ✓'; }
      catch (e) { msg.textContent = `${e.message}，請檢查有沒有抄錯`; }
    } },
  ];
  actions.push({ label: '刪除我的帳號', danger: true, onClick: confirmDeleteAccount });
  actions.push({ label: '關閉', primary: true, onClick: closeModal });
  showModal({ title: '我的帳號', body: wrap, actions });
}
function confirmDeleteAccount() {
  const d = document.createElement('div');
  d.className = 'modal-note';
  d.textContent = '刪除後：伺服器上的匿名帳號和還原碼會刪掉、還原碼從此不能用；'
    + '這台裝置上的代稱、戰績、陣型、勳章也會清掉。這個動作不能復原。'
    + '之後再玩多人連線，會自動開一個全新的帳號。'
    + '（已上傳的對局紀錄沒有掛帳號，要刪請寫信到 contact@fervela.ai。）';
  const msg = document.createElement('div');
  msg.className = 'modal-empty';
  const body = document.createElement('div');
  body.append(d, msg);
  showModal({ title: '確定刪除我的帳號？', body, actions: [
    { label: '先不要', onClick: openAccount },
    { label: '確定刪除', danger: true, primary: true, onClick: async () => {
      msg.textContent = '刪除中…';
      try {
        await deleteAccount();
        const done = document.createElement('div');
        done.className = 'modal-note';
        done.textContent = '帳號已刪除。這台裝置上的資料也清掉了。';
        showModal({ title: '已刪除', body: done, actions: [
          { label: '回首頁', primary: true, onClick: () => { location.href = location.pathname; } },
        ] });
      } catch (e) {
        msg.textContent = `沒有刪成功：${e.message}。請確認有連上網路再試一次；資料都還在。`;
      }
    } },
  ] });
}
document.getElementById('reportBtn')?.addEventListener('click', () => {
  els.moreBox?.classList.remove('is-open');
  const info = online && session?.roomInfo ? session.roomInfo() : null;
  const others = info ? othersInRoom(info) : [];
  if (!others.length) { hint('這一局沒有其他真人玩家'); return; }
  openReportNickname(others, info.code);
});
document.getElementById('accountBtn')?.addEventListener('click', () => { els.moreBox?.classList.remove('is-open'); openAccount(); });
document.getElementById('ldAccount')?.addEventListener('click', (event) => { event.preventDefault(); openAccount(); });

// 代稱：顯示在首頁，點一下就能改（Lynch：「要有可以改名的位置」）。
// 放在首頁而不是對局畫面——改名是開局前的事，對局中改會讓棋譜裡同一局出現兩個名字。
const ldName = document.getElementById('ldName');
const paintName = () => { if (ldName) ldName.textContent = playerName() || '（還沒取名）'; };
paintName();
// 改代稱：首頁、佈陣列、大廳三個地方都叫這一支（Lynch：「不要只在首頁」）。
// 在房間裡的話還要通知伺服器，否則別人看到的還是舊名字。
async function renameMe() {
  await askNickname({ force: true });
  paintName();
  if (online && session?.send) {
    // 舊版伺服器不認得 rename，會回一句錯誤——那不是玩家的問題，不要拿去嚇他。
    ignoreLobbyError = '不認識的動作';
    session.send({ type: 'rename', nickname: playerName() });
  }
  if (lobbyOpen) renderLobby(session.roomInfo());
  refresh?.();
}
document.getElementById('ldRename')?.addEventListener('click', renameMe);
els.btnName?.addEventListener('click', renameMe);

// 帶著邀請連結進來的人，直接進那一間房——不要先擋一個進場畫面。
// 三種寫法都吃：#123456（現在發出去的）、?room=（舊連結）、?r=（手打的簡寫）。
const params = new URLSearchParams(location.search);
const joinCode = (location.hash.replace(/^#/, '') || params.get('room') || params.get('r') || '').trim();
// army.fervela.ai/#lobby：直接打開配對大廳（10/9 加）。約朋友湊桌時傳這個連結，
// 對方點開就在大廳，不用先找「多人連線」再找「配對大廳」兩層。
if (joinCode.toLowerCase() === 'lobby') {
  hideLanding();
  // 從約桌連結進來的人是要跟真人打，不是打三家電腦——開場白要對得上
  askNickname({ lead: '四人兩隊的暗棋，跟線上的人湊一桌。取個代稱，大家在大廳就看得到你。' }).then(() => openMatchLobby());
} else if (joinCode) {
  hideLanding();
  // 點朋友的邀請連結進來的：開場白要講「朋友在等你」，不是「打三家電腦」（10/21 走截圖串時看出來）
  askNickname({ lead: '朋友邀你一起下四國軍棋（四人兩隊的暗棋）。取個代稱，就進他的房間坐下。' })
    .then(() => startOnline(joinCode.toUpperCase()));   // 舊的英數房號要轉大寫，純數字不受影響
} else {
  if (landing) landing.hidden = false;
}

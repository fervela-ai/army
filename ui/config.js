// 部署設定。改這裡就好，不用動遊戲程式。
//
// RECORD_ENDPOINT：棋譜要回傳到哪裡。
//   本機開發時留空字串，會用同網域的 /record（tools/dev-server.py 會寫進 records/）。
//   上線時填 Worker 的網址，例如 'https://army-records.xxx.workers.dev/record'。
// 本機開發時不要送到正式的收件端——測試棋譜混進真實資料裡，分析時就得一直挑掉。
// （這件事已經發生過：本機測了兩局，正式 KV 就多了兩筆假資料。）
const LOCAL = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
export const RECORD_ENDPOINT = LOCAL
  ? ''                                                             // 走同網域 /record，由 tools/dev-server.py 收
  : 'https://army-records.fervela-ai.workers.dev/record';

// GAME_ENDPOINT：多人連線的遊戲伺服器（房間＋裁判＋AI 都跑在上面）。
// 跟棋譜那支是**兩個不同的 Worker**，不要混用。
// 本機開發時也指向正式的那支——連線層沒有本機替身，而且它不會寫進棋譜庫，
// 不像 RECORD_ENDPOINT 那樣會污染真實資料。
// 例外：本機加 ?game=8799 就改連本機的 `wrangler dev`——伺服器端的改動（例如配對大廳）
// 還沒上線前要先在本機驗，不能拿正式伺服器做實驗。只在 localhost 生效。
const LOCAL_GAME_PORT = LOCAL && /^\d{4,5}$/.test(new URLSearchParams(globalThis.location?.search).get('game') ?? '')
  ? new URLSearchParams(globalThis.location.search).get('game') : null;
export const GAME_ENDPOINT = LOCAL_GAME_PORT
  ? `http://localhost:${LOCAL_GAME_PORT}`
  : 'https://army-game.fervela-ai.workers.dev';

// WebSocket 的位址由上面那個換算，不要另外寫死一份，免得改了一個忘了另一個。
export const GAME_WS = GAME_ENDPOINT.replace(/^http/, 'ws');

// 棋譜要標上是哪一版 AI 下的，否則之後拿到一堆棋譜也分不出誰是誰。
// 每次改動 AI 就把這個往上跳。
export const AI_VERSION = '2026-08-29a';

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

// 棋譜要標上是哪一版 AI 下的，否則之後拿到一堆棋譜也分不出誰是誰。
// 每次改動 AI 就把這個往上跳。
export const AI_VERSION = '2026-08-29a';

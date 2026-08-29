// 部署設定。改這裡就好，不用動遊戲程式。
//
// RECORD_ENDPOINT：棋譜要回傳到哪裡。
//   本機開發時留空字串，會用同網域的 /record（tools/dev-server.py 會寫進 records/）。
//   上線時填 Worker 的網址，例如 'https://army-records.xxx.workers.dev/record'。
export const RECORD_ENDPOINT = '';

// 棋譜要標上是哪一版 AI 下的，否則之後拿到一堆棋譜也分不出誰是誰。
// 每次改動 AI 就把這個往上跳。
export const AI_VERSION = '2026-08-29a';

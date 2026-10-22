// 從邀請或分享連結進來時，漏斗只記一個固定步驟名，不帶房號、代稱、網址任何片段（法遵 10/21 條件）。
// 拆成獨立小檔，是為了測試能直接驗「網址裡有什麼都不會流進漏斗」。
export const SHARE_STEP = '從分享進來';

// search：location.search。回傳 step（要送的步驟名或 null）與拿掉 from 之後剩下的查詢字串。
export function shareEntry(search) {
  const q = new URLSearchParams(search);
  if (!q.has('from')) return { step: null, rest: q.toString() };
  q.delete('from');
  return { step: SHARE_STEP, rest: q.toString() };
}

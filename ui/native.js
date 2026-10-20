// 手機殼的原生功能（iOS 殼用 WKWebView 的 messageHandlers；Android 與網頁走瀏覽器原本的路）。
// 殼沒接上這些名稱時一律退回網頁做法，所以網頁版、舊殼都不會壞。
const bridge = (name) => globalThis.webkit?.messageHandlers?.[name] ?? null;

// 系統分享面板：有原生就用原生（LINE、訊息一步傳出），回傳 true 代表已經交出去了。
export function nativeShare({ title, text, url }) {
  const h = bridge('fervelaShare');
  if (!h) return false;
  try { h.postMessage({ title, text, url }); return true; } catch { return false; }
}

// 落子、吃子的手感：light＝走一步，heavy＝吃子或同歸於盡。
export function haptic(kind = 'light') {
  const h = bridge('fervelaHaptic');
  try {
    if (h) h.postMessage(kind);
    else navigator.vibrate?.(kind === 'heavy' ? 30 : 10);
  } catch { /* 有些瀏覽器不准震動，安靜略過 */ }
}

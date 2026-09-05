// 帳號：第一次進站自動就有，玩家完全無感。
//
// Lynch 的三條前提（docs/ACCOUNTS.md）：
//   1.「打開就能玩」不能破壞——所以不問任何問題就先給帳號。
//   2. 零個資——不收 email、不收真名。
//   3.「我最怕資安問題」——所以沒有密碼、沒有 OAuth、也沒有 passkey（他明確說不要）。
//
// 換裝置靠「還原碼」：一組抄得下來的短碼，在新裝置貼上就接續同一個帳號。
// **只有在玩家已經有東西可失去的時候才提出**——那時他才有動機去抄。
import { GAME_ENDPOINT } from './config.js?v=198';

const KEY = 'army-online:account';

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
};
const save = (acc) => {
  try { localStorage.setItem(KEY, JSON.stringify(acc)); } catch { /* 無痕模式就只有這一次 */ }
};

const post = async (path, body, token) => {
  const res = await fetch(GAME_ENDPOINT + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `連線失敗（${res.status}）`);
  return data;
};

// 取得可用的帳號。沒有就跟伺服器要一個。
// ⚠ 還原碼只有這一次拿得到（伺服器只存雜湊），所以拿到就存進本機，
//   讓玩家之後隨時看得到——不然他永遠不知道自己有這個東西。
export async function ensureAccount() {
  const have = load();
  if (have?.token) return have;
  const data = await post('/auth/anon');
  const acc = { userId: data.userId, token: data.token, recovery: data.recovery };
  save(acc);
  return acc;
}

export const currentAccount = () => load();

// 在新裝置貼上還原碼，接續同一個帳號
export async function redeem(code) {
  const data = await post('/auth/redeem', { code });
  const acc = { userId: data.userId, token: data.token, recovery: null };
  save(acc);
  return acc;
}

// 換一組新的還原碼。用途：Lynch 問過「還原碼可以自行更改？」——
// 抄在紙上被別人看到、或想換一組好記的，都需要這個。
export async function rotateRecovery() {
  const acc = load();
  if (!acc?.token) throw new Error('還沒有帳號');
  const data = await post('/auth/rotate', { old: acc.recovery ?? null }, acc.token);
  save({ ...acc, recovery: data.recovery });
  return data.recovery;
}

// 開一間房，拿到邀請碼
export async function createRoom({ mode = 'four', fill = 'mate' } = {}) {
  const acc = await ensureAccount();
  const data = await post('/room', { mode, fill }, acc.token);
  return data.code;
}

// 這台裝置要不要重來一次（Lynch：「一開始三連敗，我就想刪掉這個帳號重來」）。
// 只清本機——伺服器上的舊帳號還在，還原碼還救得回來，所以這不是不可逆的刪除。
export function forgetLocalAccount() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

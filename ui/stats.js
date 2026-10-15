// 本機戰績：只存加總與最後一局代號，不含玩家身分。
const STATS_KEY = 'army-online:stats';
const EMPTY = Object.freeze({ v: 1, played: 0, wins: 0, losses: 0, draws: 0, vsHuman: 0, vsAI: 0, lastCode: null });

export function readStats(store) {
  let saved;
  try { saved = JSON.parse(store.getItem(STATS_KEY) ?? 'null'); } catch { return { ...EMPTY }; }
  if (!saved || saved.v !== 1) return { ...EMPTY };
  const stats = { ...EMPTY };
  for (const key of ['played', 'wins', 'losses', 'draws', 'vsHuman', 'vsAI']) {
    if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) stats[key] = saved[key];
  }
  if (typeof saved.lastCode === 'string') stats.lastCode = saved.lastCode;
  return stats;
}

export function recordGame(store, game) {
  const stats = readStats(store);
  const code = String(game.code || game.at || '');
  if (!code || code === stats.lastCode) return stats;
  if (game.result?.type !== 'win' && game.result?.type !== 'draw') return stats;
  stats.played++;
  if (game.humans >= 2) stats.vsHuman++;
  else stats.vsAI++;
  // 熱座版的這台裝置屬於兩邊玩家，沒有可歸屬的個人勝負。
  if (game.myTeam != null) {
    if (game.result.type === 'draw') stats.draws++;
    else if (game.result.team === game.myTeam) stats.wins++;
    else stats.losses++;
  }
  stats.lastCode = code;
  store.setItem(STATS_KEY, JSON.stringify(stats));
  return stats;
}

export function statsLine(stats) {
  if (!stats.played) return '還沒下過，先來一局吧';
  const decided = stats.wins + stats.losses;
  const rate = decided ? Math.round(stats.wins / decided * 100) : 0;
  return `已下 ${stats.played} 局・贏 ${stats.wins} 局（勝率 ${rate}%）・跟真人 ${stats.vsHuman} 局`;
}

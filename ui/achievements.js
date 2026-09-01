// 成就與每局亮點。
//
// 為什麼先做這個而不是天梯或造型（Lynch 同意的順序）：
//   * 不需要帳號——他刻意不做註冊，天梯和衣櫃都需要「這個人是同一個人」
//   * 人少的時候排名沒有意義；真正讓人想再來一局的是「我剛剛做到了一件事」
//   * 原料已經有了（session.stats）
const KEY = 'army-online:achievements';

// 條件全部用一局結束時的統計去算。文案要具體——「你做到了什麼」比「+10 分」有感。
export const ACHIEVEMENTS = [
  { id: 'firstWin', name: '初戰告捷', desc: '第一次獲勝',
    test: (s, r) => r.win },
  { id: 'flawless', name: '一子未失', desc: '整局出手沒有任何一顆棋子陣亡，而且贏了',
    test: (s, r) => r.win && s.attacks > 0 && s.lost === 0 && s.traded === 0 },
  { id: 'bombHitTop', name: '一擊換帥', desc: '用炸彈換掉對方的司令或軍長',
    test: (s) => s.bombBonus > 0 },
  { id: 'sapper', name: '工兵開路', desc: '一局之內拆掉兩顆以上的地雷',
    test: (s) => s.minesDug >= 2 },
  { id: 'commanderSurvives', name: '司令未損', desc: '贏下這局，而且自己的司令還活著',
    test: (s, r) => r.win && s.myCommanderAlive },
  { id: 'hunter', name: '獵手', desc: '一局之內吃掉八顆以上的棋子',
    test: (s) => s.won >= 8 },
  { id: 'sharpshooter', name: '出手精準', desc: '出手五次以上，勝率八成以上',
    test: (s) => s.attacks >= 5 && s.won / s.attacks >= 0.8 },
  { id: 'longGame', name: '鏖戰', desc: '一局打超過 200 手',
    test: (s) => s.plies >= 200 },
  // ── 以下是第二批（Lynch：「只有八個還是太少，也沒章法系統」）──
  // 分成四類，每類由淺入深，讓人看得出「還有什麼可以拚」：
  // 進攻、工兵、炸彈、收尾。
  { id: 'doubleFlag', name: '雙旗英雄', desc: '同一局親手扛下兩面敵旗',
    test: (s) => (s.myFlagsTaken ?? 0) >= 2 },
  { id: 'firstFlag', name: '扛旗手', desc: '親手扛下一面敵旗',
    test: (s) => (s.myFlagsTaken ?? 0) >= 1 },
  { id: 'decapitate', name: '斬首', desc: '正面吃掉對方的司令或軍長（不是用炸彈）',
    test: (s) => s.topKills >= 1 },
  { id: 'sapperKing', name: '工兵之王', desc: '一局拆掉三顆地雷',
    test: (s) => s.minesDug >= 3 },
  { id: 'doubleBomb', name: '雙響炮', desc: '一局用掉兩顆炸彈，而且都換到人',
    test: (s) => s.bombsSpent >= 2 },
  { id: 'blitz', name: '閃電戰', desc: '一百二十手之內獲勝',
    test: (s, r) => r.win && s.plies <= 120 },
  { id: 'flagKeeper', name: '固若金湯', desc: '獲勝，而且自己的軍旗從沒被碰到',
    test: (s, r) => r.win && !s.myFlagLost },
  { id: 'perfectRate', name: '例無虛發', desc: '出手八次以上，而且沒有任何一次是白虧的',
    test: (s) => s.attacks >= 8 && s.lost === 0 },
  { id: 'comeback', name: '逆轉', desc: '兩百手以上的長局，最後贏下來',
    test: (s, r) => r.win && s.plies >= 200 },
  { id: 'veteran', name: '沙場老將', desc: '累積玩過十局',
    test: (s, r, ctx) => (ctx?.games ?? 0) >= 10 },
  { id: 'winStreak3', name: '三連勝', desc: '連續贏下三局',
    test: (s, r, ctx) => (ctx?.streak ?? 0) >= 3 },
];

// ── 頭銜：每一局給一個，講「這局你打得怎麼樣」──────────────────
// Lynch：「成就只有八個還是太少，也沒章法系統。可以給一些頭銜。
//          譬如這場我勝率 86% 真的是超級高的。」
// 成就是「收集」（拿過就不再跳），頭銜是「這一局的評語」（每局都有，會變）。
// 兩者用途不同：成就給長期目標，頭銜給即時回饋。
// 由上往下比，第一個成立的就是這局的頭銜——所以難的要排前面。
export const TITLES = [
  { name: '常勝統帥', desc: '獲勝，出手八次以上而且勝率九成',
    test: (s, r) => r.win && s.attacks >= 8 && s.winRate >= 0.9 },
  // ⚠ 用 myFlagsTaken（我自己扛的），不是 flagsTaken（我隊扛的）。
  // 一開始寫成隊伍的數字，結果隊友扛的也算到我頭上——Lynch：「我沒有扛兩家，
  // 但最後說我是雙旗英雄」。文案講「你扛的」，數字就必須是你扛的。
  { name: '雙旗英雄', desc: '這局兩面敵旗都是你親手扛的',
    test: (s) => (s.myFlagsTaken ?? 0) >= 2 },
  { name: '零封', desc: '獲勝，而且出手過但一顆子都沒陣亡',
    test: (s, r) => r.win && s.attacks >= 3 && s.lost === 0 },
  { name: '神算', desc: '出手五次以上，勝率八成以上',
    test: (s) => s.attacks >= 5 && s.winRate >= 0.8 },
  { name: '工兵之王', desc: '一局拆掉三顆以上的地雷',
    test: (s) => s.minesDug >= 3 },
  { name: '爆破手', desc: '用炸彈換掉對方的司令或軍長',
    test: (s) => s.bombBonus >= 1 },
  { name: '斬首', desc: '正面吃掉對方的司令或軍長',
    test: (s) => s.topKills >= 1 },
  { name: '開路先鋒', desc: '拆掉兩顆地雷，替大部隊打開通路',
    test: (s) => s.minesDug >= 2 },
  { name: '閃電戰', desc: '一百二十手之內獲勝',
    test: (s, r) => r.win && s.plies <= 120 },
  { name: '鏖戰名將', desc: '兩百手以上的長局，最後贏了',
    test: (s, r) => r.win && s.plies >= 200 },
  { name: '獵手', desc: '一局吃掉八顆以上的棋子',
    test: (s) => s.won >= 8 },
  { name: '守成', desc: '獲勝，而且自己的司令還活著',
    test: (s, r) => r.win && s.myCommanderAlive },
  { name: '慘勝', desc: '贏了，但代價不小',
    test: (s, r) => r.win },
  { name: '死守', desc: '沒有輸掉自己的軍旗',
    test: (s) => !s.myFlagLost },
  { name: '再接再厲', desc: '這一局沒有成功，下一局再來',
    test: () => true },
];

// 這一局的頭銜。由上往下比，第一個成立的就是。
export function titleFor(stats, result) {
  for (const t of TITLES) {
    let ok = false;
    try { ok = !!t.test(stats, result); } catch { ok = false; }
    if (ok) return t;
  }
  return null;
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
export const unlockedIds = () => Object.keys(load());

// 回傳「這一局新解鎖的成就」。已經拿過的不會再跳，否則第二次就沒有感覺了。
// 跨局的紀錄：玩過幾局、目前連勝幾局。有些成就要靠它（沙場老將、三連勝）。
const RUN_KEY = 'army-online:run';
export function noteGame(result) {
  let run = { games: 0, streak: 0, best: 0 };
  try { run = { ...run, ...JSON.parse(localStorage.getItem(RUN_KEY) ?? '{}') }; } catch { /* 壞了就重來 */ }
  run.games += 1;
  run.streak = result.win ? run.streak + 1 : 0;
  run.best = Math.max(run.best, run.streak);
  try { localStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch { /* 存不下就只有這一次 */ }
  return run;
}

export function checkAchievements(stats, result, ctx = {}) {
  const have = load();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = !!a.test(stats, result, ctx); } catch { ok = false; }
    if (!ok) continue;
    have[a.id] = Date.now();
    fresh.push(a);
  }
  if (fresh.length) { try { localStorage.setItem(KEY, JSON.stringify(have)); } catch { /* 存不下就只有這一次 */ } }
  return fresh;
}

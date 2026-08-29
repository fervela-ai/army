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
];

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
export const unlockedIds = () => Object.keys(load());

// 回傳「這一局新解鎖的成就」。已經拿過的不會再跳，否則第二次就沒有感覺了。
export function checkAchievements(stats, result) {
  const have = load();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = !!a.test(stats, result); } catch { ok = false; }
    if (!ok) continue;
    have[a.id] = Date.now();
    fresh.push(a);
  }
  if (fresh.length) { try { localStorage.setItem(KEY, JSON.stringify(have)); } catch { /* 存不下就只有這一次 */ } }
  return fresh;
}

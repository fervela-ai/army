// 一局的結算統計：殘子、出兵勝率、炸彈的獎勵、成就與頭銜要用的細項。
//
// 為什麼獨立成一個模組：本機版（ui/session.js）與連線版（ui/remote-session.js）
// 都要算同一份東西。抄成兩份，改了一邊忘了另一邊，玩家看到的頭銜就會對不上——
// 「雙旗英雄」那個 bug 就是統計判斷寫錯造成的，這種東西只能有一份。
//
// 純函式，不碰房間也不碰引擎狀態：
//   pieces：盤上還在的棋子（{ seat, piece } 的可迭代），要含真實身分——
//           所以只有在局終（或本機版）才叫得動它。
//   moves ：完整棋譜，每一步 { seat, from, to, piece, victim, outcome, ply }。
import { SEATS, TEAM_OF } from './board.mjs';

export function gameStats({ pieces = [], moves = [], seat = 0, plies = 0 } = {}) {
  const team = TEAM_OF(seat);
  const alive = { mine: { 司令: 0, 軍長: 0, 師長: 0 }, foe: { 司令: 0, 軍長: 0, 師長: 0 } };
  // 每一家分開算（Lynch 要的表格：縱軸四家、橫軸 1／2／3／炸彈）
  const bySeat = SEATS.map(() => ({ 司令: 0, 軍長: 0, 師長: 0, 炸彈: 0 }));
  {
    for (const o of pieces) {
      const side = TEAM_OF(o.seat) === team ? 'mine' : 'foe';
      if (o.piece in alive[side]) alive[side][o.piece]++;
      if (o.piece in bySeat[o.seat]) bySeat[o.seat][o.piece]++;
    }
  }
  // 出兵勝率：我方主動發起的攻擊裡，吃掉對方的比例
  let attacks = 0, won = 0, traded = 0, lost = 0, bombBonus = 0;
  const bombKills = [];
  for (const m of moves) {
    if (TEAM_OF(m.seat) !== team) continue;
    if (m.outcome === 'moved') continue;          // 沒碰到人，不算出兵
    attacks++;
    if (m.outcome === 'defenderDead') won++;
    else if (m.outcome === 'bothDead') traded++;
    else lost++;
    // 炸彈換到司令或軍長＝最高價值的一擊
    if (m.piece === '炸彈' && m.outcome === 'bothDead' && m.victim) {
      if (m.victim === '司令' || m.victim === '軍長') { bombBonus++; bombKills.push(m.victim); }
    }
  }
  // 給成就用的細項
  let minesDug = 0, bombsSpent = 0, myCommanderAlive = false;
  let flagsTaken = 0, myFlagsTaken = 0, myFlagLost = false, topKills = 0;
  for (const m of moves) {
    if (m.victim === '軍旗' && m.outcome === 'defenderDead') {
      if (TEAM_OF(m.seat) === team) flagsTaken++;                 // 我隊扛到的旗
      if (m.seat === seat) myFlagsTaken++;                        // **我自己**扛到的旗
      else if (m.to?.startsWith(`P${seat}-`)) myFlagLost = true;  // 自己那面被扛
    }
    if (TEAM_OF(m.seat) !== team) continue;
    if (m.piece === '工兵' && m.victim === '地雷' && m.outcome === 'defenderDead') minesDug++;
    if (m.piece === '炸彈' && m.outcome === 'bothDead') bombsSpent++;
    // 吃掉對方的司令／軍長（不含炸彈換的，那是 bombBonus）
    if (m.outcome === 'defenderDead' && m.piece !== '炸彈'
        && (m.victim === '司令' || m.victim === '軍長')) topKills++;
  }
  for (const o of pieces)
    if (o.seat === seat && o.piece === '司令') myCommanderAlive = true;

  return {
    alive, bySeat, attacks, won, traded, lost, minesDug, bombsSpent, myCommanderAlive,
    // Lynch：「同歸於盡應該算贏，因為不虧。」
    winRate: attacks ? (won + traded) / attacks : null,
    bombBonus, bombKills, flagsTaken, myFlagsTaken, myFlagLost, topKills,
    plies,
  };
}

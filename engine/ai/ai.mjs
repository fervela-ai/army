// AI 對手。對應規格 RULES-V1.md §4.6：AI 與人類受同樣的資訊限制——
// 它只知道自己棋子的身分，敵方一律未知，只能從公開的交手結果推理。
// 絕對不要讓 AI 直接讀 game.at 裡別人的 piece，那會變成作弊機器。
import { BOARD, SEATS, TEAM_OF } from '../src/board.mjs';
import { PIECES } from '../src/rules.mjs';
import { movesForSeat } from '../src/game.mjs';
import { legalMoves } from '../src/rules.mjs';
import { threatMap, hangRisk, VALUE, valueOf, engineerValue, mightMove } from './lookahead.mjs';
import { buildBelief, buildSelfBelief, pLose, leakOf, infoGainOf } from './belief.mjs';
import { TUNED } from './weights-tuned.mjs';
import { nodeXY } from '../src/geometry.mjs';

// 推理記憶。全部只由公開資訊 + 自己棋子的身分推得——這正是人類玩暗棋在做的事。
// weights 可以傳入固定權重；不傳就給這一家隨機生成一種性格。
export function createMemory(seat = null, weights = null, rnd = null) {
  return {
    seat,
    W: weights ?? (rnd ? makePersonality(W, rnd) : W),
    deadly: new Map(),        // 格子 → 撞死過幾個人（大子或地雷）
    mineSuspect: new Set(),   // 疑似地雷：撞死人、位置在敵方後兩排、而且從沒移動過
    bigThreat: new Map(),     // 格子 → 它幹掉過我方多大的子（拿來決定要不要出炸彈）
    revenge: new Map(),       // 格子 → 隊友在那裡折損過幾顆（幫隊友報仇／擋刀）
    moved: new Set(),         // 動過的格子：動過就不可能是地雷或軍旗
    weakKnown: new Map(),     // 已經曝光的弱子（例如拆過地雷的必是工兵）
    notFlag: new Set(),       // 已證實不是軍旗的大本營格子
    myExposed: new Set(),     // 我方已曝光為「大子」的棋子（打贏過，全場都知道它不小）
    lastLostPly: new Map(),   // 我方在哪一格、第幾手折損過
    lostCount: new Map(),     // 我方在哪一格總共折損過幾顆——記整場，不會過期（Lynch）
    notMine: new Set(),       // 確定不是地雷的格子：我方工兵死在那 → 工兵吃得掉地雷，所以那不是雷
    notBomb: new Set(),       // 確定不是炸彈的格子：炸彈碰到誰都同歸於盡，所以「打贏過」或「守住過」的都不是炸彈
    lastMovedPly: new Map(),  // 格子 → 最近一次移動的手數（剛靠過來的很可能是炸彈）
    ply: 0,
    trail: [],                // 自己最近幾步（擋「A→B→A→B」的來回震盪）
    pending: null,            // 自己這一步的意圖，回報結果時用來回推對方多大
  };
}


// ── 可調權重 ──
// 全部集中在這裡，讓 sim/tune.mjs 能自動搜尋。手調到後來全是「沒有統計差異」，
// 改由程式跑幾百局對打來決定數值。改動請附上量測結果，不要憑感覺。
const DEFAULT_W = {
  hqPull: 0.6,          // 往敵方大本營推進
  flagRush: 12,        // 追已顯露的敵方軍旗
  flagDefend: 3.0,      // 守自己的軍旗
  mateFlagDefend: 2.2,  // 守隊友的軍旗
  homeDefend: 4.0,      // 清掉打進自家的敵人
  mateHomeDefend: 3.0,  // 清掉打進隊友家的敵人
  engIdleEarly: 40,     // 工兵沒任務時不准亂動（開局）
  engIdleLate: 6,       // 殘局解禁
  engReveal: 12,        // 走出普通棋子做不到的彎＝自報身分
  engFlagMine: 200,     // 拆「緊鄰敵方大本營」的疑似地雷——工兵最重要的一件事
  engProbe: 6,
  engCamp: 8,           // 工兵躲進行營（Lynch：很好的一步，保護自己）          // 去測疑似地雷（會再乘上地雷機率）
  bombBig: 22,          // 炸彈換軍長以上
  bombMid: 20,          // 炸彈換師長級
  bombIdle: 12,
  // ⚠ 暫時關閉（設 0）。Lynch 的心法是「1 去吃已證明不是炸彈的子，穩賺；
  //   風險是被猜出是 1，但那也表示可以把對方炸彈引出來」——
  //   報酬在「引出炸彈之後把它拆掉」，而我們還沒有那個能力，
  //   所以只承擔風險沒拿到報酬：拆開實測，這半條讓對打從 49.1% 掉到 41.1%。
  //   等欺敵／主動拆炸彈那層做出來再打開。
  commanderFeast: 0,
  commanderVsFresh: 24, // 但不要拿司令去碰剛動過的新子——那最可能是炸彈
  topKill: 22,          // 敵方 1 已死時，用 2 去吃「確定不是 B」的子（Lynch：鐵賺）
  keepCommander: 14,    // 同一情況下，面對「未知」的子讓 2 先上（1 死了會亮軍旗）
  commanderShare: 0.6,  // 但確定不是 B 的子 1 也該吃，只是權重比 2 低（Lynch）
  probeBig: 7,          // 用 3 去碰未知子：它死了就精確指出對方是 1、2 或 B
  bombIdle: 12,         // 炸彈沒目標亂動
  camp: 2.2,            // 佔行營
  campContested: 3.0,   // 敵人就在旁邊的行營
  campHome: 7.0,        // 自家或隊友家的行營被敵人逼近
  campLeave: 26,        // 離開行營（行營的價值是持續的，留守拿不到分，只能讓離開變貴）
  campLeaveBlind: 6.0,  // 為了吃未知子而離營
  revenge: 5.0,         // 隊友折損處
  weakKnown: 12,        // 已曝光的弱子
  deadly: 10,           // 撞死過人的格子
  probeSmall: 4.0,      // 小兵探路
  bigAvoid: 4.0,        // 大子別碰未知
  bombFear: 12,         // 剛靠過來的可能是炸彈
  backRowProbe: 160,
  bigVsUntested: 60,    // 大子在工兵測過之前撞後兩排未知格（Lynch：一定是工兵拆過才衝）     // 小兵去探敵方後兩排。3.0 太弱——軍旗住在後兩排，探路是唯一的進攻途徑
  urgencyCapture: 14,   // 快和局了就出手
  urgencySpan: 45,      // 從第幾步開始緊張（60 減這個數）
  contactPull: 0.8,     // 太久沒吃子時去找人打
  hang: 0.15,           // 把棋子送到人家嘴邊的扣分
  smallVsBig: 6,       // 小子不要一直去撞已知的大子
  guardMate: 3,         // 隊友的主力暴露時過去幫忙擋
  centrePull: 4,        // 中央沒有我方棋子時，把最近的一顆拉過去（有人在就不再加分）
  engThreat: 18,        // 工兵停在敵方軍旗旁製造兩難（對方怎麼回應都洩漏資訊）
  infoLeak: 5,        // 每洩漏一 bit 的代價
  infoGain: 2.5,        // 每問出一 bit 的收益
  beliefEV: 0.12,       // 用信念表算出的期望損益，換算成評分的權重
  plugBreach: 34,       // 護旗的地雷被拆掉後，那個缺口一定要補上
  killIntruder: 30,     // 清掉逼到自家大本營旁的敵方工兵
  engConfirmsFlag: 12,  // 用自己的工兵去解，等於承認那裡是軍旗
  backRowStay: 14,      // 後兩排非必要不准動——一動就等於宣告「我不是地雷」
  blockMate: 7,         // 停在隊友陣地的主幹道上會擋住他出兵
  campFromRow1: 30,     // 用第一排的子佔行營＝告訴對方「這裡沒有炸彈」（Lynch）
  campFromBack: 8,      // 用後兩排的棋子去佔行營要扣分（那些子在守家）
  campAfterLoss: 45,    // 自家行營旁邊剛折損棋子＝立刻去坐進去，別去報仇（Lynch）
  openingCamp: 16,      // 開局搶行營。順序靠 CAMP_PRIORITY 的比例決定，不是靠加大總分      // 開局前五步先佔行營（Lynch），後兩排的子不算
  bombInCamp: 30,       // 炸彈進駐自家門前行營＝Lynch 的防守骨架（安全、匿名、能反擊）
  frontCampHold: 26,    // 佔住自家軍旗前面的行營（Lynch：超級重要的據點，絕對不能不守）
  frontCampLeave: 20,   // 沒事不要離開門前的行營——空出來就是給對方踏板
  noRevenge: 10,        // 剛折損在那格，不要馬上再送一顆回去
  defendPull: 9,        // 有敵人逼近自家軍旗時，把棋子拉回去攔截
  defendKill: 25,       // 吃掉正在逼近軍旗的敵人
  hqRush: 40,           // 敵方大本營沒動過的那顆有一半機率是軍旗，值得衝
  flagSetup: 120,       // 走完這步，下一手就能扛已顯露的軍旗（前瞻一步）
  finalFlagGamble: 200, // 只剩一家敵人時，踏進未排除的大本營＝五五波直接贏，要壓過一切
  frozenIntruder: 45,   // 別花手去吃「困在大本營裡」的敵子——它已經不能動了
  deathSquare: 18,      // 那一格剛吞掉我方棋子，別急著再送一顆過去
  // （不再用時間視窗：死亡格記整場）
  keyNode: 1,         // 佔住重要點位（九宮、行營）本身就有價值
  margin: 1.5,          // 挑步時容許的分數差
};

// 自我對弈調出來的權重會覆寫預設值。整夜跑 sim/tune.mjs 之後，這裡自動生效。
// 量測用：W_OVERRIDE='{"urgencyCapture":40}' 可以臨時蓋掉權重，跑 A/B 不用改檔案。
// （改檔案跑實驗很容易忘記改回來，這個開關就是為了避免那件事。）
const OVERRIDE = (() => {
  try { return JSON.parse(globalThis.process?.env?.W_OVERRIDE ?? '{}'); } catch { return {}; }
})();

export const W = { ...DEFAULT_W, ...TUNED, ...OVERRIDE };

const wOf = (memory) => memory?.W ?? W;

// ── 鐵律 vs 經驗（Lynch 的區分，2026-08-29）──────────────────
// 鐵律＝硬約束，違反就是錯：工兵五條、後兩排非必要不動。程式裡是「直接禁止」。
// 經驗＝情境判斷：大子何時能吃、小子要不要測炸彈、炸彈要不要空炸、要不要裝大子。
//   這些不該寫死——寫死就變成可預測，而且「保守不會連贏」。
//   做法：判斷類的權重每局隨機抖動，等於每一家有不同的性格與風險偏好。
const JUDGEMENT_KEYS = [
  'bigAvoid', 'probeSmall', 'bombBig', 'bombMid', 'bombIdle', 'bombFear',
  'hqRush', 'hang', 'urgencyCapture', 'camp', 'campContested', 'smallVsBig', 'backRowProbe',
];

// 產生一種「性格」：對這幾個判斷項各給一個 0.7~1.4 倍的偏好。
// 鐵律不在此列——它們不是偏好問題。
export function makePersonality(base = W, rnd = Math.random) {
  const out = { ...base };
  for (const k of JUDGEMENT_KEYS) {
    if (typeof out[k] !== 'number') continue;
    out[k] = Math.round(out[k] * (0.7 + rnd() * 0.7) * 100) / 100;
  }
  return out;
}

const isBackRow = (id) => /r[56]c/.test(id);

// 地雷比較常出現在大本營附近，但**這只是傾向，不是定律**。
// Lynch 的指正：「四國軍棋沒有所謂最好，不要把某種擺法當定律。」
// 早期我把 r6c3 設成 1.0、r5c3 設成 0.15，等於假設所有人都用三角雷護旗——
// 碰到不照這套走的對手（例如真人）就會判斷全錯。現在只保留很輕微的傾向。
const MINE_PRIOR = {
  'r6c1': 0.7, 'r6c3': 0.7, 'r6c5': 0.7,
  'r5c2': 0.6, 'r5c4': 0.6,
  'r5c1': 0.5, 'r5c5': 0.5,
  'r5c3': 0.4,
};
const minePrior = (id) => MINE_PRIOR[id.slice(id.indexOf('-') + 1)] ?? 0.5;

// 只吃公開資訊：誰從哪走到哪、結果如何，不含任何棋子身分。
// 唯一的額外資訊來源是「自己那顆棋子是什麼」——那本來就是自己的情報。
export function observe(memory, events) {
  memory.ply += 1;
  for (const e of events) {
    if (e.type !== 'move') continue;

    // 情報要跟著棋子走：一顆棋子換了位置，我對它的推論也要跟著搬過去。
    const survivorMoves = e.outcome === 'moved' || e.outcome === 'defenderDead';
    const relocate = (map) => {
      if (!map.has(e.from)) return;
      if (survivorMoves) map.set(e.to, map.get(e.from));
      map.delete(e.from);
    };
    // Set 版的搬家（notBomb 是 Set，不是 Map）
    const relocateSet = (set) => {
      if (!set.has(e.from)) return;
      if (survivorMoves) set.add(e.to);
      set.delete(e.from);
    };
    // 拆掉疑似地雷的那顆，只可能是工兵——這是暗棋裡最確定的一種曝光
    if (e.outcome === 'defenderDead' && memory.mineSuspect.has(e.to)) memory.weakKnown.set(e.to, '工兵');
    // 走了普通棋子做不到的路線 → 那顆一定是工兵。全場都看得到，敵我皆適用。
    if (e.revealing && e.outcome !== 'attackerDead' && e.outcome !== 'bothDead')
      memory.weakKnown.set(e.to, '工兵');
    // 大本營裡的東西被吃掉、或有人走了進去，那格就確定不是軍旗
    // （軍旗被取走會直接判該家出局，不會只是「吃掉一顆」）
    if (BOARD.nodes.get(e.to)?.kind === 'hq' && e.outcome !== 'attackerDead') memory.notFlag.add(e.to);

    // 炸彈碰到任何棋子都是同歸於盡。所以只要有人「吃掉對方而自己活著」，
    // 或是「守住而攻擊方陣亡」，那顆就確定不是炸彈——這是公開資訊，推得非常硬。
    // Lynch：敵方 1 死掉之後，就該派 2 去吃「已確定不是 B」的子，鐵賺。
    if (e.outcome === 'defenderDead') memory.notBomb.add(e.to);
    if (e.outcome === 'attackerDead') memory.notBomb.add(e.to);

    relocateSet(memory.notBomb);
    relocate(memory.weakKnown);
    relocate(memory.bigThreat);
    // 打贏一場的棋子等於自曝「我不小」，全場都看得到。
    // 它接下來要以大子的姿態行動：躲行營避風頭、果斷吃小子、避開新鮮的未知子（可能是衝著它來的炸彈）。
    if (e.outcome === 'defenderDead' && memory.seat != null && e.seat === memory.seat)
      memory.myExposed.add(e.to);
    if (memory.myExposed.has(e.from)) {
      memory.myExposed.delete(e.from);
      if (e.outcome === 'moved' || e.outcome === 'defenderDead') memory.myExposed.add(e.to);
    }
    if (survivorMoves) memory.lastMovedPly.set(e.to, memory.ply);
    memory.lastMovedPly.delete(e.from);

    // ⚠ 只有真的有棋子「走進」終點才算動過。
    // 攻擊方陣亡時守方動都沒動——把它記成 moved 會直接毀掉整套地雷推斷：
    // 下面那行 `!memory.moved.has(e.to)` 就永遠是 false，mineSuspect 從頭到尾是空的。
    // 實測：155 次非工兵撞雷，攻方記憶裡標成疑似地雷的是 0 次。
    // 一顆護旗雷因此吃掉五顆子（Lynch 的兒子那局 260901-SHW）。
    if (e.outcome === 'moved' || e.outcome === 'defenderDead') memory.moved.add(e.to);
    memory.moved.delete(e.from);
    // 地雷永遠不會移動，所以只要有棋子走進這一格，它就絕對不是地雷。
    // 少了這條，AI 會拿工兵去「拆」一顆剛走過來的旅長（Lynch 實戰抓到）。
    if (e.outcome === 'moved' || e.outcome === 'defenderDead') {
      memory.mineSuspect.delete(e.to);
      memory.notMine.add(e.to);
    }

    const mine = memory.seat != null && e.seat === memory.seat;
    const teammate = memory.seat != null && e.seat !== memory.seat && TEAM_OF(e.seat) === TEAM_OF(memory.seat);

    if (e.outcome === 'attackerDead') {
      memory.deadly.set(e.to, (memory.deadly.get(e.to) ?? 0) + 1);
      if (isBackRow(e.to) && !memory.moved.has(e.to)) memory.mineSuspect.add(e.to);
      if (mine) {
        memory.lastLostPly.set(e.to, memory.ply);
        memory.lostCount.set(e.to, (memory.lostCount.get(e.to) ?? 0) + 1);
      }
      if (mine && memory.pending?.to === e.to) {
        const r = PIECES[memory.pending.piece]?.rank ?? 0;
        memory.bigThreat.set(e.to, Math.max(memory.bigThreat.get(e.to) ?? 0, r));
        // 工兵死在那 → 那格一定不是地雷（工兵是唯一吃得掉地雷的），可以放心叫大子來吃
        if (memory.pending.piece === '工兵') {
          memory.notMine.add(e.to);
          memory.mineSuspect.delete(e.to);
        }
      }
      if (teammate) memory.revenge.set(e.to, (memory.revenge.get(e.to) ?? 0) + 1);
    } else if (e.outcome === 'bothDead') {
      for (const m of [memory.deadly, memory.bigThreat, memory.revenge, memory.weakKnown, memory.lastMovedPly])
        m.delete(e.to);
      memory.mineSuspect.delete(e.to);
    } else if (e.outcome === 'defenderDead') {
      memory.deadly.delete(e.to);        // 該格已易主，舊的威脅情報作廢
      memory.mineSuspect.delete(e.to);
      memory.revenge.delete(e.to);
    }
  }
  memory.pending = null;
  return memory;
}

// 記下自己走過的步，供反震盪判斷。呼叫端在決定走法後呼叫。
export function noteOwnMove(memory, move) {
  if (!memory) return;
  memory.trail = [...(memory.trail ?? []), { ...move, ply: memory.ply }].slice(-8);
}

// 中央九宮的中心點。四條鐵路在這裡交會，站住這裡對四家都構得到。
const CENTRE = 'M-r2c2';

const dist = (a, b) => {
  const p = nodeXY(a), q = nodeXY(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

// 敵方大本營：AI 的長期目標（扛旗才算贏）。
// 一定要排掉已經出局的那一家——它的大本營是空殼，去了也沒有旗可扛。
// 這裡漏掉 eliminated 造成過一個很貴的 bug：扛掉第一家之後，整隊的棋子都還在那家附近，
// 所以那個空殼永遠是「最近的大本營」，全隊就在死人門口繞圈，沒人去打還活著的那家。
// 量出來的症狀是「73% 的和局，有一隊只差最後一面旗」。
const enemyHQs = (game, seat) => [0, 1, 2, 3]
  .filter(s => TEAM_OF(s) !== TEAM_OF(seat) && !game.eliminated.has(s))
  .flatMap(s => [`P${s}-r6c2`, `P${s}-r6c4`]);

// 已顯露的軍旗是公開資訊（司令陣亡就會亮出來），AI 當然要用。
// 這不是作弊——人類玩家看得到一模一樣的東西。
const revealedFlagNodes = (game, predicate) => {
  const out = [];
  for (const s of game.revealedFlags ?? [])
    if (predicate(s))
      for (const [id, o] of game.at) if (o.seat === s && o.piece === '軍旗') out.push({ id, seat: s });
  return out;
};
// 自家（或隊友）的軍旗下一步就會被扛走嗎？
// 用整輪算好的威脅圖，不額外花計算：threatMap 本來就是「敵方構得到哪些格」。
// 這是「算得出這一步之差」的最小版本——知道自己命在旦夕，決策就該整個換一套。
function flagInPeril(game, seat, memory) {
  const threats = memory?.threats;
  if (!threats) return false;
  for (const s of SEATS) {
    if (TEAM_OF(s) !== TEAM_OF(seat) || game.eliminated.has(s)) continue;
    const f = myFlagNode(game, s);
    if (f && (threats.get(f) ?? 0) > 0) return true;
  }
  return false;
}

const myFlagNode = (game, seat) => {
  for (const [id, o] of game.at) if (o.seat === seat && o.piece === '軍旗') return id;
  return null;
};
const inMyTerritory = (id, seat) => id.startsWith(`P${seat}-`);

const kindOf = (id) => BOARD.nodes.get(id).kind;
const neighbours = (id) => [...BOARD.adj.get(id)];

// 評分：分數越高越想走。所有判斷只用得到公開資訊與自己棋子的身分。
// 僵局壓力：越接近「60 步無吃子判和」，越該主動出手。
// 真人不會互相挪棋子挪到和局——僵持對誰都沒好處，總有一方會先動手。
// 沒有這一項時，AI 的對局有 83% 以此收場（實測 522/600）。
// 敵方兩家的司令是不是都死了。司令陣亡會強制亮出該家軍旗，所以這是公開資訊——
// AI 用它不算作弊。這一刻起我的 2 就等於 1：除了炸彈，沒有東西吃得掉它（Lynch）。
function topRankFree(game, seat) {
  for (const s of SEATS) {
    if (TEAM_OF(s) === TEAM_OF(seat)) continue;
    if (!game.eliminated.has(s) && !game.revealedFlags.has(s)) return false;
  }
  return true;
}

const urgency = (game, w) => Math.min(1, (game.pliesSinceCapture ?? 0) / w.urgencySpan);

// 太久沒吃子時，主動去找人打。殘局裡每家有 3 地雷＋軍旗＋大本營卡死的那顆＝5 顆不能動，
// 四家就 20 顆；剩下的活棋散在四角彼此構不到，於是誰也吃不到誰而判和。
// 這一項讓 AI 主動朝最近的敵方活棋靠過去，製造接觸。
const nearestEnemyPiece = (game, seat, to) => {
  let best = Infinity;
  for (const [id, o] of game.at) {
    if (TEAM_OF(o.seat) === TEAM_OF(seat)) continue;
    if (!mightMove(game, id, o)) continue;      // 只用公開資訊判斷會不會動（不准偷看是不是地雷）
    best = Math.min(best, dist(to, id));
  }
  return best;
};

// 找出正在逼近我方（或隊友）軍旗的敵人。
// 這是「防守優先於攻擊」的基礎——沒有這個，AI 只會在能順手吃掉對方時才防守，
// 敵人大搖大擺走進來拆雷扛旗時完全沒有反應（Lynch 實戰：兩步被扛旗兩次）。
const flagThreats = (game, seat, flagNodes) => {
  const out = [];
  if (!flagNodes.length) return out;
  for (const [id, o] of game.at) {
    if (TEAM_OF(o.seat) === TEAM_OF(seat)) continue;
    if (!mightMove(game, id, o)) continue;
    const d = Math.min(...flagNodes.map(f => dist(id, f)));
    if (d <= 4.5) out.push({ id, d });
  }
  return out;
};

// 工兵這一步有沒有「理由」。抽出來是為了讓模擬器能直接量「無意義的工兵移動」——
// Lynch：「亂走就是走沒有意義的棋。」量不到就修不了。
// 這四條就是 Lynch 指定的工兵鐵律（外加雙飛由呼叫端判斷）。
// 還可能是軍旗的敵方大本營（notFlag 已經證實不是的就排除）
function enemyHQsUnexcluded_(game, seat, memory) {
  return enemyHQs(game, seat).filter(id => !memory.notFlag?.has(id));
}

export function engineerReasons(game, seat, memory, from, to) {
  const target = game.at.get(to);
  const neighbours = (id) => [...(BOARD.adj.get(id) ?? [])];
  const suspectMine = memory.mineSuspect?.has(to);
  const deadly = memory.bigThreat?.get(to) ?? 0;
  const mateSeat = [0, 1, 2, 3].find(x => x !== seat && TEAM_OF(x) === TEAM_OF(seat));
  const enemyHQsUnexcluded = enemyHQs(game, seat).filter(id => !memory.notFlag?.has(id));

  const 賭三角雷 = enemyHQsUnexcluded.some(hq => dist(to, hq) <= 1.5);
  const movedAgo = (memory.ply ?? 0) - (memory.lastMovedPly?.get(to) ?? -99);
  const 測炸彈 = !!target && movedAgo <= 3 && neighbours(to).some(n => {
    const o = game.at.get(n);
    return o && TEAM_OF(o.seat) === TEAM_OF(seat) && (PIECES[o.piece]?.rank ?? 0) >= 6;
  });
  const 拆地雷 = !!suspectMine || (deadly > 0 && !memory.notMine?.has(to));
  const 擋炸彈 = mateSeat != null && neighbours(to).some(n => {
    const o = game.at.get(n);
    if (!o || o.seat !== mateSeat) return false;
    return neighbours(n).some(m => {
      const e = game.at.get(m);
      return e && TEAM_OF(e.seat) !== TEAM_OF(seat);
    });
  });
  // 逃命：現在站的地方會被吃，走開是正當理由。不給這條，工兵會呆在原地被白吃。
  const threats = memory.threats;
  const 逃命 = !!threats && (threats.get(from) ?? 0) > 0 && (threats.get(to) ?? 0) === 0;

  // 朝目標靠近：一步到不了「疑似地雷」時，中途那步也算有目的。
  // ⚠ 這裡只能放疑似地雷，**不能把敵方大本營也算進去**——大本營永遠存在，
  // 那等於「隨時可以朝敵人家走」，整條鐵律就形同虛設（實測抓到：
  // 那顆工兵的每一步都變成「有理由」）。往敵人家去只在「賭三角雷」時成立。
  const goals = [...(memory.mineSuspect ?? [])];
  const near = (id) => (goals.length ? Math.min(...goals.map(g => dist(id, g))) : Infinity);
  const 接近目標 = goals.length > 0 && near(to) < near(from);

  // 讓路（Lynch）：工兵卡住自己人的出路時可以move開，但條件很嚴——
  //   「可以移動，但不要被吃，不要走到危險地方，不要轉彎，走路要像一般棋子，
  //     不要沒事吐露自己是工兵。」
  // 所以：只有在旁邊真的有自己人被卡死時才算理由，而且落點要安全、
  // 而且那一步必須是普通棋子也走得到的（轉彎＝自報身分）。
  const 卡住同伴 = neighbours(from).some(n => {
    const o = game.at.get(n);
    return o && o.seat === seat && legalMoves(game, n).length === 0;
  });
  const 像普通棋子 = legalMoves(game, from, { asPiece: '排長' }).includes(to);
  const 落點安全 = !threats || (threats.get(to) ?? 0) === 0;
  const 讓路 = 卡住同伴 && 像普通棋子 && 落點安全;

  // 進行營：行營是安全區，裡面的棋子吃不到。把全隊最珍貴、又最脆弱的工兵
  // 收進行營，等於放進保險箱——Lynch：「佔行營是工兵很好的一步，保護自己。」
  // ⚠ 已經在行營裡就不再給——否則工兵會在五個行營之間換來換去，
  // 實測工兵的走子比例會從 6% 暴增到 20%。
  const 進行營 = BOARD.nodes.get(to)?.kind === 'camp' && !game.at.has(to)
    && BOARD.nodes.get(from)?.kind !== 'camp';

  const 有理由 = 賭三角雷 || 測炸彈 || 拆地雷 || 擋炸彈 || 逃命 || 接近目標 || 讓路 || 進行營;
  return { 賭三角雷, 測炸彈, 拆地雷, 擋炸彈, 逃命, 接近目標, 讓路, 進行營, 有理由 };
}

export function scoreMove(game, seat, memory, { from, to }) {
  const w = wOf(memory);
  // 開局階段（自己還沒走滿五步）。宣告放在最前面：底下好幾段都要用。
  const opening = Math.floor((game.plies ?? 0) / 4) < 5;

  // 反震盪：把棋子走回它剛剛離開的格子，幾乎沒有意義，而且會卡成無限來回。
  // 實戰棋譜裡出現過連續 12 步在三個格子之間跳的工兵，就是少了這一條。
  const trail = memory?.trail ?? [];
  for (let i = trail.length - 1, back = 0; i >= 0 && back < 4; i--, back++) {
    const t = trail[i];
    if (t.from === to && t.to === from) return -60;      // 完全走回頭路
    if (t.to === from && t.from === to) return -60;
  }
  const mine = game.at.get(from);
  const piece = mine.piece;
  const rank = PIECES[piece].rank ?? 0;
  const target = game.at.get(to);
  const enemyTarget = target && TEAM_OF(target.seat) !== TEAM_OF(seat);
  const deadly = memory.deadly?.get(to) ?? 0;
  const suspectMine = memory.mineSuspect?.has(to);
  const bigThreat = memory.bigThreat?.get(to) ?? 0;
  const revenge = memory.revenge?.get(to) ?? 0;

  // ── 鐵律（Lynch 2026-09-02）：推斷出來是地雷的格子，除了工兵誰都不准碰 ──
  // 「如果很大的子撞死可能是地雷的，那就要當作那個子是地雷，不可以亂撞。
  //   死了 3 結果他還送 1、4、5 去根本不合理。我說死 3 就要用 1 吃，講的是人，不是地雷。」
  // 這條必須放在所有加分之前：實戰 260901-SHW 裡同一顆護旗雷吃掉五顆子
  // （師長、司令、師長、旅長、團長），原因就是「下一手就能扛旗」給 +120，
  // 而撞死過人的懲罰只有約 26——每死一顆反而更想去死一次。
  // 撞地雷沒有任何上檔空間：不是機率問題，是純虧。
  if (enemyTarget && suspectMine && piece !== '工兵' && piece !== '炸彈') return -Infinity;

  const targetHQs = enemyHQs(game, seat);
  // 兩家都扛完就贏了，不會走到這裡；保險起見空陣列時不給推進分。
  const hqPullScore = targetHQs.length
    ? -Math.min(...targetHQs.map(hq => dist(to, hq))) * w.hqPull : 0;   // 往還活著的敵方大本營推進
  let score = hqPullScore;

  // 死亡格：那一格吃過我方的子。**記整場，不設時效**（Lynch）——
  // 真人不會因為過了十手就忘記「那裡吃掉我兩顆工兵」。死越多次越要避
  // （開根號成長，避免完全不敢碰關鍵點位）。
  // 一定要放在這裡、不能放進「有子可吃」的分支：實戰 VWW-8WC 裡工兵是
  // **走到空格**送死的，放在捕獲分支等於完全沒蓋到那個情境。
  const lostHere = memory.lostCount?.get(to) ?? 0;
  if (lostHere > 0)
    score -= w.deathSquare * Math.sqrt(lostHere) * (piece === '工兵' ? 2.5 : 1);

  // ── 搶旗與守旗（軍旗顯露是公開資訊）──
  for (const flag of revealedFlagNodes(game, s => TEAM_OF(s) !== TEAM_OF(seat))) {
    if (to === flag.id) return Infinity;                   // 鐵律：一步扛旗＝直接獲勝，沒有任何理由不下
    // 前瞻一步：走完這步之後，下一手能不能直接扛旗？
    // Lynch 實戰 260830-SFV：敵方「兩步內可扛旗」的機會出現 10 次（第 171 手就有了），
    // 卻拖到第 222 手才動手——因為原本只認「這一手就能扛」，看不到「兩步變一步」。
    if (!game.at.has(to) || enemyTarget) {
      const moved = game.at.get(from);
      const occ = game.at.get(to);
      game.at.delete(from); game.at.set(to, moved);
      let setsUp = false;
      try { setsUp = legalMoves(game, to).includes(flag.id); } catch { setsUp = false; }
      game.at.delete(to); if (occ) game.at.set(to, occ); game.at.set(from, moved);
      if (setsUp) score += w.flagSetup;
    }
    score += Math.max(0, 14 - dist(to, flag.id)) * w.flagRush;
  }
  // 守旗：自己的軍旗要守，隊友的軍旗也要守——隊友見死不救的話，這隊等於只有一個人在打
  const myFlag = myFlagNode(game, seat);
  const mateSeat = [0, 1, 2, 3].find(s => s !== seat && TEAM_OF(s) === TEAM_OF(seat));
  const mateFlag = myFlagNode(game, mateSeat);
  if (enemyTarget) {
    if (myFlag && dist(to, myFlag) < 4) score += (5 - dist(to, myFlag)) * w.flagDefend;
    if (mateFlag && dist(to, mateFlag) < 4) score += (5 - dist(to, mateFlag)) * w.mateFlagDefend;
  }

  // ── 工兵要惜命：它是唯一能拆地雷的棋，而且一走遠路就等於自報身分 ──
  if (piece === '工兵') {
    // ── 工兵鐵律（Lynch 指定）──────────────────────────────
    // 前提：工兵一旦「轉彎移動」就等於自報身分（只有工兵能在鐵路上任意拐彎）。
    // 所以會暴露身分的移動，必須符合以下四種理由之一，否則一律禁止：
    //   1. 賭三角雷：走到敵方軍旗旁邊。若對方是三角雷，那些地雷不會動、吃不到我，
    //      下一步就能直接取旗。
    //   2. 測炸彈：對方剛露出來的疑似炸彈，用工兵去換是划算的。
    //   3. 拆地雷：本來就是工兵唯一的專屬任務。
    //   4. 擋炸彈：隊友大子剛吃了人、對方八成要出炸彈報復，沒有更好的子可以擋，
    //      只好飛工兵去墊。
    const revealing = !legalMoves(game, from, { asPiece: '排長' }).includes(to);

    const enemyHQsUnexcluded = enemyHQs(game, seat)
      .filter(id => !memory.notFlag?.has(id));
    const { 賭三角雷, 測炸彈, 拆地雷, 擋炸彈, 進行營, 有理由 } = engineerReasons(game, seat, memory, from, to);
    // 鐵律（Lynch）：沒有理由就不准「亂走」——但「亂走」的定義要精準：
    //   亂走 ＝ 飛到別人家、或走出普通棋子做不到的路線（那才是自報身分）。
    //   在自家走一格、或走進行營躲好，都**不算**亂動——那是正常棋子的走法。
    // 一開始我把整條寫成「沒理由就完全不准動」，那會讓工兵變成路障（Lynch 指正）。
    const 走法像普通棋子 = legalMoves(game, from, { asPiece: '排長' }).includes(to);
    const 待在自家 = to.startsWith(`P${seat}-`);
    if (!有理由 && !(走法像普通棋子 && 待在自家)) return -Infinity;

    if (拆地雷) score += w.engProbe * Math.max(0.5, minePrior(to)) + 14;
    // 護旗雷優先（Lynch）：「工兵要優先拆軍旗正上方的地雷，有空檔就要做，
    // 這要很優先，就算死了也是重大成果。」
    // 大本營的位置是公開的，所以「緊鄰敵方大本營的疑似地雷」不需要軍旗顯露就知道要拆。
    // 給的分要明顯高過「站到軍旗旁邊」（engThreat），否則工兵永遠選比較便宜的那個站位——
    // 實戰 260901-SHW 就是這樣：工兵飛過來卻跳到軍旗左上、右上，不去拆正上方那顆。
    if (拆地雷 && enemyHQsUnexcluded_(game, seat, memory).some(hq => dist(to, hq) <= 1.5))
      score += w.engFlagMine;
    // 工兵停在敵方軍旗旁不只是為了拆雷，更是威嚇（Lynch）：
    // 對方動後兩排來擋＝告訴我那顆不是地雷；不能吃我＝我直接賭贏；
    // 飛自己的工兵來解＝等於承認這裡是軍旗。怎麼回應都洩漏資訊。
    if (賭三角雷) score += w.engThreat;
    // 工兵換炸彈本來是賺的，但只剩一顆工兵時就不是了：換掉一顆炸彈，
    // 代價是這局再也拆不了地雷。越少越不划算。
    if (測炸彈) score += 10 * (20 / engineerValue(game, seat));
    if (擋炸彈) score += 8;
    if (進行營) score += w.engCamp;      // 工兵躲進行營：保住全隊唯一能拆雷的棋子

    // 工兵絕不去吃「動過的棋子」——那不可能是地雷，純送死
    const couldBeMine = !memory.moved?.has(to) && !memory.notMine?.has(to);
    if (target && !couldBeMine && !測炸彈 && !memory.weakKnown?.has(to)) return -50;

    if (!有理由) {
      // 工兵不吃「往敵陣推進」這套獎勵（Lynch 實戰 VWW-8WC 抓到的）：
      // 它是全盤跑最遠的棋子，所以永遠是最能一步拉近距離的那顆，
      // 結果它拿最高分、飛進敵陣深處，然後坐在那裡被吃掉。
      // 那一局右家兩顆工兵先後飛到同一格送死，隊友再補第三顆。
      score -= hqPullScore;
      // 沒有任務的工兵不該亂動。殘局若還有雷可拆才放寬。
      const hasMineTarget = (memory?.mineSuspect?.size ?? 0) > 0 || (memory?.deadly?.size ?? 0) > 0;
      let own = 0;
      for (const o of game.at.values()) if (o.seat === seat) own++;
      score -= hasMineTarget && own <= 12
        ? (own > 8 ? w.engIdleEarly / 2 : w.engIdleLate)
        : w.engIdleEarly;
    }
  }

  // ── 炸彈要留給大子，而且不能大搖大擺推過去 ──
  if (piece === '炸彈') {
    // 已經進駐門前行營的炸彈，沒有值得換的目標就別出來——出來就失去安全與匿名。
    if (kindOf(from) === 'camp' && [`P${seat}-r4c2`, `P${seat}-r4c4`].includes(from)
        && !enemyTarget) score -= w.bombInCamp;
    // 全隊只有兩顆炸彈，至少要換到司令或軍長才划算。
    // bigThreat 記的是「我方多大的子死在那格」——我的軍長(8)死在那，對方至少是軍長。
    // Lynch：「死了 3、4 就想辦法炸掉他，大加分。」「不會使用炸彈，讓我的總司令為所欲為。」
    // 實戰數據：他的司令出擊 13 次吃掉 12 顆、零陣亡——因為沒有人炸它。
    // 那一格吃掉我方越多、越大的子，就越該用炸彈換掉。
    const rampage = memory.deadly?.get(to) ?? 0;             // 那一格吞掉我方幾顆
    if (enemyTarget && bigThreat >= 8) score += w.bombBig + rampage * 6;   // 至少軍長：值得換
    else if (enemyTarget && bigThreat >= 6) score += w.bombMid + rampage * 6;  // 旅長以上就該炸（Lynch）   // 師長級也值得換——Lynch：師長+炸彈換司令軍長很划算   // 至少是師長：可以考慮
    // 空炸：自己沒死大子，但隊友折損了，這時賭一把也是一種打法。
    // Lynch：「缺點是會炸錯裝大子的，優點是沒損失師長就炸掉司令很賺。
    //         保守不會連贏，要可以出其不意。」所以給它一個機會，但不常做。
    else if (enemyTarget && (memory.revenge?.get(to) ?? 0) > 0) score += w.bombMid * 0.5;
    // Lynch 的防守骨架：炸彈自己站進門前行營，師長在旁邊當明面上的守衛。
    // 行營是安全區，沒人吃得到它，而且沒人知道那顆是什麼——
    // 敵人吃掉旁邊的師長，炸彈就從行營出來反擊。
    // （佈陣時行營必須空著，所以這是開局後要走出來的陣型，不是擺出來的。）
    // 開局不做這件事：它獎勵的是 r4（靠自家那兩個），會跟「先佔前面」打架。
    // 藏炸彈是中盤的防守骨架，不是開局第一件事（Lynch）。
    else if (!opening && [`P${seat}-r4c2`, `P${seat}-r4c4`].includes(to) && kindOf(from) !== 'camp')
      score += w.bombInCamp;                  // 只有還沒進駐時才給，否則它會進進出出
    else score -= w.bombIdle / 2;      // 沒有夠格的目標就別動：推過去會被小兵解掉

    // 鐵律（Lynch：「炸彈留給大子」）：沒有證據顯示對面夠大，就不准引爆。
    // 原本只有加分沒有禁止，量出來 74.6% 的引爆換不到軍長以上，
    // 而且最常炸到的是**地雷**（568 次裡 104 次）——拿全隊只有兩顆的炸彈
    // 去炸一顆不會動的地雷，純虧。其次是工兵 43、排長 22。
    // 例外：對面是已顯露的軍旗（那是直接獲勝），或自家軍旗命在旦夕（沒有明天了）。
    if (enemyTarget) {
      const 是軍旗 = revealedFlagNodes(game, s2 => TEAM_OF(s2) !== TEAM_OF(seat)).some(f => f.id === to);

      // Lynch：「炸彈不會主動撞不動的東西。除非沒工兵，不然不可能拿炸彈撞地雷。」
      // 關鍵在於 bigThreat 在地雷格上一樣會累積——師長撞死在那裡，AI 就以為
      // 「那顆很大，值得炸」，但那其實是地雷。兩者用公開資訊分得開：
      // 地雷在後兩排、而且從來沒動過；會動的大子不會有這個特徵。
      let 我還有工兵 = false;
      for (const [, o] of game.at) if (o.seat === seat && o.piece === '工兵') 我還有工兵 = true;
      const 可能是地雷 = isBackRow(to) && !memory.moved?.has(to);
      if (可能是地雷 && 我還有工兵 && !是軍旗) return -Infinity;

      const 夠大 = bigThreat >= 6;      // 旅長級就算夠大（Lynch 指定，原本設 7 太嚴）
      if (!夠大 && !是軍旗 && !flagInPeril(game, seat, memory)) return -Infinity;
    }
  }

  // ── 心法：隊友動了主力，就過去幫忙擋 ──
  // 判斷方式只用公開資訊：隊友剛移動過、而且那顆子旁邊有敵人，就是需要掩護的位置。
  if (!target && mateSeat != null) {
    for (const [id, o] of game.at) {
      if (o.seat !== mateSeat) continue;
      if ((memory.ply ?? 0) - (memory.lastMovedPly?.get(id) ?? -99) > 2) continue;   // 只管剛動過的
      const threatened = neighbours(id).some(n => {
        const e = game.at.get(n);
        return e && TEAM_OF(e.seat) !== TEAM_OF(seat);
      });
      if (threatened && dist(to, id) <= 1.5) score += w.guardMate;   // 靠過去擋在旁邊
    }
  }

  // ── 困在大本營裡的敵子已經等於被解決掉了（Lynch 實戰：左家一直去吃我卡在他大本營的子）──
  // 大本營的棋子只進不出，走進去就再也不能動。花一手去吃它，是拿主動權換一顆死子。
  // 判斷方式：大本營的格子屬於某一家，佔著它的卻是別家的棋子 → 那是被凍住的闖入者。
  if (target && enemyTarget && kindOf(to) === 'hq' && Number(to[1]) !== target.seat)
    score -= w.frozenIntruder;

  // ── 軍旗一定在兩個大本營其中之一 ──
  // 這是公開資訊推得的：大本營的棋子只進不出，所以從沒動過的大本營格子，
  // 有一半機率就是軍旗。真人殘局會直接撞大本營賭這一半，AI 之前完全不會。
  // 只有「大本營裡站著它自己家的棋子」才有賭的意義。站著別家的棋子時，
  // 座位顏色是公開的——那顆一望即知不是這家的軍旗，再賭就是純粹送子（Lynch 實戰）。
  if (target && enemyTarget && kindOf(to) === 'hq' && Number(to[1]) === target.seat) {
    const revealed = (game.revealedFlags ?? new Set()).has(target.seat);
    const seatOfHQ = Number(to[1]);
    const bothHQ = [`P${seatOfHQ}-r6c2`, `P${seatOfHQ}-r6c4`];
    const other = bothHQ.find(id => id !== to);
    if (memory.notFlag?.has(to)) {
      score -= 20;                       // 已經證實不是軍旗，再去就是把棋子送進死格
    } else if (memory.notFlag?.has(other)) {
      return 1000;                       // 另一個大本營已排除 → 這裡百分之百是軍旗
    } else if (!revealed) {
      // 還沒排除：這是五五波的賭注。任何棋子都能取軍旗，所以派便宜的去。
      // 司令尤其不能賭——它一死自家軍旗就顯露，是雙重損失。
      //
      // 但「浪費」是有前提的：只有在還輸得起的時候，省下司令才有意義。
      // Lynch 實戰：AI 的司令有一步可以奪旗，它嫌浪費沒去，下一手全家被滅——
      // 「他是唯一的機會，他不做，他全家就被我滅了！他算不出這一步之差！」
      // 自家軍旗下一步就會被扛走時，這個五五波是穩賺的：不賭是必輸，賭了有一半。
      const doomed = flagInPeril(game, seat, memory);
      const cheapness = doomed ? 1 : (rank > 0 ? Math.max(0.1, 1 - rank / 10) : 0.5);
      score += w.hqRush * cheapness * (doomed ? 3 : 1);

      // 只剩最後一家敵人時，踏進「還沒被排除」的大本營是**五五波直接獲勝**。
      // 原本只給 hqRush×便宜程度，大子只拿到 4 分，於是它常常改去走一步沒事的棋——
      // 量出來 49 次放棄裡有 47 次是「只是移動」（Lynch：「可以踏進去就該接近 100%」）。
      // 一步獲勝的期望值是半場棋，估值要壓過怕死。
      const 只剩一家 = [0, 1, 2, 3].filter(x =>
        TEAM_OF(x) !== TEAM_OF(seat) && !game.eliminated.has(x)).length === 1;
      if (只剩一家) score += w.finalFlagGamble;
    }
  }

  // ── 守住軍旗的關鍵點位（Lynch 指正）───────────────────────
  // 不是「軍旗旁邊的任何空格」，而是**左上與右上**這兩個踏板：
  // 軍旗在 r6c2 時就是 r5c1 與 r5c3。敵人站上去就同時威脅護旗的地雷與軍旗本身，
  // 守住那兩格等於把整條進攻路線封死。
  // Lynch 連三局都是「工兵拆掉一顆三角雷 → 大子從缺口取旗」，就是這裡沒守。
  if (!target || enemyTarget) {
    const myFlag2 = myFlagNode(game, seat);
    if (myFlag2) {
      const m = myFlag2.match(/^P(\d)-r6c(\d)$/);
      if (m) {
        const fc = Number(m[2]);
        const shoulders = [fc - 1, fc + 1].filter(c => c >= 1 && c <= 5)
          .map(c => `P${seat}-r5c${c}`);
        const adjacent = [`P${seat}-r5c${fc}`, `P${seat}-r6c${fc - 1}`, `P${seat}-r6c${fc + 1}`]
          .filter(id => /c[1-5]$/.test(id));
        const enemyCanReach = (node) => [...game.at].some(([id, o]) =>
          TEAM_OF(o.seat) !== TEAM_OF(seat) && mightMove(game, id, o) && dist(id, node) <= 3.5);
        if (shoulders.includes(to) && !game.at.has(to) && enemyCanReach(to)) score += w.plugBreach;
        else if (adjacent.includes(to) && !game.at.has(to) && enemyCanReach(to)) score += w.plugBreach * 0.7;
      }
    }
  }

  // ── 敵方工兵逼到自家大本營旁：要清掉，但別用會洩漏資訊的方式（Lynch）──
  if (target && memory.weakKnown?.get(to) === '工兵') {
    const myHQs = [`P${seat}-r6c2`, `P${seat}-r6c4`];
    const nearMyFlag = Math.min(...myHQs.map(h => dist(to, h))) <= 2.5;
    if (nearMyFlag) {
      score += w.killIntruder;                       // 這顆一定要清掉
      // 但用自己的工兵去解，等於昭告「這裡真的是軍旗」，否則我幹嘛花工兵
      if (piece === '工兵') score -= w.engConfirmsFlag;
    }
  }

  // ── 後兩排非必要不准動（Lynch）──────────────────────────
  // 主因不是守家，是資訊：後兩排一動，等於告訴對方「這顆不是地雷」，
  // 替他省下一次試探。地雷只有三顆，它的價值有一半在於「對方不知道是哪三顆」。
  // 只有兩種情況值得動：
  //   1. 大本營有被攻擊的風險（不分軍旗側）——對手還不知道軍旗在哪時，
  //      要裝成軍旗去守，這本身就是有價值的欺敵。
  //   2. 我方大子有被炸的風險，需要調度。
  if (/r[56]c/.test(from) && from.startsWith(`P${seat}-`) && piece !== '炸彈') {
    const myHQs = [`P${seat}-r6c2`, `P${seat}-r6c4`];
    const hqUnderThreat = [...game.at].some(([id, o]) =>
      TEAM_OF(o.seat) !== TEAM_OF(seat) && mightMove(game, id, o) &&
      Math.min(...myHQs.map(h => dist(id, h))) <= 2.5);
    const bigAtRisk = [...(memory.myExposed ?? [])].some(id =>
      game.at.has(id) && neighbours(id).some(n => {
        const o = game.at.get(n);
        return o && TEAM_OF(o.seat) !== TEAM_OF(seat);
      }));
    if (!hqUnderThreat && !bigAtRisk && !target) score -= w.backRowStay;
  }

  // ── 不要擋住隊友的出路（Lynch：我的旅長其實擋住我對家出路，這是不好的）──
  // 隊友陣地的鐵路節點與前線橫排是他出兵的主幹道，佔著會讓他動彈不得。
  // 去吃子或回防不算——那有明確目的。
  if (!target && mateSeat != null && to.startsWith(`P${mateSeat}-`)) {
    const onHighway = BOARD.railNodes.has(to) || /-r1c/.test(to);
    if (onHighway) score -= w.blockMate;
  }

  // ── 打贏過的棋子已經曝光成大子，要以大子的姿態行動（Lynch 指定）──
  if (memory.myExposed?.has(from)) {
    if (kindOf(to) === 'camp') score += 4;                    // 躲進行營避風頭，對方吃不到
    if (target) {
      if (memory.weakKnown?.has(to)) score += 6;              // 果斷吃已知的小子
      const fresh = (memory.ply ?? 0) - (memory.lastMovedPly?.get(to) ?? -99) <= 3;
      if (fresh && !memory.weakKnown?.has(to)) score -= 8;    // 新鮮的未知子多半是來炸它的
    }
  }

  // ── 防守優先於攻擊：有人逼近我方或隊友的軍旗，就回去攔 ──
  {
    const myFlags = [myFlagNode(game, seat), myFlagNode(game, mateSeat)].filter(Boolean);
    const threats = flagThreats(game, seat, myFlags);
    if (threats.length) {
      const nearest = Math.min(...threats.map(t => t.d));
      const urgency2 = Math.max(0, 5 - nearest) / 5;              // 越近越急
      if (target && threats.some(t => t.id === to)) {
        score += w.defendKill * (0.5 + urgency2);                 // 直接吃掉逼近者
      } else {
        const closing = Math.min(...threats.map(t => dist(to, t.id)));
        score += w.defendPull * urgency2 * Math.max(0, 3 - closing);  // 靠過去擋住
      }
    }
  }

  // ── 心法：佔住重要點位，別人也不敢亂來吃你 ──
  if (kindOf(to) === 'center' || kindOf(to) === 'camp') score += w.keyNode;

  // ── 行營：搶著佔，但不要為了吃人把裡面的子叫出來 ──
  // ── 佔住中央（原本以為是「守隊友軍旗」，對照實驗證明不是）──────────
  // 我原本寫成「隊友軍旗沒人守就派一顆去站崗」，混隊基準 24.7% → 31.1%。
  // 但把錨點換成棋盤中央做對照，結果更好（34.6%）——
  // **所以有效的不是協作，是「棋子太散，往中央站比較有用」**。
  // 中央九宮連著四條鐵路，站在那裡對四家都構得到，也擋得住別人穿過去。
  // 一樣只在「中央附近沒有我方棋子」時才拉人，避免全隊擠在中間。
  // CENTRE_GATE=off：不設「已經有人在中央就不拉」的條件，做對照用
  if (!memory.centreHeld || globalThis.process?.env?.CENTRE_GATE === 'off') {
    const d0 = dist(from, CENTRE), d1 = dist(to, CENTRE);
    if (d1 < d0) score += w.centrePull * Math.max(0, 1 - d1 / 14);
  }

  // ── 開局：前五步先把棋子走進行營（Lynch）─────────────────────
  // 行營是安全區，吃不到裡面的子。早早佔住＝白拿五個據點，而且逼對方繞路。
  // 但**不准動後兩排的子**——那些子在守家，而且一動就等於自曝不是地雷。
  // 佔領順序（Lynch）：**先前面兩個（r2）、再後面兩個（r4）、最後才是中間（r3c3）**。
  // 後面的慢慢佔還來得及；前面的一旦被敵人坐進去就趕不走了（行營吃不到），
  // 而且他從那裡隨時能出來吃你。
  // ⚠ 這段先前寫過一次，被一批失敗的改動一起回退掉了——所以 Lynch 又看到它先佔後面。
  // 前兩個（r2）佔滿之後，後兩個（r4）就接手變成主要目標，最後才是中間（Lynch）。
  const frontTaken = [`P${seat}-r2c2`, `P${seat}-r2c4`]
    .every(id => game.at.get(id)?.seat === seat);
  const CAMP_PRIORITY = frontTaken
    ? { r2c2: 1, r2c4: 1, r4c2: 1, r4c4: 1, r3c3: 0.3 }
    : { r2c2: 1, r2c4: 1, r4c2: 0.15, r4c4: 0.15, r3c3: 0.05 };
  const campKey = to.startsWith(`P${seat}-`) ? to.slice(to.indexOf('-') + 1) : null;
  // ⚠ 不能用第一排的棋子去佔行營（Lynch）：**炸彈不能放第一排**，
  // 所以從 r1 走進行營的那顆一定不是炸彈——對方立刻知道這個行營沒有炸彈威脅，
  // 大子就敢在附近亂吃。行營的價值有一半來自「對方不知道裡面是什麼」，
  // 用第一排的子去佔，等於自己把那份價值丟掉。
  const fromRow1 = /-r1c/.test(from) && from.startsWith(`P${seat}-`);
  if (opening && kindOf(to) === 'camp' && campKey && !/r[56]c/.test(from)) {
    if (fromRow1) score -= w.campFromRow1;
    else score += w.openingCamp * (CAMP_PRIORITY[campKey] ?? 0.2);
  }

  // ── 軍旗前面的行營＝超級重要的據點（Lynch）──────────────────
  // r4c2 / r4c4 正對著兩個大本營。敵人一旦站上去，防守會變極難：
  // 後兩排要「假裝是地雷」不能亂動，而站上來的可能是工兵、也可能是大子，無從判斷。
  // 空著的行營就是給對方的踏板，所以一空出來要立刻補位。
  const frontCamps = [`P${seat}-r4c2`, `P${seat}-r4c4`];
  const mateSeat2 = [0, 1, 2, 3].find(x => x !== seat && TEAM_OF(x) === TEAM_OF(seat));
  const mateFrontCamps = mateSeat2 == null ? [] : [`P${mateSeat2}-r4c2`, `P${mateSeat2}-r4c4`];
  // 開局階段不給這份獎勵：它獎勵的是 r4（靠自家那兩個），會把棋子往後拉，
  // 跟「先佔前面」直接打架——Lynch 實戰回報「還是先佔領後面行營」就是這樣來的。
  if (frontCamps.includes(to) && !opening) score += w.frontCampHold;
  else if (mateFrontCamps.includes(to)) score += w.frontCampHold * 0.5;   // 隊友門前也該幫忙補
  // 守在門前的子不要隨便離開——除非是去吃人
  if (frontCamps.includes(from) && !enemyTarget) score -= w.frontCampLeave;

  if (kindOf(to) === 'camp') {
    score += w.camp + rank * 0.15;
    // Lynch：「我佔領行營只有一個選擇，不可能移動後兩排去佔領，一定是動連長。」
    // 後兩排的棋子在守家，抽調它們去佔行營等於把家門打開。
    if (/r[56]c/.test(from) && from.startsWith(`P${seat}-`)) score -= w.campFromBack;
    const enemyNear = neighbours(to).some(n => {
      const o = game.at.get(n);
      return o && TEAM_OF(o.seat) !== TEAM_OF(seat);
    });
    if (enemyNear) score += w.campContested;
    // 自家或隊友陣地裡的行營被敵人佔走非常慘，敵人一靠近就要搶先坐進去
    const home = to.startsWith(`P${seat}-`) || to.startsWith(`P${mateSeat}-`);
    if (home && enemyNear) score += w.campHome;

    // Lynch：「如果對方一開場吃我左上，我應該立刻站左上行營，**不是去吃他**。
    //   因為吃他之後，他會站走我行營——那他就吃我兩子還佔行營，我也炸不到他，
    //   他還可以隨時出來吃不是炸彈的人！」
    // 所以「剛在旁邊折損棋子」本身就是佔這個行營的訊號，而且要壓過報仇。
    const justLostNearby = neighbours(to).some(n =>
      (memory.ply ?? 0) - (memory.lastLostPly?.get(n) ?? -999) <= 3);
    if (home && justLostNearby) score += w.campAfterLoss;
  }
  if (kindOf(from) === 'camp') {
    // 行營的價值是**持續的**，不是一次性的：
    //   ① 裡面的棋子吃不掉、換不掉——一顆大子待在行營是永久有效的威脅
    //   ② 行營位在路網樞紐，站住它，敵人只能繞邊路
    //   ③ 兩者加成：正因為吃不掉，那個節點才會被「持續」鎖住
    // 但在「替每一步打分」的架構裡，「留在原地」不是一步、拿不到分——
    // 所以表達「留守有價值」的唯一方式，就是讓**離開**變貴。
    // 原本只有 4.0，而吃掉一顆子有 22 分，難怪它出去吃人把要塞讓掉。
    // 自家的行營比別人家的值錢；前面兩個（r2）又比後面的關鍵。
    const fromKey = from.startsWith(`P${seat}-`) ? from.slice(from.indexOf('-') + 1) : null;
    const holdValue = fromKey
      ? ({ r2c2: 1, r2c4: 1, r4c2: 0.8, r4c4: 0.8, r3c3: 0.6 }[fromKey] ?? 0.5)
      : 0.35;                                   // 別人家的行營，離開沒那麼可惜
    score -= w.campLeave * holdValue;
    // 唯一值得離營的例外：對面是已經曝光的工兵，那是穩賺的一顆
    const worthIt = memory.weakKnown?.has(to) || bigThreat > 0 || suspectMine;
    if (enemyTarget && !worthIt) score -= w.campLeaveBlind;
  }

  if (!target) {
    // 太久沒吃子＝雙方沒有接觸。主動朝最近的敵方活棋靠過去，別在原地繞圈。
    const u = urgency(game, w);
    // 工兵不負責「去找人打」——它飛得最遠，永遠是離敵人最近的那顆，
    // 讓它去製造接觸的結果就是它在盤上亂飛（實戰棋譜證實）。
    if (u > 0.3 && piece !== '工兵') {
      const d = nearestEnemyPiece(game, seat, to);
      if (Number.isFinite(d)) score += u * Math.max(0, 16 - d) * w.contactPull;
    }
    return score;
  }
  if (!enemyTarget) return -Infinity;                        // 不吃自己人（走子生成已擋，保險）

  score += urgency(game, w) * w.urgencyCapture;                               // 快和局了就別再乾瞪眼

  // 已經曝光的弱子（拆過地雷的必定是工兵）＝免費的一顆，誰去吃都賺
  if (memory.weakKnown?.has(to)) score += w.weakKnown;

  // ── 司令（和軍長）該怎麼用（Lynch）────────────────────────
  // 「其實這樣亂走是好的，因為會吃掉很多子。但要注意新子，不要 1 先吃。
  //   1 要吃任意有吃贏別人的子——反正一定不是炸彈，吃了會贏。
  //   風險是會被猜出來是 1，但也表示很多炸彈可以被你引出來。」
  // notBomb 是硬推論：炸彈碰到誰都同歸於盡，所以「吃掉別人還活著」的一定不是炸彈。
  // 對司令來說那就是穩賺的一顆——它比誰都大，唯一怕的只有炸彈和地雷。
  if (enemyTarget && (piece === '司令' || piece === '軍長') && memory.notBomb?.has(to))
    score += w.commanderFeast;
  // 反過來：剛動過的「新子」最可能是衝著大子來的炸彈，司令不要先去碰。
  const freshTarget = (memory.ply ?? 0) - (memory.lastMovedPly?.get(to) ?? -999) <= 3;
  if (enemyTarget && piece === '司令' && freshTarget && !memory.notBomb?.has(to))
    score -= w.commanderVsFresh;

  // ── 敵方司令已死之後的打法（Lynch 心法）────────────────────
  // 司令陣亡會強制亮出該家軍旗，所以「敵方 1 已死」是公開資訊，可以放心使用。
  // 這時候能殺掉我 1 或 2 的只剩炸彈和地雷，所以「確定不是炸彈」的子，
  // 1 和 2 都該出擊——不是只准動 2（Lynch 更正）。差別只在權重與目標的安全度：
  // 我的 1 死了還要多賠一次軍旗曝光，所以未知的子讓 2 先上，1 挑穩的吃。
  if (topRankFree(game, seat)) {
    const 確定不是炸彈 = memory.notBomb?.has(to);
    if (確定不是炸彈) {
      if (piece === '軍長') score += w.topKill;
      else if (piece === '司令') score += w.topKill * w.commanderShare;
    } else if (piece === '司令' && !flagInPeril(game, seat, memory)) {
      score -= w.keepCommander;        // 只有面對未知子時才讓路，不是整顆收起來
    }
  }
  // 3 的死是「精確」的資訊：吃得掉師長的只有 1、2、B 三種。而 3 換掉一顆 B，
  // 等於保住了我的 1 和 2（Lynch）。所以拿 3 去碰未知子，本身就有價值。
  if (piece === '師長' && !memory.weakKnown?.has(to) && !memory.notBomb?.has(to)) score += w.probeBig;

  // ── 隊友折損過的位置：幫忙報仇／擋刀 ──
  if (revenge > 0) score += w.revenge + revenge * 2;
  // ── 有人打進自己家或隊友家：主動處理 ──
  if (to.startsWith(`P${seat}-`)) score += w.homeDefend;
  else if (to.startsWith(`P${mateSeat}-`)) score += w.mateHomeDefend;      // 隊友的陣地一樣要幫忙清

  // Lynch：「這手我被吃，我不會回來吃他——因為如果我又死了，他反而可以逃走。」
  // 剛折損在那一格、又還沒摸清對方多大，就別急著再送一顆過去。
  const sinceLost = (memory.ply ?? 0) - (memory.lastLostPly?.get(to) ?? -999);
  const justLost = sinceLost <= 2;
  if (justLost && piece !== '炸彈' && !memory.weakKnown?.has(to)) score -= w.noRevenge;

  // 鐵律（Lynch）：「不要亂出子吃地雷就不會這樣了。」
  // 已經推定是地雷的格子（後兩排、從沒動過、殺過人），除了工兵誰都不准去撞——
  // 撞了必死，而且死了還會讓那一帶在自己眼裡變成危險區，連帶不敢靠近。
  if (target && enemyTarget && suspectMine && piece !== '工兵') return -Infinity;

  // 鐵律（Lynch）：「你怎麼知道死掉那顆，對方多大？要去吃第二次一定要更大。」
  // ⚠ 但「大一階」是錯的實作：死了 6 之後依序送 5、4、3、2 才同歸於盡，
  //    那是階梯式送死。Lynch 的原意是「**6 死了就直接派 1**，不然就別去」。
  //    所以只允許兩種：我方目前最大的那一階，或明顯高出兩階以上。
  if (target && enemyTarget && rank > 0 && bigThreat >= rank
      && piece !== '工兵' && piece !== '炸彈'
      && rank !== (memory.myTopRank ?? 0) && rank < bigThreat + 2) return -Infinity;

  if (deadly > 0) {
    if (piece === '工兵' || piece === '炸彈') return score;
    // 心法：小子的功用是「測未知」，不是拿去撞已經知道很大的子。
    // 對面已經證明比某個階級大，就別再派更小的去送。
    if (rank > 0 && bigThreat >= rank) score -= w.smallVsBig;
    // 「有人死在那」要看死的是誰。我方工兵死在那，只證明對面不是地雷、至少是排長——
    // 這時大子正該接手（一波一波推進）。死的是大子才真的可怕。
    if (memory.notMine?.has(to) && bigThreat <= 1) return score + 6;   // 工兵測過了，大子接手
    return score - (w.deadly + deadly * 4);
  }

  // 敵方後兩排是地雷的家。沒撞過就伸手進去，人類不會這樣下——除非已經知道那是弱子。
  // 敵方後兩排是地雷的家。人類的直覺是「不要沒測過就伸手進去」，
  // 但實測發現任何形式的迴避都讓 AI 大幅變弱（勝率 67%→25~51%）——因為軍旗就住在後兩排，
  // 不進去就永遠贏不了。所以改成鼓勵用小兵去試，而不是懲罰大子進去。
  // 探後兩排要有探的價值：那格站的必須是「這塊陣地自己家的棋子」。
  // 站著別家的闖入者時，顏色一望即知不可能是這家的地雷，探它問不出任何東西。
  // （探路誘因拉到 160 之後這個洞才浮出來——它會去「探」一顆困死在大本營的闖入者。）
  const 可能是這家的雷 = !target || Number(to[1]) === target.seat;
  // Lynch：「正常人玩，不會大人撞死在地雷。一定是工兵拆過才衝。
  //          除非是要賭，但賭不會站高比重。」
  // 這是治因：只要大子不亂撞後兩排，bigThreat 就不會在地雷格上累積，
  // 炸彈把地雷誤判成大子這件事也會自己消失。
  // 用重扣分而不是全面禁止——軍旗就住在後兩排，堵死就永遠贏不了（試過，67%→25~51%）。
  if (target && enemyTarget && rank >= 6 && isBackRow(to) && 可能是這家的雷
      && !memory.moved?.has(to) && !memory.notMine?.has(to) && !memory.weakKnown?.has(to))
    score -= w.bigVsUntested;

  const untestedBackRow = isBackRow(to) && 可能是這家的雷
    && !memory.weakKnown?.has(to) && deadly === 0 && bigThreat === 0;
  if (untestedBackRow && rank <= 3) score += w.backRowProbe;      // 小兵去探後兩排是划算的

  // ── 資訊價值：我洩漏多少、我問到多少 ──────────────────────
  // 這一層讓「後兩排不動」「工兵轉彎就暴露」從手寫規則變成推導結果。
  if (memory.selfBelief) {
    const revealing = BOARD.railNodes.has(from) && piece === '工兵' &&
      !legalMoves(game, from, { asPiece: '排長' }).includes(to);
    score -= w.infoLeak * leakOf(memory.selfBelief, from, piece, revealing);
  }
  if (memory.belief && target && enemyTarget) {
    score += w.infoGain * infoGainOf(memory.belief, to, piece);
  }

  // ── 用信念表算這一擊的期望損益（取代粗略的階級猜測）──
  // 這一格「有多可能比我大」是算出來的，不是用全場平均猜的。
  if (memory.belief) {
    const p = pLose(memory.belief, to, piece);
    const myValue = valueOf(game, seat, piece);
    const theirValue = 24;                       // 未知敵子的概略身價
    score += w.beliefEV * ((1 - p) * theirValue - p * myValue);
  }

  // 未知的敵子：用小子探路，大子不要亂碰。
  // 但最後一顆工兵不是「小子」，它是勝利條件——不准拿它去探路。
  const lastEngineer = piece === '工兵' && engineerValue(game, seat) >= 85;
  if (rank <= 3 && !lastEngineer) score += w.probeSmall - rank * 0.5;
  else if (rank >= 8) score -= w.bigAvoid + (piece === '司令' ? 6 : 0);   // 司令一死就亮自家軍旗，更該保守
  else score += 1;

  // 剛剛主動靠過來的未知子，很可能是衝著我的大子來的炸彈。
  // 大子要閃開，讓小兵去試——這正是人類會做的事。
  const movedAgo = memory.ply - (memory.lastMovedPly?.get(to) ?? -99);
  if (movedAgo <= 3) {
    if (rank >= 6) score -= w.bombFear;
    else if (rank <= 3) score += 3;
  }
  return score;
}

// 挑步：只在「跟最佳分數差距很小」的候選裡隨機，避免每局都一樣、又不會挑到平庸的棋。
// 原本用固定前 15%，棋子多的時候等於從十幾步裡亂挑，常常下出爛棋。
const CHOICE_MARGIN = 1.5;
export const HANG_WEIGHT = 0.15;      // 風險扣分的權重，靠對打實測校準

// 快撞上「60 步無吃子」時，只要有子可吃就一定要吃（挑代價最小的那個）。
// 真人幾乎不可能 60 步不吃子；讓 AI 走到那種和局是設計上的失敗，不是穩健。
const FORCE_CAPTURE_AFTER = 45;

export function chooseMove(game, seat, memory, rnd = Math.random) {
  let moves = movesForSeat(game, seat);
  if (!moves.length) return null;
  // 鐵律（Lynch）：只剩最後一家敵人時，能踏進他家大本營就是第一順位——
  // 那格若是軍旗就直接獲勝，是五五波。實測用加分完全推不動這件事：
  // 把獎勵從 200 加到 100000，踏進去的比例一動也不動（82.7%），
  // 代表卡點不在估值。所以改成在這裡直接挑走法，繞過評分。
  // 已被排除的大本營（notFlag）與站著別家棋子的格子不算——踏進去只會白白凍死一顆子。
  const enemiesLeft = SEATS.filter(s2 => TEAM_OF(s2) !== TEAM_OF(seat) && !game.eliminated.has(s2));
  if (enemiesLeft.length === 1) {
    const foe = enemiesLeft[0];
    const hqs = [`P${foe}-r6c2`, `P${foe}-r6c4`].filter(id => {
      if (memory.notFlag?.has(id)) return false;
      const o = game.at.get(id);
      return !o || o.seat === foe;
    });
    const shot = moves.filter(m => hqs.includes(m.to) && game.at.has(m.to));
    if (shot.length) return shot[Math.floor(rnd() * shot.length)];
  }

  if ((game.pliesSinceCapture ?? 0) >= FORCE_CAPTURE_AFTER) {
    // 只有「敵方」的棋子才算可吃。原本寫成 game.at.has(m.to)，把隊友也算了進去——
    // 那會把候選走法過濾成一堆 -Infinity 的違規走法，最後 15 步等於亂走，
    // 這條本來要防止和局的規則反而在製造和局。
    const captures = moves.filter(m => {
      const o = game.at.get(m.to);
      return o && TEAM_OF(o.seat) !== TEAM_OF(seat);
    });
    if (captures.length) moves = captures;
  }
  // 往前看一步：走完之後，這顆棋子會不會被對方吃掉？整輪只算一次威脅圖。
  const threats = threatMap(game, seat, memory);   // 疑似地雷不算威脅（它不會動）
  memory.threats = threats;
  // 我方還活著的最大階級：那一格已經吃掉我一顆時，只有「派最大的」才有意義
  memory.myTopRank = 0;
  for (const [, o] of game.at)
    if (o.seat === seat) memory.myTopRank = Math.max(memory.myTopRank, PIECES[o.piece]?.rank ?? 0);              // 讓 scoreMove 也用得到（flagInPeril 要靠它）

  // 中央附近有沒有我方棋子：整輪算一次就好。
  // 量出來的病根：「隊友軍旗被貼住」的 146 個回合裡，AI 吃得掉那顆的只有 3%——
  // 它不是不肯救，是根本不在場（平均離隊友軍旗 7.9 步）。
  // 危機發生時才出發永遠來不及，所以平時就要有人在守備範圍內。
  {
    memory.centreHeld = false;
    for (const [id, o] of game.at) {
      if (TEAM_OF(o.seat) !== TEAM_OF(seat)) continue;
      if (dist(id, CENTRE) <= 3.2) { memory.centreHeld = true; break; }
    }
  }

  // 信念表也是整輪算一次——它讓「這一格有多危險」變成具體機率，而不是全場平均。
  memory.belief = buildBelief(game, seat, memory);
  memory.selfBelief = buildSelfBelief(game, seat, memory);   // 別人眼中的我，用來算洩漏
  const scored = moves
    .map(m => {
      const piece = game.at.get(m.from).piece;
      const risk = hangRisk(game, seat, { piece, to: m.to }, threats, memory);
      // 僵局時把怕死的權重降下來，否則兩邊都不敢動，最後一起和局
      const w2 = wOf(memory);
      const w = w2.hang * (1 - 0.7 * urgency(game, w2));
      return { m, s: scoreMove(game, seat, memory, m) - risk * w + rnd() * 0.4 };
    })
    .sort((a, b) => b.s - a.s);
  const best = scored[0].s;
  // 注意 Infinity：奪旗是鐵律回傳 Infinity，而 Infinity - Infinity = NaN，
  // 直接用差值比會把候選清單濾成空的（這裡當場炸過一次）。
  const top = scored.filter(x => x.s === best || best - x.s <= wOf(memory).margin);
  return top[Math.floor(rnd() * top.length)].m;
}

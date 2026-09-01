// 產生佈陣：**四種各自完整的風格，每局隨機挑一種**。
//
// Lynch 的指正（2026-08-29）：「四國軍棋的樂趣就在於沒有所謂最好，實戰都是心理戰，
// 要讓對手猜不透。」三角雷、師長→工兵→炸彈、司令不站第一排都只是「其中一種」。
//
// ⚠ 但「多樣」不等於「隨機」：我曾把佈陣改成幾乎完全隨機，勝率立刻掉到 11%。
// 正解是**準備幾套各自成立的路數**，像真人有自己的幾套慣用陣型——
// 每一套內部都有章法，套與套之間差異夠大，對手才猜不透。
class Retry extends Error {}

import { BOARD } from '../src/board.mjs';
import { PIECES, validateSetup } from '../src/rules.mjs';

const isCamp = (r, c) => BOARD.nodes.get(`P0-r${r}c${c}`).kind === 'camp';

function makeBoard(seat, rnd) {
  const layout = {};
  const used = new Set();
  const put = (r, c, piece) => {
    if (c < 1 || c > 5 || r < 1 || r > 6) return false;
    const id = `P${seat}-r${r}c${c}`;
    if (used.has(id) || isCamp(r, c)) return false;
    layout[id] = piece; used.add(id); return true;
  };
  const free = () => {
    const out = [];
    for (let r = 1; r <= 6; r++) for (let c = 1; c <= 5; c++)
      if (!isCamp(r, c) && !used.has(`P${seat}-r${r}c${c}`)) out.push({ r, c });
    return out;
  };
  const remaining = () => {
    const out = [];
    for (const [name, def] of Object.entries(PIECES)) {
      const already = Object.values(layout).filter(p => p === name).length;
      for (let i = 0; i < def.count - already; i++) out.push(name);
    }
    return out;
  };
  // 把剩下的棋子填完：depth 決定大子偏前還是偏後（每套風格自己決定）
  const fillRest = (bigForward) => {
    const rank = (p) => PIECES[p].rank ?? 0;
    const rest = remaining().sort((a, b) => (rank(b) - rank(a)) * (bigForward ? 1 : -1) + (rnd() - 0.5) * 2);
    const slots = free().sort((a, b) => (a.r - b.r) + (rnd() - 0.5) * 0.8);
    if (rest.length !== slots.length) return false;
    rest.forEach((p, i) => put(slots[i].r, slots[i].c, p));
    return true;
  };
  // 結構性擺放用 must()：放不下就中止這次嘗試重來。
  // 用 put() 靜默失敗過——風格想把司令放側翼，位置被地雷佔走，司令就被隨手填到第一排，
  // 整個風格等於沒實現（實測勝率 0.4%）。
  const must = (r, c, piece) => { if (!put(r, c, piece)) throw new Retry(); };

  // 軍旗旁邊一定要有東西擋。三角雷只是其中一種擺法，但「軍旗裸奔」不是風格，是漏洞：
  // 敵人用小兵換掉旁邊的炸彈，下一步就直接取旗（實測這種陣型勝率 0.4%）。
  // ⚠ 護旗有很多種擺法，不能每局都同一個三角形。
  // Lynch（2026-09-02）：「每一局 AI 的佈陣會變吧？為什麼我覺得好像都差不多」
  // 「太好捉摸、太好猜的 AI 就會變得很弱」「電腦都不會把地雷放在鐵路轉角那兩個點」。
  // 實測 400 局只有兩種地雷組合（左右鏡像的三角雷），r6c3 出現率 100%。
  //
  // ⚠ 而且「正上方一定放雷」也是錯的（我寫死過，被 Lynch 推翻）：
  // 「正常玩的時候，軍旗正上是大子的勝率更高才對。」
  // 軍旗正上方是唯一一步取得到軍旗的格子，所以那裡一定要有防守——
  // 但防守可以是**地雷**（死的、擋一次），也可以是**大子**（會吃人、還能動）。
  // 真人不會拿大子去硬撞未知的格子，所以放大子在那裡反而更有威嚇力。
  // 規則只有一條：那一格不能空著。
  const guardFlag = (flagCol) => {
    const ok = (r, c) => c >= 1 && c <= 5 && r >= 5 && r <= 6 && !isCamp(r, c);
    const A = [6, flagCol - 1], B = [6, flagCol + 1], C = [5, flagCol];   // 貼著軍旗的三格
    const L = [5, flagCol - 1], R = [5, flagCol + 1];                     // 斜上兩格：擋進攻通道
    const K1 = [5, 1], K2 = [5, 5];                                       // 鐵路轉角
    // Lynch 說大子在正上方是更好的守陣，所以偏向它；但擺不下時會退回地雷，
    // 所以實際比例會低於這個機率。
    const bigOnTop = rnd() < 0.65;                                        // 正上方放大子還是放雷

    if (bigOnTop) {
      // Lynch 的完整守陣：「對方還是要派工兵來測。測完我有大子防守，
      // 大子上面還有炸彈防守，這才是最好的守陣。」
      // 大子擋住唯一的取旗路線，誰吃掉大子就換炸彈——工兵測出來也沒用。
      const big = ['司令', '軍長', '師長'][Math.floor(rnd() * 3)];
      if (!put(C[0], C[1], big)) return guardMines([C, A, B]);            // 放不下就退回三角雷
      // ⚠ 軍旗正上方再上一格（r4c2／r4c4）是行營，開局不能放子。
      // 所以炸彈放在大子的相鄰格，優先第四排（在它後面接應）。
      // 炸彈要放在**一步接應得到**大子的格子。r4c1 之類看起來在上面，其實跟 r5c2 不相鄰，
      // 大子被吃掉時炸彈根本過不去（第一版就是這樣，實測 0% 接應到）。
      // 同一排的左右鄰格才接得上。
      const backup = [[5, flagCol - 1], [5, flagCol + 1]];
      const spot = backup.find(([r, c]) => c >= 1 && c <= 5 && !isCamp(r, c) && put(r, c, '炸彈'));
      // 炸彈佔掉了斜上那格，地雷就往貼旗兩側＋鐵路轉角擺
      return guardMines(spot ? [A, B, rnd() < 0.5 ? K1 : K2] : [C, A, B]);
    }
    return guardMines([
      [C, A, B],                // 三角雷（經典）
      [C, A, K2], [C, B, K1],   // 一側貼旗＋對角的鐵路轉角
      [C, L, R],                // 斜上兩格：把整條通道封起來
      [C, A, L], [C, B, R],     // 一側貼旗＋同側斜上
      [C, K1, K2],              // 兩個鐵路轉角
    ][Math.floor(rnd() * 7)]);

    function guardMines(set) {
      let placed = 0;
      for (const [r, c] of set) if (ok(r, c) && put(r, c, '地雷')) placed++;
      // 擺不下就從貼旗的幾格補滿：寧可退回三角雷，也不能讓軍旗裸奔
      for (const [r, c] of [C, A, B, L, R, K1, K2]) {
        if (placed >= 3) break;
        if (ok(r, c) && put(r, c, '地雷')) placed++;
      }
      return placed;
    }
  };

  // 另一個大本營一定要先放便宜的棋子。大本營的棋子永遠不能移動，
  // 讓填充程式隨手把司令或工兵塞進去，等於開局就少一顆關鍵棋（實測勝率掉到 0.4%）。
  const reserveSpareHQ = (flagCol) => put(6, flagCol === 2 ? 4 : 2, '排長');

  // 工兵不要每局都放同樣兩格（Lynch 問「triangleRush 把工兵放在 r5c1/r5c5 為何？」——
  // 那是我自己加的，理由是鐵路轉角容易出動，但代價是完全可預測，
  // 而且跟「地雷放鐵路轉角」搶位置。改成每局從一池候選格隨機挑。
  // 候選格限定第三排以後、而且靠得到鐵路（工兵要能飛出去），不是全盤亂放。
  // count 一律傳 3（全部三顆）：只放兩顆的話，剩下那顆會落到 fillRest 手上，
  // 而它把小子一律往最後排堆——實測工兵有 52% 落在 r6c1／r6c5，反而更好猜。
  // 一隻工兵固定放 r1c2 或 r1c4（Lynch 直接指定）：
  // 「這個點 1-8 無法直接吃到，所以安全。然後等到要拆雷又隨時可以飛。通常會放一隻。」
  // 引擎驗證過（只算**敵方站得到**的位置，自家格子不算威脅——第一版把自家也算進去，
  // 得出 22／11／5 那組沒有意義的數字，Lynch 指正）：
  //   r1c2、r1c4：敵方一步吃得到的位置 0 個  ← 完全碰不到
  //   r1c3      ：4 個（對家沿中央鐵路直下，加中央三格）
  //   r1c1、r1c5：13 個（兩家的整條側邊鐵路，加中央三格）
  // 所以 r1c3 也比兩個角落安全得多，只是仍不如 r1c2／r1c4。
  // 而且它就在鐵路上，要拆雷時可以直接飛出去。
  const safeEngineer = () => {
    // ⚠ 只有 r1c2、r1c4。r1c3 雖然也安全（碰到兩個行營、敵方只有 4 個位置構得到），
    // 但那是**戰略點**——Lynch：「隨時要出子去擋、去吃，這個位置不要放工兵。
    // 安全點是安全點，但不代表適合放工兵。R1 就只有 C2、C4 適合放工兵。」
    // 工兵在那裡既擋不住也吃不了人，等於把一個要衝讓出來。
    const spots = [[1, 2], [1, 4]];
    if (rnd() < 0.5) spots.reverse();
    for (const [r, c] of spots) if (put(r, c, '工兵')) return true;
    return false;
  };

  const spreadEngineers = (count) => {
    // 一開始給鐵路格加權，結果工兵又全部集中到 r6c1／r6c5（54%）——
    // 偏好只要夠強就會製造新的可預測性。純隨機就好：
    // 第三排以後的任何一格，離鐵路本來就只有一步。
    // ⚠ 也不會落在鐵路轉角（r5c1／r5c5）。Lynch：「對方工兵很喜歡測這個點，
    // 工兵放這很笨，很容易被同歸於盡。」工兵換工兵是我方虧——全隊只有三顆，
    // 而且是唯一能拆雷的。（那兩格本來就在後兩排，已經被排除。）
    // 第 2～4 排。兩條理由都是 Lynch 給的：
    //   後兩排（r5、r6）不能放——那兩排的棋子「沒必要不動」是鐵律（一動就宣告不是地雷），
    //   工兵被綁在那裡等於廢掉全隊唯一能拆雷的子。
    //   第一排不放——太前面，開局幾手就被換掉。
    //   第二排也不放：實測放到第 2～4 排時，整組佈陣在模擬裡掉到 34%（原本 45%），
    //   工兵太早被換掉，全隊就拆不了雷了。第 3～4 排是「動得了、又不會馬上死」的折衷。
    // 其餘的工兵：第 2～4 排，而且不站左右路（c1／c5）。
    // Lynch：「其他兩隻放 R2~R4，不躲進行營、站在左右路的話，前方必須要有大子保護。」
    // 行營開局必須空著，所以躲行營不是佈陣時的選項；左右路要有大子在前面擋才行，
    // 這裡直接避開左右路——那是同一條規則的安全子集，不必去湊「前方有大子」。
    const pool = [];
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) {
      if (isCamp(r, c)) continue;
      pool.push({ r, c, key: rnd() });
    }
    pool.sort((a, b) => a.key - b.key);
    // 還缺幾隻自己算：已經放過的（例如安全點那一隻）要扣掉，
    // 不然會擺出四隻工兵，整份佈陣驗證不過（實測直接產生失敗）。
    const already = Object.values(layout).filter(p => p === '工兵').length;
    let placed = 0;
    for (const { r, c } of pool) {
      if (already + placed >= count) break;
      if (put(r, c, '工兵')) placed++;
    }
    return placed;
  };

  return { layout, put, must, free, fillRest, reserveSpareHQ, guardFlag, spreadEngineers, safeEngineer };
}

// ── 四種風格 ──────────────────────────────────────────────
// 每一套都完整：軍旗、地雷、炸彈、工兵各有安排，差別在「章法」不同。

const STYLES = [
  // 1. 三角雷護旗 + 大子前壓：正面硬碰，靠前排大子換掉對方主力
  function triangleRush(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc);
    b.safeEngineer(); b.spreadEngineers(3);
    b.must(4, 1, '炸彈'); b.must(4, 5, '炸彈');
    b.guardFlag(fc);                     // 護旗放最後：先讓風格佔好自己的關鍵格，護旗再繞著擺
    return b.fillRest(true) ? b.layout : null;
  },
  // 2. 一字雷 + 前排小兵屏障：大子縮在二三排，用小兵探路，反擊型
  function lineGuard(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc);
    b.must(1, 1, '排長'); b.must(1, 5, '排長'); b.must(1, 3, '連長');   // 前排小兵當屏障
    b.must(3, 2, '炸彈'); b.safeEngineer(); b.spreadEngineers(3);
    b.guardFlag(fc);
    return b.fillRest(true) ? b.layout : null;
  },
  // 3. 側翼司令（Lynch 的路數）：司令縮在側邊鐵路底端，隨時能沿縱列一口氣飛上前線
  function flankCommander(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc);
    const side = rnd() < 0.5 ? 1 : 5;
    b.must(5, side, '司令');      // 司令縮在側邊鐵路底端，隨時能沿縱列飛上前線
    b.must(4, side, '炸彈');
    b.must(3, side, '工兵');
    b.must(1, 3, '軍長');
    b.guardFlag(fc);
    return b.fillRest(true) ? b.layout : null;
  },
  // 4. 炸彈前置：把炸彈放在前兩排當陷阱，專炸衝進來的大子
  function bombTrap(seat, rnd, fc) {
    const b = makeBoard(seat, rnd);
    b.put(6, fc, '軍旗'); b.reserveSpareHQ(fc);
    b.must(2, 1, '炸彈'); b.must(2, 5, '炸彈');   // 炸彈前置當陷阱
    b.must(1, 1, '師長'); b.must(1, 5, '師長');
    b.safeEngineer(); b.spreadEngineers(3);
    b.guardFlag(fc);
    return b.fillRest(true) ? b.layout : null;
  },
];

export const LAYOUT_STYLES = STYLES.map(f => f.name);

// 目前輪替使用的風格。側翼司令（index 2）暫時不用——那套需要「等時機一口氣飛上前線」
// 的戰術，AI 還不會，硬用只會把自己的側邊鐵路堵死（實測勝率 4.9%）。
// 等 sim/tune-layout.mjs 調出能駕馭它的權重再放回來。
const ACTIVE = [0, 1, 3];

// ── 左右兩路的基本防禦（Lynch 2026-09-02）────────────────────────
// 「左右路都要有基本防禦。左路右路上，至少要有 1、2、3 其中一個。
//   如果是 2、3 就要有炸彈保護。」
// 兩側的縱列是鐵路主幹道，敵人沿著它一口氣滑進來；那條路上沒有大子＝門戶洞開。
// 而軍長、師長擋得住一般棋子卻擋不住司令，所以要有炸彈在旁邊接應。
const TOP3 = ['司令', '軍長', '師長'];

function laneGuard(layout, seat, rnd) {
  const id = (r, c) => `P${seat}-r${r}c${c}`;
  const rowOf = (x) => Number(x.match(/r(\d)/)[1]);
  const cellsIn = (col) => Object.keys(layout).filter(x => x.endsWith(`c${col}`));
  const canPut = (piece, x) => {
    if (BOARD.nodes.get(x).kind === 'hq') return ['軍旗', '地雷', '排長'].includes(piece);
    if (piece === '軍旗') return false;
    if (piece === '地雷') return rowOf(x) >= 5;
    if (piece === '炸彈') return rowOf(x) !== 1;
    return true;
  };
  const swap = (a, b) => {
    if (!canPut(layout[a], b) || !canPut(layout[b], a)) return false;
    const t = layout[a]; layout[a] = layout[b]; layout[b] = t; return true;
  };

  // 守在軍旗正上方的大子不能被調走——那一格空了就是把鑰匙插在門上
  const flagId = Object.keys(layout).find(x => layout[x] === '軍旗');
  const topOfFlag = flagId ? flagId.replace(/r6c(\d)/, 'r5c$1') : null;

  for (const col of [1, 5]) {
    const lane = cellsIn(col);
    if (lane.some(x => TOP3.includes(layout[x]))) continue;
    // 這條路上沒有大子：從別處調一顆過來（優先調動最不影響另一條路的那顆）
    const donors = Object.keys(layout)
      .filter(x => TOP3.includes(layout[x]) && x !== topOfFlag
        && !x.endsWith('c1') && !x.endsWith('c5'));
    const spot = lane.filter(x => !TOP3.includes(layout[x]) && rowOf(x) <= 5
      && BOARD.nodes.get(x).kind !== 'hq' && layout[x] !== '地雷' && layout[x] !== '軍旗');
    if (!donors.length || !spot.length) continue;
    swap(donors[Math.floor(rnd() * donors.length)], spot[Math.floor(rnd() * spot.length)]);
  }

  // 守在路上的如果是軍長或師長，旁邊要有炸彈接應（它們擋不住司令）
  for (const col of [1, 5]) {
    const guard = cellsIn(col).find(x => layout[x] === '軍長' || layout[x] === '師長');
    if (!guard) continue;
    const near = [...(BOARD.adj.get(guard) ?? [])].filter(x => layout[x] != null);
    if (near.some(x => layout[x] === '炸彈')) continue;
    const bomb = Object.keys(layout).find(x => layout[x] === '炸彈');
    const spot = near.find(x => canPut('炸彈', x) && canPut(layout[x], bomb)
      && !TOP3.includes(layout[x]) && layout[x] !== '軍旗' && layout[x] !== '地雷');
    if (bomb && spot) swap(bomb, spot);
  }
  return layout;
}

export function doctrineLayout(seat, rnd = Math.random, styleIndex = null) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const style = STYLES[styleIndex ?? ACTIVE[Math.floor(rnd() * ACTIVE.length)]];
    const fc = rnd() < 0.5 ? 2 : 4;
    let layout = null;
    try { layout = style(seat, rnd, fc); } catch (e) { if (!(e instanceof Retry)) throw e; }
    if (layout) laneGuard(layout, seat, rnd);
    if (layout && validateSetup(seat, layout).ok) return layout;
  }
  throw new Error('產生佈陣失敗');
}

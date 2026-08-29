// 抽樣「敵方可能長什麼樣」：把未知的敵方棋子指派成一組合法身分。
// 這是搜尋層的地基——有了完整盤面才能往前推演。
// 鐵律：只能用公開資訊與自己的推理記憶，絕不可以偷看 game.at 裡別人的 piece。
import { BOARD, TEAM_OF } from '../src/board.mjs';
import { PIECES } from '../src/rules.mjs';

const isBackRow = (id) => /r[56]c/.test(id);
const isHQ = (id) => BOARD.nodes.get(id)?.kind === 'hq';

// 一個座位完整的 25 顆棋子清單
const census = () => {
  const out = [];
  for (const [name, def] of Object.entries(PIECES)) for (let i = 0; i < def.count; i++) out.push(name);
  return out;
};

// 這顆棋子「可以是」哪些身分？只根據公開觀察與推理記憶判斷。
function candidatesFor(id, memory) {
  const moved = memory?.moved?.has(id);
  const notMine = memory?.notMine?.has(id);
  const known = memory?.weakKnown?.get(id);
  if (known) return [known];                                  // 已曝光（例如拆過地雷的必是工兵）

  return census().filter(name => {
    if (name === '軍旗') return isHQ(id) && !moved;            // 軍旗只在大本營且不會動
    if (name === '地雷') return isBackRow(id) && !moved && !notMine;   // 地雷只在後兩排且不會動
    const bigThreat = memory?.bigThreat?.get(id) ?? 0;
    if (bigThreat > 0 && name !== '炸彈') {                     // 我方某階的子死在它手上
      const r = PIECES[name].rank ?? 0;
      if (r < bigThreat) return false;                         // 它至少要贏得了那顆
    }
    return true;
  });
}

// 對單一座位抽一組合法身分。用「可能性最少的先指派」，避免抽到一半無解。
function sampleSeat(game, seat, memory, rnd) {
  const nodes = [];
  for (const [id, o] of game.at) if (o.seat === seat) nodes.push(id);

  const pool = census();
  const assignment = new Map();
  const options = nodes.map(id => ({ id, opts: candidatesFor(id, memory) }))
    .sort((a, b) => a.opts.length - b.opts.length);

  for (const { id, opts } of options) {
    const usable = opts.filter(name => pool.includes(name));
    const pick = usable.length
      ? usable[Math.floor(rnd() * usable.length)]
      : pool[Math.floor(rnd() * pool.length)];               // 抽不到相容的就退而求其次，不要卡死
    assignment.set(id, pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return assignment;
}

// 產生一份「假想完整盤面」：自己的棋子照實，敵方（與看不到的隊友）用抽樣的身分填上。
export function determinize(game, seat, memory, rnd = Math.random) {
  const at = new Map();
  const mySide = new Set();
  for (const [id, o] of game.at) if (o.seat === seat) mySide.add(id);

  const seats = new Set();
  for (const o of game.at.values()) if (o.seat !== seat) seats.add(o.seat);

  const guesses = new Map();
  for (const s of seats) for (const [id, piece] of sampleSeat(game, s, memory, rnd)) guesses.set(id, piece);

  for (const [id, o] of game.at)
    at.set(id, mySide.has(id) ? { ...o } : { seat: o.seat, piece: guesses.get(id) ?? '排長' });

  return {
    ...game,
    at,
    eliminated: new Set(game.eliminated),
    revealedFlags: new Set(game.revealedFlags),
    log: [],
  };
}

export const isTeammate = (a, b) => TEAM_OF(a) === TEAM_OF(b);

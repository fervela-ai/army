// 軍階符號：把 CYC 那套「星星／梅花／橫槓」畫成 SVG。
// 形狀在這裡定義，顏色一律走 theme.css 的 CSS 變數，美術改色不必動這支。
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

// 軍階：將官用星、校官用梅花、尉官用橫槓（與 CYC 的圖示一致）
export const RANK_INSIGNIA = {
  司令: { kind: 'star', count: 3 },
  軍長: { kind: 'star', count: 2 },
  師長: { kind: 'star', count: 1 },
  旅長: { kind: 'plum', count: 3 },
  團長: { kind: 'plum', count: 2 },
  營長: { kind: 'plum', count: 1 },
  連長: { kind: 'bar', count: 2 },
  排長: { kind: 'bar', count: 1 },
  工兵: { kind: 'tool' },
  地雷: { kind: 'mine' },
  炸彈: { kind: 'bomb' },
  軍旗: { kind: 'flag' },
};

const star = (cx, cy, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.40 : r;      // 內外比 0.40（規格）
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`);
  }
  return el('polygon', { class: 'ins ins--star', points: pts.join(' ') });
};

const plum = (cx, cy, r) => {                    // 梅花：五瓣
  const g = el('g', { class: 'ins ins--plum' });
  for (let i = 0; i < 5; i++) {
    const rad = (Math.PI * 2 / 5) * i - Math.PI / 2;
    // 花瓣半徑 r×0.36、中心距 r×0.50（規格）——原本 0.46／0.55 太肥，
    // 導致梅花的填色面積遠大於星星，階級高的反而看起來弱。
    g.appendChild(el('circle', { cx: cx + r * 0.50 * Math.cos(rad), cy: cy + r * 0.50 * Math.sin(rad), r: r * 0.36 }));
  }
  return g;
};

const bar = (cx, cy, w) => el('rect', {
  class: 'ins ins--bar', x: cx - w / 2, y: cy - 1.4, width: w, height: 2.8, rx: 1.2,
});

// 規格：docs/piece-symbols-spec.md（2026-08-29 用手機真實尺寸 19.8×18.9 目視定案）
// 座標以中心為原點；規格寫的是 viewBox 0 0 32 30，中心 (16,15)，這裡一律減掉。
// 「品字形」＝一上二下，三顆以內人眼不用數，這是整套符號的前提。
const SLOTS = {
  3: [[0, -6.5], [-6.7, 5], [6.7, 5]],
  2: [[-6.7, 0], [6.7, 0]],
  1: [[0, 0]],
};

export function insignia(piece) {
  const spec = RANK_INSIGNIA[piece];
  const g = el('g', { class: 'insignia' });
  if (!spec) return g;

  if (spec.kind === 'star') {
    // 每顆星一律同尺寸，不因數量放大——否則「一顆星」看起來比「三顆星」還重。
    for (const [x, y] of SLOTS[spec.count]) g.appendChild(star(x, y, 7.4));
  } else if (spec.kind === 'plum') {
    // 梅花要收小：同半徑下五瓣梅花的填色面積約為五角星的三倍，
    // 不收小的話階級高的反而看起來弱。
    for (const [x, y] of SLOTS[spec.count]) g.appendChild(plum(x, y, 5.9));
  } else if (spec.kind === 'bar') {
    const gap = 5.2;
    const start = -((spec.count - 1) * gap) / 2;
    for (let i = 0; i < spec.count; i++) g.appendChild(bar(0, start + i * gap, 15));
  } else if (spec.kind === 'tool') {
    // 工兵：十字鎬（取代原本的鏟子／扳手）
    g.appendChild(el('path', { class: 'ins ins--tool-handle', d: 'M 0 8 V -5' }));
    g.appendChild(el('path', {
      class: 'ins ins--tool-head',
      d: 'M -8.5 -3.5 Q 0 -9 8.5 -3.5 Q 0 -6 -8.5 -3.5 Z' }));
  } else if (spec.kind === 'mine') {
    // 地雷：水雷式——圓身 ＋ 八根放射狀尖刺。小尺寸辨識度最好，
    // 而且與炸彈（圓潤、有引信）的輪廓不會混淆。
    g.appendChild(el('circle', { class: 'ins ins--mine', cx: 0, cy: 0, r: 4.4 }));
    const spikes = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const c = Math.cos(a), s2 = Math.sin(a);
      spikes.push(`M ${(c * 4.4).toFixed(2)} ${(s2 * 4.4).toFixed(2)} L ${(c * 8.4).toFixed(2)} ${(s2 * 8.4).toFixed(2)}`);
    }
    g.appendChild(el('path', { class: 'ins ins--mine-spikes', d: spikes.join(' ') }));
  } else if (spec.kind === 'bomb') {
    // 炸彈：維持圓身＋引信＋火花。試過三種飛彈造型，Lynch 目視判定
    // 「飛彈太不清楚」——細長形在 19.8px 下輪廓太窄。不要再改回飛彈。
    g.appendChild(el('circle', { class: 'ins ins--bomb', cx: 0, cy: 1.8, r: 5 }));
    g.appendChild(el('path', { class: 'ins ins--bomb-fuse', d: 'M 3.1 -2.4 Q 6.4 -7 9 -5.2' }));
    g.appendChild(el('path', { class: 'ins ins--bomb-spark',
      d: 'M 9 -5.2 l 2.6 -1.2 M 9 -5.2 l 1.1 2.4 M 9 -5.2 l -0.4 -2.7' }));
  } else if (spec.kind === 'flag') {
    g.appendChild(el('path', { class: 'ins ins--flag-pole', d: 'M -6 -7.5 V 7.5' }));
    g.appendChild(el('path', { class: 'ins ins--flag', d: 'M -6 -7.5 L 7.5 -3 L -6 1.5 Z' }));
  }
  return g;
}


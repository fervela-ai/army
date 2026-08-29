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
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`);
  }
  return el('polygon', { class: 'ins ins--star', points: pts.join(' ') });
};

const plum = (cx, cy, r) => {                    // 梅花：五瓣
  const g = el('g', { class: 'ins ins--plum' });
  for (let i = 0; i < 5; i++) {
    const rad = (Math.PI * 2 / 5) * i - Math.PI / 2;
    g.appendChild(el('circle', { cx: cx + r * 0.55 * Math.cos(rad), cy: cy + r * 0.55 * Math.sin(rad), r: r * 0.42 }));
  }
  return g;
};

const bar = (cx, cy, w) => el('rect', {
  class: 'ins ins--bar', x: cx - w / 2, y: cy - 1.4, width: w, height: 2.8, rx: 1.2,
});

export function insignia(piece) {
  const spec = RANK_INSIGNIA[piece];
  const g = el('g', { class: 'insignia' });
  if (!spec) return g;

  if (spec.kind === 'star' || spec.kind === 'plum') {
    const r = 3.6, gap = 8.4;
    const start = -((spec.count - 1) * gap) / 2;
    for (let i = 0; i < spec.count; i++)
      g.appendChild(spec.kind === 'star' ? star(start + i * gap, 0, r) : plum(start + i * gap, 0, r));
  } else if (spec.kind === 'bar') {
    const gap = 4.5;
    const start = -((spec.count - 1) * gap) / 2;
    for (let i = 0; i < spec.count; i++) g.appendChild(bar(0, start + i * gap, 13));
  } else if (spec.kind === 'tool') {              // 工兵：鏟子（柄 + 鏟頭）
    g.appendChild(el('path', { class: 'ins ins--tool-handle', d: 'M 0 6.5 V -0.5' }));
    g.appendChild(el('path', { class: 'ins ins--tool', d: 'M -4.6 -0.5 Q 0 -7.5 4.6 -0.5 Z' }));
  } else if (spec.kind === 'mine') {              // 地雷：帶刺的球
    g.appendChild(el('circle', { class: 'ins ins--mine', cx: 0, cy: 0, r: 3.4 }));
    g.appendChild(el('path', { class: 'ins ins--mine-spikes', d: 'M 0 -6.5 V 6.5 M -6.5 0 H 6.5 M -4.6 -4.6 L 4.6 4.6 M 4.6 -4.6 L -4.6 4.6' }));
  } else if (spec.kind === 'bomb') {              // 炸彈：球 + 引信
    g.appendChild(el('circle', { class: 'ins ins--bomb', cx: 0, cy: 1.5, r: 4.2 }));
    g.appendChild(el('path', { class: 'ins ins--bomb-fuse', d: 'M 2.6 -2 Q 5.5 -6 8 -4.5' }));
  } else if (spec.kind === 'flag') {              // 軍旗：旗桿 + 三角旗
    g.appendChild(el('path', { class: 'ins ins--flag-pole', d: 'M -5 -6 V 6' }));
    g.appendChild(el('path', { class: 'ins ins--flag', d: 'M -5 -6 L 6 -2.5 L -5 1 Z' }));
  }
  return g;
}

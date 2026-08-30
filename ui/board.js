// 棋盤渲染：把 129 個點位、鐵路、公路、弧線與棋子畫成 SVG。
// ⚠ 這裡只負責「畫」與「回報點擊」，不含任何遊戲規則；規則一律在 engine/ 裡。
// class 名稱是與 theme.css 的契約，改樣式請動 theme.css，不要改這裡的結構。
import { BOARD, SEATS } from '../engine/src/board.mjs?v=140';
import { GEOMETRY, ARCS, BOUNDS, nodeXY } from '../engine/src/geometry.mjs?v=140';
import { insignia } from './insignia.js?v=140';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

const SCALE = 46, PAD = 40;
const px = (x) => (x - BOUNDS.minX) * SCALE + PAD;
const py = (y) => (BOUNDS.maxY - y) * SCALE + PAD;
const W = (BOUNDS.maxX - BOUNDS.minX) * SCALE + PAD * 2;
const H = (BOUNDS.maxY - BOUNDS.minY) * SCALE + PAD * 2;

const seatClass = (seat) => `seat-${seat}`;
const railEdges = () => {
  const out = [], seen = new Set();
  for (const line of BOARD.lines)
    for (let i = 0; i + 1 < line.length; i++) {
      const key = [line[i], line[i + 1]].sort().join('|');
      if (!seen.has(key)) { seen.add(key); out.push([line[i], line[i + 1]]); }
    }
  return out;
};
const isArcPair = (a, b) => ARCS.some(arc =>
  (arc.from === a && arc.to === b) || (arc.from === b && arc.to === a));

export function createBoardView(svg, { onNodeClick, onPointerUp }) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // 事件統一由棋盤根節點代理：
  //  * 用 pointerdown 而不是 click——click 要求按下與放開落在同一個元素上，
  //    棋子只有 42x36，手指移動幾像素就不算 click，玩起來就是「點了沒反應」。
  //  * 代理而不是逐顆掛：棋盤每次重畫都會換掉所有棋子元素，掛在元素上的監聽會跟著消失，
  //    按到一半剛好遇到重畫就會斷掉。
  //  * 一律 preventDefault，否則拖曳會變成框選棋子上的文字，選取一旦開始後續點擊全亂。
  const nodeAt = (e) => e.target.closest?.('[data-node]')?.getAttribute('data-node') ?? null;
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const id = nodeAt(e);
    if (id) onNodeClick(id);
  });
  svg.addEventListener('pointerup', (e) => {
    const id = nodeAt(e);
    if (id) onPointerUp?.(id);
  });
  svg.addEventListener('dragstart', (e) => e.preventDefault());

  const rotor = el('g', { class: 'rotor' });
  const layers = {
    roads: el('g', { class: 'layer-roads' }),
    rails: el('g', { class: 'layer-rails' }),
    nodes: el('g', { class: 'layer-nodes' }),
    hints: el('g', { class: 'layer-hints' }),
    pieces: el('g', { class: 'layer-pieces' }),
    marks: el('g', { class: 'layer-marks' }),   // 可吃的目標要畫在棋子「上面」，否則會被棋子蓋住
    fx: el('g', { class: 'layer-fx' }),
  };
  svg.replaceChildren(rotor);
  Object.values(layers).forEach(l => rotor.appendChild(l));

  // 公路：不是鐵路的相鄰連線
  const drawn = new Set();
  for (const [id, neighbours] of BOARD.adj)
    for (const nb of neighbours) {
      const key = [id, nb].sort().join('|');
      if (drawn.has(key) || BOARD.isRailEdge(id, nb)) continue;
      drawn.add(key);
      const a = nodeXY(id), b = nodeXY(nb);
      layers.roads.appendChild(el('line', {
        class: 'road', x1: px(a.x), y1: py(a.y), x2: px(b.x), y2: py(b.y),
      }));
    }

  // 鐵路：直線段 + 四個轉角弧
  for (const [a, b] of railEdges()) {
    if (isArcPair(a, b)) continue;
    const p = nodeXY(a), q = nodeXY(b);
    layers.rails.appendChild(el('line', {
      class: 'rail', x1: px(p.x), y1: py(p.y), x2: px(q.x), y2: py(q.y),
    }));
  }
  for (const arc of ARCS) {
    // 真正的四分之一圓：圓心在外側轉角、半徑一格，切線剛好貼合兩家的側邊縱列。
    // 別為了「讓它看起來更彎」把控制點往外推——那會變成往外撐開的大括號，整個棋盤就走樣了。
    const a = nodeXY(arc.from), b = nodeXY(arc.to);
    const r = arc.radius * SCALE;
    layers.rails.appendChild(el('path', {
      class: 'rail rail--arc',
      d: `M ${px(a.x)} ${py(a.y)} A ${r} ${r} 0 0 ${arc.sweep} ${px(b.x)} ${py(b.y)}`,
    }));
  }

  // 點位：兵站與九宮＝方、行營＝紅圓、大本營＝本壘板（尖端朝內）
  for (const node of BOARD.nodes.values()) {
    const p = nodeXY(node.id);
    const x = px(p.x), y = py(p.y);
    const stroke = node.seat == null ? null : `var(--seat-${node.seat})`;
    let shape;
    if (node.kind === 'camp') {
      shape = el('circle', { class: 'node node--camp', cx: x, cy: y, r: 10 });
    } else if (node.kind === 'hq') {
      const w = 13;
      shape = el('polygon', {
        class: 'node node--hq',
        points: `${-w},11 ${w},11 ${w},-3 0,-15 ${-w},-3`,
        transform: `translate(${x},${y}) rotate(${-90 * node.seat})`,
        stroke,
      });
    } else {
      shape = el('rect', {
        class: `node node--${node.kind === 'center' ? 'center' : 'post'}`,
        x: x - 11, y: y - 11, width: 22, height: 22, stroke,
      });
    }
    if (node.kind === 'camp') shape.setAttribute('stroke', 'var(--camp-stroke)');
    layers.nodes.appendChild(shape);
    // 每一格都要有「整格大小」的透明命中區。
    // 少了這個，空格子只有那顆小綠點（r=7，手機上約 6px）點得到——
    // 手指一偏就打到空白處，變成一直取消選取（Lynch 實機回報）。
    layers.nodes.appendChild(el('rect', {
      class: 'node-hit', 'data-node': node.id,
      x: x - 23, y: y - 22, width: 46, height: 44, fill: 'transparent',
    }));
  }

  let bottomSeat = 0;
  const setBottomSeat = (seat) => {
    bottomSeat = seat;
    rotor.setAttribute('transform', `rotate(${90 * seat} ${W / 2} ${H / 2})`);
  };
  setBottomSeat(0);

  // 依「該玩家看得到的盤面」重畫棋子與提示
  // 窄螢幕只留符號、不畫文字：手機一格約 19.8px，中文只有 6.5px，是雜訊不是資訊。
  // 斷點用「單格的實際像素」而不是視窗寬度——棋盤尺寸、平板橫拿、瀏覽器縮放
  // 都會讓視窗寬度失準，格子大小永遠正確。（規格 docs/piece-symbols-spec.md）
  // 用遲滯（hysteresis）：小於 26 才進精簡、要大於 30 才退出。
  // 只用單一門檻的話，棋盤大小剛好卡在邊界時會來回切換——
  // 切換 → 版面微調 → 又觸發判斷，畫面看起來就是「一直放大縮小」（Lynch 實機回報）。
  let compact = false;
  function syncCompact() {
    const cellPx = (svg.getBoundingClientRect().width || 0) / W * 42;
    if (!cellPx) return;
    if (!compact && cellPx < 26) compact = true;
    else if (compact && cellPx > 30) compact = false;
    else return;                       // 在遲滯區間內就完全不動，避免抖動
    svg.classList.toggle('is-compact', compact);
  }
  // 只在重畫時算不夠：手機轉橫、拉動視窗時格子大小就變了，
  // 但下一步棋之前不會重畫，文字的顯示狀態會卡在舊的。
  // 兩種都掛，不要二選一：實測 ResizeObserver 在某些情況下不會觸發（視窗縮放模擬），
  // 只靠它就會卡在錯的狀態——57.9px 的大格子還在隱藏文字。
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncCompact).observe(svg);
  window.addEventListener('resize', syncCompact);
  window.addEventListener('orientationchange', () => setTimeout(syncCompact, 200));
  requestAnimationFrame(syncCompact);      // 首次版面完成後再量一次

  function render({ board, mySeats = [], selected = null, moves = [], revealedFlags = [], lastMove = null, recentMoves = [], hide = [], viewerSeat = 0 }) {
    syncCompact();
    layers.pieces.replaceChildren();
    layers.hints.replaceChildren();
    layers.marks.replaceChildren();
    // 走法提示用「看棋的人自己的隊色」：不會跟任何一家的棋子撞色，
    // 因為你不可能吃自己的棋子，所以自家顏色在敵方棋子上一定看得出來。
    for (const g of [layers.hints, layers.marks]) g.setAttribute('class', `${g.getAttribute('class').split(' ')[0]} ind-seat${viewerSeat}`);
    if (!board) return;

    // 對手的路徑：在你兩次出手之間，其他三家各走了一步。
    // 只畫「最後一步」的話，你永遠看不到另外兩家做了什麼——
    // Lynch：「大家可能會不夠時間看每個人怎麼移動，敵人路徑這個功能真的很重要。」
    // 所以畫的是「從你上次出手到現在的每一步」，每家用自己的顏色。
    const trailMoves = (recentMoves.length ? recentMoves : (lastMove ? [lastMove] : []));
    for (const mv of trailMoves) {
      const route = mv.path?.length >= 2 ? mv.path : [mv.from, mv.to];
      const d = route.map((id, i) => {
        const q = nodeXY(id);
        return `${i ? 'L' : 'M'} ${px(q.x)} ${py(q.y)}`;
      }).join(' ');
      layers.hints.appendChild(el('path', {
        class: 'last-path', d, stroke: `var(--seat-${mv.seat})`,
      }));
      const a = nodeXY(mv.from), b = nodeXY(mv.to);
      layers.hints.appendChild(el('circle', {
        class: 'last-from', cx: px(a.x), cy: py(a.y), r: 13, stroke: `var(--seat-${mv.seat})`,
      }));
      layers.hints.appendChild(el('rect', {
        // 一定要跟棋子同尺寸（42×36）。原本畫成 46×40，剛走完的那顆就多出一圈，
        // 在這個靠大小判斷階級的遊戲裡等於製造假的階級訊號——Lynch 實戰誤判成「棋子長大了」。
        class: 'last-to', x: px(b.x) - 21, y: py(b.y) - 18, width: 42, height: 36, rx: 6,
        stroke: `var(--seat-${mv.seat})`,
      }));
    }

    for (const [id, occ] of Object.entries(board.at)) {
      if (hide.includes(id)) continue;          // 動畫進行中的那顆棋子由分身代勞，本體先不畫
      const p = nodeXY(id);
      const x = px(p.x), y = py(p.y);
      const known = Boolean(occ.piece);
      const g = el('g', {
        class: ['piece', `piece--seat${occ.seat}`, known ? 'piece--known' : 'piece--hidden',
          mySeats.includes(occ.seat) ? 'piece--mine' : '',
          selected === id ? 'is-selected' : ''].filter(Boolean).join(' '),
        'data-node': id,
        transform: `translate(${x},${y})`,
      });
      // 透明的大命中區：實際圖形 42x36，但手指／滑鼠容許誤差要更大，否則很難點
      g.appendChild(el('rect', {
        class: 'piece-hit', x: -23, y: -22, width: 46, height: 44, fill: 'transparent',
      }));
      const face = el('g', { transform: `rotate(${-90 * bottomSeat})` });   // 讓棋子永遠正面朝向看的人
      face.appendChild(el('rect', {
        class: 'piece-box', x: -21, y: -18, width: 42, height: 36, rx: 6,
        stroke: `var(--seat-${occ.seat})`, 'stroke-width': 2.5,
      }));   // 暗棋的底色由 theme.css 依 .piece--hidden.piece--seatN 決定
      if (known) {
        const badge = insignia(occ.piece);
        badge.setAttribute('class', 'badge');
        badge.setAttribute('transform', 'translate(0,-6) scale(1)');   // 為下方文字留位；精簡模式會取消   // 新符號本身已是規格尺寸，不再放大
        face.appendChild(badge);
        const label = el('text', { class: 'piece-label', y: 9.5 });
        label.textContent = occ.piece;
        face.appendChild(label);
      }
      g.appendChild(face);
      layers.pieces.appendChild(g);
    }

    for (const to of moves) {
      const p = nodeXY(to);
      const occupied = Boolean(board.at[to]);
      const group = el('g', { class: 'move-target', 'data-node': to });
      if (occupied) {
        // 可以吃的棋子：外圈綠框 + 中央綠點，畫在棋子上層才看得見
        group.appendChild(el('circle', { class: 'move-dot move-dot--capture', cx: px(p.x), cy: py(p.y), r: 19 }));
        group.appendChild(el('circle', { class: 'move-dot', cx: px(p.x), cy: py(p.y), r: 6 }));
      } else {
        group.appendChild(el('circle', { class: 'move-dot', cx: px(p.x), cy: py(p.y), r: 7 }));
      }
      (occupied ? layers.marks : layers.hints).appendChild(group);
    }
  }

  // 走子動畫：先把一顆「分身」從起點滑到終點，再依結果做效果，最後才重畫盤面。
  // 這樣人眼看得到棋子確實移動過，而不是瞬間換位置。
  // 保險絲：分頁切到背景時瀏覽器會暫停動畫，onfinish 可能永遠不觸發。
  // 遊戲流程不可以被動畫綁架，所以一律加上時限，時間到就強制收尾。
  const settle = (anim, ms, done) => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); done(); };
    const timer = setTimeout(finish, ms);
    if (anim) anim.onfinish = finish;
    return finish;
  };

  // 棋子沿著實際路徑一格一格走，不是從起點直線滑到終點。
  // 工兵在鐵路上會拐彎，直線滑過去看起來就像瞬間移動。
  // 速度固定：每格 STEP_MS，換算約每秒 3 公分（一般螢幕 1 公分≈38px，格距 46px）。
  const STEP_MS = 400;

  function animateMove({ from, to, seat, outcome, piece, path }) {
    return new Promise((resolve) => {
      const route = (path && path.length >= 2) ? path : [from, to];
      const a = nodeXY(route[0]), b = nodeXY(route[route.length - 1]);
      const steps = route.length - 1;
      const travelMs = Math.max(STEP_MS, steps * STEP_MS);
      const ghost = el('g', { class: `ghost piece piece--seat${seat} ${piece ? 'piece--known' : 'piece--hidden'}` });
      const face = el('g', { transform: `rotate(${-90 * bottomSeat})` });
      face.appendChild(el('rect', {
        class: 'piece-box', x: -21, y: -18, width: 42, height: 36, rx: 6,
        stroke: `var(--seat-${seat})`, 'stroke-width': 2.5,
      }));
      if (piece) {
        const badge = insignia(piece);
        badge.setAttribute('class', 'badge');
        badge.setAttribute('transform', 'translate(0,-6) scale(1)');   // 為下方文字留位；精簡模式會取消   // 新符號本身已是規格尺寸，不再放大
        face.appendChild(badge);
        const label = el('text', { class: 'piece-label', y: 9.5 });
        label.textContent = piece;
        face.appendChild(label);
      }
      ghost.appendChild(face);
      ghost.setAttribute('transform', `translate(${px(a.x)},${py(a.y)})`);
      layers.fx.appendChild(ghost);

      const travel = ghost.animate(
        route.map((id, i) => {
          const p = nodeXY(id);
          return { transform: `translate(${px(p.x)}px,${py(p.y)}px)`, offset: i / steps };
        }),
        { duration: travelMs, easing: 'linear', fill: 'forwards' });

      settle(travel, travelMs + 200, () => {
        if (outcome === 'attackerDead') {
          // 撞到更大的：撞牆一樣彈一下就消失
          const bounce = ghost.animate(
            [{ transform: `translate(${px(b.x)}px,${py(b.y)}px) scale(1)`, opacity: 1 },
             { transform: `translate(${px(b.x)}px,${py(b.y)}px) scale(1.15)`, opacity: 1, offset: .25 },
             { transform: `translate(${px((b.x * 2 + a.x) / 3)}px,${py((b.y * 2 + a.y) / 3)}px) scale(.7)`, opacity: 0 }],
            { duration: 340, easing: 'ease-out', fill: 'forwards' });
          settle(bounce, 520, () => { ghost.remove(); resolve(); });
        } else if (outcome === 'bothDead') {
          const fade = ghost.animate([{ opacity: 1, transform: `translate(${px(b.x)}px,${py(b.y)}px) scale(1)` },
            { opacity: 0, transform: `translate(${px(b.x)}px,${py(b.y)}px) scale(1.4)` }],
            { duration: 260, fill: 'forwards' });
          settle(fade, 440, () => { ghost.remove(); resolve(); });
        } else {
          ghost.remove(); resolve();
        }
      });
    });
  }

  return { render, animateMove, STEP_MS, setBottomSeat, get bottomSeat() { return bottomSeat; } };
}

// 棋盤渲染：把 129 個點位、鐵路、公路、弧線與棋子畫成 SVG。
// ⚠ 這裡只負責「畫」與「回報點擊」，不含任何遊戲規則；規則一律在 engine/ 裡。
// class 名稱是與 theme.css 的契約，改樣式請動 theme.css，不要改這裡的結構。
import { BOARD, SEATS } from '../engine/src/board.mjs?v=159';
import { GEOMETRY, ARCS, BOUNDS, nodeXY } from '../engine/src/geometry.mjs?v=159';
import { insignia } from './insignia.js?v=159';

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
  //  * 鏡頭拉近時可以拖曳平移看別家（Lynch：「放大全盤後我還是可以靠拖曳看到全局嗎？」）。
  //    選取仍然發生在 pointerdown（那是刻意的，見上），拖過之後就不觸發 pointerup 的
  //    「拖到另一顆放開」，否則想看別家會變成走子。
  const nodeAt = (e) => e.target.closest?.('[data-node]')?.getAttribute('data-node') ?? null;
  let cam = null;                     // null＝全盤，不能平移
  let drag = null;
  const DRAG_MIN = 8;                 // 手指本來就會晃，太小會把點擊誤判成拖曳
  const pointers = new Map();
  let pinch = null;
  let camCustom = false;              // 使用者自己兩指縮放過，就不要再被預設大小蓋掉
  const MIN_W = 200;                  // 再放大就只剩兩三格，看不到脈絡

  const applyCam = () => {
    cam.w = Math.min(Math.max(cam.w, MIN_W), W);
    cam.h = Math.min(cam.h, H);
    cam.x = Math.min(Math.max(cam.x, 0), Math.max(0, W - cam.w));
    cam.y = Math.min(Math.max(cam.y, 0), Math.max(0, H - cam.h));
    svg.setAttribute('viewBox', `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    syncCompact();                    // 縮放到一定大小，棋子名稱自己回來
  };

  // 兩指縮放：Lynch「或是我拖曳到某個大小，就自動有文字」——
  // 文字的顯示本來就是看格子的實際像素，所以自由縮放天生就有這個行為，不用另外做。
  const dist = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const toBoard = (pt) => {
    const r = svg.getBoundingClientRect();
    return { x: cam.x + (pt.x - r.left) / r.width * cam.w,
             y: cam.y + (pt.y - r.top) / r.height * cam.h };
  };

  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // 收不到 pointerup 的手指要清掉（手指滑出畫面、被系統中斷都會發生）。
    // 不清的話它會一直留在記錄裡，下一次「單指拖曳」就被誤判成雙指縮放——
    // 症狀是想平移卻突然縮放，實際踩到過。
    const now = e.timeStamp || 0;
    for (const [id, p] of pointers) if (now - (p.t ?? 0) > 3000) pointers.delete(id);
    try { svg.setPointerCapture?.(e.pointerId); } catch { /* 不支援就算了 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    if (cam && pointers.size === 2) {
      const pts = [...pointers.values()];
      const m = mid(pts);
      pinch = { d: dist(pts), w: cam.w, h: cam.h, anchor: toBoard(m), screen: m };
      drag = null;
      return;                          // 兩指是在縮放，不要順便選子
    }
    if (cam) drag = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, moved: false };
    const id = nodeAt(e);
    if (id) onNodeClick(id);
  });
  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp || 0 });
    if (pinch && cam && pointers.size >= 2) {
      const pts = [...pointers.values()].slice(0, 2);
      const d = dist(pts);
      if (d < 1) return;
      const f = pinch.d / d;                       // 兩指張開＝f<1＝視野變小＝放大
      const r = svg.getBoundingClientRect();
      cam.w = pinch.w * f;
      cam.h = pinch.h * f;
      // 讓兩指中點壓著的那一點留在原地，縮放才不會亂飄
      cam.x = pinch.anchor.x - (pinch.screen.x - r.left) / r.width * cam.w;
      cam.y = pinch.anchor.y - (pinch.screen.y - r.top) / r.height * cam.h;
      camCustom = true;
      applyCam();
      return;
    }
    if (!drag || !cam) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
    drag.moved = true;
    const k = cam.w / r.width;
    cam.x = Math.min(Math.max(drag.camX - dx * k, 0), Math.max(0, W - cam.w));
    cam.y = Math.min(Math.max(drag.camY - dy * k, 0), Math.max(0, H - cam.h));
    applyCam();
  });
  const endDrag = (e) => {
    if (e?.pointerId != null) pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    const panned = drag?.moved;
    drag = null;
    return Boolean(panned);
  };
  svg.addEventListener('pointerup', (e) => {
    if (endDrag(e)) return;           // 剛剛是在拖動畫面，不是要走子
    const id = nodeAt(e);
    if (id) onPointerUp?.(id);
  });
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);
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
    // 分母要用**目前的** viewBox 寬度，不是整盤的 W：鏡頭拉近時同樣的螢幕寬度
    // 代表更大的格子，用 W 會算得太小，於是放大了文字還是被藏著。
    const vw = Number(svg.getAttribute('viewBox').split(' ')[2]) || W;
    const cellPx = (svg.getBoundingClientRect().width || 0) / vw * 42;
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

  // 鏡頭：'full' 是整個棋盤，'seat' 只框自己的陣地＋中央九宮。
  // 手機上整盤縮到 375px 時，一顆棋只有 20px（實測），手指點不準；
  // 只框自己那一區的話同一支手機上是 60px。代價是看不到另外兩家的細節，
  // 所以一定要配一顆切回全盤的按鈕，不能只給放大。
  // 三段大小（Lynch 指定：大／中／小都要能拖曳平移）。
  // 'small' 是整盤，本來就裝得下所以拖不動；'mid'、'big' 都可以拖。
  // force=true 是使用者按了大／中／小，才可以覆蓋他自己縮放出來的大小。
  // 每一步棋都會重畫，重畫時如果直接套回預設，玩家縮好的畫面就一直被拉回去
  //（Lynch：「我雙指縮放後，請維持我要的大」）。
  function setCamera(mode, force = false) {
    if (!force && camCustom && cam) { syncCompact(); return; }
    camCustom = false;
    if (mode !== 'seat' && mode !== 'mid' && mode !== 'big') {
      cam = null;
      svg.classList.remove('is-pannable');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      syncCompact();
      return;
    }
    const mine = `P${bottomSeat}-`;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of svg.querySelectorAll('rect.node-hit')) {
      const id = n.getAttribute('data-node');
      if (!id.startsWith(mine) && !id.startsWith('M-')) continue;
      const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + Number(n.getAttribute('width')));
      y1 = Math.max(y1, y + Number(n.getAttribute('height')));
    }
    if (x0 > x1) return;
    const pad = 18;
    // 「中」是「大」的 1.7 倍視野：看得到自己這邊＋左右兩家逼近的部分
    const f = mode === 'mid' ? 1.7 : 1;
    // 重新設鏡頭時只換大小，位置盡量沿用上一次拖到的地方，不要每走一步就跳回自己家
    const w = (x1 - x0 + pad * 2) * f, h = (y1 - y0 + pad * 2) * f;
    const keep = cam && Math.abs(cam.w - w) < 1 && Math.abs(cam.h - h) < 1;
    // 換大小時以自己的陣地為中心重新對焦；只是重畫（大小沒變）就留在原地
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    cam = {
      x: keep ? cam.x : cx - w / 2,
      y: keep ? cam.y : cy - h / 2,
      w, h,
    };
    svg.classList.add('is-pannable');
    applyCam();
  }

  return { render, animateMove, STEP_MS, setBottomSeat, setCamera,
    get bottomSeat() { return bottomSeat; } };
}

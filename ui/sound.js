// 音效：全部用 WebAudio 即時合成，不需要任何音檔。
// 設計目標（Lynch 指定的質感）：
//   移動＝鐵軌的匡噹聲、撞牆＝撞到冰塊的脆裂、吃掉＝併吞的吞噬感、
//   爆炸＝低頻爆裂、司令陣亡＝燈燈燈的警示音。
let ctx = null;
let enabled = true;
export const setEnabled = (v) => { enabled = v; };

const ac = () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

function tone({ freq, dur = 0.12, type = 'sine', gain = 0.18, sweepTo = null, at = 0 }) {
  const c = ac(), t = c.currentTime + at;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + dur + 0.03);
}

// 帶濾波的雜訊：撞擊、爆炸、鐵軌的底層都靠它
function burst({ dur = 0.16, gain = 0.25, freq = 900, type = 'lowpass', at = 0, q = 1, decay = 2 }) {
  const c = ac(), t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

const guard = (fn) => (...args) => { if (enabled) try { fn(...args); } catch { /* 音效失敗不該中斷遊戲 */ } };

// ── 每個事件都準備幾個版本，讓人試聽挑一個（選擇存在瀏覽器裡）──────────
// Lynch：「音效我要改，你多做幾個讓我挑。」
export const VARIANTS = {
  move: [
    { name: '鐵軌　匡噹匡噹（原本）', fn: (steps = 1, stepMs = 400) => {
      const n = Math.min(14, Math.max(1, steps)), gap = stepMs / 1000;
      for (let i = 0; i < n; i++) {
        burst({ dur: 0.05, gain: 0.13, freq: 2600, type: 'bandpass', q: 2.5, at: i * gap });
        tone({ freq: 150 + (i % 2) * 30, dur: 0.05, type: 'square', gain: 0.05, at: i * gap });
      }
    } },
    { name: '鐵軌　更像火車（雙軌接縫）', fn: (steps = 1, stepMs = 400) => {
      const n = Math.min(14, Math.max(1, steps)), gap = stepMs / 1000;
      for (let i = 0; i < n; i++) {
        const t = i * gap;
        // 一格兩響＝過兩道接縫，這是火車聲最關鍵的特徵
        burst({ dur: 0.035, gain: 0.16, freq: 1900, type: 'bandpass', q: 3.5, at: t });
        burst({ dur: 0.035, gain: 0.12, freq: 2400, type: 'bandpass', q: 3.5, at: t + 0.075 });
        tone({ freq: 92, dur: 0.09, type: 'square', gain: 0.07, at: t });
        tone({ freq: 74, dur: 0.07, type: 'square', gain: 0.05, at: t + 0.075 });
      }
    } },
    { name: '鐵軌　重載貨車（低沉）', fn: (steps = 1, stepMs = 400) => {
      const n = Math.min(14, Math.max(1, steps)), gap = stepMs / 1000;
      for (let i = 0; i < n; i++) {
        const t = i * gap;
        burst({ dur: 0.12, gain: 0.14, freq: 520, type: 'lowpass', at: t, decay: 2.2 });
        burst({ dur: 0.04, gain: 0.10, freq: 3200, type: 'bandpass', q: 4, at: t + 0.02 });
        tone({ freq: 58, dur: 0.14, type: 'sawtooth', gain: 0.08, at: t });
      }
    } },
  ],

  // 贏：吃掉對方。要「併吞」而且聽起來開心
  capture: [
    { name: '併吞　吸進去（原本）', fn: () => {
      tone({ freq: 900, dur: 0.26, type: 'sine', gain: 0.20, sweepTo: 180 });
      tone({ freq: 450, dur: 0.28, type: 'triangle', gain: 0.10, sweepTo: 90 });
      burst({ dur: 0.18, gain: 0.10, freq: 700, at: 0.06 });
    } },
    { name: '併吞　吸進去＋上揚小調（開心）', fn: () => {
      tone({ freq: 820, dur: 0.16, type: 'sine', gain: 0.16, sweepTo: 220 });
      burst({ dur: 0.14, gain: 0.10, freq: 800, at: 0.02 });
      // 吞完往上跳兩個音＝爽快
      tone({ freq: 659, dur: 0.10, type: 'triangle', gain: 0.15, at: 0.16 });
      tone({ freq: 988, dur: 0.20, type: 'triangle', gain: 0.16, at: 0.26 });
    } },
    { name: '併吞　咕嚕一大口（厚實）', fn: () => {
      tone({ freq: 620, dur: 0.30, type: 'sine', gain: 0.22, sweepTo: 120 });
      tone({ freq: 240, dur: 0.34, type: 'sawtooth', gain: 0.09, sweepTo: 60 });
      burst({ dur: 0.26, gain: 0.14, freq: 480, type: 'lowpass', at: 0.04, decay: 2 });
      tone({ freq: 880, dur: 0.16, type: 'triangle', gain: 0.12, at: 0.30 });
    } },
  ],

  // 輸：自己的棋子陣亡。撞到冰塊／金屬
  bounce: [
    { name: '撞冰塊　脆裂（原本）', fn: () => {
      burst({ dur: 0.09, gain: 0.32, freq: 5200, type: 'highpass', decay: 1 });
      tone({ freq: 2400, dur: 0.09, type: 'triangle', gain: 0.14, sweepTo: 900 });
      burst({ dur: 0.22, gain: 0.14, freq: 3400, type: 'highpass', at: 0.06, decay: 3 });
      tone({ freq: 320, dur: 0.16, type: 'sine', gain: 0.12, sweepTo: 150, at: 0.02 });
    } },
    { name: '撞金屬　鏘（鐵板）', fn: () => {
      [1840, 2790, 3610, 5230].forEach((f, i) =>
        tone({ freq: f, dur: 0.5 - i * 0.08, type: 'triangle', gain: 0.10 - i * 0.018 }));
      burst({ dur: 0.06, gain: 0.30, freq: 4200, type: 'highpass', decay: 1 });
      tone({ freq: 180, dur: 0.20, type: 'sine', gain: 0.14, sweepTo: 70, at: 0.01 });
    } },
    { name: '撞金屬　悶鈍（厚鐵塊）', fn: () => {
      burst({ dur: 0.10, gain: 0.34, freq: 900, type: 'lowpass', decay: 1.2 });
      tone({ freq: 620, dur: 0.28, type: 'triangle', gain: 0.13, sweepTo: 240 });
      tone({ freq: 155, dur: 0.30, type: 'sine', gain: 0.16, sweepTo: 60, at: 0.02 });
      burst({ dur: 0.30, gain: 0.08, freq: 1600, type: 'bandpass', q: 2, at: 0.05, decay: 3 });
    } },
  ],

  // 和：同歸於盡。跟炸彈一樣的爆炸聲
  explode: [
    { name: '爆炸　低頻長尾（原本）', fn: () => {
      burst({ dur: 0.5, gain: 0.45, freq: 320, type: 'lowpass', decay: 1.4 });
      tone({ freq: 110, dur: 0.42, type: 'sawtooth', gain: 0.26, sweepTo: 32 });
      burst({ dur: 0.7, gain: 0.16, freq: 180, type: 'lowpass', at: 0.05, decay: 2.5 });
    } },
    { name: '爆炸　更爆（前面帶炸裂）', fn: () => {
      burst({ dur: 0.05, gain: 0.5, freq: 6000, type: 'highpass', decay: 1 });
      burst({ dur: 0.6, gain: 0.45, freq: 260, type: 'lowpass', at: 0.02, decay: 1.3 });
      tone({ freq: 130, dur: 0.5, type: 'sawtooth', gain: 0.24, sweepTo: 28, at: 0.02 });
      burst({ dur: 0.9, gain: 0.14, freq: 150, type: 'lowpass', at: 0.10, decay: 3 });
    } },
  ],

  // 司令陣亡、軍旗顯露：要有威嚇感的「燈燈燈」
  alarm: [
    { name: '燈燈燈　三聲（原本）', fn: () => {
      [0, 0.26, 0.52].forEach((at, i) => {
        tone({ freq: 620 - i * 40, dur: 0.20, type: 'square', gain: 0.13, at });
        tone({ freq: 310 - i * 20, dur: 0.20, type: 'sine', gain: 0.10, at });
      });
    } },
    { name: '燈燈燈　命運式（威嚇，推薦）', fn: () => {
      // 三短一長、每一下都往下沉，聽起來像宣判
      [[0, 0.16], [0.20, 0.16], [0.40, 0.16]].forEach(([at]) => {
        tone({ freq: 392, dur: 0.16, type: 'square', gain: 0.16, at });
        tone({ freq: 196, dur: 0.16, type: 'sawtooth', gain: 0.12, at });
      });
      tone({ freq: 311, dur: 0.9, type: 'square', gain: 0.18, at: 0.62 });
      tone({ freq: 155, dur: 0.9, type: 'sawtooth', gain: 0.16, at: 0.62 });
      burst({ dur: 0.9, gain: 0.10, freq: 300, type: 'lowpass', at: 0.62, decay: 2 });
    } },
    { name: '燈燈燈　警報（尖銳）', fn: () => {
      [0, 0.30, 0.60].forEach((at) => {
        tone({ freq: 880, dur: 0.24, type: 'square', gain: 0.14, sweepTo: 660, at });
        tone({ freq: 440, dur: 0.24, type: 'square', gain: 0.10, sweepTo: 330, at });
      });
    } },
  ],

  // 滅掉一家：要有儀式感
  flag: [
    { name: '扛旗　上揚（原本）', fn: () => {
      tone({ freq: 300, dur: 0.55, type: 'sine', gain: 0.20, sweepTo: 1000 });
      tone({ freq: 600, dur: 0.55, type: 'triangle', gain: 0.10, sweepTo: 2000, at: 0.05 });
    } },
    { name: '滅一家　鑼聲＋號角（儀式感，推薦）', fn: () => {
      // 一聲鑼定住場面，再用號角宣告
      burst({ dur: 1.1, gain: 0.30, freq: 1400, type: 'bandpass', q: 1.2, decay: 2.4 });
      tone({ freq: 196, dur: 1.0, type: 'sawtooth', gain: 0.14, sweepTo: 150 });
      [[392, 0.34], [523, 0.52], [784, 0.72]].forEach(([f, at]) =>
        tone({ freq: f, dur: at === 0.72 ? 0.9 : 0.18, type: 'triangle', gain: 0.17, at }));
    } },
    { name: '滅一家　低沉宣告（莊重）', fn: () => {
      tone({ freq: 110, dur: 1.3, type: 'sawtooth', gain: 0.20, at: 0 });
      tone({ freq: 165, dur: 1.3, type: 'triangle', gain: 0.12, at: 0.04 });
      burst({ dur: 1.4, gain: 0.16, freq: 260, type: 'lowpass', at: 0.02, decay: 3 });
      tone({ freq: 330, dur: 0.7, type: 'triangle', gain: 0.14, at: 0.55 });
      tone({ freq: 440, dur: 0.9, type: 'triangle', gain: 0.14, at: 0.80 });
    } },
  ],
};

// Lynch 聽過所有版本後選的（2026-08-30）：移動2／吃掉2／陣亡2／爆炸1／司令2／滅家2。
// 這是**所有人的預設**——真實玩不給大家選，試聽面板改成只有 ?debug=1 才出現。
const DEFAULT_CHOICE = { move: 1, capture: 1, bounce: 1, explode: 0, alarm: 1, flag: 1 };

const CHOICE_KEY = 'army-online:sfx';
const loadChoice = () => {
  try { return { ...DEFAULT_CHOICE, ...JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') }; }
  catch { return { ...DEFAULT_CHOICE }; }
};
let choice = loadChoice();
export const getChoice = () => ({ ...choice });
export function setVariant(event, index) {
  choice[event] = index;
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* 存不下就只用這一次 */ }
}
// 試聽：不管目前選的是哪個，直接播指定的那一版
export const preview = (event, index) => {
  if (!enabled) return;
  try { VARIANTS[event]?.[index]?.fn(3, 320); } catch { /* 試聽失敗不影響遊戲 */ }
};
const pick = (event) => (...args) => {
  const list = VARIANTS[event];
  (list[choice[event] ?? 0] ?? list[0]).fn(...args);
};

export const SFX = {
  select: guard(() => tone({ freq: 860, dur: 0.05, type: 'sine', gain: 0.06 })),
  reject: guard(() => tone({ freq: 180, dur: 0.13, type: 'square', gain: 0.09 })),
  move: guard(pick('move')),
  bounce: guard(pick('bounce')),
  capture: guard(pick('capture')),
  explode: guard(pick('explode')),
  alarm: guard(pick('alarm')),
  flag: guard(pick('flag')),

  // 勝利：三連上行的號角
  victory: guard(() => {
    [[523, 0], [659, 0.16], [784, 0.32], [1046, 0.5]].forEach(([f, at]) =>
      tone({ freq: f, dur: at === 0.5 ? 0.75 : 0.2, type: 'triangle', gain: 0.18, at }));
  }),
  // 落敗：下行的低音
  defeat: guard(() => {
    [[392, 0], [330, 0.2], [262, 0.4]].forEach(([f, at]) =>
      tone({ freq: f, dur: at === 0.4 ? 0.8 : 0.24, type: 'sine', gain: 0.16, at }));
  }),
};

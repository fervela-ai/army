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

export const SFX = {
  select: guard(() => tone({ freq: 860, dur: 0.05, type: 'sine', gain: 0.06 })),
  reject: guard(() => tone({ freq: 180, dur: 0.13, type: 'square', gain: 0.09 })),

  // 移動：鐵軌的匡噹匡噹。每經過一格響一次，跟畫面上的腳步對齊。
  move: guard((steps = 1, stepMs = 400) => {
    const n = Math.min(14, Math.max(1, steps));
    const gap = stepMs / 1000;
    for (let i = 0; i < n; i++) {
      burst({ dur: 0.05, gain: 0.13, freq: 2600, type: 'bandpass', q: 2.5, at: i * gap });
      tone({ freq: 150 + (i % 2) * 30, dur: 0.05, type: 'square', gain: 0.05, at: i * gap });
    }
  }),

  // 撞牆：撞到冰塊——高頻脆裂 + 短促的碎裂尾巴
  bounce: guard(() => {
    burst({ dur: 0.09, gain: 0.32, freq: 5200, type: 'highpass', decay: 1 });
    tone({ freq: 2400, dur: 0.09, type: 'triangle', gain: 0.14, sweepTo: 900 });
    burst({ dur: 0.22, gain: 0.14, freq: 3400, type: 'highpass', at: 0.06, decay: 3 });
    tone({ freq: 320, dur: 0.16, type: 'sine', gain: 0.12, sweepTo: 150, at: 0.02 });
  }),

  // 吃掉：併吞——由高往低吸進去的滑音，收尾帶一點厚度
  capture: guard(() => {
    tone({ freq: 900, dur: 0.26, type: 'sine', gain: 0.20, sweepTo: 180 });
    tone({ freq: 450, dur: 0.28, type: 'triangle', gain: 0.10, sweepTo: 90 });
    burst({ dur: 0.18, gain: 0.10, freq: 700, at: 0.06 });
  }),

  // 爆炸／同歸於盡：低頻爆裂 + 長尾
  explode: guard(() => {
    burst({ dur: 0.5, gain: 0.45, freq: 320, type: 'lowpass', decay: 1.4 });
    tone({ freq: 110, dur: 0.42, type: 'sawtooth', gain: 0.26, sweepTo: 32 });
    burst({ dur: 0.7, gain: 0.16, freq: 180, type: 'lowpass', at: 0.05, decay: 2.5 });
  }),

  // 司令陣亡：燈—燈—燈 三聲警示
  alarm: guard(() => {
    [0, 0.26, 0.52].forEach((at, i) => {
      tone({ freq: 620 - i * 40, dur: 0.20, type: 'square', gain: 0.13, at });
      tone({ freq: 310 - i * 20, dur: 0.20, type: 'sine', gain: 0.10, at });
    });
  }),

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

  // 扛旗：勝負底定的上揚音
  flag: guard(() => {
    tone({ freq: 300, dur: 0.55, type: 'sine', gain: 0.20, sweepTo: 1000 });
    tone({ freq: 600, dur: 0.55, type: 'triangle', gain: 0.10, sweepTo: 2000, at: 0.05 });
  }),
};

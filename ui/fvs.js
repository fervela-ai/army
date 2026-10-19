// 匿名使用漏斗：瀏覽器以 <script type="module"> 載入。
const DAY_MS = 24 * 60 * 60 * 1000;
const RETURN_STEPS = [[1, '回訪_d1'], [7, '回訪_d7'], [30, '回訪_d30']];
let current = null;
let work = Promise.resolve();

function schedule(action) {
  work = work.then(action, action).catch(() => {});
  return work;
}

function taiwanDay(time) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayNumber(day) {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

function minuteBand(elapsed) {
  const minutes = Math.max(0, elapsed) / 60000;
  if (minutes < 1) return '<1';
  if (minutes < 5) return '1-5';
  if (minutes < 30) return '5-30';
  if (minutes < 1440) return '30-1440';
  return '>1440';
}

function readJSON(storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveQueue(state) {
  state.storage.setItem(state.prefix + 'queue', JSON.stringify(state.queue));
}

async function flush(state) {
  if (state.off || !state.queue.length) return;
  // 收集端只收 31 天內的；更舊的丟掉
  const oldest = taiwanDay(Date.now() - 31 * DAY_MS);
  state.queue = state.queue.filter((e) => e && e.date >= oldest).slice(-50);
  if (!state.queue.length) { saveQueue(state); return; }
  // 收集端每批最多 30 則、每分鐘 30 則：一次 flush 只送一批，剩下的等下次 init／step 再送
  const batch = state.queue.slice(0, 30);
  let response;
  try {
    // 不設標頭：字串 body 預設 text/plain，不觸發 CORS 預檢
    response = await fetch(state.endpoint, { method: 'POST', keepalive: true, body: JSON.stringify(batch) });
  } catch {
    return;
  }
  const status = response?.status;
  if (status === 410) {
    state.off = true;
    state.queue = [];
    state.storage.setItem(state.prefix + 'off', '1');
    state.storage.removeItem(state.prefix + 'queue');
    return;
  }
  // 204／2xx 收下；400 格式不對，整批丟掉不重送；429 與其他錯誤留著下次再送
  if (response?.ok || status === 400) {
    state.queue = state.queue.slice(batch.length);
    saveQueue(state);
  }
}

async function record(state, name) {
  if (state.off || state.sent.has(name)) return;
  const now = Date.now();
  const event = {
    product: state.product,
    version: state.version,
    platform: state.platform,
    step: name,
    mins: minuteBand(now - state.firstAt),
    date: taiwanDay(now),
  };
  state.sent.add(name);
  state.storage.setItem(state.prefix + 'sent', JSON.stringify([...state.sent]));
  if (name === '第一個成果') {
    state.storage.setItem(state.prefix + 'resultAt', String(now));
    state.resultAt = now;
  }
  state.queue.push(event);
  if (state.queue.length > 50) state.queue.splice(0, state.queue.length - 50);
  saveQueue(state);
  await flush(state);
}

const FervelaFunnel = {
  init(options) {
    return schedule(async () => {
      if (!options || typeof options.product !== 'string' ||
          typeof options.version !== 'string' || typeof options.platform !== 'string' ||
          typeof options.endpoint !== 'string' || !Array.isArray(options.allow)) return;
      const storage = globalThis.localStorage;
      const prefix = `ffunnel:${options.product}:`;
      const off = storage.getItem(prefix + 'off') === '1' || storage.getItem(prefix + 'optout') === '1';
      const storedFirst = storage.getItem(prefix + 'firstAt');
      const firstAt = storedFirst === null ? Date.now() : Number(storedFirst);
      if (!Number.isFinite(firstAt)) return;
      if (storedFirst === null && !off) storage.setItem(prefix + 'firstAt', String(firstAt));
      const state = {
        product: options.product,
        version: options.version,
        platform: options.platform,
        endpoint: options.endpoint,
        allow: new Set(options.allow),
        storage,
        prefix,
        firstAt,
        resultAt: Number(storage.getItem(prefix + 'resultAt')) || null,
        sent: new Set(readJSON(storage, prefix + 'sent', [])),
        queue: readJSON(storage, prefix + 'queue', []).slice(-50),
        off,
      };
      current = state;
      if (state.off) return;
      await flush(state);
      if (state.off) return;
      if (storedFirst === null && state.allow.has('首次打開')) await record(state, '首次打開');
      if (state.off || state.resultAt === null) return;
      const days = dayNumber(taiwanDay(Date.now())) - dayNumber(taiwanDay(state.resultAt));
      for (const [threshold, name] of RETURN_STEPS) {
        if (days >= threshold) await record(state, name);
      }
    });
  },
  // 設定頁的開關（法遵 10/16 建議：預設開）；關掉＝不再送、清暫存
  setEnabled(on) {
    return schedule(async () => {
      const state = current;
      if (!state) return;
      if (on) {
        state.storage.removeItem(state.prefix + 'optout');
        state.off = state.storage.getItem(state.prefix + 'off') === '1';
      } else {
        state.storage.setItem(state.prefix + 'optout', '1');
        state.storage.removeItem(state.prefix + 'queue');
        state.queue = [];
        state.off = true;
      }
    });
  },
  step(name) {
    return schedule(async () => {
      const state = current;
      if (!state || state.off) return;
      await flush(state);
      if (state.off || !state.allow.has(name)) return;
      await record(state, name);
    });
  },
};

if (typeof window !== 'undefined') window.FervelaFunnel = FervelaFunnel;

export { FervelaFunnel };
export default FervelaFunnel;

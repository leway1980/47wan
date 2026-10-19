// 遊戲狀態：整個遊戲就是一個可 JSON 序列化的物件（種子 + 目前進度）。
import { gauss, mulberry32 } from './rng.js';
import { generateIdentity } from './identity.js';
import { genPeers, newPeerCounts } from './peers.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'wan47.save.v1';
export const HABIT_DEFAULTS = { 零用錢: '花掉', 手機: 2, 睡前手機: false, 補習: 0, 運動: 0, 作業: '紙本', 遊戲: 0, 課堂: '跟著上' };
export const HW_MODES = ['紙本', '上網查', '開群組邊寫邊聊'];
export const CLASS_MODES = ['跟著上', '挑重點聽', '做自己的事', '放空', '補眠'];

// 開學時的習慣：不是玩家選的，是這個人原本的樣子；之後只會因為事件裡的選擇慢慢改變
export function startHabits(seed, identity) {
  const r = mulberry32((seed ^ 0x6b43a9b5) >>> 0);
  const h = { ...HABIT_DEFAULTS };
  const u = r();
  h.手機 = u < 0.2 ? 1 : u < 0.7 ? 2 : 3;
  h.遊戲 = r() < (identity.sex === '男' ? 0.45 : 0.25) ? 1 : 0;
  h.運動 = r() < 0.25 ? 1 : 0;
  return h;
}

export function newState(seed, data) {
  seed = seed >>> 0;
  const idn = data.identities;
  const identity = generateIdentity(seed, idn);
  const school = idn.schools.find((s) => s.id === identity.schoolId);
  const start = idn.econStart[identity.family.econ];
  const r = mulberry32((seed ^ 0x2545f491) >>> 0);
  const stats = {
    專注: 72, 理解: 42 + gauss(r) * 3, 體力: 80, 聯繫: 30, 知心: 1, 心情: 55, 幸福: 55,
    錢包: start.錢包, AI依賴: 0, 親子: { 放任: 50, 支持: 65, 高期待: 45, 自顧不暇: 40 }[identity.family.style] ?? 50, 投資: 0, 投資本金: 0, 睡眠債: 1, 牽掛: 0, 假熟悉: 0, 班級氣氛: 0.5, 興趣: 1.0, 資訊: identity.info, 露餡: 0,
  };
  for (const [k, v] of Object.entries(school.mod)) {
    if (k === '班級氣氛') stats[k] = v;
    else stats[k] += v;
  }
  const peers = genPeers(seed, data, identity.name);
  return {
    v: SAVE_VERSION, seed, turn: 0, rngS: (seed ^ 0xa5a5a5a5) >>> 0, peerS: (seed ^ 0x3c6ef372) >>> 0, autoS: (seed ^ 0x51ed270b) >>> 0, slotS: (seed ^ 0x7f4a7c15) >>> 0,
    identity, stats, habits: startHabits(seed, identity), flags: {}, cooldowns: {}, used: {},
    slotLast: {}, flavorSeen: {},
    delayed: [], deferred: [], majorCount: {}, choices: [], payoffs: [], luck: [], hist: [], logs: [],
    peers, peerCounts: newPeerCounts(), peerSnap: newPeerCounts(), peerFeed: [],
    recover: 0, dead: false, deathTurn: null, ended: false,
    gsat: null, final: null, outcome: null, examScores: [], quiz: [], reportPending: null, cur: null,
  };
}

export const serialize = (st) => JSON.stringify(st);
export const deserialize = (s) => {
  const st = JSON.parse(s);
  if (!st || st.v !== SAVE_VERSION) throw new Error('存檔版本不符');
  st.peerFeed ??= []; // 舊存檔沒有
  st.slotS ??= ((st.seed ^ 0x7f4a7c15) >>> 0); st.slotLast ??= {}; st.flavorSeen ??= {};
  return st;
};

export function visibleScore(st, rngAtFn) {
  // 分數 = 理解 +（補習帶來的）短期假熟悉 + 雜訊
  const noise = (rngAtFn(st.seed, st.turn, 'score') - 0.5) * 10;
  return Math.max(0, Math.min(100, Math.round(25 + st.stats.理解 * 0.75 + st.stats.假熟悉 * 0.6 + noise)));
}

export function focusPhrase(f) {
  if (f >= 75) return '上課很清醒';
  if (f >= 55) return '大部分時間跟得上';
  if (f >= 38) return '最近上課常恍神';
  return '腦袋像泡在霧裡';
}

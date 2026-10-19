// 遊戲狀態：整個遊戲就是一個可 JSON 序列化的物件（種子 + 目前進度）。
import { gauss, mulberry32 } from './rng.js';
import { generateIdentity } from './identity.js';
import { genPeers, newPeerCounts } from './peers.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'wan47.save.v1';
export const HABIT_DEFAULTS = { 零用錢: '花掉', 手機: 2, 睡前手機: false, 補習: 0, 運動: 0, 作業: '紙本', 遊戲: 0, 課堂: '跟著上' };
export const HW_MODES = ['紙本', '上網查', '開群組邊寫邊聊'];
export const CLASS_MODES = ['跟著上', '挑重點聽', '做自己的事', '放空', '補眠'];

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
    v: SAVE_VERSION, seed, turn: 0, rngS: (seed ^ 0xa5a5a5a5) >>> 0, peerS: (seed ^ 0x3c6ef372) >>> 0,
    identity, stats, habits: { ...HABIT_DEFAULTS }, flags: {}, cooldowns: {}, used: {},
    delayed: [], deferred: [], majorCount: {}, choices: [], luck: [], hist: [], logs: [],
    peers, peerCounts: newPeerCounts(), peerSnap: newPeerCounts(),
    recover: 0, dead: false, deathTurn: null, ended: false,
    gsat: null, final: null, outcome: null, examScores: [], quiz: [], reportPending: null, cur: null,
  };
}

export const serialize = (st) => JSON.stringify(st);
export const deserialize = (s) => {
  const st = JSON.parse(s);
  if (!st || st.v !== SAVE_VERSION) throw new Error('存檔版本不符');
  return st;
};

export function visibleScore(st, rngAtFn) {
  // 分數 = 理解 +（補習帶來的）短期假熟悉 + 雜訊
  const noise = (rngAtFn(st.seed, st.turn, 'score') - 0.5) * 10;
  return Math.max(0, Math.min(100, Math.round(st.stats.理解 * 0.85 + st.stats.假熟悉 * 0.6 + noise)));
}

export function focusPhrase(f) {
  if (f >= 75) return '上課很清醒';
  if (f >= 55) return '大部分時間跟得上';
  if (f >= 38) return '最近上課常恍神';
  return '腦袋像泡在霧裡';
}

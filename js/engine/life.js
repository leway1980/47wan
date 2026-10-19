// 真實機率的人生事件（交通）。資料來自 data/life_events.json，機率換算見設計稿 LIFE_EVENTS.md。
import { rngAt, pickKey } from './rng.js';

export const DEATH_LINE = '因為一場車禍，你短暫而璀璨的人生，畫上了休止符。';
export const COMMUTE_DAYS_PER_TURN = 10;

/** 這個通勤方式屬於該事件的哪個風險族群；不在任何族群就回傳 null。 */
export function groupOf(ev, commute) {
  const g = ev.risk_groups;
  switch (ev.id) {
    case 'traffic_death_teen': return commute === '無照騎機車' ? '無照騎機車' : '其他';
    case 'micro_escooter_crash': return commute === '微電車' ? '騎微電車' : null;
    case 'slow_vehicle_casualty': return commute === '腳踏車' || commute === '微電車' ? '騎慢車' : null;
    case 'unlicensed_penalty': return commute === '無照騎機車' ? '無照騎機車' : null;
    default: return Object.keys(g)[0] && null;
  }
}

export const yearProb = (ev, group) => (group ? ev.risk_groups[group].annual_prob_if_in_group : 0);
/** p = 1 − (1 − p_year)^(commuteDays/180) */
export const turnProb = (pYear, commuteDays) => 1 - Math.pow(1 - pYear, commuteDays / 180);

export function lifeProbTable(commute, events, commuteDays = COMMUTE_DAYS_PER_TURN) {
  return events.map((ev) => {
    const group = groupOf(ev, commute);
    const pYear = yearProb(ev, group);
    return { id: ev.id, group, pYear, pTurn: turnProb(pYear, commuteDays) };
  });
}

export function rollSeverity(ev, u) {
  if (ev.id === 'traffic_death_teen') return '死亡';
  if (!ev.severity) return '輕傷';
  let x = u;
  for (const [k, p] of Object.entries(ev.severity)) {
    if (x < p) return k;
    x -= p;
  }
  return Object.keys(ev.severity)[0];
}
export const isMajor = (sev) => sev === '住院' || sev === '重傷休學' || sev === '死亡';

const VEHICLE = { 腳踏車: '腳踏車', 微電車: '微型電動二輪車', 無照騎機車: '機車', 其他: '' };

/** 把一次發生轉成要顯示的卡片＋要套用的效果。 */
export function describeOutcome(ev, sev, commute) {
  const veh = VEHICLE[commute] || '車';
  const tw = ev.display;
  if (sev === '死亡') {
    return { id: ev.id, title: '一場意外', text: DEATH_LINE, taiwan: tw, death: true };
  }
  if (ev.id === 'unlicensed_penalty') {
    return {
      id: ev.id, title: '被攔查了', taiwan: tw, sev: '開罰',
      text: '放學路上，你被警察攔下來查驗，沒有駕照，開了罰單。罰單寄到家裡，爸媽收到了。',
      effects: { 錢包: -500, 心情: -10 }, hidden: { 幸福: -2 }, flags: ['被開過罰單'],
    };
  }
  const base = { id: ev.id, title: '一場事故', taiwan: tw, sev };
  if (sev === '輕傷') return { ...base, text: `騎${veh}上學時，在路口被一台轉彎的車擦撞，手肘和膝蓋破皮，貼了好幾天紗布。`, effects: { 體力: -8, 心情: -6 }, hidden: {} };
  if (sev === '住院') return { ...base, text: `騎${veh}上學時，你被撞倒了，送到醫院檢查後住院觀察，骨折了。醫生說要休養幾個禮拜，課也落下了一些。`, effects: { 體力: -25, 心情: -12, 錢包: -800 }, hidden: { 理解: -2, 專注: -8 }, recover: 1 };
  return { ...base, text: `騎${veh}上學時發生了很嚴重的事故。你住院、開刀，復健了好幾個月，不得不暫時離開學校。`, effects: { 體力: -40, 心情: -25, 錢包: -2000 }, hidden: { 理解: -6, 專注: -12, 幸福: -5 }, recover: 3 };
}

/**
 * 判定這一回合玩家的人生事件。
 * 運氣由 (種子, 回合, 事件id) 決定，和玩家選擇無關；重大事件每學期最多一件，超過的順延不丟棄。
 * 回傳 outcome 陣列（尚未套用）。
 */
export function checkLife(st, data, tl) {
  const out = [];
  const days = tl.vacation ? 0 : COMMUTE_DAYS_PER_TURN;
  const semKey = `${tl.year}-${tl.seg}`;
  if (days > 0) {
    for (const ev of data.life.events) {
      const group = groupOf(ev, st.identity.commute);
      if (!group) continue;
      const p = turnProb(yearProb(ev, group), days);
      if (rngAt(st.seed, st.turn, ev.id) < p) {
        const sev = rollSeverity(ev, rngAt(st.seed, st.turn, ev.id + ':sev'));
        st.deferred.push({ id: ev.id, sev, commute: st.identity.commute, from: st.turn });
      }
    }
  }
  if (tl.vacation) return out;
  const rest = [];
  for (const occ of st.deferred) {
    const major = isMajor(occ.sev);
    if (major && ((st.majorCount[semKey] || 0) >= 1 || out.some((o) => o.major))) { rest.push(occ); continue; }
    const ev = data.life.byId[occ.id];
    const o = describeOutcome(ev, occ.sev, occ.commute);
    o.major = major;
    o.deferredFrom = occ.from;
    if (major) st.majorCount[semKey] = (st.majorCount[semKey] || 0) + 1;
    out.push(o);
  }
  st.deferred = rest;
  return out;
}

export function groupLabelForReport(commute, events) {
  return lifeProbTable(commute, events, 180);
}

export { pickKey };

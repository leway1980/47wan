// 回合引擎：習慣 → 固定劇情 → 延遲佇列 → 人生事件 → 抽卡 → 選擇 → 同儕 → 紀錄。純函式、無 DOM。
import { stateRng, rngAt, gauss, pickWeighted, clamp } from './rng.js';
import { buildCtx, drawCard, describeCard, applyChoice, applyEffects, cardById, evalCond, compile, passes } from './events.js';
import { checkLife, DEATH_LINE } from './life.js';
import { stepPeers } from './peers.js';
import { computeOutcome, semesterReport, formatDate, formatDateLong } from './report.js';

export const TOTAL_TURNS = 72;
const DAY = 86400000;
export { formatDate, formatDateLong };

/* ───────────── 日曆 ───────────── */
export function buildTimeline(cal) {
  const y0 = parseInt(cal.startDate.slice(0, 4), 10);
  const segs = [];
  for (let k = 0; k < cal.years; k++) {
    for (const s of cal.segments) {
      const [mm, dd] = s.start.split('-').map(Number);
      const yr = mm >= 8 ? y0 + k : y0 + k + 1;
      segs.push({ ...s, year: k + 1, t0: Date.UTC(yr, mm - 1, dd) });
    }
  }
  segs[0].t0 = Date.parse(cal.startDate + 'T00:00:00Z');
  const lastEnd = Date.UTC(y0 + cal.years, 7, 31);
  const tls = [];
  segs.forEach((s, si) => {
    const next = si + 1 < segs.length ? segs[si + 1].t0 : lastEnd;
    const span = (next - s.t0) / DAY;
    for (let i = 0; i < s.turns; i++) {
      const a = s.t0 + Math.floor((i * span) / s.turns) * DAY;
      const b = i + 1 < s.turns ? s.t0 + Math.floor(((i + 1) * span) / s.turns) * DAY : next;
      tls.push({ turn: tls.length, year: s.year, seg: s.name, idx: i, vacation: s.vacation, start: a, end: b, days: Math.round((b - a) / DAY) });
    }
  });
  for (const tl of tls) {
    tl.fixed = cal.fixed.filter((f) => (f.year === undefined || f.year === tl.year) && f.seg === tl.seg && f.idx === tl.idx);
    tl.exam = tl.fixed.some((f) => f.kind === 'exam');
  }
  for (let i = 0; i < tls.length; i++) {
    const nx = tls[i + 1];
    tls[i].examWeek = tls[i].exam || !!(nx && nx.seg === tls[i].seg && nx.year === tls[i].year && nx.exam);
  }
  return tls;
}

export function prepareData(raw) {
  const cardIndex = {};
  for (const c of raw.events.cards) {
    if (cardIndex[c.id]) throw new Error('重複的事件卡 id: ' + c.id);
    cardIndex[c.id] = c;
  }
  const life = { events: raw.life_events.events, byId: Object.fromEntries(raw.life_events.events.map((e) => [e.id, e])) };
  return { identities: raw.identities, events: raw.events, calendar: raw.calendar, life, cardIndex, timeline: buildTimeline(raw.calendar) };
}

/* ───────────── 習慣自動結算 ───────────── */
const CLASS_F = { 跟著上: 1, 挑重點聽: 0.75, 做自己的事: 0.35, 放空: 0.25, 補眠: 0.1 };
const ATMOS_D = { 跟著上: 0.008, 挑重點聽: 0, 做自己的事: -0.008, 放空: -0.004, 補眠: -0.012 };
const HW_F = { 紙本: 1, 上網查: 0.75, 開群組邊寫邊聊: 0.6 };
const PHONE_LINK = [-1.5, 0, 1.5, 3, 3];
const PHONE_MOOD = [-4, 0, 4, 4, 4];
const PHONE_FOCUS = [0, 0, 2, 5, 9];
const PHONE_HAPPY = [-0.5, 0.3, 0.3, -0.2, -0.6];
const COVER = { 自己就是資源: 0.4, 花錢買資源: 0.7, 自己找資源: 0 };

export function applyHabits(st, data, tl, r) {
  const S = st.stats, H = st.habits, id = st.identity, idn = data.identities, fam = id.family;
  const vac = tl.vacation, len = vac ? 2 : 1;
  const lines = [];
  /* 錢 */
  const econ = idn.econStart[fam.econ];
  const costPer = 600 * (1 - Math.min(0.9, COVER[fam.support] + { 寬裕: 0.3, 小康: 0.1, 吃緊: 0 }[fam.econ])) * len;
  const income = econ.allowance * len * (vac ? 0.8 : 1) + (st.flags.打工中 ? (vac ? 1800 : 900) : 0);
  const other = [0, 0, 80, 200][H.遊戲] * len + [0, 0, 0, 40, 80][H.手機] * len;
  const avail = S.錢包 + income;
  let cram = H.補習;
  while (cram > 0 && avail - cram * costPer - other < 0) cram--;
  if (cram < H.補習) { H.補習 = cram; lines.push('錢包撐不住了，補習班先停掉了幾科。'); }
  S.錢包 = Math.max(0, Math.round(avail - cram * costPer - other));

  /* 時間：可自己運用的小時數 */
  const commH = vac ? 0 : idn.commuteHours[id.commute];
  const club = st.flags.社團中 ? 3 : 0;
  const work = st.flags.打工中 ? (vac ? 14 : 7) : 0;
  let selfHours = (vac ? 40 : 22) - commH - cram * 3 - H.遊戲 * 2.5 - H.運動 * 2 - club - work - (H.手機 >= 3 ? 2 : 0);
  if (H.作業 === '上網查' && r() < 0.3) selfHours -= 1; // 順便看了一下訊息或影片
  selfHours = Math.max(1, selfHours);

  /* 學習 = 時間 × 專注 × 消化比例 × 興趣 */
  const focus = S.專注 / 100, interest = S.興趣;
  const atmos = 0.85 + 0.3 * S.班級氣氛;
  const classPart = vac ? 0 : 40 * focus * 0.35 * CLASS_F[H.課堂] * atmos * interest;
  const own = H.課堂 === '做自己的事' && !vac ? 3 : 0;
  const selfPart = (selfHours + own) * focus * HW_F[H.作業] * interest;
  const cramPart = cram * 3.5 * focus * 0.4 * interest;
  const learn = classPart + cramPart + selfPart;
  const recov = st.recover > 0 ? 0.35 : 1;
  const gain = learn * 0.15 * (1 - S.理解 / 170) * recov;
  S.理解 = clamp(S.理解 + gain - S.理解 * 0.03 * len, 0, 100);
  S.假熟悉 = clamp(S.假熟悉 * 0.65 + Math.max(0, cram * 3 - selfHours * 0.25) * 0.8, 0, 30);
  if (H.作業 === '開群組邊寫邊聊') { S.聯繫 += 1; S.心情 += 1; }
  if (!vac && H.課堂 === '跟著上' && r() < 0.06) S.興趣 = clamp(S.興趣 + 0.03, 0.8, 1.2);
  if (!vac && (H.課堂 === '放空' || H.課堂 === '補眠')) S.興趣 = clamp(S.興趣 - 0.01, 0.8, 1.2);
  S.班級氣氛 = clamp(S.班級氣氛 + (vac ? 0 : ATMOS_D[H.課堂]) + (0.5 - S.班級氣氛) * 0.02, 0, 1);

  /* 睡眠債：流入 − 自然恢復 */
  const bed = H.睡前手機 || H.手機 >= 4;
  const inflow = 0.15 + (bed ? 0.8 : 0) + cram * 0.15 + H.遊戲 * 0.15 + (tl.examWeek ? 0.4 : 0) + (st.flags.打工中 ? 0.4 : 0) - H.運動 * 0.1 + fam.sleep + (H.課堂 === '補眠' && !vac ? -0.6 : 0);
  S.睡眠債 = clamp(S.睡眠債 + (inflow - 0.25 * S.睡眠債) * len, 0, 10);

  /* 牽掛（遊戲） */
  S.牽掛 = clamp(S.牽掛 + [0, 0.4, 0.8, 1.4][H.遊戲] + (H.手機 >= 3 ? 0.1 : 0) - 0.15 * S.牽掛 - (H.遊戲 === 0 ? 0.2 : 0), 0, 10);

  /* 專注（隱藏）：睡眠、手機、牽掛、運動、體力共同決定，帶慣性 */
  const fTarget = 90 - S.睡眠債 * 4 - PHONE_FOCUS[H.手機] - S.牽掛 * 2.2 + H.運動 * 3 - Math.max(0, 40 - S.體力) * 0.3;
  S.專注 = clamp(0.5 * S.專注 + 0.5 * fTarget + gauss(r) * 2, 15, 100);

  /* 體力 */
  const tTarget = 85 - S.睡眠債 * 4.5 + H.運動 * 5 - cram * 3 - work * 0.5 - Math.max(0, commH - 6) * 0.8 - H.遊戲 * 1.5;
  S.體力 = clamp(0.5 * S.體力 + 0.5 * tTarget + (H.課堂 === '放空' ? 2 : 0), 5, 100);

  /* 心情（短期、跳動大）與幸福（長期、隱藏） */
  const mTarget = 50 + PHONE_MOOD[H.手機] + H.運動 * 3 - S.睡眠債 * 1.5 + (S.知心 - 2) * 2.5 + [0, 0, 1, 3][H.遊戲] + gauss(r) * 5 - cram * 2 + (st.flags.交往中 ? 6 : 0) - (S.體力 < 35 ? 5 : 0) - (tl.examWeek ? 4 : 0);
  S.心情 = clamp(0.4 * S.心情 + 0.6 * mTarget, 0, 100);
  const noise = 0.7 + 0.6 * r();
  const hDelta = 2 * (PHONE_HAPPY[H.手機] * noise + 0.2 * (S.知心 - 2) + 0.3 * H.運動 - 0.12 * (S.睡眠債 - 2) - 0.3 * Math.max(0, cram - 1) - 0.05 * S.牽掛 + (st.flags.交往中 ? 0.2 : 0) + (st.flags.社團中 ? 0.15 : 0));
  S.幸福 = clamp(S.幸福 + hDelta * len - (S.幸福 - 50) * 0.08, 0, 100);

  /* 人際 */
  S.聯繫 = clamp(S.聯繫 + (PHONE_LINK[H.手機] + (cram > 0 ? 0.5 : 0) + (st.flags.社團中 ? 1 : 0) + (H.遊戲 > 0 ? 0.5 : 0)) * len - (S.聯繫 - 15) * 0.12, 0, 100);
  S.知心 = clamp(S.知心 + (S.聯繫 > 35 ? 0.04 : 0) + (st.flags.交往中 ? 0.03 : 0) - (S.知心 > 1 ? 0.07 : 0.02), 0, 5);
  return lines;
}

/* ───────────── 固定劇情（考試等） ───────────── */
function runFixed(st, data, tl, f, r, out) {
  const S = st.stats;
  if (f.kind === 'exam') {
    const score = clamp(Math.round(S.理解 * 0.85 + S.假熟悉 * 0.6 - S.睡眠債 * 0.8 + gauss(r) * 5), 0, 100);
    st.examScores.push(score);
    S.心情 = clamp(S.心情 + clamp((score - 60) / 8, -5, 5), 0, 100);
    S.睡眠債 = clamp(S.睡眠債 + 0.3, 0, 10);
    out.lines.push({ d: 1, text: `${f.name}成績出來了：平均 ${score} 分。` });
  } else if (f.kind === 'gsat') {
    const s = clamp(S.理解 * 0.9 + S.假熟悉 * 0.3 - S.睡眠債 * 0.8 + gauss(r) * 5, 0, 100);
    st.gsat = s;
    const lv = Math.round(s * 0.75);
    out.notices.push({ kind: 'info', title: '學測', text: `一月的兩天考試結束了。放榜那天，五科合計 ${lv} 級分（滿分 75）。接下來是準備申請入學的資料和面試。` });
    out.lines.push({ d: 1, text: `學測成績出爐：${lv} 級分。` });
  } else if (f.kind === 'apply') {
    const portfolio = (st.flags['社團:科學'] ? 2 : 0) + (st.flags['社團:音樂'] ? 2 : 0) + (st.flags['社團:運動'] ? 2 : 0) + (st.flags.去過營隊 ? 3 : 0) + (st.flags.社團中 ? 1 : 0);
    const penalty = S.露餡 >= 2 ? 4 : 0;
    st.final = (st.gsat ?? S.理解) + Math.min(portfolio, 6) - penalty + gauss(r) * 4;
    st.outcome = computeOutcome(st, data);
    const o = st.outcome;
    let t = `放榜日，你的申請結果出來了：${o.text}`;
    if (penalty) t += ' 面試時教授問起你學習歷程裡寫過的內容，你答得有點吃力。';
    out.notices.push({ kind: 'info', title: '放榜', text: t });
    out.lines.push({ d: 1, text: '申請入學放榜了。' });
  } else if (f.kind === 'fenke') {
    out.notices.push({ kind: 'info', title: '高中最後一個暑假', text: st.outcome && st.outcome.retake ? '你決定重考一年，在補習班租了一個位子。' : '分科測驗和登記分發都有了結果，你要去的地方已經確定了。你開始整理行李，也想起三年來的很多人。' });
  }
}

/* ───────────── 開始回合 ───────────── */
export function startTurn(st, data) {
  if (st.ended || st.dead) throw new Error('遊戲已結束');
  if (st.cur) throw new Error('上一個回合尚未結束');
  const tl = data.timeline[st.turn];
  const r = stateRng(st);
  const cur = { tl, lines: [], notices: [], card: null, cardView: null, ctx: null };
  st.cur = cur;
  if (!tl.vacation && tl.idx === 0 && st.flags.打工中 && !st.flags.長期打工) delete st.flags.打工中; // 暑期打工結束

  for (const l of applyHabits(st, data, tl, r)) cur.lines.push({ d: 2, text: l });

  // 2. 固定劇情
  for (const f of tl.fixed) {
    if (f.kind === 'card') { if (!cur.card && !(st.used[f.event])) cur.card = cardById(data, f.event); }
    else runFixed(st, data, tl, f, r, cur);
  }
  // 3. 延遲佇列
  if (!cur.card) {
    const k = st.delayed.findIndex((d) => d.due <= st.turn);
    if (k >= 0) { cur.card = cardById(data, st.delayed[k].event); st.delayed.splice(k, 1); }
  }
  // 4. 人生事件
  const outcomes = checkLife(st, data, tl);
  for (const o of outcomes) {
    cur.notices.push({ kind: 'life', title: o.title, text: o.text, taiwan: o.taiwan, death: !!o.death });
    st.luck.push({ turn: st.turn, text: o.death ? '一場車禍' : o.sev === '開罰' ? '無照騎車被攔查開罰' : `通勤事故（${o.sev}）`, tw: o.taiwan });
    if (o.death) { st.dead = true; st.deathTurn = st.turn; break; }
    applyEffects(st, o.effects); applyEffects(st, o.hidden);
    for (const f of o.flags || []) st.flags[f] = true;
    if (o.recover) st.recover = Math.max(st.recover, o.recover);
    cur.lines.push({ d: 2, text: o.sev === '開罰' ? '無照騎車被警察攔下，開了罰單。' : `通勤途中發生事故（${o.sev}），需要好好休養。` });
  }
  if (st.dead) { cur.ctx = null; return { tl, notices: cur.notices, card: null, dead: true }; }
  // 5. 一般抽卡
  const ctx = buildCtx(st, tl);
  cur.ctx = ctx;
  if (!cur.card && r() < (tl.vacation ? 0.85 : 0.7)) cur.card = drawCard(st, data, ctx, r);
  cur.cardView = cur.card ? describeCard(cur.card, st, ctx) : null;
  return { tl, notices: cur.notices, card: cur.cardView, dead: false };
}

/** 玩家選了某個選項 */
export function chooseCard(st, data, idx) {
  const cur = st.cur;
  if (!cur || !cur.card) throw new Error('目前沒有事件卡');
  const r = stateRng(st);
  const { line } = applyChoice(st, data, cur.card, idx, cur.ctx, r, st.turn);
  if (line) cur.lines.push({ d: 0, text: line });
  cur.cardTitle = cur.card.title;
  cur.card = null; cur.cardView = null;
  return { line };
}

/** 倒數模式或略過：照目前習慣過，不選。 */
export function skipCard(st) {
  const cur = st.cur;
  if (!cur || !cur.card) return;
  cur.lines.push({ d: 0, text: '你沒有選，所以照平常的你過了這兩週。' });
  cur.card = null; cur.cardView = null;
}

/* ───────────── 結束回合 ───────────── */
function flavorLines(st, data, tl, r, n) {
  const ctx = buildCtx(st, tl);
  const pool = data.calendar.flavor.filter((f) => evalCond(f.if, ctx));
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const f = pickWeighted(r, pool);
    out.push(f.text);
    pool.splice(pool.indexOf(f), 1);
  }
  return out;
}

export function finishTurn(st, data) {
  const cur = st.cur;
  if (!cur) throw new Error('沒有進行中的回合');
  if (cur.card) skipCard(st);
  const tl = cur.tl;
  const r = stateRng(st);
  const news = stepPeers(st, data, tl);
  const lines = cur.lines.slice();
  if (news.length) lines.push({ d: 3, text: news[Math.floor(r() * news.length)] });
  const want = 2 + Math.floor(r() * 3);
  const fl = flavorLines(st, data, tl, r, Math.max(1, Math.min(2, want - lines.length)));
  for (const t of fl) lines.push({ d: 1, text: t });
  // 最多 4 行（優先保留卡片結果與考試）
  while (lines.length > 4) {
    const i = lines.findIndex((l) => l.d === 1 && fl.includes(l.text));
    lines.splice(i >= 0 ? i : lines.length - 1, 1);
  }
  // 安排日期：d=0 為本回合第一天，其餘隨機散開、排序
  const days = Math.max(2, tl.days);
  const fixedFirst = lines.filter((l) => l.d === 0);
  const rest = lines.filter((l) => l.d !== 0);
  const offs = rest.map(() => 1 + Math.floor(r() * (days - 1))).sort((a, b) => a - b);
  const sched = [...fixedFirst.map((l) => ({ day: 0, text: l.text })), ...rest.map((l, i) => ({ day: offs[i], text: l.text }))];
  sched.sort((a, b) => a.day - b.day);

  const S = st.stats, H = st.habits;
  st.hist.push({
    t: st.turn, 專注: +S.專注.toFixed(1), 睡眠債: +S.睡眠債.toFixed(2), 心情: +S.心情.toFixed(1), 幸福: +S.幸福.toFixed(1),
    理解: +S.理解.toFixed(1), 聯繫: +S.聯繫.toFixed(1), 知心: +S.知心.toFixed(2), 牽掛: +S.牽掛.toFixed(2), 體力: +S.體力.toFixed(1),
    h: [H.手機, H.睡前手機 ? 1 : 0, H.補習, H.運動, H.遊戲], c: cur.cardTitle || null,
  });
  st.logs.push({ turn: st.turn, lines: sched });
  if (st.logs.length > 30) st.logs.shift();
  if (st.recover > 0) st.recover--;

  const dead = st.dead;
  const finished = tl;
  st.turn++;
  st.cur = null;
  let report = null;
  if (dead) { st.ended = true; }
  else {
    if (st.turn >= TOTAL_TURNS) { st.ended = true; if (!st.outcome) st.outcome = computeOutcome(st, data); }
    if ((finished.seg === '上學期' || finished.seg === '下學期') && finished.idx === 9 && !st.ended) {
      report = semesterReport(st, data, finished);
      st.reportPending = report;
    }
  }
  return { tl: finished, lines: sched, report, ended: st.ended, dead };
}

/** 學期報告的「先猜再揭曉」：記錄玩家的猜測 */
export function answerQuiz(st, guess) {
  const rp = st.reportPending;
  if (!rp) return null;
  st.quiz.push({ sem: rp.title, guess, answer: rp.quiz.answer });
  return rp.quiz.answer;
}
export function clearReport(st) { st.reportPending = null; }

/* ───────────── 自動遊玩（測試與模擬用） ───────────── */
export function playTurn(st, data, policy) {
  const tl = data.timeline[st.turn];
  if (policy && policy.habits) policy.habits(st, tl);
  const res = startTurn(st, data);
  if (!res.dead && res.card) {
    const idx = policy && policy.choose ? policy.choose(st, res.card) : res.card.choices.find((c) => !c.disabled).i;
    chooseCard(st, data, idx);
  }
  const fin = finishTurn(st, data);
  if (st.reportPending) clearReport(st);
  return fin;
}

export function playToEnd(st, data, policy) {
  let guard = 0;
  while (!st.ended && guard++ < 200) playTurn(st, data, policy);
  return st;
}

export { DEATH_LINE };

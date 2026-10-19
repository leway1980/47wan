// 終局人生：22／25／30 歲與「好的／遺憾」由 data/endings.json 的條件句庫組合而成。純函式，無 DOM。
// 條件語言與事件卡相同（events.js 的 evalCond），環境是 endingCtx。
import { mulberry32, hashStr, pickWeighted } from './rng.js';
import { evalCond } from './events.js';
import { effectiveEcon } from './family.js';

// 25～30 歲之間的人生轉折會在 30 歲條件裡變成旗標，讓「工作」「人際感情」兩段不跟轉折打架
export const TURN_TAGS = ['公職', '創業', '讀研', '轉職', '裁員', '升主管', '出國', '回鄉', '換城市', '結婚', '同居', '單身', '貓狗', '照顧家人', '生子', '買房', '健康'];
export const WORK_TAGS = ['公職', '創業', '讀研', '轉職', '裁員', '升主管', '出國'];
export const LOVE_TAGS = ['結婚', '同居', '單身', '生子'];
export const FACETS = { 22: ['學業或工作', '生活', '人際'], 25: ['工作', '身體', '錢', '人際感情', '住處與家人'], 30: ['工作', '身體', '錢', '人際感情', '自評'] };
export const ENDING_PLACEHOLDERS = ['姓名', '朋友', '科系', '縣市', '學校', '群'];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const everSet = (st, names) => names.some((f) => st.flags[f]) || (st.choices || []).some((c) => (c.fl || []).some((f) => names.includes(f)));

/** 終局條件環境。outcome 可省（取 st.outcome）。 */
export function endingCtx(st, data, outcome, archetype = '') {
  const o = outcome || st.outcome || {}, id = st.identity, S = st.stats, fam = id.family, hs = st.hist || [];
  const col = (k) => mean(hs.map((h) => h.h[k]));
  const share = (k, val) => (hs.length ? hs.filter((h) => h.h[k] === val).length / hs.length : 0); // 零用錢習慣各模式的占比
  const fh = st.famHistory || [];
  const tags = Object.fromEntries(TURN_TAGS.map((t) => [t, false]));
  const work = o.type === '直接就業';
  return {
    原型: archetype, 去向: o.type || '', 科系: work || o.retake ? '' : o.dept || '', 技高: id.kind === '技高', 群: id.vocGroup || o.group || '',
    普高: id.kind !== '技高', 國立: /^國立/.test(o.type || ''), 科大: /科大|科技大學/.test(o.type || ''), 明星: id.schoolTier === 'star' || id.schoolTier === 'pstar',
    都會: id.tier === '六都' && /區$/.test(id.district || ''), 縣市: id.county, 家庭: fam.structure, 經濟: effectiveEcon(st), 職業: fam.job, 性別: id.sex,
    理解: S.理解, 專注: S.專注, 睡眠債: S.睡眠債, 幸福: mean(hs.map((h) => h.幸福)), 心情: mean(hs.map((h) => h.心情)),
    聯繫: S.聯繫, 知心: S.知心, 體力: S.體力, 錢包: S.錢包 || 0, 投資: S.投資 || 0, 存款: (S.錢包 || 0) + (S.投資 || 0), AI依賴: S.AI依賴 ?? 0, 露餡: S.露餡 ?? 0,
    存下比: share(5, 1), 投資比: share(5, 2), 花掉比: share(5, 0), 花費次數: (st.choices || []).filter((c) => c.spend).length,
    手機: col(0), 睡前手機比: hs.length ? hs.filter((h) => h.h[1]).length / hs.length : 0, 運動: col(3), 補習: col(2), 遊戲: col(4),
    交往過: !!st.partner || everSet(st, ['交往中', '分手過', '偷偷交往']), 分手過: everSet(st, ['分手過']), 被騙: (st.scams || []).length > 0,
    受傷: (st.luck || []).some((l) => /通勤事故/.test(l.text)), 寵物: !!st.flags.寵物, 打工: everSet(st, ['打工中', '長期打工', '打工加班']),
    證照: !!st.flags.報名證照, 建教: !!st.flags.建教合作, 營隊: everSet(st, ['去過營隊', '營隊朋友']),
    家人生病: fh.includes('sick'), 家人失業: fh.includes('unemployed') || fh.includes('biz_bad'), 重考: !!o.retake, 就業: work,
    ...tags, 工作轉折: false, 感情轉折: false,
  };
}

// 選擇史的雜湊：同種子＋同選擇 → 同結局；選擇或習慣不同 → 抽籤不同
export function choiceHash(st) {
  const parts = (st.choices || []).map((c) => `${c.turn}|${c.id}|${c.label}`);
  parts.push((st.hist || []).map((h) => h.h.join('')).join(','));
  return hashStr(parts.join(';'));
}

function fillText(t, v) {
  return t.replace(/\{([^{}]+)\}/g, (m, n) => (n in v ? v[n] : m));
}

/** 回傳 { a22, a25, a30, good, regret, picks:[{facet,i}] } */
export function composeEnding(st, data, o, archetype = '') {
  const E = data.endings, id = st.identity;
  const ctx = endingCtx(st, data, o, archetype);
  const r = mulberry32((st.seed ^ choiceHash(st)) >>> 0);
  const v = { 姓名: id.name, 朋友: st.peers?.known?.[0]?.name || '好友', 科系: ctx.科系, 縣市: id.county, 學校: id.school, 群: ctx.群 };
  const picks = [];
  const ok = (e, c) => !e.if || evalCond(e.if, c);
  const pickOne = (arr, c, key) => {
    const el = arr.map((e, i) => ({ e, i })).filter((x) => ok(x.e, c));
    const x = pickWeighted(r, el, (y) => y.e.w ?? 1) || arr.map((e, i) => ({ e, i })).find((y) => !y.e.if);
    picks.push({ facet: key, i: x.i });
    return x.e;
  };
  const section = (age, c) => FACETS[age].map((f) => fillText(pickOne(E.facets[age][f], c, `${age}:${f}`).t, v));
  const a22 = section(22, ctx).join('');
  const a25 = section(25, ctx).join('');
  // 25～30 歲的轉折：1～2 個，不重複抽取
  const n = r() < 0.5 ? 1 : 2, chosen = [];
  const pool = E.turns.map((e, i) => ({ e, i }));
  for (let k = 0; k < n; k++) {
    const ct = { ...ctx }; // 已抽到的轉折先算進條件，避免「結婚」又「單身」
    for (const y of chosen) if (y.e.tag) ct[y.e.tag] = true;
    ct.工作轉折 = WORK_TAGS.some((t) => ct[t]); ct.感情轉折 = LOVE_TAGS.some((t) => ct[t]);
    const el = pool.filter((x) => !chosen.includes(x) && ok(x.e, ct));
    const x = pickWeighted(r, el, (y) => y.e.w ?? 1);
    if (x) chosen.push(x);
  }
  const ages = n === 1 || chosen.length === 1 ? [26 + Math.floor(r() * 4)] : [26 + Math.floor(r() * 2), 28 + Math.floor(r() * 2)];
  const c30 = { ...ctx };
  for (const x of chosen) { if (x.e.tag) c30[x.e.tag] = true; picks.push({ facet: 'turn', i: x.i }); }
  c30.工作轉折 = WORK_TAGS.some((t) => c30[t]); c30.感情轉折 = LOVE_TAGS.some((t) => c30[t]);
  const turnText = chosen.map((x, k) => `${ages[k]} 歲${k === 0 ? '那年' : ''}，${fillText(x.e.t, v)}`).join('');
  const a30 = turnText + section(30, c30).join('');
  const good = fillText(pickOne(E.good, ctx, 'good').t, v), regret = fillText(pickOne(E.regret, ctx, 'regret').t, v);
  return { a22, a25, a30, good, regret, picks };
}

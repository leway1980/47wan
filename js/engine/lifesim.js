// 人生模型（原型，尚未接進遊戲）：第一層＝終局狀態 → 七個特質（0–100）；第二層＝特質＋背景 → 22/25/30/35/40 歲事件。
// 純函式，無 DOM。所有權重在 data/lifesim.json（cfg），由呼叫端讀入。
import { mulberry32, gauss } from './rng.js';
import { choiceHash } from './ending.js';
import { effectiveEcon } from './family.js';

export const TRAITS = ['盡責', '合作', '外向', '穩定', '開放', '自制', '對上關係'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/* ───────────── 第一層：輸入 ───────────── */
const SOCIAL_POOLS = ['人際', '社群', '社團', '感情'];
const SOCIAL_ACT = /開始交往|合唱|運動會|畢業旅行|班級幹部|班際/;
const OPEN_ACT = /營|競賽|科展|科學|證照|技藝|建教|海外|推薦|課輔/;
const reCache = new Map();
// 事件卡的選項文字含 {占位}，st.choices 存的是代入後的字；用樣板轉正規式對回原選項
function choiceOf(data, c) {
  const card = data.cardIndex?.[c.id];
  if (!card) return null;
  let list = reCache.get(card.id);
  if (!list) {
    list = card.choices.map((ch) => ({ ch, re: new RegExp('^' + ch.label.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^{}]*\}/g, '.*') + '$') }));
    reCache.set(card.id, list);
  }
  return (list.find((x) => x.re.test(c.label)) || {}).ch || null;
}

/** 從終局狀態取各原始輸入（未標準化）。 */
export function lifeInputs(st, data) {
  const S = st.stats, A = st.att || {}, hs = st.hist || [];
  const H = (f) => hs.map(f);
  const chs = st.choices || [];
  let coop = 0, social = 0, noReply = 0;
  for (const c of chs) {
    const ch = choiceOf(data, c);
    if (/已讀不回/.test(c.label)) noReply++;
    if (!ch) continue;
    const card = data.cardIndex[c.id];
    if (c.id.startsWith('mn_') && (ch.hidden?.同儕信任 || 0) > 0) coop++;
    if (SOCIAL_POOLS.includes(card.pool) && (ch.effects?.聯繫 || 0) > 0) social++;
  }
  const acts = [...new Set((st.acts || []).map((a) => a.text))];
  social += acts.filter((t) => SOCIAL_ACT.test(t)).length;
  const open = acts.filter((t) => OPEN_ACT.test(t)).length + (st.flags.社團中 ? 1 : 0) + (st.flags.去過營隊 ? 1 : 0);
  const mood = H((h) => h.心情);
  return {
    late: A.遲到 || 0, sweep: A.缺掃 || 0, miss: A.缺交 || 0, makeup: A.補交 || 0, award: A.嘉獎 || 0, warn: A.警告 || 0,
    sleep: mean(H((h) => h.睡眠債)), teacher: S.師長印象, peer: S.同儕信任, close: S.知心, contact: S.聯繫, understand: S.理解,
    coop, noReply, social, open, mood: mean(mood), moodSd: sd(mood), happy: mean(H((h) => h.幸福)),
    phone: mean(H((h) => h.h[0])), game: mean(H((h) => h.h[4])), bedPhone: mean(H((h) => h.h[1])),
    save: hs.length ? hs.filter((h) => h.h[5] >= 1).length / hs.length : 0,
  };
}

/** 各特質的加權和（輸入先以參考母體的 mean/sd 標準化）。 */
export function composites(inputs, cfg) {
  const out = {};
  for (const [t, list] of Object.entries(cfg.traits)) {
    out[t] = list.reduce((s, [k, w]) => { const r = cfg.ref.inputs[k]; return s + w * (inputs[k] - r.mean) / (r.sd || 1); }, 0);
  }
  return out;
}

// 百分位：在參考母體的 101 個分位點上線性內插
function percentile(q, x) {
  if (x <= q[0]) return 0;
  if (x >= q[100]) return 100;
  let lo = 0, hi = 100;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q[m] <= x) lo = m; else hi = m; }
  return lo + (q[hi] === q[lo] ? 0 : (x - q[lo]) / (q[hi] - q[lo]));
}

/** 特質（0–100，50＝典型）。 */
export function lifeTraits(st, data, cfg) {
  const c = composites(lifeInputs(st, data), cfg), t = {};
  for (const k of TRAITS) t[k] = Math.round(percentile(cfg.ref.q[k], c[k]) * 10) / 10;
  return t;
}

/** 第二層需要的背景。 */
export function lifeCtx(st) {
  const id = st.identity, o = st.outcome || {};
  return { outcome: o.type, tech: id.kind === '技高', group: id.vocGroup || o.group || '', dept: o.dept || '', econ: effectiveEcon(st), family: id.family.structure, metro: id.tier === '六都' && /區$/.test(id.district || ''), sex: id.sex, cert: !!st.flags.報名證照 };
}

/** 亂數：同種子＋同選擇 → 同人生；與 ending.js 的抽籤用不同的鹽，彼此獨立。 */
export const lifeRng = (st) => mulberry32((st.seed ^ choiceHash(st) ^ 0x1f3d5b79) >>> 0);

/* ───────────── 第二層：人生階段 ───────────── */
export function simulateLife(traits, ctx, rng, cfg) {
  const W = cfg.weights, E = W.events, SC = W.sdScale, [pLo, pHi] = W.clamp;
  const tags = [], why = {}, probs = {};
  const z = (t) => (traits[t] - 50) / SC;
  // 二元事件：logit(p)=logit(base)+Σβ·z+背景項；回傳是否發生，並記下主因
  const ev = (name, def, extra = {}, base = def.base) => {
    const terms = Object.entries(def.betas).map(([t, b]) => [t + (b * z(t) >= 0 ? '高' : '低'), b * z(t)]);
    for (const [label, v] of Object.entries(extra)) terms.push([label, v]);
    const p = clamp(sigmoid(logit(base) + terms.reduce((s, x) => s + x[1], 0)), pLo, pHi);
    probs[name] = p;
    const hit = rng() < p;
    // 發生 → 推高機率的前 2 項；沒發生 → 壓低機率的前 2 項
    const top = terms.filter(([, v]) => (hit ? v : -v) >= W.why.minContribution).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2).map(([l]) => l);
    if (top.length) why[name + (hit ? '' : '(未)')] = top;
    return hit;
  };
  const stages = { 22: {}, 25: {}, 30: {}, 35: {}, 40: {} };
  const college = ['國立大學', '私立大學', '科技大學', '國立科大', '私立科大', '二專或五專續讀'].includes(ctx.outcome);

  // 22 歲
  if (college) { stages[22].打工 = ev('打工', E.打工, ctx.econ === '吃緊' ? { 家境吃緊: E.打工.econ吃緊 } : {}); if (stages[22].打工) tags.push('大學打工'); }
  stages[22].交往過 = ev('交往過', E.交往過);
  if (stages[22].交往過) tags.push('交往過');

  // 25 歲
  const s25 = stages[25];
  s25.正職 = ev('正職', E.正職);
  const SL = W.salary;
  s25.起薪 = Math.round(((SL.start[ctx.outcome] ?? 30000) + (ctx.outcome === '直接就業' && ctx.cert ? SL.certBonus : 0) + SL.perSD盡責 * z('盡責') + SL.perSD開放 * z('開放') + gauss(rng) * SL.noiseSd) / 100) * 100;
  s25.被針對 = ev('被針對', E.被針對);
  s25.換過工作 = ev('換過工作', E.換過工作);
  if (!s25.正職) tags.push('非正職');
  if (s25.被針對) tags.push('職場被針對');
  if (s25.換過工作) tags.push('換過工作');

  // 30 歲
  const s30 = stages[30];
  s30.被提拔 = ev('被提拔', E.被提拔, s25.被針對 ? { 被針對過: E.被提拔.被針對 } : {});
  s30.錯過提拔 = !s30.被提拔 && (traits.對上關係 < 40 || traits.合作 < 40);
  if (s30.被提拔) tags.push('被提拔'); else if (s30.錯過提拔) { tags.push('錯過提拔'); why.錯過提拔 = [traits.對上關係 < 40 ? '對上關係低' : null, traits.合作 < 40 ? '合作低' : null].filter(Boolean); }
  s30.失業過 = ev('失業過', E.失業過);
  if (s30.失業過) tags.push('失業過');
  const A = SL.at30;
  s30.月薪 = Math.round(s25.起薪 * (A.mult + (s30.被提拔 ? A.promo : 0) + (s30.失業過 ? A.unemp : 0)) + gauss(rng) * A.noiseSd);
  const sv = W.saving, saveRate = Math.max(0, sv.base + sv.perSD自制 * z('自制'));
  s30.存款 = Math.round(s30.月薪 * 12 * saveRate * sv.years);
  s30.存款級距 = s30.存款 < sv.bands[0] ? '少' : s30.存款 < sv.bands[1] ? '一些' : '不少';
  const hi = s30.月薪 > cfg.ref.medianPay30;
  s30.結婚 = ev('結婚30', E.結婚30, hi ? { 月薪高於中位: E.結婚30.月薪高於中位 } : {});
  s30.健康警訊 = ev('健康警訊', E.健康警訊);
  if (s30.結婚) tags.push('結婚');
  if (s30.健康警訊) tags.push('健康警訊');

  // 35 歲
  const s35 = stages[35];
  s35.結婚 = s30.結婚 || ev('結婚35', E.結婚35, hi ? { 月薪高於中位: E.結婚35.月薪高於中位 } : {});
  if (s35.結婚 && !s30.結婚) tags.push('結婚');
  if (!s35.結婚) tags.push('單身');
  s35.主管 = ev('主管', E.主管, {}, s30.被提拔 ? E.主管.base : E.主管.baseNoPromo);
  if (s35.主管) tags.push('主管');

  // 40 歲：孩子（有伴才有）
  const s40 = stages[40], kids = [];
  if (s35.結婚) {
    const K = W.kids;
    const w = K.dist.map((p, k) => p * Math.exp(K.perSD穩定 * z('穩定') * k)), tot = w.reduce((a, b) => a + b, 0);
    let x = rng() * tot, n = 0;
    for (; n < w.length - 1; n++) { x -= w[n]; if (x < 0) break; }
    s40.孩子數 = n;
    for (let i = 0; i < n; i++) {
      const kid = { 性別: rng() < 0.5 ? '男' : '女' };
      for (const [name, d] of Object.entries(W.kid)) {
        const mu = d.base + Object.entries(d.coef).reduce((s, [t, c]) => s + c * (traits[t] - 50), 0) + (d.國立 && /^國立/.test(ctx.outcome || '') ? d.國立 : 0);
        kid[name] = Math.round(clamp(mu + gauss(rng) * d.sd, 0, 100));
      }
      kids.push(kid);
    }
    if (n) tags.push('有孩子');
  } else s40.孩子數 = 0;
  return { stages, tags, kids, why, probs };
}

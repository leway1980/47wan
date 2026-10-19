// 用法：node tools/lifesim-report.mjs [局數=3000] [起始種子=200001] [人格局數=500]  → 印出 Markdown（貼進 docs/LIFESIM.md 第 5 節）
import { randomPolicy } from './simulate.mjs';
import { loadData, loadCfg, playGame, lifeTraits, lifeCtx, lifeRng, simulateLife, TRAITS } from './lifesim-common.mjs';

const N = parseInt(process.argv[2] || '3000', 10), s0 = parseInt(process.argv[3] || '200001', 10), NP = parseInt(process.argv[4] || '500', 10);
const data = loadData(), cfg = loadCfg();
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pct = (a) => (a.length ? (mean(a.map(Number)) * 100).toFixed(1) + '%' : '—');
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function run(seed0, n, policyFor) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const st = playGame(seed0 + i, data, policyFor);
    if (!st) continue;
    const traits = lifeTraits(st, data, cfg), life = simulateLife(traits, lifeCtx(st), lifeRng(st), cfg);
    rows.push({ traits, life, outcome: st.outcome.type });
  }
  return rows;
}
const g = (r, s, k) => r.life.stages[s][k];
function summary(rows) {
  const m = rows.length, married = rows.filter((r) => g(r, 35, '結婚')), kids = rows.flatMap((r) => r.life.kids);
  return {
    m, 正職: pct(rows.map((r) => g(r, 25, '正職'))), 被針對: pct(rows.map((r) => g(r, 25, '被針對'))), 被提拔: pct(rows.map((r) => g(r, 30, '被提拔'))),
    失業過: pct(rows.map((r) => g(r, 30, '失業過'))), 結婚30: pct(rows.map((r) => g(r, 30, '結婚'))), 結婚35: pct(rows.map((r) => g(r, 35, '結婚'))),
    主管: pct(rows.map((r) => g(r, 35, '主管'))), 健康警訊: pct(rows.map((r) => g(r, 30, '健康警訊'))),
    月薪: med(rows.map((r) => g(r, 30, '月薪'))), 孩子全: mean(rows.map((r) => g(r, 40, '孩子數'))).toFixed(2), 孩子婚: mean(married.map((r) => g(r, 40, '孩子數'))).toFixed(2),
    禮貌: mean(kids.map((k) => k.禮貌)).toFixed(1), 學業: mean(kids.map((k) => k.學業)).toFixed(1), 活潑: mean(kids.map((k) => k.活潑)).toFixed(1), kids: kids.length,
  };
}

const t0 = Date.now();
const rows = run(s0, N, randomPolicy);
const S = summary(rows);
const out = [];
out.push(`模擬 ${N} 局（randomPolicy，種子 ${s0}–${s0 + N - 1}），死亡 ${N - rows.length} 局不計，有效 ${rows.length} 局。`);
out.push('\n**整體比率**\n\n| 項目 | 數值 |\n| --- | --- |');
for (const [k, l] of [['正職', '25 歲正職'], ['被針對', '25 歲職場被針對'], ['被提拔', '30 歲前被提拔'], ['失業過', '失業過'], ['結婚30', '30 歲前結婚'], ['結婚35', '35 歲前結婚'], ['主管', '35 歲主管'], ['健康警訊', '30 歲健康警訊']]) out.push(`| ${l} | ${S[k]} |`);
out.push(`| 30 歲月薪中位數 | NT$${fmt(S.月薪)} |`, `| 平均孩子數（全部） | ${S.孩子全} |`, `| 平均孩子數（已婚者） | ${S.孩子婚} |`, `| 孩子特質平均（禮貌／學業／活潑，共 ${S.kids} 個孩子） | ${S.禮貌} ／ ${S.學業} ／ ${S.活潑} |`);

// 各特質：最高四分位 vs 最低四分位
out.push('\n**各特質：最高四分位 vs 最低四分位**（括號內為高減低的差，單位：百分點或 NT$）\n');
out.push('| 特質 | 被提拔 高／低 | 被針對 高／低 | 30 歲前結婚 高／低 | 30 歲月薪中位 高／低 |', '| --- | --- | --- | --- | --- |');
const gaps = {};
for (const t of TRAITS) {
  const s = [...rows].sort((a, b) => a.traits[t] - b.traits[t]), q = Math.floor(s.length / 4), lo = s.slice(0, q), hi = s.slice(-q);
  const f = (k, st, pctMode = true) => { const a = hi.map((r) => g(r, st, k)), b = lo.map((r) => g(r, st, k)); return pctMode ? `${pct(a)} ／ ${pct(b)}（${((mean(a.map(Number)) - mean(b.map(Number))) * 100 >= 0 ? '+' : '')}${((mean(a.map(Number)) - mean(b.map(Number))) * 100).toFixed(1)}）` : `${fmt(med(a))} ／ ${fmt(med(b))}（${fmt(med(a) - med(b))}）`; };
  gaps[t] = (mean(hi.map((r) => g(r, 30, '被提拔') ? 1 : 0)) - mean(lo.map((r) => g(r, 30, '被提拔') ? 1 : 0))) * 100;
  out.push(`| ${t} | ${f('被提拔', 30)} | ${f('被針對', 25)} | ${f('結婚', 30)} | ${f('月薪', 30, false)} |`);
}
out.push('');
for (const t of ['盡責', '對上關係', '合作']) out.push(`- 單一特質「被提拔」高低四分位差距：${t} ${gaps[t].toFixed(1)} 個百分點${gaps[t] >= 10 && gaps[t] <= 25 ? '（落在預期 10–25 內）' : '（**超出預期 10–25**）'}`);

// 兩種人格
const addOf = (card, i) => card.choices[i].addHabits || {};
const phoneUp = (a) => (a.手機 > 0 ? 2 : 0) + (a.睡前手機 === true ? 2 : 0) + (a.遊戲 > 0 ? 1 : 0);
const persona = (mode) => () => ({
  choose(st, view) {
    const ok = view.choices.filter((c) => !c.disabled);
    const card = data.cardIndex[view.id];
    if (view.id.startsWith('mn_')) {
      const score = (c) => { const h = card.choices[c.i].hidden || {}; return (h.師長印象 || 0) + (h.同儕信任 || 0); };
      return ok.reduce((a, b) => ((mode === 'low' ? score(b) < score(a) : score(b) > score(a)) ? b : a)).i;
    }
    // 其他卡：好人格避開手機／遊戲增加的選項，壞人格挑那些選項；沒有就取第一個
    const sc = (c) => phoneUp(addOf(card, c.i));
    if (mode === 'low') { const hit = ok.filter((c) => sc(c) > 0); if (hit.length) return hit.reduce((a, b) => (sc(b) > sc(a) ? b : a)).i; return ok[0].i; }
    const clean = ok.filter((c) => sc(c) === 0);
    return (clean[0] || ok[0]).i;
  },
});
const A = run(300001, NP, persona('high')), B = run(300001, NP, persona('low'));
const sa = summary(A), sb = summary(B), tm = (rows, t) => mean(rows.map((r) => r.traits[t])).toFixed(1);
out.push(`\n**兩種人格**（各 ${NP} 局、同組種子；腳本策略：mn_ 禮貌卡取師長印象＋同儕信任最高／最低的選項；其他卡好人格避開增加手機／睡前手機／遊戲的選項，壞人格優先選這類選項，其餘取第一個可選項）\n`);
out.push('| | 準時、有禮貌、不太滑手機 | 常遲到、不理人、手機重度 |', '| --- | --- | --- |', `| 有效局數 | ${sa.m} | ${sb.m} |`);
for (const t of TRAITS) out.push(`| 平均${t} | ${tm(A, t)} | ${tm(B, t)} |`);
for (const [k, l] of [['被針對', '25 歲被針對'], ['被提拔', '30 歲前被提拔'], ['失業過', '失業過'], ['結婚30', '30 歲前結婚'], ['結婚35', '35 歲前結婚'], ['主管', '35 歲主管'], ['健康警訊', '30 歲健康警訊']]) out.push(`| ${l} | ${sa[k]} | ${sb[k]} |`);
const q = (rows) => { const v = rows.map((r) => g(r, 30, '月薪')).sort((a, b) => a - b); return `${fmt(v[Math.floor(v.length * 0.25)])} / ${fmt(v[v.length >> 1])} / ${fmt(v[Math.floor(v.length * 0.75)])}`; };
out.push(`| 30 歲月薪 25%／中位／75% | ${q(A)} | ${q(B)} |`, `| 平均孩子數（全部／已婚） | ${sa.孩子全} ／ ${sa.孩子婚} | ${sb.孩子全} ／ ${sb.孩子婚} |`, `| 孩子禮貌／學業／活潑 | ${sa.禮貌} ／ ${sa.學業} ／ ${sa.活潑} | ${sb.禮貌} ／ ${sb.學業} ／ ${sb.活潑} |`);

// 健全性檢查
const all = [...rows, ...A, ...B];
let noPartnerKids = 0, pBad = 0, pMin = 1, pMax = 0, kidBad = 0;
for (const r of all) {
  if (!r.life.stages[35].結婚 && r.life.kids.length) noPartnerKids++;
  if (r.life.kids.length > 3) kidBad++;
  for (const p of Object.values(r.life.probs)) { pMin = Math.min(pMin, p); pMax = Math.max(pMax, p); if (p < 0.02 - 1e-9 || p > 0.98 + 1e-9) pBad++; }
}
const tmed = TRAITS.map((t) => `${t} ${med(rows.map((r) => r.traits[t])).toFixed(1)}`).join('、');
out.push('\n**健全性檢查**\n');
out.push(`- 沒有伴卻有孩子：${noPartnerKids} 例（檢查 ${all.length} 人）${noPartnerKids ? ' ← 異常' : ''}`);
out.push(`- 孩子數超過 3：${kidBad} 例`);
out.push(`- 事件機率範圍：${pMin.toFixed(3)}–${pMax.toFixed(3)}，超出 [0.02, 0.98] 者 ${pBad} 例`);
out.push(`- 隨機策略母體的特質中位數：${tmed}`);
out.push(`- 「被提拔」單一特質高低四分位差距：盡責 ${gaps.盡責.toFixed(1)}、對上關係 ${gaps.對上關係.toFixed(1)}、合作 ${gaps.合作.toFixed(1)}（預期 10–25）`);
out.push(`\n（耗時 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
console.log(out.join('\n'));

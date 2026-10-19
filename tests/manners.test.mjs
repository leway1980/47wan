import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, playToEnd, startTurn, chooseCard, finishTurn } from '../js/engine/turn.js';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { buildCtx, applyChoice } from '../js/engine/events.js';
import { buildEnding } from '../js/engine/report.js';
import { playRestAuto } from '../js/engine/auto.js';
import { ATT_KEYS } from '../js/engine/conduct.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const events = rd('events.json');
for (const f of readdirSync(join(root, 'data')).sort()) if (/^events_.+\.json$/.test(f)) events.cards.push(...rd(f).cards);
const data = prepareData({ identities: rd('identities.json'), schools: rd('schools.json'), events, calendar: rd('calendar.json'), life_events: rd('life_events.json'), slots: rd('slots.json'), endings: rd('endings.json') });

// 在 mn_ 開頭的卡裡，依隱藏的師長印象＋同儕信任挑最低（low）或最高（high）的選項；其他卡取第一個可選的
const policy = (mode) => ({
  choose(st, view) {
    const ok = view.choices.filter((c) => !c.disabled);
    if (!view.id.startsWith('mn_')) return ok[0].i;
    const card = data.cardIndex[view.id];
    const score = (c) => { const h = card.choices[c.i].hidden || {}; return (h.師長印象 || 0) + (h.同儕信任 || 0); };
    return ok.reduce((a, b) => ((mode === 'low' ? score(b) < score(a) : score(b) > score(a)) ? b : a)).i;
  },
});

test('態度：新局有兩個隱藏數值與出缺勤計數，ctx 給整數', () => {
  const st = newState(5, data);
  assert.equal(st.stats.師長印象, 50);
  assert.equal(st.stats.同儕信任, 50);
  assert.deepEqual(Object.keys(st.att), ATT_KEYS);
  st.stats.師長印象 = 33.6;
  const ctx = buildCtx(st, data.timeline[0]);
  assert.equal(ctx.師長印象, 34);
  assert.equal(ctx.本學期遲到, 0);
});

test('態度：att 效果會累加，本學期遲到＝累計減去學期快照', () => {
  const st = newState(5, data);
  const card = data.cardIndex.mn_wake_up;
  const ctx = buildCtx(st, data.timeline[0]);
  const r = () => 0.5;
  for (let i = 0; i < 3; i++) applyChoice(st, data, card, 1, ctx, r, i);
  assert.equal(st.att.遲到, 3);
  assert.equal(buildCtx(st, data.timeline[0]).本學期遲到, 3);
  assert.ok(st.stats.師長印象 < 50);
});

test('舊存檔沒有態度欄位也能讀', () => {
  const st = newState(5, data);
  const old = JSON.parse(serialize(st));
  for (const k of ['att', 'semesters', 'missed', 'acts', 'semBase']) delete old[k];
  delete old.stats.師長印象; delete old.stats.同儕信任;
  const back = deserialize(JSON.stringify(old));
  assert.equal(back.stats.師長印象, 50);
  assert.deepEqual(back.semesters, []);
  const ctx = buildCtx(back, data.timeline[0]);
  assert.equal(ctx.本學期遲到, 0);
});

test('學期紀錄：玩完一局有 6 筆（含高三下），自動過完也有 6 筆', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const st = newState(seed, data);
    playToEnd(st, data, policy('high'));
    if (st.dead) continue;
    assert.equal(st.semesters.length, 6, `seed ${seed}`);
    assert.deepEqual(st.semesters.map((s) => s.title), ['高一上學期', '高一下學期', '高二上學期', '高二下學期', '高三上學期', '高三下學期']);
    for (const s of st.semesters) {
      assert.ok(s.exam == null || (s.exam >= 0 && s.exam <= 100));
      for (const k of ATT_KEYS) assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `${k}`);
      assert.ok(typeof s.club === 'string' && s.club);
      assert.ok(s.activities.length <= 3 && s.highlight);
    }
    const sum = (k) => st.semesters.reduce((a, s) => a + s[k], 0);
    for (const k of ATT_KEYS) assert.ok(sum(k) <= st.att[k]);
  }
  const st = newState(9, data);
  for (let i = 0; i < 17; i++) { startTurn(st, data); finishTurn(st, data); st.reportPending = null; }
  playRestAuto(st, data);
  if (!st.dead) assert.equal(st.semesters.length, 6);
});

test('結局：有 6 學期紀錄與 2–4 句態度與人際，文字沒有殘留的 {}', () => {
  for (const seed of [1, 2, 3]) {
    const st = newState(seed, data);
    playToEnd(st, data, policy('low'));
    const e = buildEnding(st, data);
    if (e.dead) continue;
    assert.equal(e.semesters.length, 6);
    assert.ok(e.conduct.length >= 2 && e.conduct.length <= 4, e.conduct.join('|'));
    const text = [...e.conduct, ...e.semesters.flatMap((s) => [s.title, s.club, s.highlight, ...s.activities])].join('\n');
    assert.ok(!/[{}]/.test(text), text);
  }
});

test('態度：長期不理師長的人，被壓掉的老師資源比有禮貌的人多；同儕邀約也是', () => {
  let lowT = 0, highT = 0, lowP = 0, highP = 0, lowImp = 0, highImp = 0, lowTr = 0, highTr = 0, n = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const a = newState(seed, data), b = newState(seed, data);
    playToEnd(a, data, policy('low')); playToEnd(b, data, policy('high'));
    if (a.dead || b.dead) continue;
    n++;
    lowT += a.missed.teacher; highT += b.missed.teacher; lowP += a.missed.peer; highP += b.missed.peer;
    lowImp += a.stats.師長印象; highImp += b.stats.師長印象; lowTr += a.stats.同儕信任; highTr += b.stats.同儕信任;
  }
  assert.ok(n >= 40);
  assert.ok(lowImp < highImp && lowTr < highTr);
  assert.ok(lowT > highT, `teacher ${lowT} vs ${highT}`);
  assert.ok(lowP > highP, `peer ${lowP} vs ${highP}`);
  assert.ok(lowT / n >= 0.5, `平均少掉 ${lowT / n} 次老師機會`);
});

test('態度：老師主動推薦的資源只給師長印象夠高的人', () => {
  let lowOffers = 0, highOffers = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const a = newState(seed, data), b = newState(seed, data);
    playToEnd(a, data, policy('low')); playToEnd(b, data, policy('high'));
    lowOffers += a.choices.filter((c) => c.id.startsWith('mn_offer_')).length;
    highOffers += b.choices.filter((c) => c.id.startsWith('mn_offer_')).length;
  }
  assert.equal(lowOffers, 0);
  assert.ok(highOffers > 0);
});

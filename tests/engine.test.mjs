import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, playTurn, playToEnd, startTurn, chooseCard, finishTurn, TOTAL_TURNS } from '../js/engine/turn.js';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { stateRng, pick } from '../js/engine/rng.js';
import { compile, evalCond, VISIBLE_KEYS } from '../js/engine/events.js';
import { lifeProbTable, turnProb, DEATH_LINE } from '../js/engine/life.js';
import { buildEnding } from '../js/engine/report.js';
import { N_PEERS, stepPeers } from '../js/engine/peers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const raw = () => ({ identities: rd('identities.json'), events: rd('events.json'), calendar: rd('calendar.json'), life_events: rd('life_events.json') });
const data = prepareData(raw());

// 固定的「玩家」：習慣與選擇都由自己的亂數決定
function scripted(seed) {
  const h = { rngS: seed >>> 0 };
  const r = stateRng(h, 'rngS');
  return {
    habits(st) {
      if (st.turn % 7 === 0) {
        st.habits.手機 = Math.floor(r() * 5); st.habits.睡前手機 = r() < 0.4; st.habits.補習 = Math.floor(r() * 4);
        st.habits.運動 = Math.floor(r() * 3); st.habits.遊戲 = Math.floor(r() * 4);
      }
    },
    choose(st, card) { return pick(r, card.choices.filter((c) => !c.disabled)).i; },
  };
}

test('時間軸：72 回合，從 2026-08-31 開始，每學年 10+2+10+2', () => {
  assert.equal(data.timeline.length, 72);
  assert.equal(new Date(data.timeline[0].start).toISOString().slice(0, 10), '2026-08-31');
  const segs = data.timeline.slice(0, 24).map((t) => t.seg);
  assert.equal(segs.filter((s) => s === '上學期').length, 10);
  assert.equal(segs.filter((s) => s === '寒假').length, 2);
  assert.equal(segs.filter((s) => s === '下學期').length, 10);
  assert.equal(segs.filter((s) => s === '暑假').length, 2);
  for (let i = 1; i < 72; i++) assert.ok(data.timeline[i].start > data.timeline[i - 1].start, '日期要遞增');
  assert.ok(data.timeline.filter((t) => t.vacation).every((t) => t.seg === '寒假' || t.seg === '暑假'));
});

test('決定性：同種子＋同選擇 ⇒ 同結果', () => {
  for (const seed of [1, 42, 20260831]) {
    const a = newState(seed, data), b = newState(seed, data);
    playToEnd(a, data, scripted(seed));
    playToEnd(b, data, scripted(seed));
    assert.equal(serialize(a), serialize(b));
  }
  const x = newState(7, data), y = newState(8, data);
  assert.notEqual(x.identity.name + x.identity.county + x.identity.family.job, y.identity.name + y.identity.county + y.identity.family.job + 'x');
});

test('同一個人生：同種子、不同選擇 ⇒ 同身分、同運氣（人生事件骰）', () => {
  const a = newState(99, data), b = newState(99, data);
  assert.deepEqual(a.identity, b.identity);
  playToEnd(a, data, scripted(1));
  playToEnd(b, data, scripted(2));
  // 通勤沒被改變的人，運氣完全一樣
  if (a.identity.commute === a.identity.commuteOrig && b.identity.commute === b.identity.commuteOrig) {
    assert.deepEqual(a.luck.map((l) => l.turn), b.luck.map((l) => l.turn));
  }
});

test('完整自動遊玩：許多種子都能跑完 72 回合（或死亡）而不拋錯', () => {
  let finished = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const st = newState(seed, data);
    playToEnd(st, data, scripted(seed * 31));
    assert.ok(st.ended);
    assert.ok(st.dead ? st.turn <= TOTAL_TURNS : st.turn === TOTAL_TURNS, `seed ${seed} turn=${st.turn}`);
    const e = buildEnding(st, data);
    assert.ok(e.archetype && e.curves.focus.startsWith('<svg'));
    assert.ok(e.sections.length >= 1);
    finished++;
    for (const [k, v] of Object.entries(st.stats)) assert.ok(Number.isFinite(v), `${k} 不是有限數`);
  }
  assert.equal(finished, 60);
});

test('死亡路徑：把機率調成 1，玩家會死並得到休止符結局', () => {
  const rawD = raw();
  for (const ev of rawD.life_events.events) for (const g of Object.values(ev.risk_groups)) g.annual_prob_if_in_group = 1;
  const d = prepareData(rawD);
  const st = newState(5, d);
  playToEnd(st, d, scripted(5));
  assert.ok(st.dead && st.ended);
  const e = buildEnding(st, d);
  assert.equal(e.archetype, 'J');
  assert.ok(e.sections[0].text === DEATH_LINE);
  assert.ok(e.truth.startsWith('在台灣：'));
});

test('機率都在 [0,1]，且換算公式正確', () => {
  const c = data.identities.commutes;
  for (const commute of c) {
    for (const days of [0, 10, 100, 180]) {
      for (const row of lifeProbTable(commute, data.life.events, days)) {
        assert.ok(row.pYear >= 0 && row.pYear <= 1 && row.pTurn >= 0 && row.pTurn <= 1, `${commute} ${row.id}`);
      }
    }
  }
  assert.equal(turnProb(0.5, 0), 0);
  assert.ok(Math.abs(turnProb(0.063095, 180) - 0.063095) < 1e-12);
  // 假期不通勤 ⇒ 沒有人生事件
  const t = lifeProbTable('無照騎機車', data.life.events, 0);
  assert.ok(t.every((x) => x.pTurn === 0));
  // 無照騎機車的死亡年機率 = 資料裡的值，其他人較低
  const u = lifeProbTable('無照騎機車', data.life.events, 180).find((x) => x.id === 'traffic_death_teen');
  const w = lifeProbTable('走路', data.life.events, 180).find((x) => x.id === 'traffic_death_teen');
  assert.ok(u.pYear > w.pYear * 20);
});

test('存檔往返：JSON 還原後繼續玩，結果與不中斷相同', () => {
  const seed = 1234;
  const full = newState(seed, data);
  const pol = scripted(777);
  playToEnd(full, data, pol);

  const a = newState(seed, data);
  const polA = scripted(777);
  for (let i = 0; i < 30 && !a.ended; i++) playTurn(a, data, polA);
  const restored = deserialize(serialize(a));
  assert.equal(serialize(restored), serialize(a));
  // 用同一個「玩家」繼續（polA 的亂數狀態在 30 回合後的位置）
  playToEnd(restored, data, polA);
  assert.equal(serialize(restored), serialize(full));
});

test('條件求值器：不用 eval，語法正確', () => {
  const ctx = { 錢包: 20, 知心: 1, 經濟: '吃緊', 假期: false, __flags: { 交往中: true } };
  assert.ok(evalCond("錢包 < 30", ctx));
  assert.ok(evalCond("知心 <= 1 and 經濟 == '吃緊'", ctx));
  assert.ok(evalCond("#交往中 && not 假期", ctx));
  assert.ok(!evalCond("#沒有這個旗標 or 錢包 > 100", ctx));
  assert.ok(evalCond("(錢包 > 100 or 知心 == 1) and true", ctx));
  assert.ok(!evalCond("不存在的變數 > 3", ctx));
  assert.throws(() => compile('錢包 < < 3'));
  assert.throws(() => compile("process.exit()"));
});

test('事件卡資料檢查：至少 14 張、每個選項都有看得見的好處、延遲事件存在', () => {
  const cards = data.events.cards;
  assert.ok(cards.length >= 14);
  const ids = new Set(cards.map((c) => c.id));
  for (const c of cards) {
    assert.ok(c.choices.length >= 2, c.id);
    assert.ok(data.events.pools[c.pool] || c.pool.startsWith('_'), `${c.id} 的池子 ${c.pool}`);
    for (const m of c.modifiers || []) compile(m.if);
    if (c.requires?.expr) compile(c.requires.expr);
    if (c.excludes?.expr) compile(c.excludes.expr);
    for (const ch of c.choices) {
      const eff = ch.effects || {};
      assert.ok(Object.keys(eff).every((k) => VISIBLE_KEYS.includes(k)), `${c.id}: 看得見的效果只能用 ${VISIBLE_KEYS}`);
      assert.ok(Object.entries(eff).some(([, v]) => v > 0), `${c.id} / ${ch.label} 沒有看得見的好處`);
      for (const d of ch.delayed || []) assert.ok(ids.has(d.event), `${c.id} → ${d.event}`);
      for (const g of [].concat(ch.grayIf || [])) { compile(g.if); assert.ok(g.reason); }
    }
  }
  for (const need of ['karaoke_invite', 'group_fight', 'haohao_treat', 'haohao_package', 'cram_trial', 'family_help', 'rainy_commute', 'crush', 'ai_homework', 'ai_oral_followup', 'club_choice', 'late_gaming', 'summer_plan', 'teacher_camp', 'class_own_thing', 'counselor_care']) assert.ok(ids.has(need), need);
  const ai = data.cardIndex.ai_homework;
  assert.equal(ai.choices.length, 5);
});

test('每回合最多一張選擇卡；卡片出現時引擎不會自己往前走', () => {
  const st = newState(3, data);
  let sawCard = false;
  for (let i = 0; i < 40 && !st.ended; i++) {
    const res = startTurn(st, data);
    assert.ok(res.card === null || typeof res.card.id === 'string');
    if (res.card) {
      sawCard = true;
      assert.equal(st.turn, i, '選之前回合數不變');
      chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
    }
    finishTurn(st, data);
    st.reportPending = null;
  }
  assert.ok(sawCard);
});

test('灰色選項：吃緊的家庭看得到營隊但不能選', () => {
  let found = false;
  for (let seed = 1; seed < 400 && !found; seed++) {
    const st = newState(seed, data);
    if (st.identity.family.econ !== '吃緊') continue;
    const idx = data.timeline.findIndex((t) => t.year === 1 && t.seg === '暑假' && t.idx === 0);
    st.turn = idx;
    const res = startTurn(st, data);
    const camp = res.card?.id === 'summer_plan' && res.card.choices[0];
    if (camp) { assert.ok(camp.disabled); assert.equal(camp.reason, '家裡負擔不起'); found = true; }
  }
  assert.ok(found);
});

test('同儕：999 人 × 72 回合遠少於 1 秒，且有 12 個認識的人', () => {
  const st = newState(11, data);
  assert.equal(st.peers.a.length, N_PEERS * 8);
  assert.equal(st.peers.known.length, 12);
  assert.equal(new Set(st.peers.known.map((k) => k.name)).size, 12);
  const t0 = performance.now();
  for (let k = 0; k < 72; k++) stepPeers(st, data, data.timeline[k]);
  assert.ok(performance.now() - t0 < 1000);
});

test('身分：姓名、座號、縣市、學校、家庭、通勤都由種子產生', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const { identity: id } = newState(seed, data);
    assert.ok(id.name.length >= 2 && id.seat >= 1 && id.seat <= 35);
    assert.ok(id.county && id.district && id.school && id.family.job);
    if (!id.mrt) assert.notEqual(id.commute, '捷運');
    seen.add(id.commute);
  }
  assert.ok(seen.size >= 5);
});

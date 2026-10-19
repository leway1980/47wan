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
import { buildCtx, passes, describeCard, applyChoice } from '../js/engine/events.js';
import { applyHabits } from '../js/engine/turn.js';
import { buildEnding } from '../js/engine/report.js';
import { N_PEERS, stepPeers } from '../js/engine/peers.js';
import { tutorCap, tutorMaxLevel, famStep, shockOf, effectiveEcon } from '../js/engine/family.js';
import { avatarSVG, avatarSpec, avatarOptsFromState, isCompletePalette } from '../js/engine/avatar.js';
import { generateIdentity } from '../js/engine/identity.js';

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

const BAD_UP = new Set(['睡眠債', '牽掛', '露餡']);
const hasCost = (ch) => Object.values(ch.effects || {}).some((v) => v < 0) || !!ch.cost || !!(ch.delayed && ch.delayed.length)
  || Object.entries(ch.hidden || {}).some(([k, v]) => (BAD_UP.has(k) ? v > 0 : v < 0));

test('事件卡資料檢查：每個選項都有好處也有代價；至少 14 張、每個選項都有看得見的好處、延遲事件存在', () => {
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
      if (!c.noCostOk) assert.ok(hasCost(ch), `${c.id} / ${ch.label} 沒有任何代價（看得見、隱藏或延遲）`);
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

test('像素小人：身分外貌由種子決定，名字依性別', () => {
  const idn = data.identities;
  assert.ok(idn.givenNamesM.length >= 25 && idn.givenNamesF.length >= 25);
  let girlsSkirt = 0, girls = 0, glasses = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const a = generateIdentity(seed, idn), b = generateIdentity(seed, idn);
    assert.deepEqual(a, b);
    assert.ok(a.sex === '男' || a.sex === '女');
    const given = a.name.slice(1);
    assert.ok((a.sex === '男' ? idn.givenNamesM : idn.givenNamesF).includes(given));
    if (a.sex === '男') assert.equal(a.bottom, '長褲');
    else { girls++; if (a.bottom === '裙') girlsSkirt++; }
    if (a.glasses) glasses++;
    assert.ok(a.hair >= 0 && a.hair < 3 && idn.avatar.skins[a.skin] && idn.avatar.hairColors[a.hairColor]);
    assert.ok(idn.uniforms[a.schoolKey]);
  }
  assert.ok(girlsSkirt / girls > 0.65 && girlsSkirt / girls < 0.85);
  assert.ok(glasses / 400 > 0.25 && glasses / 400 < 0.45);
});

test('像素小人：每所學校都有完整制服與運動服調色盤，且彼此不同', () => {
  const idn = data.identities;
  const names = idn.schools.flatMap((s) => s.names);
  for (const n of names) assert.ok(isCompletePalette(idn.uniforms[n]), n);
  const sigs = new Set(names.map((n) => JSON.stringify(idn.uniforms[n])));
  assert.equal(sigs.size, names.length);
});

test('像素小人：avatarSVG 為純函式，輸出隨學校與狀態改變', () => {
  const idn = data.identities;
  const id = generateIdentity(7, idn);
  const spec = avatarSpec(id, idn, 7);
  const svg = avatarSVG(spec, { outfit: 'uniform' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('shape-rendering="crispEdges"') && svg.includes('viewBox="0 0 16 24"'));
  assert.equal(svg, avatarSVG(spec, { outfit: 'uniform' }));
  const other = { ...spec, uniform: idn.uniforms[Object.keys(idn.uniforms).find((k) => k !== id.schoolKey)] };
  assert.notEqual(svg, avatarSVG(other, { outfit: 'uniform' }));
  for (const o of [{ outfit: 'pe' }, { outfit: 'casual' }, { frame: 1 }, { tired: true }, { phone: true, glow: true }, { mood: 'happy' }, { mood: 'sad' }, { bandage: true }, { gaming: true, sweat: true, backpack: true, hw: 'chat' }, { hw: 'paper', slouch: true }]) {
    const v = avatarSVG(spec, o);
    assert.ok(v.startsWith('<svg') && v !== svg, JSON.stringify(o));
  }
  const dead = avatarSVG(spec, { dead: true });
  assert.ok(dead.includes('opacity="0.5"') && dead.includes('feColorMatrix'));
  for (let seed = 1; seed <= 100; seed++) {
    const i2 = generateIdentity(seed, idn);
    assert.ok(avatarSVG(avatarSpec(i2, idn, seed), {}).startsWith('<svg'));
  }
  const st = newState(3, data);
  const o = avatarOptsFromState(st, data.timeline[0]);
  assert.equal(o.outfit, 'uniform');
  assert.equal(avatarOptsFromState(st, { vacation: true }).outfit, 'casual');
});

test('家境：補習科數受家裡負擔上限限制，衝擊使上限下降、到期後恢復', () => {
  const find = (econ) => { for (let s = 1; s < 2000; s++) { const st = newState(s, data); if (st.identity.family.econ === econ) return st; } };
  for (const [econ, cap, maxLv] of [['寬裕', 3, 3], ['小康', 2, 2], ['吃緊', 0, 1]]) {
    const st = find(econ);
    assert.equal(tutorCap(st), cap);
    assert.equal(tutorMaxLevel(st), maxLv);
    st.habits.補習 = 3;
    const res = startTurn(st, data);
    assert.equal(st.habits.補習, maxLv, econ);
    if (maxLv < 3) assert.ok(res.tl && st.cur.lines.some((l) => l.text.includes('補習先停一科')));
    finishTurn(st, data);
  }
  const st = find('寬裕');
  st.fam = { shock: { id: 'unemployed', from: 0, until: 3 } };
  assert.equal(effectiveEcon(st), '小康');
  assert.equal(tutorCap(st), 2);
  st.habits.補習 = 3;
  startTurn(st, data);
  assert.equal(st.habits.補習, 2);
  finishTurn(st, data);
  st.turn = 3;
  const tl = data.timeline[3];
  const out = famStep(st, data, tl);
  assert.equal(shockOf(st), null);
  assert.ok(out.lines.length === 1);
  assert.equal(tutorCap(st), 3);
  const g = find('小康');
  g.fam = { shock: { id: 'promo', from: 0, until: 9 } };
  assert.equal(tutorCap(g), 3);
});

test('家境衝擊：頻率適中、可重現，且伴隨有選項的卡片', () => {
  let total = 0, seeds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const st = newState(seed, data);
    let n = 0;
    while (!st.ended) {
      const res = startTurn(st, data);
      if (st.fam && st.fam.shock && st.fam.shock.from === st.turn) { n++; assert.ok(res.card && res.card.id.startsWith('fam_') || st.delayed.some((d) => d.event.startsWith('fam_'))); }
      if (res.card) chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
      finishTurn(st, data);
      if (st.dead) break;
    }
    total += n; seeds++;
  }
  const avg = total / seeds;
  assert.ok(avg > 0.5 && avg < 3.5, `平均每局 ${avg} 次`);
});

test('錢包：低錢包時風險卡權重上升、誘惑卡被擋；高錢包相反', () => {
  const st = newState(5, data), tl = data.timeline[4];
  const weight = (id, wallet) => {
    st.stats.錢包 = wallet;
    const c = data.cardIndex[id], ctx = buildCtx(st, tl);
    if (!passes(c, st, ctx)) return 0;
    return (c.weight ?? 1) * (c.modifiers || []).reduce((x, m) => (evalCond(m.if, ctx) ? x * m.x : x), 1);
  };
  for (const id of ['high_pay_job', 'money_borrow']) {
    assert.ok(weight(id, 50) > weight(id, 250) && weight(id, 250) > 0, id);
    assert.equal(weight(id, 3500), 0, id);
  }
  for (const id of ['tempt_gacha', 'tempt_boba', 'tempt_shoes', 'tempt_treat']) {
    assert.equal(weight(id, 100), 0, id);
    assert.ok(weight(id, 4000) > weight(id, 2000) && weight(id, 2000) > 0, id);
  }
  assert.ok(weight('haohao_treat', 100) >= weight('haohao_treat', 3000));
  // 社交邀約錢不夠時：可以先請同學墊（欠人情）；非社交的花費則直接灰掉
  st.stats.錢包 = 100;
  const ctx = buildCtx(st, tl);
  const view = describeCard(data.cardIndex.karaoke_invite, st, ctx);
  assert.ok(!view.choices[0].disabled && view.choices[0].owe === 200);
  const camp = describeCard(data.cardIndex.teacher_camp, st, ctx);
  assert.ok(camp.choices[0].disabled);
  const st2 = newState(5, data); st2.stats.錢包 = 100;
  applyChoice(st2, data, data.cardIndex.karaoke_invite, 0, buildCtx(st2, tl), stateRng(st2), 4);
  assert.equal(st2.stats.錢包, 0);
  assert.equal(st2.debt, 200);
  assert.ok(st2.delayed.some((d) => d.event === 'debt_favor'));
  // 錢包低迷時心情每回合 −1
  const a = newState(9, data), b = newState(9, data);
  a.stats.錢包 = 0; b.stats.錢包 = 5000; a.habits.手機 = 0; b.habits.手機 = 0;
  const m = (s) => { applyHabits(s, data, data.timeline[1], stateRng(s)); return s.stats.心情; };
  assert.ok(m(b) > m(a));
});

function gameShare(level, seeds = 12, dropAt = null) {
  let turns = 0, hits = 0, late = 0, lateTurns = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const st = newState(seed, data);
    while (!st.ended && !st.dead) {
      st.habits.遊戲 = dropAt !== null && st.turn >= dropAt ? 0 : level;
      const res = startTurn(st, data);
      const g = res.card && res.card.id.startsWith('game_');
      turns++; if (g) hits++;
      if (dropAt !== null && st.turn >= dropAt + 5) { lateTurns++; if (g) late++; }
      if (res.card) chooseCard(st, data, res.card.choices.find((c) => !c.disabled && !c.label.startsWith('這次先不')).i);
      finishTurn(st, data);
    }
  }
  return { share: hits / turns, late: lateTurns ? late / lateTurns : 0 };
}

test('手遊牽引：高等級時遊戲卡明顯變多；降到 0 後數回合內退光', () => {
  const hi = gameShare(3).share, lo = gameShare(0).share, one = gameShare(1).share;
  assert.equal(lo, 0);
  assert.ok(hi > 0.3 && hi > one && one > 0.1, `hi=${hi} one=${one}`);
  const q = gameShare(3, 12, 20);
  assert.ok(q.late < 0.02, `退出後仍有遊戲卡 ${q.late}`);
});

test('連續婉拒手遊邀約三次，出現公會的提問', () => {
  const st = newState(2, data);
  st.habits.遊戲 = 3;
  const lines = [];
  for (let i = 0; i < 60 && lines.length < 1 && !st.ended; i++) {
    const res = startTurn(st, data);
    if (res.card && res.card.id.startsWith('game_')) {
      chooseCard(st, data, res.card.choices.find((c) => c.label.startsWith('這次先不')).i);
      for (const l of st.cur.lines) if (l.text.includes('公會的人問你是不是不玩了')) lines.push(l.text);
    } else if (res.card) chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
    finishTurn(st, data);
  }
  assert.equal(lines.length, 1);
  assert.ok(st.gameDecline >= 3);
});

test('零用錢：投資報酬可重現、帳戶不為負；存下／投資讓花錢的社交選項更難負擔', () => {
  const run = (seed) => {
    const st = newState(seed, data);
    st.habits.零用錢 = '投資';
    const bal = [];
    while (!st.ended && !st.dead) {
      const res = startTurn(st, data);
      if (res.card) {
        // 這個測試只看投資帳戶本身：避開會改變零用錢用途的選項
        const raw = data.cardIndex[res.card.id].choices;
        const pick = res.card.choices.find((c) => !c.disabled && !(raw[c.i].setHabits && raw[c.i].setHabits.零用錢)) || res.card.choices.find((c) => !c.disabled);
        chooseCard(st, data, pick.i);
      }
      finishTurn(st, data);
      bal.push(st.stats.投資);
      assert.ok(st.stats.投資 >= 0 && st.stats.錢包 >= 0 && st.stats.投資本金 >= 0);
    }
    return bal;
  };
  const a = run(4), b = run(4), c = run(5);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a[a.length - 1] > 0);
  const st = newState(5, data);
  const ctx = buildCtx(st, data.timeline[4]);
  st.stats.錢包 = 400;
  const dis = (mode) => { st.habits.零用錢 = mode; return describeCard(data.cardIndex.karaoke_invite, st, ctx).choices[0]; };
  assert.equal(dis('花掉').disabled, false);
  assert.equal(dis('存下').disabled, true);
  assert.equal(dis('存下').reason, '想存錢');
  assert.equal(dis('投資').disabled, true);
  // 花掉 → 錢包偏低；存下 → 錢包累積
  const wallet = (mode) => { const s2 = newState(7, data); s2.habits.零用錢 = mode; for (let i = 0; i < 20; i++) { startTurn(s2, data); finishTurn(s2, data); } return s2.stats.錢包; };
  assert.ok(wallet('存下') > wallet('花掉'));
});

test('代價規則：每個打工選項都有體力、理解、睡眠債的代價；AI 解釋觀念也有依賴代價', () => {
  for (const c of data.events.cards) for (const ch of c.choices) {
    if ((ch.setFlags || []).includes('打工中')) {
      assert.ok((ch.effects.體力 ?? 0) < 0, `${c.id}/${ch.label} 體力`);
      assert.ok((ch.hidden?.理解 ?? 0) < 0, `${c.id}/${ch.label} 理解`);
      assert.ok((ch.hidden?.睡眠債 ?? 0) > 0, `${c.id}/${ch.label} 睡眠債`);
    }
  }
  const ai = data.cardIndex.ai_homework;
  for (const ch of ai.choices) if (ch.label.includes('AI')) assert.ok(ch.hidden.AI依賴 > 0, ch.label);
  const explain = ai.choices.find((c) => c.label.startsWith('請 AI 解釋'));
  const direct = ai.choices.find((c) => c.label.startsWith('讓 AI 直接'));
  assert.ok(explain.hidden.AI依賴 < direct.hidden.AI依賴);
});

test('AI 依賴高時理解成長變慢，「考試沒有 AI」卡可以出現', () => {
  const a = newState(3, data), b = newState(3, data);
  b.stats.AI依賴 = 3;
  for (let i = 0; i < 6; i++) for (const s of [a, b]) { startTurn(s, data); finishTurn(s, data); }
  assert.ok(a.stats.理解 > b.stats.理解);
  const st = newState(3, data);
  st.stats.AI依賴 = 3;
  const c = data.cardIndex.ai_exam_stuck;
  assert.ok(passes(c, st, buildCtx(st, data.timeline[4])));
  st.stats.AI依賴 = 0;
  assert.ok(!passes(c, st, buildCtx(st, data.timeline[4])));
});

test('家規：parentRule 與家長風格相關；接受規定後手機等級被壓在上限，到期後解除', () => {
  const cnt = { 高期待: { 嚴格: 0, 普通: 0, 不太管: 0 }, 自顧不暇: { 嚴格: 0, 普通: 0, 不太管: 0 } };
  for (let s = 1; s <= 600; s++) {
    const id = generateIdentity(s, data.identities);
    if (cnt[id.family.style]) cnt[id.family.style][id.parentRule]++;
    assert.ok(['嚴格', '普通', '不太管'].includes(id.parentRule));
  }
  assert.ok(cnt.高期待.嚴格 > cnt.高期待.不太管 && cnt.自顧不暇.不太管 > cnt.自顧不暇.嚴格);
  const st = newState(8, data);
  st.habits.手機 = 4;
  const card = data.cardIndex.phone_rule;
  const r = stateRng(st);
  st.turn = 3;
  applyChoice(st, data, card, 0, buildCtx(st, data.timeline[3]), r, 3);
  assert.ok(st.rule && st.rule.cap === 2 && st.rule.until === 11);
  // 家規期間：效果照 2 級算，但不改掉玩家自己的設定
  const capped = JSON.parse(JSON.stringify(st)), free = JSON.parse(JSON.stringify(st));
  free.rule = null;
  startTurn(capped, data); startTurn(free, data);
  assert.equal(capped.habits.手機, 4);
  assert.ok(capped.stats.聯繫 < free.stats.聯繫, '家規期間手機效果應該被壓低');
  // 期滿後恢復
  st.turn = 12;
  startTurn(st, data);
  assert.equal(st.habits.手機, 4);
});

test('過年卡只會在寒假抽到；寒假變數與時間軸一致', () => {
  const ny = data.events.cards.filter((c) => c.pool === '過年');
  assert.ok(ny.length >= 5);
  const st = newState(21, data);
  for (const c of ny) {
    for (const tl of data.timeline) {
      assert.equal(passes(c, st, buildCtx(st, tl)) && c.id !== 'ny_shop', tl.seg === '寒假' && c.id !== 'ny_shop', `${c.id} @ ${tl.seg}`);
    }
  }
  for (const tl of data.timeline) assert.equal(buildCtx(st, tl).寒假, tl.seg === '寒假');
  // 實際遊玩：過年卡出現的回合都在寒假
  let seen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = newState(seed, data);
    while (!s.ended && !s.dead) {
      const res = startTurn(s, data);
      if (res.card && ny.some((c) => c.id === res.card.id)) { seen++; assert.equal(res.tl.seg, '寒假'); }
      if (res.card) chooseCard(s, data, res.card.choices.find((c) => !c.disabled).i);
      finishTurn(s, data);
    }
  }
  assert.ok(seen > 0);
});

test('打工收入：一般約 3,100／回合，加班約 6,300，假期更高；詐騙會記錄在 st.scams', async () => {
  const { workPay } = await import('../js/engine/turn.js');
  const st = newState(4, data);
  assert.equal(workPay(st, false), 0);
  st.flags.打工中 = true;
  assert.equal(workPay(st, false), 3100);
  assert.equal(workPay(st, true), 14000);
  st.flags.打工加班 = true;
  assert.equal(workPay(st, false), 6300);
  assert.ok(workPay(st, true) >= 25000);
  const s2 = newState(5, data); s2.stats.錢包 = 5000;
  const tl = data.timeline[4];
  applyChoice(s2, data, data.cardIndex.scam_shop, 0, buildCtx(s2, tl), stateRng(s2), 4);
  assert.equal(s2.scams.length, 1);
  assert.equal(s2.scams[0].loss, 2500);
  assert.equal(s2.stats.錢包, 2500);
  assert.ok(s2.delayed.some((d) => d.event === 'scam_shop_loss'));
});

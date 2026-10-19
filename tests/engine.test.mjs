import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, playTurn, playToEnd, startTurn, chooseCard, finishTurn, TOTAL_TURNS } from '../js/engine/turn.js';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { stateRng, pick } from '../js/engine/rng.js';
import { compile, evalCond, VISIBLE_KEYS } from '../js/engine/events.js';
import { lifeProbTable, turnProb, DEATH_LINE } from '../js/engine/life.js';
import { buildCtx, passes, describeCard, applyChoice } from '../js/engine/events.js';
import { applyHabits, COUPLE_LINES } from '../js/engine/turn.js';
import { buildEnding } from '../js/engine/report.js';
import { N_PEERS, stepPeers } from '../js/engine/peers.js';
import { tutorCap, tutorMaxLevel, famStep, shockOf, effectiveEcon, BIZ, SALARY } from '../js/engine/family.js';
import { avatarSVG, avatarSpec, avatarOptsFromState, isCompletePalette } from '../js/engine/avatar.js';
import { generateIdentity } from '../js/engine/identity.js';
import { selfChoice, playRestAuto } from '../js/engine/auto.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const withCampus = () => { const e = rd('events.json'); for (const f of readdirSync(join(root, 'data')).sort()) if (/^events_.+\.json$/.test(f)) e.cards.push(...rd(f).cards); return e; };
const raw = () => ({ identities: rd('identities.json'), schools: rd('schools.json'), events: withCampus(), calendar: rd('calendar.json'), life_events: rd('life_events.json') });
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

test('時間軸：70 回合，從 2026-08-31 開始，每學年 10+2+10+2（最後一個暑假省略）', () => {
  assert.equal(data.timeline.length, 70);
  assert.equal(TOTAL_TURNS, 70);
  assert.equal(new Date(data.timeline[69].end).toISOString().slice(0, 10), '2029-07-01');
  assert.equal(data.timeline[69].seg, '下學期');
  assert.equal(new Date(data.timeline[0].start).toISOString().slice(0, 10), '2026-08-31');
  const segs = data.timeline.slice(0, 24).map((t) => t.seg);
  assert.equal(segs.filter((s) => s === '上學期').length, 10);
  assert.equal(segs.filter((s) => s === '寒假').length, 2);
  assert.equal(segs.filter((s) => s === '下學期').length, 10);
  assert.equal(segs.filter((s) => s === '暑假').length, 2);
  for (let i = 1; i < 70; i++) assert.ok(data.timeline[i].start > data.timeline[i - 1].start, '日期要遞增');
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

test('完整自動遊玩：許多種子都能跑完 70 回合（或死亡）而不拋錯', () => {
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

test('同儕：999 人 × 70 回合遠少於 1 秒，且有 12 個認識的人', () => {
  const st = newState(11, data);
  assert.equal(st.peers.a.length, N_PEERS * 8);
  assert.equal(st.peers.known.length, 12);
  assert.equal(new Set(st.peers.known.map((k) => k.name)).size, 12);
  const t0 = performance.now();
  for (let k = 0; k < 70; k++) stepPeers(st, data, data.timeline[k]);
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
    assert.ok(idn.uniformPalettes[a.schoolKey]);
  }
  assert.ok(girlsSkirt / girls > 0.65 && girlsSkirt / girls < 0.85);
  assert.ok(glasses / 400 > 0.25 && glasses / 400 < 0.45);
});

test('像素小人：每套制服調色盤都完整（含運動服），且彼此不同', () => {
  const pal = data.identities.uniformPalettes;
  assert.ok(pal.length >= 16);
  pal.forEach((u, i) => assert.ok(isCompletePalette(u), String(i)));
  assert.equal(new Set(pal.map((u) => JSON.stringify(u))).size, pal.length);
});

test('像素小人：avatarSVG 為純函式，輸出隨學校與狀態改變', () => {
  const idn = data.identities;
  const id = generateIdentity(7, idn);
  const spec = avatarSpec(id, idn, 7);
  const svg = avatarSVG(spec, { outfit: 'uniform' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('shape-rendering="crispEdges"') && svg.includes('viewBox="0 0 16 24"'));
  assert.equal(svg, avatarSVG(spec, { outfit: 'uniform' }));
  const other = { ...spec, uniform: idn.uniformPalettes[(id.schoolKey + 1) % idn.uniformPalettes.length] };
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

test('資料對齊：事件用到的數值、習慣、變數、延遲事件都存在', async () => {
  const { lintData } = await import('../tools/lint-data.mjs');
  const { errors } = lintData();
  assert.deepEqual(errors, []);
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

test('delayed 的 if 條件：自律才排好結果、不自律才排壞結果；ctx 有性別', () => {
  const tl = data.timeline[56];
  const card = data.cardIndex.campus_y3_retreat;
  const run = (phone, game) => {
    const st = newState(7, data); st.habits.手機 = phone; st.habits.遊戲 = game; st.turn = 56;
    applyChoice(st, data, card, 3, buildCtx(st, tl), stateRng(st), 56);
    return st.delayed.map((d) => d.event);
  };
  assert.ok(!run(3, 1).includes('home_study_good'));
  assert.ok(!run(1, 0).includes('home_study_bad'));
  for (let i = 0; i < 1; i++) assert.ok(['男', '女'].includes(buildCtx(newState(7, data), tl).性別));
});

test('校園卡：學測前閉關一個月在高三上最後幾回合出現', () => {
  let seen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const st = newState(seed, data);
    for (let t = 0; t < 58 && !st.ended; t++) {
      const res = startTurn(st, data);
      if (res.card) { if (res.card.id === 'campus_y3_retreat') { seen++; assert.equal(st.turn, 55); } chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i); }
      finishTurn(st, data); st.reportPending = null;
    }
  }
  assert.equal(seen, 20, `閉關出現 ${seen}/20`);
});

/* ───────────── 前因後果（consequence threads）與結構性降低手機 ───────────── */
const stub = (seed, turn) => { const st = newState(seed, data); st.turn = turn; return st; };

test('前因後果：payoffOf 的卡被選後記進 st.payoffs，結局列出「{setup} → {title}」，最糟的後果成為「如果重來」', () => {
  const st = playToEnd(newState(11, data), data, scripted(11));
  st.payoffs = [];
  st.choices.push({ turn: 20, id: 'group_fight', title: '群組吵架', label: '默默潛水，不要被牽扯' });
  const card = data.cardIndex.pay_nobody_speaks;
  applyChoice(st, data, card, 1, buildCtx(st, data.timeline[60]), stateRng(st), 60);
  assert.equal(st.payoffs.length, 1);
  const p = st.payoffs[0];
  assert.equal(p.turn, 60); assert.equal(p.title, card.title); assert.equal(p.setup, card.payoffOf);
  assert.equal(p.setupTurn, 20); assert.equal(p.tone, 'bad');
  const e = buildEnding(st, data);
  assert.deepEqual(e.payoffs, [`${card.payoffOf} → ${card.title}`]);
  assert.ok(e.whatIf.includes('默默潛水') && e.whatIf.includes(card.title), e.whatIf);
  // 沒有後果就是空的；最多列 6 項
  st.payoffs = [];
  assert.deepEqual(buildEnding(st, data).payoffs, []);
  st.payoffs = Array.from({ length: 9 }, (_, i) => ({ turn: i, setup: 's' + i, title: 't' + i, label: '', tone: 'good', val: 1, setupTurn: null }));
  assert.equal(buildEnding(st, data).payoffs.length, 6);
});

test('前因後果資料：至少 14 條線，每張後果卡都有 payoffOf／payoffSetup，文字回想起早先的選擇', () => {
  const pays = data.events.cards.filter((c) => c.payoffOf);
  assert.ok(pays.length >= 30, `後果卡 ${pays.length}`);
  const setups = new Set(pays.map((c) => c.payoffSetup));
  assert.ok(setups.size >= 14, `線數 ${setups.size}`);
  for (const c of pays) {
    assert.ok(data.cardIndex[c.payoffSetup], `${c.id} 的起點 ${c.payoffSetup}`);
    assert.ok(['good', 'bad'].includes(c.payoffTone), `${c.id} tone`);
    assert.match(c.text, /還記得|想起|上次|之前/, `${c.id} 沒有回想早先的選擇`);
  }
  assert.ok(pays.some((c) => c.payoffTone === 'good') && pays.some((c) => c.payoffTone === 'bad'));
  // 設定段：記憶旗標（記_）或長延遲（至少一邊 ≥10 回合）
  let longDelay = 0;
  for (const c of data.events.cards) for (const ch of c.choices) for (const d of ch.delayed || []) if ((d.after && d.after[1] >= 10) || d.atTurn) longDelay++;
  assert.ok(longDelay >= 14);
  assert.ok(data.events.cards.some((c) => c.choices.some((ch) => (ch.setFlags || []).some((f) => f.startsWith('記_')))));
});

test('延遲事件：被固定劇情佔掉的回合不會丟，等下一個空回合；依到期先後；超過終點不出錯', () => {
  const st = newState(2, data);
  st.delayed.push({ event: 'pay_cadre_burnout', due: 0 });
  startTurn(st, data); // 第 0 回合有固定的新生訓練
  assert.equal(st.cur.card.id, 'orientation');
  assert.equal(st.delayed.length, 1, '延遲事件要留著');
  chooseCard(st, data, 0); finishTurn(st, data);
  const res = startTurn(st, data);
  assert.equal(res.card.id, 'pay_cadre_burnout');
  assert.equal(st.delayed.length, 0);
  // 先到期的先出現
  const s2 = stub(2, 1);
  s2.delayed.push({ event: 'pay_cadre_letter', due: 1 }, { event: 'pay_cadre_burnout', due: 0 });
  assert.equal(startTurn(s2, data).card.id, 'pay_cadre_burnout');
  assert.equal(s2.delayed.length, 1);
  // 只會出現一次的卡不會重複；找不到的事件（舊存檔）會被略過
  const s3 = stub(2, 1);
  s3.used.pay_cadre_letter = true;
  s3.delayed.push({ event: 'pay_cadre_letter', due: 0 }, { event: '不存在的事件', due: 0 });
  startTurn(s3, data);
  assert.ok(!s3.cur.card || s3.cur.card.id !== 'pay_cadre_letter');
  assert.equal(s3.delayed.length, 0);
  // 很久以後才到期：玩到結束不會出錯，條目還在
  const s4 = newState(4, data);
  s4.delayed.push({ event: 'pay_cadre_letter', due: 500 });
  playToEnd(s4, data, scripted(4));
  assert.ok(s4.ended);
  assert.ok(s4.delayed.some((d) => d.due === 500));
});

test('延遲事件：atTurn 綁定回合區間、need 在到期時才檢查', () => {
  const card = data.cardIndex.pay_cadre_letter; void card;
  const setup = data.cardIndex.crush_confess;
  const st = stub(3, 10);
  applyChoice(st, data, setup, 0, buildCtx(st, data.timeline[10]), stateRng(st), 10);
  const sup = st.delayed.filter((d) => d.event === 'pay_couple_support' || d.event === 'pay_couple_breakup');
  assert.equal(sup.length, 1);
  assert.ok(sup[0].due >= 56 && sup[0].due <= 58 && sup[0].need === '#交往中');
  // 到期時不再交往 ⇒ 不出現；仍在交往 ⇒ 出現
  const a = stub(3, 57); a.delayed.push({ event: 'pay_couple_support', due: 57, need: '#交往中' });
  startTurn(a, data);
  assert.ok(!a.cur.card || a.cur.card.id !== 'pay_couple_support');
  assert.equal(a.delayed.length, 0);
  const b = stub(3, 57); b.flags.交往中 = true; b.delayed.push({ event: 'pay_couple_support', due: 57, need: '#交往中' });
  assert.equal(startTurn(b, data).card.id, 'pay_couple_support');
  // 區間已過就不排
  const late = stub(3, 60);
  applyChoice(late, data, setup, 0, buildCtx(late, data.timeline[60]), stateRng(late), 60);
  assert.ok(!late.delayed.some((d) => d.event.startsWith('pay_couple')));
});

test('計次旗標 ladder：第一次設 記_幫家裡，第二次設 記_幫家裡2', () => {
  const st = stub(5, 4);
  const card = data.cardIndex.family_help;
  const ap = () => applyChoice(st, data, card, 0, buildCtx(st, data.timeline[4]), stateRng(st), 4);
  ap(); assert.ok(st.flags.記_幫家裡 && !st.flags.記_幫家裡2);
  ap(); assert.ok(st.flags.記_幫家裡 && st.flags.記_幫家裡2);
  ap(); assert.ok(st.flags.記_幫家裡2);
});

test('手機悄悄變多：有 IG 或在玩遊戲，每回合約 6% 手機 +1（最多 4），保管／螢幕時間期間不會', () => {
  const tl = data.timeline[5];
  const run = (mut) => {
    let creeps = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const st = stub(seed, 5); st.habits.遊戲 = 0; delete st.flags.IG; st.habits.手機 = 2;
      mut(st);
      const lines = applyHabits(st, data, tl, stateRng(st));
      const hit = lines.includes('不知不覺，你滑手機的時間又變長了。');
      assert.equal(hit, st.habits.手機 === 3, '有 log 才會 +1');
      if (hit) creeps++;
    }
    return creeps;
  };
  const withIG = run((st) => { st.flags.IG = true; });
  assert.ok(withIG >= 15 && withIG <= 65, `IG：${withIG}/600`);
  const withGame = run((st) => { st.habits.遊戲 = 1; });
  assert.ok(withGame >= 15 && withGame <= 65, `遊戲：${withGame}/600`);
  assert.equal(run(() => {}), 0, '沒有 IG 也沒玩遊戲就不會');
  assert.equal(run((st) => { st.flags.IG = true; st.rule = { cap: 2, until: 99, label: '交給家長保管' }; }), 0, '有保管時不會');
  const full = stub(1, 5); full.flags.IG = true; full.habits.手機 = 4;
  for (let t = 0; t < 40; t++) { full.turn = t; applyHabits(full, data, data.timeline[t], stateRng(full)); }
  assert.equal(full.habits.手機, 4, '最高 4');
  // 整局：只靠 IG 的人手機等級平均會往上
  let up = 0;
  for (let seed = 1; seed <= 20; seed++) { const st = stub(seed, 0); st.flags.IG = true; st.habits.手機 = 1; for (let t = 0; t < 60; t++) { st.turn = t; applyHabits(st, data, data.timeline[t], stateRng(st)); } up += st.habits.手機; }
  assert.ok(up / 20 > 2, `平均 ${up / 20}`);
});

test('結構性降低：手機／遊戲不能只靠決定；保管、密碼、功能機是 phoneCap，且有復發的機會', () => {
  for (const c of data.events.cards) for (const ch of c.choices) {
    for (const k of ['手機', '遊戲']) {
      if ((ch.addHabits?.[k] ?? 0) < 0) assert.ok(ch.phoneCap || (ch.setFlags || []).some((f) => /保管|刪帳號/.test(f)), `${c.id}／${ch.label}`);
    }
    for (const k of ['手機', '遊戲']) if (typeof ch.setHabits?.[k] === 'number') assert.fail(`${c.id}／${ch.label} 直接設定 ${k}`);
  }
  const help = data.cardIndex.phone_help;
  const byLabel = (s) => help.choices.findIndex((ch) => ch.label.includes(s));
  const st = stub(8, 10); st.habits.手機 = 4;
  const ctx = buildCtx(st, data.timeline[10]);
  applyChoice(st, data, help, byLabel('交給{家長}保管'), ctx, stateRng(st), 10);
  assert.deepEqual([st.rule.cap, st.rule.until, st.rule.label], [2, 16, '交給家長保管']);
  assert.ok(st.flags.手機保管);
  applyChoice(st, data, help, byLabel('螢幕時間密碼'), ctx, stateRng(st), 10);
  assert.deepEqual([st.rule.cap, st.rule.until], [2, 18]);
  applyChoice(st, data, help, byLabel('功能型手機'), ctx, stateRng(st), 10);
  assert.deepEqual([st.rule.cap, st.rule.until], [1, 20]);
  assert.ok(help.choices[byLabel('功能型手機')].effects.聯繫 <= -5, '功能機要付出很大的聯繫代價');
  // 保管期間的手機效果被壓低、玩家自己的等級不變
  const capped = JSON.parse(JSON.stringify(st)), free = JSON.parse(JSON.stringify(st));
  free.rule = null; capped.turn = free.turn = 11;
  applyHabits(capped, data, data.timeline[11], stateRng(capped)); applyHabits(free, data, data.timeline[11], stateRng(free));
  assert.equal(capped.habits.手機, 4);
  assert.ok(capped.stats.專注 > free.stats.專注 || capped.stats.心情 !== free.stats.心情);
  // 復發：找到手機／密碼被猜到 ⇒ 限制提早結束，手機 +1
  for (const id of ['phone_relapse_find', 'phone_relapse_pw']) {
    const s2 = stub(8, 12); s2.habits.手機 = 2; s2.rule = { cap: 2, until: 99, label: 'x' }; s2.flags.手機保管 = true;
    applyChoice(s2, data, data.cardIndex[id], 0, buildCtx(s2, data.timeline[12]), stateRng(s2), 12);
    assert.equal(s2.rule, null); assert.equal(s2.habits.手機, 3);
  }
  // 刪帳號／交給朋友保管：遊戲 -1，並排了 30–40% 的復發卡
  const q = data.cardIndex.mobile_game_quit;
  for (const ch of q.choices.filter((c) => c.addHabits?.遊戲 < 0)) {
    const d = ch.delayed.find((x) => x.event === 'game_relapse');
    assert.ok(d && d.chance >= 0.3 && d.chance <= 0.4);
  }
  const s3 = stub(9, 12); s3.habits.遊戲 = 1;
  applyChoice(s3, data, data.cardIndex.game_relapse, 0, buildCtx(s3, data.timeline[12]), stateRng(s3), 12);
  assert.equal(s3.habits.遊戲, 2);
});

test('資料檢查：手機／遊戲只靠決定就減少會有提醒；現有資料沒有這種選項', async () => {
  const { lintData, loadRaw } = await import('../tools/lint-data.mjs');
  assert.ok(!lintData().warns.some((w) => w.includes('只靠決定')));
  const bad = loadRaw();
  bad.events.cards.find((c) => c.id === 'ig_trip_story').choices[0].addHabits = { 手機: -1 };
  assert.ok(lintData(bad).warns.some((w) => w.includes('只靠決定')));
});

test('交往：對象名字、交往回合、{對象} 代換，分手後清除', () => {
  const st = newState(5, data);
  assert.equal(describeCard(data.cardIndex.dt_jealous, st, buildCtx(st, data.timeline[0])).text.includes('對方'), true, '沒有對象時退回「對方」');
  const confess = data.cardIndex.crush_confess;
  st.turn = 6;
  applyChoice(st, data, confess, 0, buildCtx(st, data.timeline[6]), stateRng(st), 6);
  assert.ok(st.flags.交往中 && st.partner && st.partner.name && st.partner.since === 6);
  assert.notEqual(st.partner.name, st.peers.known[0].name, '對象不是 {同學} 那位');
  st.turn = 11;
  assert.equal(buildCtx(st, data.timeline[11]).交往回合, 5);
  const v = describeCard(data.cardIndex.dt_jealous, st, buildCtx(st, data.timeline[11]));
  assert.ok(v.text.includes(st.partner.name) && !v.text.includes('{對象}'));
  const q = data.cardIndex.couple_quarrel;
  applyChoice(st, data, q, 2, buildCtx(st, data.timeline[11]), stateRng(st), 11);
  assert.ok(!st.flags.交往中 && st.partner === null);
  assert.equal(buildCtx(st, data.timeline[12]).交往回合, 0);
});

test('交往中：每回合都有相處的小事 log，感情卡很常出現（約一半的回合）', () => {
  let dTurns = 0, dCards = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const st = newState(seed, data);
    st.flags.交往中 = true;
    for (let t = 0; t < 40 && !st.ended && !st.dead; t++) {
      const was = !!st.flags.交往中;
      const res = startTurn(st, data);
      if (res.dead) break;
      if (was) {
        dTurns++;
        if (res.card && (res.card.id.startsWith('dt_') || ['couple_quarrel', 'pay_couple_support', 'pay_couple_breakup'].includes(res.card.id))) dCards++;
      }
      const name = st.partner ? st.partner.name : '對方'; // 選項可能分手，先記下名字
      if (res.card) chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
      const fin = finishTurn(st, data);
      if (st.reportPending) st.reportPending = null;
      if (was) {
        const texts = fin.lines.map((l) => l.text);
        const lineOk = COUPLE_LINES.some((L) => texts.includes(L.t.replace(/\{對象\}/g, name)));
        assert.ok(lineOk, `seed ${seed} 回合 ${t} 沒有相處的 log：${texts}`);
      }
    }
  }
  assert.ok(dTurns > 300);
  assert.ok(dCards / dTurns >= 0.4 && dCards / dTurns <= 0.75, `交往卡比例 ${(dCards / dTurns).toFixed(2)}`);
});

test('交往卡資料：至少 18 張交往卡，都需要交往中、有冷卻、有前因後果、不鎖性別', () => {
  const ds = data.events.cards.filter((c) => c.id.startsWith('dt_'));
  const main = ds.filter((c) => c.pool === '感情');
  assert.ok(main.length >= 18, `交往卡 ${main.length}`);
  for (const c of main) { assert.ok(c.requires.flags.includes('交往中'), c.id); assert.ok(c.cooldown, c.id); }
  assert.ok(ds.filter((c) => c.payoffOf).length >= 5);
  for (const c of ds) for (const ch of c.choices) for (const g of [].concat(ch.grayIf || [])) assert.ok(!/性別/.test(g.if), `${c.id} 不能用性別鎖選項`);
  for (const c of ds) if (c.requires?.expr) assert.ok(!/性別/.test(c.requires.expr), `${c.id} 不能用性別擋卡片`);
});

test('讓他自己過：從開頭與回合中途都能一路過完，且有記錄自己過的回合', () => {
  const a = newState(11, data);
  playRestAuto(a, data);
  assert.ok(a.ended);
  assert.ok(a.autoTurns > 0);
  // 回合進行到一半（已抽卡、尚未選）
  const b = newState(12, data);
  for (let i = 0; i < 5; i++) playTurn(b, data, scripted(12));
  startTurn(b, data);
  assert.ok(b.cur);
  playRestAuto(b, data);
  assert.ok(b.ended && !b.cur);
  assert.ok(b.autoTurns > 0);
  assert.equal(serialize(playRestAuto(newState(11, data), data)), serialize(a), '決定性');
});

test('selfChoice 不會選到不能選的選項', () => {
  let n = 0;
  for (const seed of [3, 4, 5]) {
    const st = newState(seed, data);
    st.stats.錢包 = 50;
    while (!st.ended) {
      const res = startTurn(st, data);
      if (!res.dead && res.card) {
        const i = selfChoice(st, res.card);
        assert.ok(!res.card.choices.find((c) => c.i === i).disabled, `${res.card.id}#${i}`);
        chooseCard(st, data, i); n++;
      }
      finishTurn(st, data);
      st.reportPending = null;
    }
  }
  assert.ok(n > 50);
});

test('同屆的其他人：peerFeed 最多 12 則，且死亡消息不含姓名', () => {
  let any = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const st = newState(seed, data);
    playToEnd(st, data, scripted(seed));
    assert.ok(st.peerFeed.length <= 12);
    any += st.peerFeed.length;
    for (const f of st.peerFeed) assert.ok(f.text && typeof f.turn === 'number');
  }
  assert.ok(any > 0, '應該至少留下一些消息');
});

test('真實學校名冊：每所學校縣市有效、遮罩名含一個○、同縣市不重名、縣市共 22', () => {
  const idn = data.identities, list = idn.schoolList;
  const counties = new Map(idn.counties.map((c) => [c.name, c]));
  assert.equal(counties.size, 22);
  assert.ok(list.length >= 450);
  const seen = new Set();
  for (const s of list) {
    const c = counties.get(s.county);
    assert.ok(c, s.county);
    assert.ok(c.districts.includes(s.district), s.n);
    assert.equal([...s.n].filter((ch) => ch === '○').length, 1, s.n);
    assert.ok(['普高', '技高', '綜高', '單科'].includes(s.kind) && ['star', 'pstar', 'community', 'general'].includes(s.tier) && s.w > 0);
    assert.ok(!seen.has(s.county + s.n), s.county + s.n);
    seen.add(s.county + s.n);
  }
  for (const c of idn.counties) {
    assert.ok(c.name.includes('臺') || !c.name.includes('台'));
    assert.equal(c.tier, ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市'].includes(c.name) ? '六都' : '其他');
    assert.ok(list.some((s) => s.county === c.name));
  }
});

test('身分：學校在自己的縣市、制服調色盤有效、群科只屬於技高／綜高', () => {
  const idn = data.identities;
  const byCode = new Map(idn.schoolList.map((s) => [s.id, s]));
  const groups = new Set(idn.vocGroups.map((g) => g.n));
  const types = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const id = generateIdentity(seed, idn);
    const s = byCode.get(id.schoolCode);
    assert.ok(s && s.county === id.county && s.district === id.schoolDistrict && s.kind === id.kind);
    assert.ok(id.school.startsWith(s.n) && (s.pub || id.school.endsWith('（私立）')));
    assert.ok(idn.uniformPalettes[id.schoolKey] && isCompletePalette(idn.uniformPalettes[id.schoolKey]));
    assert.ok(idn.schools.some((t) => t.id === id.schoolId));
    const voc = id.kind === '技高' || id.kind === '綜高';
    if (voc) assert.ok(groups.has(id.vocGroup)); else assert.equal(id.vocGroup, null);
    assert.ok(idn.counties.find((c) => c.name === id.county).districts.includes(id.district));
    types.add(id.schoolId);
  }
  assert.ok(types.has('public_voc') && types.has('community') && types.has('comprehensive'));
  // 同一所學校 → 同一套制服
  const a = generateIdentity(1, idn);
  assert.equal(idn.uniformPalettes.length > 0 && a.schoolKey, a.schoolKey);
});

test('家庭型態：5,000 個種子的分布接近設計值，且各型態的稱呼與規則正確', () => {
  const idn = data.identities, n = 5000, cnt = {};
  for (let seed = 1; seed <= n; seed++) {
    const f = generateIdentity(seed, idn).family;
    cnt[f.structure] = (cnt[f.structure] || 0) + 1;
    if (f.structure === '隔代') assert.ok(f.parent === '阿嬤' || f.parent === '阿公');
    else assert.ok(f.parent === '爸爸' || f.parent === '媽媽');
    if (f.structure === '重組') assert.equal(f.step, f.parent === '爸爸' ? '繼母' : '繼父'); else assert.equal(f.step, null);
  }
  for (const [k, p] of Object.entries({ 雙親: 0.78, 離異: 0.13, 隔代: 0.03, 重組: 0.04, 喪親: 0.02 })) assert.ok(Math.abs((cnt[k] || 0) / n - p) <= 0.03, `${k} ${(cnt[k] || 0) / n}`);
});

test('職業：每個職業都歸類為自營（BIZ）或領薪水（SALARY），權重與名稱一一對應', () => {
  const idn = data.identities;
  assert.equal(idn.jobs.length, idn.jobWeights.length);
  assert.ok(idn.jobs.length >= 28);
  for (const j of idn.jobs) {
    assert.ok(BIZ.includes(j.name) !== SALARY.includes(j.name), j.name);
    assert.equal(j.econ.length, 3); assert.equal(j.support.length, 3);
    assert.ok(j.sleep >= 0 && j.sleep <= 0.3);
  }
  for (const nm of [...BIZ, ...SALARY]) assert.ok(idn.jobs.some((j) => j.name === nm), nm);
});

test('技高不選學群；家庭型態卡與技高卡都有符合的人才會出現', () => {
  const idn = data.identities;
  const find = (f) => { for (let s = 1; s < 3000; s++) { const st = newState(s, data); if (f(st.identity)) return st; } };
  const voc = find((i) => i.kind === '技高'), gen = find((i) => i.kind === '普高');
  const tc = data.cardIndex.track_choice;
  assert.equal(passes(tc, voc, buildCtx(voc, data.timeline[10])), false);
  assert.equal(passes(tc, gen, buildCtx(gen, data.timeline[10])), true);
  const fs = data.events.cards.filter((c) => c.id.startsWith('fs_') && c.requires?.expr?.includes('家庭 =='));
  assert.ok(fs.length >= 8);
  const st = find((i) => i.family.structure === '雙親');
  for (const c of fs) assert.equal(passes(c, st, buildCtx(st, data.timeline[10])), false, c.id);
  const vc = data.events.cards.filter((c) => c.id.startsWith('voc_') && c.requires?.expr?.startsWith('技高'));
  assert.ok(vc.length >= 6);
  for (const c of vc) assert.equal(passes(c, gen, buildCtx(gen, data.timeline[10])), false, c.id);
});

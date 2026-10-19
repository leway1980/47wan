// 終局句庫：決定性、多樣性、沒有殘留佔位符
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, playToEnd } from '../js/engine/turn.js';
import { newState } from '../js/engine/state.js';
import { stateRng, pick } from '../js/engine/rng.js';
import { buildEnding, computeOutcome } from '../js/engine/report.js';
import { composeEnding, endingCtx } from '../js/engine/ending.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const events = rd('events.json');
for (const f of readdirSync(join(root, 'data')).sort()) if (/^events_.+\.json$/.test(f)) events.cards.push(...rd(f).cards);
const data = prepareData({ identities: rd('identities.json'), schools: rd('schools.json'), events, calendar: rd('calendar.json'), life_events: rd('life_events.json'), slots: rd('slots.json'), endings: rd('endings.json') });

// 兩種「玩家」：習慣與選擇各自由自己的亂數決定
function player(salt) {
  return (seed) => {
    const r = stateRng({ rngS: (seed * 2654435761 + salt) >>> 0 }, 'rngS');
    return {
      habits(st) {
        if (st.turn % 7 === 0) {
          st.habits.手機 = Math.floor(r() * 5); st.habits.睡前手機 = r() < 0.4; st.habits.補習 = Math.floor(r() * 4);
          st.habits.運動 = Math.floor(r() * 3); st.habits.遊戲 = Math.floor(r() * 4);
        }
      },
      choose(st, card) { return pick(r, card.choices.filter((c) => !c.disabled)).i; },
    };
  };
}
const playA = player(11), playB = player(98765);
const play = (seed, mk) => { const st = newState(seed, data); playToEnd(st, data, mk(seed)); return st; };
const text = (e) => e.sections.map((s) => s.text).join('|') + '|' + e.good + '|' + e.regret;

test('終局句庫：同種子＋同選擇 ⇒ 同結局（不用 Math.random）', () => {
  for (const seed of [3, 17, 99]) {
    const a = buildEnding(play(seed, playA), data), b = buildEnding(play(seed, playA), data);
    assert.equal(text(a), text(b));
  }
});

test('終局句庫：同種子、不同選擇 ⇒ 多半不同結局', () => {
  let diff = 0, n = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const a = play(seed, playA), b = play(seed, playB);
    if (a.dead || b.dead) continue;
    n++;
    if (text(buildEnding(a, data)) !== text(buildEnding(b, data))) diff++;
  }
  console.log(`# 不同選擇結局不同：${diff}/${n}`);
  assert.ok(diff / n >= 0.8, `不同選擇只有 ${diff}/${n} 局結局不同`);
});

test('終局句庫：300 局的多樣性、佔位符與面向完整', () => {
  const s30 = new Set(), cnt = {};
  let n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const st = play(seed, playA);
    if (st.dead) continue;
    n++;
    const e = buildEnding(st, data);
    assert.equal(e.sections.length, 4);
    for (const s of e.sections) assert.ok(s.text && !/[{}]/.test(s.text), `${seed} ${s.age}：${s.text}`);
    assert.ok(!/[{}]/.test(e.good + e.regret));
    s30.add(e.sections[3].text);
    const c = composeEnding(st, data, e.outcome, e.archetype);
    for (const p of c.picks) cnt[`${p.facet}#${p.i}`] = (cnt[`${p.facet}#${p.i}`] || 0) + 1;
  }
  const top = Object.entries(cnt).filter(([k]) => !k.startsWith('good') && !k.startsWith('regret')).sort((a, b) => b[1] - a[1])[0];
  console.log(`# 終局多樣性：${n} 局中 30 歲段落不重複 ${s30.size} 種；最常出現的句子 ${top[0]} 占 ${(top[1] / n * 100).toFixed(1)}%`);
  assert.ok(s30.size >= 250, `30 歲段落只有 ${s30.size} 種`);
  assert.ok(top[1] / n < 0.6, `${top[0]} 占 ${top[1]}/${n}`);
});

test('終局條件環境：欄位齊全且型別正確', () => {
  const st = play(5, playA);
  const c = endingCtx(st, data, st.outcome || computeOutcome(st, data), 'A');
  for (const k of ['原型', '去向', '科系', '技高', '群', '普高', '明星', '都會', '縣市', '家庭', '經濟', '職業', '性別', '理解', '專注', '睡眠債', '幸福', '心情', '聯繫', '知心', '體力', '錢包', '投資', '存款', 'AI依賴', '露餡', '手機', '睡前手機比', '運動', '補習', '遊戲', '交往過', '分手過', '被騙', '受傷', '寵物', '打工', '證照', '建教', '營隊', '家人生病', '重考', '就業']) assert.ok(k in c, k);
  assert.equal(c.存款, c.錢包 + c.投資);
  assert.ok(c.手機 >= 0 && c.手機 <= 4 && c.睡前手機比 >= 0 && c.睡前手機比 <= 1);
});

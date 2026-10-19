import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { playToEnd } from '../js/engine/turn.js';
import { newState } from '../js/engine/state.js';
import { mulberry32 } from '../js/engine/rng.js';
import { loadData, randomPolicy } from '../tools/simulate.mjs';
import { TRAITS, lifeTraits, lifeCtx, lifeRng, simulateLife } from '../js/engine/lifesim.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'data', 'lifesim.json'), 'utf8'));
const data = loadData();
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

// 參考母體的前 N 局（種子與 tools/build-lifesim-ref.mjs 相同）
const games = [];
for (let i = 0; i < 100; i++) {
  const st = newState(100001 + i, data);
  playToEnd(st, data, randomPolicy(st));
  if (!st.dead && st.outcome) games.push({ st, traits: lifeTraits(st, data, cfg) });
}
const lives = games.map(({ st, traits }) => simulateLife(traits, lifeCtx(st), lifeRng(st), cfg));

test('人生：特質在 0–100，參考母體中位數接近 50', () => {
  for (const g of games) for (const t of TRAITS) assert.ok(g.traits[t] >= 0 && g.traits[t] <= 100, t);
  for (const t of TRAITS) { const m = med(games.map((g) => g.traits[t])); assert.ok(m > 35 && m < 65, `${t} 中位數 ${m}`); }
});

test('人生：同一局重算結果完全相同', () => {
  const { st, traits } = games[3];
  const a = simulateLife(traits, lifeCtx(st), lifeRng(st), cfg), b = simulateLife(traits, lifeCtx(st), lifeRng(st), cfg);
  assert.deepEqual(a, b);
});

test('人生：沒有伴就沒有孩子，孩子數 0–3，孩子特質 0–100，機率在夾限內', () => {
  const [lo, hi] = cfg.weights.clamp;
  for (const L of lives) {
    if (!L.stages[35].結婚) assert.equal(L.kids.length, 0);
    assert.ok(L.kids.length >= 0 && L.kids.length <= 3);
    assert.equal(L.stages[40].孩子數, L.kids.length);
    for (const k of L.kids) for (const n of ['禮貌', '學業', '活潑']) assert.ok(k[n] >= 0 && k[n] <= 100);
    for (const p of Object.values(L.probs)) assert.ok(p >= lo - 1e-9 && p <= hi + 1e-9);
  }
  // 極端特質也不會突破夾限
  const rng = mulberry32(7);
  for (const v of [0, 100]) {
    const t = Object.fromEntries(TRAITS.map((k) => [k, v]));
    const L = simulateLife(t, { outcome: '私立大學', econ: '吃緊' }, rng, cfg);
    for (const p of Object.values(L.probs)) assert.ok(p >= lo - 1e-9 && p <= hi + 1e-9);
  }
});

test('人生：盡責最高四分位被提拔的比例高於最低四分位', () => {
  const rng = mulberry32(2024), rate = { hi: [0, 0], lo: [0, 0] };
  for (let i = 0; i < 6000; i++) {
    const t = Object.fromEntries(TRAITS.map((k) => [k, rng() * 100]));
    const g = t.盡責 >= 75 ? rate.hi : t.盡責 < 25 ? rate.lo : null;
    if (!g) continue;
    g[1]++; if (simulateLife(t, { outcome: '私立大學', econ: '普通' }, rng, cfg).stages[30].被提拔) g[0]++;
  }
  assert.ok(rate.hi[0] / rate.hi[1] > rate.lo[0] / rate.lo[1] + 0.05, JSON.stringify(rate));
});

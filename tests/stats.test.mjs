import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker, { computeSnap, parseSem } from '../worker/src/index.js';
import { semesterCodes, FEED_PHRASES, feedLine, maskSchool } from '../js/engine/feedcodes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* 舊版 Node：略過需要資料庫的測試 */ }
const dbTest = sqlite ? test : test.skip;

// 用 node:sqlite 假冒 D1／KV，真的執行 schema.sql 與 worker 的 SQL
function fakeEnv() {
  const raw = new sqlite.DatabaseSync(':memory:');
  raw.exec(readFileSync(join(root, 'worker/schema.sql'), 'utf8'));
  const prep = (sql) => {
    let args = [];
    const o = {
      bind(...a) { args = a; return o; },
      async first() { return raw.prepare(sql).get(...args) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...args) }; },
      async run() { raw.prepare(sql).run(...args); return {}; },
    };
    return o;
  };
  const kv = new Map();
  return { raw, DB: { prepare: prep }, SNAP: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, kv };
}
const G = '0123456789abcdef';
const post = (env, body, origin = 'https://leway1980.github.io') => worker.fetch(new Request('https://x/e', { method: 'POST', headers: { origin }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, {});
const sem = (o = {}) => ({ g: G, k: 'sem', sem: 1, c: '台中市', s: '曉峰高中', nm: '曾佳穎', ev: ['work'], ...o });

test('parseSem：只收白名單與嚴格格式，台→臺', () => {
  assert.equal(parseSem(sem()).c, '臺中市');
  for (const bad of [{ c: '火星市' }, { s: '<b>hi</b>' }, { s: 'A' }, { nm: '曾' }, { nm: 'Bob' }, { nm: '曾佳穎穎穎' }, { ev: ['hack'] }, { ev: ['work', 'date', 'pet'] }, { ev: 'work' }, { sem: 0 }, { sem: 7 }, { sem: '1' }])
    assert.equal(parseSem(sem(bad)), null, JSON.stringify(bad));
  assert.equal(parseSem(sem({ ev: ['toString'] })), null);
});

dbTest('worker：start／sem／end、拒絕自由文字、n>12 → 429、CORS', async () => {
  const env = fakeEnv();
  assert.equal((await post(env, { g: G, k: 'start' })).status, 204);
  assert.equal((await post(env, { g: G, k: 'start' })).status, 204); // 重送不重複
  assert.equal(env.raw.prepare('SELECT COUNT(*) c FROM games').get().c, 1);
  assert.equal((await post(env, sem())).status, 204);
  assert.equal(env.raw.prepare('SELECT COUNT(*) c FROM feed').get().c, 1);
  assert.equal(env.raw.prepare('SELECT c FROM feed').get().c, '臺中市');
  for (const bad of ['not json', { g: 'zz', k: 'start' }, { g: G, k: 'nope' }, sem({ nm: '我是壞人哈哈哈' }), sem({ s: '點我領獎' + 'x' }), { g: G, k: 'end', o: '隨便寫' }, JSON.stringify(sem({ ev: ['work'], pad: 'x'.repeat(1100) }))])
    assert.equal((await post(env, bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  assert.equal(env.raw.prepare('SELECT COUNT(*) c FROM feed').get().c, 1); // 壞資料沒進 feed
  let last;
  for (let i = 0; i < 12; i++) last = (await post(env, sem({ sem: 2 }))).status;
  assert.equal(last, 429);
  assert.equal(env.raw.prepare('SELECT n FROM games').get().n, 12);
  // CORS
  const ok = await post(env, { g: 'f'.repeat(16), k: 'start' }, 'http://localhost:8000');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  const evil = await post(env, { g: 'e'.repeat(16), k: 'start' }, 'https://evil.example');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const opt = await worker.fetch(new Request('https://x/e', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5500' } }), env, {});
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5500');
});

dbTest('feed 只留 300 筆；snap：畢業＝已結束＋3 天沒動靜，其餘在學', async () => {
  const env = fakeEnv();
  const now = Date.now(), DAY = 86400000;
  const ins = env.raw.prepare('INSERT INTO games (id, started, last, ended, outcome, n) VALUES (?,?,?,?,?,1)');
  ins.run('a'.repeat(16), now, now, now, '國立大學');
  ins.run('b'.repeat(16), now, now, now, 'J');
  ins.run('c'.repeat(16), now, now - 4 * DAY, null, null); // 離開 4 天：視為畢業
  ins.run('d'.repeat(16), now, now - 2 * DAY, null, null); // 還在
  ins.run('e'.repeat(16), now, now, null, null);
  for (let i = 0; i < 310; i++) await post(env, sem({ g: i.toString(16).padStart(16, '0') }));
  assert.equal(env.raw.prepare('SELECT COUNT(*) c FROM feed').get().c, 300);
  const snap = await computeSnap(env, now + 1000);
  assert.equal(snap.graduated, 3);
  assert.equal(snap.studying, 2 + 310);
  assert.deepEqual(snap.outcomes, { 國立大學: 1, J: 1 });
  assert.equal(snap.feed.length, 40);
  assert.deepEqual(snap.feed[0].ev, ['work']);
  // /snap 缺值時即時算並存入 KV；scheduled 會更新
  const r = await worker.fetch(new Request('https://x/snap'), env, {});
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal((await r.json()).graduated, 3);
  assert.ok(env.kv.has('snap'));
  await worker.scheduled({}, env);
  assert.equal(JSON.parse(env.kv.get('snap')).studying, 312);
});

test('semesterCodes：由旗標、詐騙、車禍、成績變化推出至多 2 個代碼', () => {
  const h = (t, 理解, hab = [2, 0, 0, 0, 0, 0]) => ({ t, 理解, h: hab });
  const st = {
    choices: [{ turn: 3, fl: ['打工中'] }, { turn: 4, fl: ['交往中'] }, { turn: 40, fl: ['寵物'] }],
    scams: [], luck: [{ turn: 5, text: '通勤事故（住院）' }],
    hist: [h(2, 40), h(9, 46, [2, 0, 1, 0, 0, 0])],
  };
  assert.deepEqual(semesterCodes(st, 3, 10), ['crash_hosp', 'date']); // 依優先順序取 2 個
  st.luck = []; st.scams = [{ turn: 6, type: 'x', loss: 0 }];
  assert.deepEqual(semesterCodes(st, 3, 10), ['scam', 'date']);
  assert.deepEqual(semesterCodes({ choices: [], luck: [], hist: [h(2, 40), h(9, 34)] }, 3, 10), ['exam_down']);
  assert.deepEqual(semesterCodes({}, 0, 10), []);
  for (const c of semesterCodes(st, 3, 10)) assert.ok(FEED_PHRASES[c]);
});

test('feedLine／maskSchool', () => {
  assert.equal(maskSchool('穗禾高中（私立）'), '穗禾高中');
  assert.equal(feedLine({ c: '臺中市', s: '曉峰高中', nm: '曾佳穎', ev: ['date', 'bogus'] }), '📍 臺中市・曉峰高中｜曾佳穎 交往了');
  assert.equal(feedLine({ c: 'a', s: 'b', nm: 'c', ev: ['bogus'] }), null);
});

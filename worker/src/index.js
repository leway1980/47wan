// 《47萬分之1》匿名統計 worker：收進度事件、每 5 分鐘算一次快照放進 KV。
import { FEED_PHRASES, COUNTIES, normCounty, OUTCOMES } from '../../js/engine/feedcodes.js';

const DAY = 86400000;
const STALE_MS = 3 * DAY; // 與遊戲「離開三天自動走完」一致
const MAX_BODY = 1024, MAX_N = 12, FEED_KEEP = 300, FEED_SHOW = 40;
const ORIGINS = [/^https:\/\/leway1980\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

const cors = (req) => {
  const o = req.headers.get('origin');
  const h = { vary: 'origin' };
  if (o && ORIGINS.some((re) => re.test(o))) {
    h['access-control-allow-origin'] = o;
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
    h['access-control-max-age'] = '86400';
  }
  return h;
};
const reply = (req, status, body, extra = {}) => new Response(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { ...(body != null && { 'content-type': 'application/json; charset=utf-8' }), ...cors(req), ...extra },
});

const RE = { g: /^[0-9a-f]{16}$/, school: /^[一-鿿○（）]{2,14}$/, name: /^[一-鿿]{2,4}$/ };

/** 回傳驗證過的 sem 事件欄位，不合格回 null */
export function parseSem(b) {
  const c = normCounty(b.c);
  if (!Number.isInteger(b.sem) || b.sem < 1 || b.sem > 6) return null;
  if (!COUNTIES.includes(c)) return null;
  if (typeof b.s !== 'string' || !RE.school.test(b.s)) return null;
  if (typeof b.nm !== 'string' || !RE.name.test(b.nm)) return null;
  if (!Array.isArray(b.ev) || b.ev.length > 2 || !b.ev.every((x) => typeof x === 'string' && Object.hasOwn(FEED_PHRASES, x))) return null;
  return { sem: b.sem, c, s: b.s, nm: b.nm, ev: [...new Set(b.ev)] };
}

export async function computeSnap(env, now = Date.now()) {
  const cut = now - STALE_MS;
  const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || {};
  const done = (await one('SELECT COUNT(*) AS n FROM games WHERE ended IS NOT NULL')).n || 0;
  const stale = (await one('SELECT COUNT(*) AS n FROM games WHERE ended IS NULL AND last < ?', cut)).n || 0;
  const studying = (await one('SELECT COUNT(*) AS n FROM games WHERE ended IS NULL AND last >= ?', cut)).n || 0;
  const oc = await env.DB.prepare('SELECT outcome, COUNT(*) AS n FROM games WHERE ended IS NOT NULL AND outcome IS NOT NULL GROUP BY outcome').all();
  const fd = await env.DB.prepare('SELECT t, sem, c, s, nm, ev FROM feed ORDER BY id DESC LIMIT ?').bind(FEED_SHOW).all();
  const outcomes = {};
  for (const r of oc.results || []) outcomes[r.outcome] = r.n;
  const feed = (fd.results || []).map((r) => ({ t: r.t, sem: r.sem, c: r.c, s: r.s, nm: r.nm, ev: String(r.ev).split(',').filter(Boolean) }));
  return { at: now, graduated: done + stale, studying, outcomes, feed };
}

async function handleEvent(req, env) {
  const raw = await req.text();
  if (raw.length > MAX_BODY || new TextEncoder().encode(raw).length > MAX_BODY) return reply(req, 400, { error: 'too large' });
  let b;
  try { b = JSON.parse(raw); } catch { return reply(req, 400, { error: 'bad json' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.g !== 'string' || !RE.g.test(b.g)) return reply(req, 400, { error: 'bad g' });
  const now = Date.now();
  if (b.k === 'start') {
    await env.DB.prepare('INSERT OR IGNORE INTO games (id, started, last, ended, outcome, n) VALUES (?, ?, ?, NULL, NULL, 1)').bind(b.g, now, now).run();
    return reply(req, 204, null);
  }
  if (b.k === 'sem') {
    const v = parseSem(b);
    if (!v) return reply(req, 400, { error: 'invalid' });
    const g = await env.DB.prepare('SELECT n FROM games WHERE id = ?').bind(b.g).first();
    if (g && g.n >= MAX_N) return reply(req, 429, { error: 'too many' });
    await env.DB.prepare('INSERT INTO games (id, started, last, ended, outcome, n) VALUES (?1, ?2, ?2, NULL, NULL, 1) ON CONFLICT(id) DO UPDATE SET last = ?2, n = n + 1').bind(b.g, now).run();
    if (v.ev.length) {
      await env.DB.prepare('INSERT INTO feed (t, sem, c, s, nm, ev) VALUES (?, ?, ?, ?, ?, ?)').bind(now, v.sem, v.c, v.s, v.nm, v.ev.join(',')).run();
      await env.DB.prepare('DELETE FROM feed WHERE id <= (SELECT MAX(id) FROM feed) - ?').bind(FEED_KEEP).run();
    }
    return reply(req, 204, null);
  }
  if (b.k === 'end') {
    if (typeof b.o !== 'string' || !OUTCOMES.includes(b.o)) return reply(req, 400, { error: 'bad o' });
    await env.DB.prepare('INSERT INTO games (id, started, last, ended, outcome, n) VALUES (?1, ?2, ?2, ?2, ?3, 1) ON CONFLICT(id) DO UPDATE SET last = ?2, ended = COALESCE(ended, ?2), outcome = COALESCE(outcome, ?3)').bind(b.g, now, b.o).run();
    return reply(req, 204, null);
  }
  return reply(req, 400, { error: 'bad k' });
}

async function handleSnap(req, env, ctx) {
  let txt = await env.SNAP.get('snap');
  if (!txt) { txt = JSON.stringify(await computeSnap(env)); await env.SNAP.put('snap', txt); }
  return reply(req, 200, txt, { 'cache-control': 'public, max-age=300' });
}

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return reply(req, 204, null);
    try {
      if (pathname === '/e' && req.method === 'POST') return await handleEvent(req, env);
      if (pathname === '/snap' && req.method === 'GET') return await handleSnap(req, env, ctx);
    } catch (e) {
      return reply(req, 500, { error: 'server' });
    }
    return reply(req, 404, { error: 'not found' });
  },
  async scheduled(_ev, env) {
    await env.SNAP.put('snap', JSON.stringify(await computeSnap(env)));
  },
};

// 匿名統計的網路層：除了 fetch／sessionStorage 不碰 DOM。網址空白（尚未部署）時所有函式都不做事。
let base = null;

export async function loadServer() {
  if (base !== null) return base;
  base = '';
  try {
    const r = await fetch('data/server.json');
    if (r.ok) { const u = ((await r.json()).url || '').trim().replace(/\/+$/, ''); if (/^https:\/\//.test(u)) base = u; }
  } catch { /* 沒有也能玩 */ }
  return base;
}

/** 送出進度事件；失敗一律吞掉 */
export async function sendEvent(body) {
  try {
    const u = await loadServer();
    if (!u) return;
    await fetch(u + '/e', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { /* 統計失敗不影響遊戲 */ }
}

const SNAP_KEY = 'wan47.snap', SNAP_TTL = 5 * 60000;
let memSnap = null;
/** 取得全站快照；失敗或尚未部署回 null（不顯示假數字） */
export async function getSnap() {
  try {
    const now = Date.now();
    if (memSnap && now - memSnap.t < SNAP_TTL) return memSnap.v;
    try { const c = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null'); if (c && now - c.t < SNAP_TTL) return (memSnap = c).v; } catch { /* 無法讀取 */ }
    const u = await loadServer();
    if (!u) return null;
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4000);
    let r;
    try { r = await fetch(u + '/snap', { signal: ac.signal }); } finally { clearTimeout(to); }
    if (!r.ok) return null;
    const v = await r.json();
    if (!v || typeof v.graduated !== 'number' || typeof v.studying !== 'number') return null;
    memSnap = { t: now, v };
    try { sessionStorage.setItem(SNAP_KEY, JSON.stringify(memSnap)); } catch { /* 無法寫入 */ }
    return v;
  } catch { return null; }
}

/** 16 碼十六進位的遊戲代號 */
export function newGid() {
  const b = new Uint8Array(8);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

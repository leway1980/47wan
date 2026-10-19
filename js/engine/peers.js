// 999 個簡化同儕：每人 8 個欄位，存在一個扁平陣列裡。
import { stateRng, pick, pickWeighted, mulberry32 } from './rng.js';
import { rollFamily, rollCommute, rollSchool } from './identity.js';
import { groupOf, yearProb, turnProb, rollSeverity, isMajor, COMMUTE_DAYS_PER_TURN } from './life.js';

export const N_PEERS = 999;
export const F = 8; // econ, commute, phone, cram, work, dating, close, status
export const ST = { 在學: 0, 休學: 1, 離開: 2, 死亡: 3 };

export function genPeers(seed, data, playerName) {
  const idn = data.identities;
  const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const a = new Array(N_PEERS * F).fill(0);
  for (let i = 0; i < N_PEERS; i++) {
    const county = pickWeighted(r, idn.counties, (c) => c.w);
    const fam = rollFamily(r, idn, county);
    const school = rollSchool(r, idn, county).type;
    const commute = rollCommute(r, idn, county, fam.econ);
    const cramP = 0.33 + (county.tier === '六都' ? 0.07 : 0) + school.cramBoost + (fam.support === '花錢買資源' ? 0.08 : 0) - (fam.econ === '吃緊' ? 0.1 : 0);
    const o = i * F;
    a[o] = idn.econLabels.indexOf(fam.econ);
    a[o + 1] = idn.commutes.indexOf(commute);
    a[o + 2] = pickWeighted(r, [0, 1, 2, 3, 4].map((k) => ({ k, w: [0.04, 0.16, 0.3, 0.34, 0.16][k] })), (x) => x.w).k;
    a[o + 3] = r() < cramP ? 1 : 0;
    a[o + 4] = r() < (fam.econ === '吃緊' ? 0.1 : 0.04) ? 1 : 0;
    a[o + 5] = r() < 0.1 ? 1 : 0;
    a[o + 6] = Math.min(5, Math.floor(r() * r() * 5) + 1);
    a[o + 7] = 0;
  }
  // 挑 12 個「你認識的人」：6 個國中同學、6 個同班同學
  const used = new Set([playerName]);
  const known = [];
  const taken = new Set();
  for (let k = 0; k < 12; k++) {
    let nm, idx;
    do { nm = pick(r, idn.friendNames); } while (used.has(nm) && used.size < idn.friendNames.length + 1);
    used.add(nm);
    do { idx = Math.floor(r() * N_PEERS); } while (taken.has(idx));
    taken.add(idx);
    known.push({ idx, name: nm, rel: k < 6 ? '國中同學' : '同班同學' });
  }
  return { a, known };
}

export function peerCounts(st, data) {
  const a = st.peers.a, idn = data.identities;
  const c = { 補習: 0, 打工: 0, 手機重度: 0, 交往: 0, 離開: 0, 休學: 0, 死亡: 0, 在學: 0, 補習或打工: 0 };
  for (let i = 0; i < N_PEERS; i++) {
    const o = i * F, s = a[o + 7];
    if (s === ST.死亡) { c.死亡++; continue; }
    if (s === ST.離開) { c.離開++; continue; }
    if (s === ST.休學) { c.休學++; continue; }
    c.在學++;
    if (a[o + 3]) c.補習++;
    if (a[o + 4]) c.打工++;
    if (a[o + 3] || a[o + 4]) c.補習或打工++;
    if (a[o + 2] >= 3) c.手機重度++;
    if (a[o + 5]) c.交往++;
  }
  // 加上玩家自己（1,000 人）
  const me = st;
  c.玩家補習或打工 = me.habits.補習 > 0 || me.flags.打工中 ? 1 : 0;
  c.total = N_PEERS + 1;
  c.補習或打工總 = c.補習或打工 + c.玩家補習或打工;
  return c;
}

/**
 * 每個回合更新 999 人。回傳你認識的人的大事（文字陣列）。
 * 只做兩件事：依習慣更新數值、擲人生事件骰；外加中輟機率與補習／打工的切換。
 */
const NOOP = () => {};
const FEED_MAX = 12, FEED_P = 0.15; // 不認識的同屆：只偶爾留下一則「聽說」的消息
const JOBS = ['手搖飲店', '便利商店', '補習班櫃台', '早餐店', '火鍋店'];
// 每個同儕編號對應固定的「路人」身分（縣市、學校類型、姓名），與主 rng 分開抽，不影響原有結果
function peerPhrase(st, idn, idx, kind) {
  const q = mulberry32((st.seed ^ (idx * 2654435761)) >>> 0);
  const county = pickWeighted(q, idn.counties, (c) => c.w);
  if (kind === '死亡') return `聽說${county.name}有一位同屆的學生在車禍中離開了。`;
  const sch = rollSchool(q, idn, county).sch;
  const male = q() < 0.5;
  const name = pickWeighted(q, idn.surnames.map((n, k) => ({ n, w: idn.surnameW[k] })), (x) => x.w).n + pick(q, male ? idn.givenNamesM : idn.givenNamesF);
  const ph = {
    打工: `這學期開始在${pick(q, JOBS)}打工`, 交往: '交往了', 分手: '和對象分手了，最近話變少', 離開: '離開了原本的學校，去走另一條路',
    輕傷: '騎車上學出了車禍，擦傷了好幾處', 住院: '出車禍住院，班上同學去探望', 休學: '出了很嚴重的車禍，暫時休學在家',
  }[kind];
  return `📍 ${county.name}・${sch.n}｜${name} ${ph}`;
}
export function stepPeers(st, data, tl) {
  const r = stateRng(st, 'peerS');
  const a = st.peers.a, idn = data.identities, events = data.life.events;
  const news = [];
  const knownByIdx = new Map(st.peers.known.map((k) => [k.idx, k]));
  const pDrop = 1 - Math.pow(1 - idn.dropoutPerYear, 1 / 24);
  const days = tl.vacation ? 0 : COMMUTE_DAYS_PER_TURN;
  const yearIdx = tl.year - 1;
  const pc = st.peerCounts;
  st.peerFeed ??= []; // 舊存檔沒有
  const feed = (i, kind) => {
    if (r() >= FEED_P) return;
    st.peerFeed.push({ turn: st.turn, text: peerPhrase(st, idn, i, kind) });
    if (st.peerFeed.length > FEED_MAX) st.peerFeed.shift();
  };
  for (let i = 0; i < N_PEERS; i++) {
    const o = i * F;
    let s = a[o + 7];
    if (s === ST.死亡 || s === ST.離開) continue;
    const kn = knownByIdx.get(i);
    const note = kn ? (t) => { news.push(t.replace('{n}', kn.name).replace('{rel}', kn.rel)); } : NOOP;
    if (s === ST.休學) {
      if (r() < 0.25) { a[o + 7] = ST.在學; note('你的{rel}{n}回到學校了，身上還有點行動不便，但看起來很開心。'); }
      continue;
    }
    // 中輟／轉換跑道
    if (r() < pDrop) {
      a[o + 7] = ST.離開; pc.離開++;
      note('你的{rel}{n}離開了原本的學校，聽說去走另一條路了。'); if (!kn) feed(i, '離開');
      continue;
    }
    // 習慣小幅漂移
    if (r() < 0.05) a[o + 2] = Math.max(0, Math.min(4, a[o + 2] + (r() < 0.5 ? -1 : 1)));
    // 補習：隨年級上升，高三最多
    const pStart = 0.012 + 0.012 * yearIdx + (tl.vacation ? 0.02 : 0);
    if (!a[o + 3]) { if (r() < pStart) { a[o + 3] = 1; note('你的{rel}{n}開始補習了，說是怕跟不上。'); } }
    else if (r() < 0.02) a[o + 3] = 0;
    // 打工：寒暑假較容易開始
    const pWork = (tl.vacation ? 0.08 : 0.008) * (a[o] === 2 ? 2 : 1);
    if (!a[o + 4]) { if (r() < pWork) { a[o + 4] = 1; note('你的{rel}{n}找了一份打工，說想自己賺零用錢。'); if (!kn) feed(i, '打工'); } }
    else if (r() < (tl.vacation ? 0.03 : 0.1)) a[o + 4] = 0;
    // 交往
    if (!a[o + 5]) { if (r() < 0.018 + 0.006 * yearIdx) { a[o + 5] = 1; note('你的{rel}{n}交往了，最近都笑得很開心。'); if (!kn) feed(i, '交往'); } }
    else if (r() < 0.05) { a[o + 5] = 0; note('你的{rel}{n}和對象分手了，最近有點低落。'); if (!kn) feed(i, '分手'); }
    // 知心的朋友：慢慢漂
    if (r() < 0.06) a[o + 6] = Math.max(0, Math.min(5, a[o + 6] + (r() < 0.5 ? -1 : 1)));
    // 人生事件骰
    if (days > 0) {
      const commute = idn.commutes[a[o + 1]];
      for (const ev of events) {
        const g = groupOf(ev, commute);
        if (!g) continue;
        if (r() < turnProb(yearProb(ev, g), days)) {
          const sev = rollSeverity(ev, r());
          if (ev.id === 'unlicensed_penalty') { pc.罰單++; note('你的{rel}{n}無照騎車被警察攔下來開罰，被家人唸了一頓。'); continue; }
          if (sev === '死亡') { a[o + 7] = ST.死亡; pc.死亡++; note('你聽說{rel}{n}因為一場車禍離開了。'); if (!kn) feed(i, '死亡'); break; }
          if (sev === '輕傷') { pc.受傷++; note('你的{rel}{n}騎車出了點小事故，擦傷貼了紗布。'); if (!kn) feed(i, '輕傷'); }
          else if (sev === '住院') { pc.受傷++; note('你的{rel}{n}出車禍住院了，大家想去探望。'); if (!kn) feed(i, '住院'); }
          else { pc.受傷++; a[o + 7] = ST.休學; note('你的{rel}{n}出了很嚴重的車禍，暫時休學在家休養。'); if (!kn) feed(i, '休學'); break; }
        }
      }
    }
  }
  return news;
}

export function newPeerCounts() { return { 離開: 0, 死亡: 0, 受傷: 0, 罰單: 0 }; }

// 事件卡：條件求值器（不用 eval）、抽卡、套用選擇。純函式，無 DOM。
import { pickWeighted, clamp, rngAt } from './rng.js';

/* ───────────── 小型條件求值器 ─────────────
   語法：數字、'字串'、變數名(中文可)、#旗標、== != < <= > >=、and or not（也可用 && || !）、括號、true/false */

const cache = new Map();

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      if (j >= src.length) throw new Error('字串沒有結尾: ' + src);
      toks.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || '') && !isValueTok(toks[toks.length - 1]))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (j < src.length && /[^\s()=!<>&|]/.test(src[j])) j++;
      toks.push({ t: 'flag', v: src.slice(i + 1, j) });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('<>!()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (/[A-Za-z_㐀-鿿]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_㐀-鿿]/.test(src[j])) j++;
      const w = src.slice(i, j);
      if (w === 'and') toks.push({ t: 'op', v: '&&' });
      else if (w === 'or') toks.push({ t: 'op', v: '||' });
      else if (w === 'not') toks.push({ t: 'op', v: '!' });
      else if (w === 'true') toks.push({ t: 'lit', v: true });
      else if (w === 'false') toks.push({ t: 'lit', v: false });
      else toks.push({ t: 'var', v: w });
      i = j; continue;
    }
    throw new Error(`無法解析條件 "${src}" 在位置 ${i}`);
  }
  return toks;
}
const isValueTok = (t) => t && (t.t === 'num' || t.t === 'str' || t.t === 'var' || t.t === 'flag' || t.t === 'lit' || (t.t === 'op' && t.v === ')'));

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek() && peek().t === 'op' && peek().v === v) { p++; return true; } return false; };
  function orE() {
    let l = andE();
    while (eat('||')) { const a = l, b = andE(); l = (c) => a(c) || b(c); }
    return l;
  }
  function andE() {
    let l = notE();
    while (eat('&&')) { const a = l, b = notE(); l = (c) => a(c) && b(c); }
    return l;
  }
  function notE() {
    if (eat('!')) { const a = notE(); return (c) => !a(c); }
    return cmpE();
  }
  function cmpE() {
    const l = prim();
    const t = peek();
    if (t && t.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      p++;
      const r = prim();
      switch (t.v) {
        case '==': return (c) => l(c) === r(c);
        case '!=': return (c) => l(c) !== r(c);
        case '<': return (c) => num(l(c)) < num(r(c));
        case '<=': return (c) => num(l(c)) <= num(r(c));
        case '>': return (c) => num(l(c)) > num(r(c));
        default: return (c) => num(l(c)) >= num(r(c));
      }
    }
    return l;
  }
  function prim() {
    const t = toks[p++];
    if (!t) throw new Error('條件不完整');
    if (t.t === 'op' && t.v === '(') { const e = orE(); if (!eat(')')) throw new Error('缺少右括號'); return e; }
    if (t.t === 'num' || t.t === 'str' || t.t === 'lit') return () => t.v;
    if (t.t === 'flag') return (c) => !!(c.__flags && c.__flags[t.v]);
    if (t.t === 'var') return (c) => c[t.v];
    throw new Error('意外的符號 ' + t.v);
  }
  const f = orE();
  if (p < toks.length) throw new Error('條件後面有多餘的內容');
  return f;
}
const num = (x) => (typeof x === 'number' ? x : x === undefined || x === null ? NaN : Number(x));

export function compile(expr) {
  let f = cache.get(expr);
  if (!f) { f = parse(tokenize(expr)); cache.set(expr, f); }
  return f;
}
export const evalCond = (expr, ctx) => !!compile(expr)(ctx);

/* ───────────── 條件環境 ───────────── */
export function buildCtx(st, tl) {
  const s = st.stats, h = st.habits, id = st.identity;
  const examNow = !!(tl && tl.examWeek);
  return {
    __flags: st.flags,
    ...s,
    手機: h.手機, 零用錢: h.零用錢 || '花掉', 睡前手機: h.睡前手機 ? 1 : 0, 補習: h.補習, 運動: h.運動, 遊戲: h.遊戲, 作業: h.作業, 課堂: h.課堂,
    經濟: id.family.econ, 支援: id.family.support, 學校: id.schoolType, 通勤: id.commute,
    家規: id.parentRule || '普通', 手機上限中: !!(st.rule && st.turn < st.rule.until), AI依賴: s.AI依賴 ?? 0, 親子: s.親子 ?? 50,
    地區: id.tier, 職業: id.family.job, 風格: id.family.style, 性別: id.sex,
    年級: tl ? tl.year : 1, 學期: tl ? (tl.seg === '上學期' ? 1 : tl.seg === '下學期' ? 2 : 0) : 1,
    交往回合: st.flags.交往中 && st.partner ? Math.max(0, st.turn - st.partner.since) : 0,
    回合: st.turn, 假期: tl ? !!tl.vacation : false, 寒假: tl ? tl.seg === '寒假' : false, 考試週: examNow,
    家裡狀況: (st.fam && st.fam.shock && st.fam.shock.id) || '',
    網友回合: st.netStart == null ? -1 : st.turn - st.netStart,
  };
}

/* ───────────── 效果 ───────────── */
const RANGE = {
  專注: [0, 100], 理解: [0, 100], 體力: [0, 100], 聯繫: [0, 100], 知心: [0, 5], 心情: [0, 100], 幸福: [0, 100],
  錢包: [0, 1e9], 投資: [0, 1e9], 投資本金: [0, 1e9], 睡眠債: [0, 10], 牽掛: [0, 10], 假熟悉: [0, 30], 班級氣氛: [0, 1], 興趣: [0.8, 1.2], 露餡: [0, 10], AI依賴: [0, 10], 親子: [0, 100], 資訊: [0, 100],
};
export const VISIBLE_KEYS = ['心情', '聯繫', '知心', '體力', '錢包', '分數'];

export function addStat(st, k, d) {
  if (k === '分數') { addStat(st, '理解', d * 0.3); addStat(st, '假熟悉', d * 0.3); return; } // 卡片上的分數↑只是小幅、一部分是短期的
  const r = RANGE[k];
  if (!r) throw new Error('未知的數值: ' + k);
  st.stats[k] = clamp(st.stats[k] + d, r[0], r[1]);
}
export function applyEffects(st, eff) {
  if (!eff) return;
  for (const [k, d] of Object.entries(eff)) addStat(st, k, d);
}

/* ───────────── 抽卡 ───────────── */
export function cardById(data, id) {
  const c = data.cardIndex[id];
  if (!c) throw new Error('找不到事件卡: ' + id);
  return c;
}

function eligible(card, st, ctx) {
  if (card.pool.startsWith('_')) return false;
  if (card.once && st.used[card.id]) return false;
  if ((st.cooldowns[card.id] || -1) > st.turn) return false;
  return passes(card, st, ctx);
}
export function passes(card, st, ctx) {
  const rq = card.requires, ex = card.excludes;
  if (rq) {
    if (rq.flags && !rq.flags.every((f) => st.flags[f])) return false;
    if (rq.expr && !evalCond(rq.expr, ctx)) return false;
  }
  if (ex) {
    if (ex.flags && ex.flags.some((f) => st.flags[f])) return false;
    if (ex.expr && evalCond(ex.expr, ctx)) return false;
  }
  return true;
}
function mulMods(mods, ctx) {
  let x = 1;
  if (mods) for (const m of mods) if (evalCond(m.if, ctx)) x *= m.x;
  return x;
}

/** 兩段式抽卡：先抽池子，再抽卡。找不到就回傳 null。 */
export function drawCard(st, data, ctx, r) {
  const byPool = {};
  for (const c of data.events.cards) if (eligible(c, st, ctx)) (byPool[c.pool] ||= []).push(c);
  const pools = Object.keys(byPool).map((name) => ({
    name, w: (data.events.pools[name]?.base ?? 3) * mulMods(data.events.pools[name]?.mods, ctx),
  }));
  const pool = pickWeighted(r, pools);
  if (!pool) return null;
  return pickWeighted(r, byPool[pool.name], (c) => (c.weight ?? 1) * mulMods(c.modifiers, ctx));
}

/* ───────────── 交往對象 ───────────── */
// 在一起的那一刻決定對象的名字：優先用認識的同儕（不含 {同學} 那位，好讓吃醋卡有第三人），沒有就用身分資料的名字
export function ensurePartner(st, turnNo, idn) {
  if (st.partner) return st.partner;
  let pool = (st.peers?.known || []).slice(1).map((k) => k.name).filter((n) => n && n !== st.identity.name);
  if (!pool.length && idn) pool = [...(idn.givenNamesM || []), ...(idn.givenNamesF || [])];
  const name = pool.length ? pool[Math.floor(rngAt(st.seed, turnNo, 'partner') * pool.length)] : '對方';
  st.partner = { name, since: turnNo };
  return st.partner;
}
export const dropPartner = (st) => { st.partner = null; };
export const isDatingCard = (c) => c.pool === '感情' && !!(c.requires && c.requires.flags && c.requires.flags.includes('交往中'));

/** 交往中專用的加抽：只從「需要交往中」的感情卡裡挑 */
export function drawDatingCard(st, data, ctx, r) {
  const pool = data.events.cards.filter((c) => isDatingCard(c) && eligible(c, st, ctx));
  return pool.length ? pickWeighted(r, pool, (c) => (c.weight ?? 1) * mulMods(c.modifiers, ctx)) : null;
}

/* ───────────── 把卡片轉成顯示用資料 ───────────── */
// IG 上認識的人用帳號名稱稱呼，不直接叫「網友」（玩家才不會一開始就起戒心）
const NET_HANDLES = ['@mia.0927', '@yu_ting.lin', '@kai__chen', '@sunny_hsu', '@leo.wu_17', '@chloe.tw', '@a_ming.zz', '@rainy.day04', '@jason_lee.08', '@pinpin.0612'];
export function fill(text, st) {
  const friend = st.peers.known[0]?.name || '同學';
  if (!st.netName) st.netName = NET_HANDLES[Math.floor(rngAt(st.seed, 7, 'nethandle') * NET_HANDLES.length)];
  text = text.replace(/\{網友\}/g, st.netName);
  return text.replace(/\{家長\}/g, st.identity.family.parent || '家長').replace(/\{同學\}/g, friend).replace(/\{對象\}/g, st.partner?.name || '對方').replace(/\{姓名\}/g, st.identity.name);
}

export function choiceState(ch, st, ctx) {
  let disabled = false, reason = '';
  if (ch.grayIf) {
    for (const g of [].concat(ch.grayIf)) if (evalCond(g.if, ctx)) { disabled = true; reason = g.reason; break; }
  }
  // 要花錢的選項（cost 或錢包減少）都要付得起；付不起就不能選
  const need = ch.cost || Math.max(0, -((ch.effects && ch.effects.錢包) || 0));
  if (!disabled && ch.repayDebt && st.stats.錢包 < (st.debt || 0)) { disabled = true; reason = `還差 NT$${Math.round((st.debt || 0) - st.stats.錢包)}`; }
  let owe = 0;
  if (!disabled && need && st.stats.錢包 < need) {
    // 社交邀約可以先請同學墊（欠人情，之後會有後續）；其他花費付不起就不能選
    if (ch.canOwe) owe = Math.round(need - st.stats.錢包);
    else { disabled = true; reason = '錢包不夠'; }
  }
  // 想存錢／投資時，花錢的社交選項要多留一倍的餘裕才肯花（不是硬擋，錢多就能付）
  if (!disabled && ch.cost && (st.habits.零用錢 || '花掉') !== '花掉' && st.stats.錢包 < ch.cost * 2) { disabled = true; reason = '想存錢'; }
  return { disabled, reason, owe };
}

// 卡片文字可依狀況換版本：textIf 由上往下找第一個符合的條件
// 同一張卡可以有好幾種寫法（texts），每次依回合隨機挑一種，避免三年都看到同一段話
export function pickText(card, ctx, st) {
  for (const t of card.textIf || []) if (ctx && evalCond(t.if, ctx)) return t.text;
  if (card.texts && card.texts.length && st) return card.texts[Math.floor(rngAt(st.seed, st.turn, 'tx_' + card.id) * card.texts.length)];
  return card.text;
}

export function describeCard(card, st, ctx) {
  return {
    id: card.id, title: fill(card.title, st), text: fill(pickText(card, ctx, st), st),
    choices: card.choices.map((ch, i) => {
      const { disabled, reason, owe } = choiceState(ch, st, ctx);
      const chips = Object.entries(ch.effects || {}).filter(([, v]) => v !== 0).map(([k, v]) => ({ k, dir: v > 0 ? 1 : -1 }));
      if (ch.cost && !(ch.effects && ch.effects.錢包)) chips.push({ k: '錢包', dir: -1 });
      // 隱藏效果或延遲事件只露出「有後續」，不洩漏內容
      if (ch.refundScam) chips.push({ k: '錢包', dir: 1 });
      if (owe || ch.scam || (ch.hidden && Object.keys(ch.hidden).length) || (ch.delayed && ch.delayed.length)) chips.push({ k: '？後續', dir: 0 });
      const note = owe ? `錢包不夠，要先請同學墊 NT$${owe}（欠人情）` : ch.note || '';
      return { i, label: ch.label, note, chips, disabled, reason, owe };
    }),
  };
}

/** 套用玩家的選擇。回傳 {line}。 */
export function applyChoice(st, data, card, idx, ctx, r, turnNo) {
  const ch = card.choices[idx];
  if (!ch) throw new Error(`選項不存在: ${card.id}#${idx}`);
  const gs = choiceState(ch, st, ctx);
  if (gs.disabled) throw new Error(`選項不可選: ${card.id}#${idx} (${gs.reason})`);
  if (ch.cost) st.stats.錢包 -= ch.cost;
  if (ch.cost && (st.habits.零用錢 || '花掉') !== '花掉') addStat(st, '心情', -1); // 花下去會心疼
  if (ch.phoneCap) st.rule = { cap: ch.phoneCap.cap, until: turnNo + ch.phoneCap.turns, label: ch.phoneCap.label || null };
  if (ch.endRule) st.rule = null; // 保管的手機被拿回來、密碼被破解：限制提早結束
  if (ch.investMul) { st.stats.投資 *= ch.investMul; }
  if (ch.scam) { // 詐騙損失：記錄下來，結局報告會提到
    const [lo, hi] = ch.scamLoss || [0, 0];
    const extra = Math.min(Math.max(0, st.stats.錢包), Math.round((lo + r() * (hi - lo)) / 100) * 100);
    st.stats.錢包 -= extra;
    const paid = (ch.cost || 0) + Math.max(0, -((ch.effects && ch.effects.錢包) || 0)); // 選項本身就要付的錢（例如轉帳訂金）
    (st.scams ||= []).push({ turn: turnNo, type: ch.scam, loss: extra + paid });
  }
  if (ch.refundScam) { // 追回部分被騙的錢
    const last = [...(st.scams || [])].reverse().find((x) => x.loss > 0);
    if (last) st.stats.錢包 += Math.round((last.loss * ch.refundScam) / 100) * 100;
  }
  if (ch.sellInvest) { st.stats.錢包 += st.stats.投資; st.stats.投資 = 0; st.stats.投資本金 = 0; }
  if (ch.toInvest) { st.stats.投資 += ch.toInvest; st.stats.投資本金 += ch.toInvest; } // 錢已由 effects 的 錢包 扣除
  applyEffects(st, ch.effects);
  applyEffects(st, ch.hidden);
  if (ch.repayDebt) { st.stats.錢包 -= st.debt || 0; st.debt = 0; }
  if (ch.clearDebt) st.debt = 0;
  if (gs.owe) {
    // 先請同學墊：錢包歸零，欠下人情，幾回合後對方會來討
    st.stats.錢包 = 0;
    st.debt = (st.debt || 0) + gs.owe;
    st.delayed.push({ event: 'debt_favor', due: turnNo + 2 + Math.floor(r() * 3) });
  }
  st.stats.錢包 = Math.max(0, st.stats.錢包);
  for (const f of ch.setFlags || []) st.flags[f] = true;
  if (ch.ladder) { const nx = ch.ladder.find((f) => !st.flags[f]); if (nx) st.flags[nx] = true; } // 計次旗標：第一次設第一個、第二次設第二個……
  for (const f of ch.clearFlags || []) delete st.flags[f];
  if ((ch.setFlags || []).includes('交往中')) ensurePartner(st, turnNo, data && data.identities);
  if ((ch.clearFlags || []).includes('交往中')) dropPartner(st);
  if (ch.setHabits) Object.assign(st.habits, ch.setHabits);
  if (ch.addHabits) for (const [k, d] of Object.entries(ch.addHabits)) st.habits[k] = clamp(st.habits[k] + d, 0, { 補習: 3, 遊戲: 3, 運動: 2 }[k] ?? 4);
  if (ch.setCommute) st.identity.commute = ch.setCommute;
  for (const d of ch.delayed || []) {
    if (d.if && !evalCond(d.if, ctx)) continue; // 可選的條件：不符合就不排這個後續
    const hit = r() < d.chance * (d.event === 'fam_scholarship' ? 0.8 + 0.4 * ((st.stats.親子 ?? 50) / 100) : 1);
    const ev = hit ? d.event : d.else;
    let due;
    if (d.atTurn) { // 綁定在特定回合區間（例如高三、畢旅前）；已經錯過就不排
      if (turnNo >= d.atTurn[1]) continue;
      const lo = Math.max(d.atTurn[0], turnNo + 1);
      due = lo + Math.floor(r() * (d.atTurn[1] - lo + 1));
    } else due = turnNo + d.after[0] + Math.floor(r() * (d.after[1] - d.after[0] + 1));
    if (ev) st.delayed.push(d.need ? { event: ev, due, need: d.need } : { event: ev, due }); // need：到期時再檢查的條件，不符合就不出現
  }
  if (card.pool === '遊戲') st.gameDecline = ch.declineGame ? (st.gameDecline || 0) + 1 : 0;
  let extra = '';
  if (ch.declineGame && st.gameDecline % 3 === 0) extra = '公會的人問你是不是不玩了。';
  if (card.once) st.used[card.id] = true;
  if (card.cooldown) st.cooldowns[card.id] = turnNo + card.cooldown + 1;
  st.choices.push({ turn: turnNo, id: card.id, title: fill(card.title, st), label: fill(ch.label, st), commute: ch.setCommute || null, spend: !!ch.spend });
  if (card.payoffOf) { // 「早先的選擇」帶來的後果：記下來，結局報告會列出
    const e = ch.effects || {};
    const val = (e.心情 || 0) + (e.聯繫 || 0) + (e.分數 || 0) + (e.體力 || 0) * 0.5 + (e.錢包 || 0) / 100;
    const setup = card.payoffSetup ? [...st.choices].reverse().find((c) => c.id === card.payoffSetup && c.turn < turnNo) : null;
    (st.payoffs ||= []).push({ turn: turnNo, setup: fill(card.payoffOf, st), title: fill(card.title, st), label: fill(ch.label, st), tone: card.payoffTone || null, val, setupTurn: setup ? setup.turn : null, setupLabel: setup ? setup.label : null });
  }
  return { line: [ch.result ? fill(ch.result, st) : '', extra].filter(Boolean).join(' ') };
}

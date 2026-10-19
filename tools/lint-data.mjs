// 資料對齊檢查：事件、旗標、數值、習慣之間有沒有「寫了沒人讀、讀了沒人寫」
// 用法：node tools/lint-data.mjs（有錯誤時 exit 1）；測試也會呼叫 lintData()
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokenize, buildCtx, compile } from '../js/engine/events.js';
import { prepareData } from '../js/engine/turn.js';
import { newState, HABIT_DEFAULTS } from '../js/engine/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

export function loadRaw() {
  const events = rd('events.json');
  for (const f of readdirSync(join(ROOT, 'data'))) {
    if (/^events_.+\.json$/.test(f)) events.cards.push(...rd(f).cards);
  }
  return { identities: rd('identities.json'), events, calendar: rd('calendar.json'), life_events: rd('life_events.json') };
}

const engineSrc = () => readdirSync(join(ROOT, 'js', 'engine')).map((f) => readFileSync(join(ROOT, 'js', 'engine', f), 'utf8')).join('\n');

export function lintData(raw = loadRaw()) {
  const errors = [], warns = [];
  const data = prepareData(raw);
  const st = newState(1, data);
  const ctx = buildCtx(st, data.timeline[0]);
  const ctxKeys = new Set(Object.keys(ctx));
  const statKeys = new Set([...Object.keys(st.stats), '分數']); // 分數是虛擬數值：換算成理解＋假熟悉
  const habitKeys = new Set(Object.keys(HABIT_DEFAULTS));
  const cards = raw.events.cards;
  const ids = new Set(cards.map((c) => c.id));
  const pools = new Set(Object.keys(raw.events.pools || {}));
  const src = engineSrc();

  const flagSet = new Map(), flagRead = new Map();
  const note = (m, k, where) => { if (!m.has(k)) m.set(k, []); m.get(k).push(where); };
  // 引擎程式裡設定／讀取的旗標
  for (const m of src.matchAll(/flags\.([㐀-鿿A-Za-z0-9_]+)\s*=(?!=)/g)) note(flagSet, m[1], 'engine');
  for (const m of src.matchAll(/flags\.([㐀-鿿A-Za-z0-9_]+)(?![㐀-鿿A-Za-z0-9_])(?!\s*=(?!=))(?!\s*\()/g)) note(flagRead, m[1], 'engine');
  for (const m of src.matchAll(/flags\[['"]([^'"]+)['"]\]/g)) { note(flagRead, m[1], 'engine'); note(flagSet, m[1], 'engine'); }

  const checkExpr = (expr, where) => {
    let toks;
    try { toks = tokenize(expr); compile(expr); } catch (e) { errors.push(`${where}：條件寫錯「${expr}」：${e.message}`); return; }
    for (const t of toks) {
      if (t.t === 'var' && !ctxKeys.has(t.v)) errors.push(`${where}：條件用到不存在的變數「${t.v}」`);
      if (t.t === 'flag') note(flagRead, t.v, where);
    }
  };
  const statUse = new Map(); // 事件寫入的數值
  for (const c of cards) {
    const W = `卡片 ${c.id}`;
    if (!pools.has(c.pool) && !c.pool.startsWith('_')) errors.push(`${W}：池子「${c.pool}」不存在`);
    if (c.requires?.expr) checkExpr(c.requires.expr, W);
    for (const f of c.requires?.flags || []) note(flagRead, f, W);
    for (const f of c.excludes?.flags || []) note(flagRead, f, W);
    if (c.excludes?.expr) checkExpr(c.excludes.expr, W);
    for (const m of c.modifiers || []) checkExpr(m.if, W);
    for (const t of c.textIf || []) checkExpr(t.if, W);
    for (const ch of c.choices || []) {
      const WC = `${W}／${ch.label}`;
      for (const part of ['effects', 'hidden']) {
        for (const k of Object.keys(ch[part] || {})) {
          if (!statKeys.has(k)) errors.push(`${WC}：數值「${k}」不存在（state.js 沒有這個欄位）`);
          note(statUse, k, WC);
        }
      }
      for (const k of Object.keys({ ...(ch.setHabits || {}), ...(ch.addHabits || {}) })) if (!habitKeys.has(k)) errors.push(`${WC}：習慣「${k}」不存在`);
      for (const g of [].concat(ch.grayIf || [])) checkExpr(g.if, WC);
      for (const d of ch.delayed || []) {
        if (!ids.has(d.event)) errors.push(`${WC}：延遲事件「${d.event}」不存在`);
        if (d.else && !ids.has(d.else)) errors.push(`${WC}：延遲事件 else「${d.else}」不存在`);
        if (d.if) checkExpr(d.if, WC);
      }
      for (const f of ch.setFlags || []) note(flagSet, f, WC);
      for (const f of ch.clearFlags || []) note(flagRead, f, WC);
    }
  }
  // 旗標：設了沒人讀／讀了沒人設
  for (const [f, w] of flagSet) if (!flagRead.has(f)) warns.push(`旗標「${f}」有設定（${w[0]}）但沒有任何地方讀取`);
  for (const [f, w] of flagRead) if (!flagSet.has(f)) warns.push(`旗標「${f}」被讀取（${w[0]}）但從來沒有被設定`);
  // 數值：事件寫入，但引擎與條件都沒有讀它 → 寫了沒有效果
  const exprText = cards.map((c) => JSON.stringify([c.requires, c.modifiers, c.textIf, (c.choices || []).map((x) => [x.grayIf, x.delayed])])).join('\n');
  for (const k of statUse.keys()) {
    if (k === '分數') continue;
    const readInEngine = new RegExp(`(S|stats)\\.${k}(?![㐀-鿿\\w])(?!\\s*=(?!=))|stats\\[['"]${k}['"]\\]`).test(src.replace(new RegExp(`(S|stats)\\.${k}\\s*=\\s*clamp\\(\\s*(S|stats)\\.${k}`, 'g'), ''));
    const readInExpr = exprText.includes(k);
    if (!readInEngine && !readInExpr) warns.push(`數值「${k}」會被事件改變，但沒有任何結算或條件讀取它`);
  }
  // 習慣：每個數字型習慣都要有事件能讓它上升，也能讓它下降
  for (const h of ['手機', '補習', '運動', '遊戲']) {
    let up = false, down = false;
    for (const c of cards) for (const ch of c.choices || []) {
      const d = ch.addHabits?.[h]; if (d > 0) up = true; if (d < 0) down = true;
      const s = ch.setHabits?.[h]; if (typeof s === 'number') { up = true; down = true; }
    }
    if (!up) warns.push(`習慣「${h}」沒有任何事件能讓它上升`);
    if (!down) warns.push(`習慣「${h}」沒有任何事件能讓它下降`);
  }
  return { errors, warns };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, warns } = lintData();
  for (const e of errors) console.log('✗ ' + e);
  for (const w of warns) console.log('△ ' + w);
  console.log(`\n錯誤 ${errors.length}、提醒 ${warns.length}`);
  process.exit(errors.length ? 1 : 0);
}

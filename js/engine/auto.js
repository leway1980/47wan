// 讓他自己過：角色依自己的個性做決定（決定性、不看玩家）。純函式、無 DOM。
import { stateRng } from './rng.js';
import { startTurn, chooseCard, finishTurn, clearReport } from './turn.js';

/** 角色自己選：可選項裡加權抽一個（借錢欠人情的比較不想選；錢包緊時花錢的比較不想選）。回傳選項編號 i。 */
export function selfChoice(st, card) {
  st.autoS ??= (st.seed ^ 0x51ed270b) >>> 0; // 舊存檔沒有
  const r = stateRng(st, 'autoS');
  const opts = card.choices.filter((c) => !c.disabled);
  const tight = st.stats.錢包 < 1000;
  const ws = opts.map((c) => (c.owe ? 0.3 : tight && c.chips && c.chips.some((x) => x.k === '錢包' && x.dir < 0) ? 0.5 : 1));
  let u = r() * ws.reduce((a, b) => a + b, 0);
  for (let k = 0; k < opts.length; k++) { u -= ws[k]; if (u < 0) return opts[k].i; }
  return opts[opts.length - 1].i;
}

/** 從任何狀態（含回合進行到一半）一路替他過完，直到結局。 */
export function playRestAuto(st, data) {
  if (st.cur) {
    if (st.cur.card && st.cur.cardView) chooseCard(st, data, selfChoice(st, st.cur.cardView));
    finishTurn(st, data);
    st.autoTurns = (st.autoTurns || 0) + 1;
  }
  st.reportPending = null;
  let guard = 0;
  while (!st.ended && guard++ < 200) {
    const res = startTurn(st, data);
    if (!res.dead && res.card) chooseCard(st, data, selfChoice(st, res.card));
    finishTurn(st, data);
    if (st.reportPending) clearReport(st);
    st.autoTurns = (st.autoTurns || 0) + 1;
  }
  return st;
}

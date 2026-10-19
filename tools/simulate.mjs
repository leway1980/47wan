// 用法：node tools/simulate.mjs [局數=2000] [起始種子=1]
// 隨機習慣＋隨機選項，自動玩 N 局，統計結局分布、死亡率、平均理解與人生事件次數。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, playToEnd } from '../js/engine/turn.js';
import { newState } from '../js/engine/state.js';
import { stateRng, pick } from '../js/engine/rng.js';
import { buildEnding } from '../js/engine/report.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

export function loadData() {
  return prepareData({ identities: rd('identities.json'), events: rd('events.json'), calendar: rd('calendar.json'), life_events: rd('life_events.json') });
}

export function randomPolicy(st) {
  // 玩家性格的亂數，獨立於遊戲本身的亂數
  const hold = { rngS: (st.seed * 2654435761) >>> 0 };
  const pr = stateRng(hold, 'rngS');
  const wpick = (ws) => { let x = pr() * ws.reduce((p, q) => p + q, 0); for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x < 0) return i; } return ws.length - 1; };
  const persona = () => ({
    手機: wpick([0.1, 0.25, 0.3, 0.25, 0.1]), 睡前手機: pr() < 0.3, 補習: wpick([0.5, 0.25, 0.15, 0.1]), 運動: wpick([0.5, 0.35, 0.15]),
    作業: pick(pr, ['紙本', '紙本', '上網查', '開群組邊寫邊聊']), 遊戲: wpick([0.5, 0.25, 0.15, 0.1]),
    課堂: pick(pr, ['跟著上', '跟著上', '跟著上', '挑重點聽', '做自己的事', '放空', '補眠']),
  });
  return {
    // 習慣不能直接設定，只能透過事件選擇改變（隨機選選項）
    choose(s, card) {
      const ok = card.choices.filter((c) => !c.disabled);
      return pick(pr, ok).i;
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = parseInt(process.argv[2] || '2000', 10);
  const s0 = parseInt(process.argv[3] || '1', 10);
  const data = loadData();
  const t0 = Date.now();
  const dist = {}, arche = {}, lifeCt = {}, commuteCt = {};
  let deaths = 0, sumU = 0, sumFocus = 0, sumDebt = 0, retake = 0;
  const uBy = {};
  for (let i = 0; i < N; i++) {
    const st = newState(s0 + i, data);
    playToEnd(st, data, randomPolicy(st));
    const e = buildEnding(st, data);
    if (st.dead) { deaths++; dist['（死亡）'] = (dist['（死亡）'] || 0) + 1; }
    else dist[e.outcome.type] = (dist[e.outcome.type] || 0) + 1;
    arche[e.archetype] = (arche[e.archetype] || 0) + 1;
    sumU += st.stats.理解; sumFocus += st.stats.專注; sumDebt += st.stats.睡眠債;
    (uBy[e.archetype] ||= []).push(st.stats.理解);
    commuteCt[st.identity.commuteOrig] = (commuteCt[st.identity.commuteOrig] || 0) + 1;
    for (const l of st.luck) lifeCt[l.text] = (lifeCt[l.text] || 0) + 1;
  }
  const pct = (n) => ((n / N) * 100).toFixed(1) + '%';
  console.log(`模擬 ${N} 局（種子 ${s0}–${s0 + N - 1}），耗時 ${Date.now() - t0} ms`);
  console.log('\n去向分布：');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8, '　')} ${String(v).padStart(5)}  ${pct(v)}`);
  console.log('\n結局類型（A穩定自律 B社交 C遊戲牽掛 D補習全包 F什麼都沾一點 G大器晚成 J休止符）：');
  for (const [k, v] of Object.entries(arche).sort()) console.log(`  ${k}  ${String(v).padStart(5)}  ${pct(v)}  平均理解 ${(uBy[k].reduce((a, b) => a + b, 0) / v).toFixed(1)}`);
  console.log(`\n死亡：${deaths} 局（${(deaths / N * 100).toFixed(3)}%）`);
  console.log(`平均理解 ${(sumU / N).toFixed(1)}｜平均專注 ${(sumFocus / N).toFixed(1)}｜平均睡眠債 ${(sumDebt / N).toFixed(2)}`);
  console.log('\n開局通勤方式：', Object.entries(commuteCt).map(([k, v]) => `${k} ${pct(v)}`).join('、'));
  console.log('\n人生事件次數：');
  const keys = Object.keys(lifeCt);
  if (!keys.length) console.log('  （無）');
  for (const k of keys.sort()) console.log(`  ${k}: ${lifeCt[k]}`);
}

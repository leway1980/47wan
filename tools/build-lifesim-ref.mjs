// 用法：node tools/build-lifesim-ref.mjs [局數=2000] [起始種子=100001]
// 以 randomPolicy 模擬 N 局，算出各輸入的 mean/sd、各特質綜合分的 101 個分位點與 30 歲月薪中位數，寫回 data/lifesim.json 的 ref。
import { randomPolicy } from './simulate.mjs';
import { loadData, loadCfg, saveCfg, playGame, lifeInputs, composites, lifeTraits, lifeCtx, lifeRng, simulateLife, TRAITS } from './lifesim-common.mjs';

const N = parseInt(process.argv[2] || '2000', 10), s0 = parseInt(process.argv[3] || '100001', 10);
const data = loadData(), cfg = loadCfg();
const sts = [];
for (let i = 0; i < N; i++) { const st = playGame(s0 + i, data, randomPolicy); if (st) sts.push(st); }
const inputs = sts.map((st) => lifeInputs(st, data));
const keys = Object.keys(inputs[0]);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const ref = { 局數: sts.length, 種子: `${s0}–${s0 + N - 1}`, inputs: {}, q: {} };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
for (const k of keys) { const v = inputs.map((x) => x[k]), m = mean(v); ref.inputs[k] = { mean: r4(m), sd: r4(Math.sqrt(mean(v.map((x) => (x - m) ** 2)))) }; }
cfg.ref = ref;
const comp = inputs.map((x) => composites(x, cfg));
for (const t of TRAITS) {
  const s = comp.map((c) => c[t]).sort((a, b) => a - b);
  ref.q[t] = Array.from({ length: 101 }, (_, i) => r4(s[Math.min(s.length - 1, Math.round((i / 100) * (s.length - 1)))]));
}
// 月薪中位數需要特質（用剛寫入的 ref）
ref.medianPay30 = 0;
const pays = sts.map((st) => simulateLife(lifeTraits(st, data, cfg), lifeCtx(st), lifeRng(st), cfg).stages[30].月薪).sort((a, b) => a - b);
ref.medianPay30 = pays[pays.length >> 1];
saveCfg(cfg);
console.log(`寫入 data/lifesim.json ref：${sts.length} 局（死亡 ${N - sts.length} 局不計），月薪30 中位數 ${ref.medianPay30}`);

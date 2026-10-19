// 人生模型工具共用：讀資料、玩一局、取得特質與人生。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { playToEnd } from '../js/engine/turn.js';
import { newState } from '../js/engine/state.js';
import { loadData } from './simulate.mjs';
import { lifeInputs, lifeTraits, lifeCtx, lifeRng, simulateLife, composites, TRAITS } from '../js/engine/lifesim.js';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CFG_PATH = join(root, 'data', 'lifesim.json');
export const loadCfg = () => JSON.parse(readFileSync(CFG_PATH, 'utf8'));
// 短陣列（["盡責", 0.3] 與 101 個分位點）壓成一行，讓 diff 好讀
export const saveCfg = (c) => writeFileSync(CFG_PATH, JSON.stringify(c, null, 2).replace(/\[\s*((?:-?[\d.e+-]+|"[^"\n]*")(?:,\s*(?:-?[\d.e+-]+|"[^"\n]*"))*)\s*\]/g, (m, a) => '[' + a.replace(/\s*\n\s*/g, ' ') + ']') + '\n');
export { loadData, simulateLife, lifeInputs, lifeTraits, lifeCtx, lifeRng, composites, TRAITS };

/** 玩完一局；死亡的局回傳 null（人生模型不適用）。 */
export function playGame(seed, data, policyFor) {
  const st = newState(seed, data);
  playToEnd(st, data, policyFor(st));
  return st.dead || !st.outcome ? null : st;
}

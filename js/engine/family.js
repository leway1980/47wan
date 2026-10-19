// 家境與家庭變動：補習由「家裡」出錢，所以有一個隨家境變動的科數上限。純函式，無 DOM。
import { rngAt } from './rng.js';

export const SUBJECT_COST_MONTH = 3000; // 一科一個月約 3,000 元（兩週約 1,500）
const BASE_CAP = { 寬裕: 3, 小康: 2, 吃緊: 0 };
const ECON = ['寬裕', '小康', '吃緊'];
export const MAX_TUTOR = 3;

// 自己開店、務農、接案的家庭不會「失業」，壞消息是生意變差（見 BIZ）；其餘領薪水的歸 SALARY
export const BIZ = ['早餐店', '小吃店或自助餐', '夜市攤商', '美髮或美甲店', '便利商店加盟', '新住民家庭開店', '中小企業老闆', '水電或裝潢師傅', '自由接案（設計、攝影）', '農漁業', '計程車／貨運／外送'];
export const SALARY = ['公務員', '教師', '大學教授', '軍警消', '醫生', '護理師', '藥師或醫檢師', '照服員或看護', '科技業工程師', '科技廠作業員（輪班）', '工廠輪班', '外商公司', '金融或保險', '業務', '房仲', '工地或營造', '清潔或保全', '百貨或賣場門市'];
// 失業的相對機率（沒列出的用 0.5）：輪班、業績制、工地偏高，公教醫偏低
const JOB_LOSS_W = {
  工廠輪班: 3, '科技廠作業員（輪班）': 3, 工地或營造: 3, 業務: 2.5, 房仲: 2.5, 百貨或賣場門市: 2, 清潔或保全: 1.5, 照服員或看護: 1, 科技業工程師: 1, 外商公司: 1, 金融或保險: 1,
  '計程車／貨運／外送': 3, 軍警消: 0.1, 公務員: 0.2, 教師: 0.2, 醫生: 0.1, 護理師: 0.2, 藥師或醫檢師: 0.2, 大學教授: 0.1,
};

export const SHOCKS = {
  unemployed: { sign: -1, icon: '⚠️', label: '{p}失業中', desc: '{p}的工作沒了，家裡手頭變緊，補習先省著。', card: 'fam_unemployed', end: '{p}找到新工作了，家裡手頭慢慢寬鬆回來。' },
  biz_bad: { sign: -1, icon: '⚠️', label: '{p}生意變差', desc: '店裡的客人變少，家裡手頭變緊，補習先省著。', card: 'fam_biz_bad', end: '生意慢慢回溫，家裡的手頭回到原本的樣子。' },
  sick: { sign: -1, icon: '🏥', label: '{p}住院', desc: '{p}生病住院，醫藥費和照顧都要花力氣，補習先省著。', card: 'fam_sick', end: '{p}出院了，家裡慢慢回到原本的生活。' },
  promo: { sign: 1, icon: '📈', label: '{p}加薪了', desc: '{p}升職加薪，家裡這陣子比較寬裕。', card: 'fam_promo', end: '加薪的新鮮感過了，家裡回到原本的手頭。' },
  biz_good: { sign: 1, icon: '📈', label: '生意變好', desc: '店裡生意變好，家裡這陣子比較寬裕。', card: 'fam_biz_good', end: '生意回到平常的樣子，家裡的手頭回到原本。' },
};
export const parentLabel = (st) => st.identity.family.parent || '家長';
const fillP = (t, st) => t.replace(/\{p\}/g, parentLabel(st));

export const shockOf = (st) => (st.fam && st.fam.shock ? st.fam.shock : null);

/** 目前家境（遇到衝擊時，經濟往下或往上一級） */
export function effectiveEcon(st) {
  const i = ECON.indexOf(st.identity.family.econ);
  const sk = shockOf(st);
  return ECON[Math.max(0, Math.min(2, i - (sk ? SHOCKS[sk.id].sign : 0)))];
}
/** 家裡負擔得起的補習科數上限 */
export function tutorCap(st) {
  return BASE_CAP[effectiveEcon(st)];
}
/** 上限為 0 時，最多只能上「學校課輔」（免費、消化效果較差），算 1 階 */
export const tutorMaxLevel = (st) => Math.max(1, tutorCap(st));
export const tutorIsFree = (st) => tutorCap(st) === 0;

export function shockView(st) {
  const sk = shockOf(st);
  if (!sk) return null;
  const d = SHOCKS[sk.id];
  return { icon: d.icon, label: fillP(d.label, st), desc: fillP(d.desc, st), sign: d.sign };
}

/**
 * 每回合開頭呼叫：結束到期的衝擊，或（機率很低地）開始新的衝擊。
 * 只用「命運骰」rngAt，不動主亂數流。回傳 { lines, cardId }。
 */
export function famStep(st, data, tl) {
  const out = { lines: [], cardId: null };
  const sk = shockOf(st);
  if (sk) {
    if (st.turn >= sk.until) {
      out.lines.push(fillP(SHOCKS[sk.id].end, st));
      st.fam.shock = null;
    }
    return out;
  }
  if (st.turn >= 66 || tl.fixed.some((f) => f.kind === 'fenke')) return out;
  const fam = st.identity.family, job = fam.job, grand = fam.structure === '隔代';
  const p = 0.02 * { 寬裕: 0.6, 小康: 1, 吃緊: 2 }[fam.econ];
  if (rngAt(st.seed, st.turn, 'famshock') >= p) return out;
  const neg = rngAt(st.seed, st.turn, 'famsign') < 0.7;
  let opts;
  if (neg) {
    opts = [['unemployed', JOB_LOSS_W[job] ?? (BIZ.includes(job) ? 0 : 0.5)], ['sick', 1]].filter(([, w]) => w > 0);
    if (BIZ.includes(job)) opts.push(['biz_bad', 2.5]);
    if (grand) opts = [['sick', 1]]; // 隔代：工作的是外地的爸媽，家裡的衝擊只剩阿公阿嬤生病
  } else {
    if (grand) return out;
    opts = [];
    if (SALARY.includes(job)) opts.push(['promo', 1]);
    if (BIZ.includes(job)) opts.push(['biz_good', 1]);
    if (!opts.length) opts.push(['promo', 1]);
  }
  const total = opts.reduce((a, [, w]) => a + w, 0);
  let x = rngAt(st.seed, st.turn, 'famkind') * total, id = opts[0][0];
  for (const [k, w] of opts) { if ((x -= w) < 0) { id = k; break; } }
  const dur = 6 + Math.floor(rngAt(st.seed, st.turn, 'famdur') * 11); // 6–16 回合
  st.fam = { shock: { id, from: st.turn, until: st.turn + dur } };
  out.cardId = SHOCKS[id].card;
  return out;
}

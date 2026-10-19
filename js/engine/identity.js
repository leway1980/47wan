// 開局抽籤：玩家什麼都不用打。姓名、座號、縣市、學校、家庭、通勤全部由種子決定。
import { mulberry32, pick, pickWeighted, pickKey, randInt, hashStr } from './rng.js';

export function rollCommute(r, idn, county, econ) {
  const base = idn.commuteBase[county.tier];
  const mult = idn.commuteEconMult[econ] || {};
  const w = {};
  for (const c of idn.commutes) {
    if (c === '捷運' && !county.mrt) continue;
    w[c] = (base[c] || 0) * (mult[c] || 1);
  }
  return pickKey(r, w);
}

export function rollFamily(r, idn, county) {
  const job = pickWeighted(r, idn.jobs.map((j, i) => ({ j, w: idn.jobWeights[i] })), (x) => x.w).j;
  const econW = job.econ.slice();
  if (county.tier === '其他') econW[2] *= 1.2;
  const econ = idn.econLabels[idx(pickWeighted(r, econW.map((w, i) => ({ i, w })), (x) => x.w))];
  const support = ['自己就是資源', '花錢買資源', '自己找資源'][
    idx(pickWeighted(r, job.support.map((w, i) => ({ i, w })), (x) => x.w))
  ];
  return { job, econ, support };
}
const idx = (o) => o.i;

// 真實學校名冊（data/schools.json）依縣市分組，只建一次
const byCounty = new WeakMap();
function countySchools(idn, name) {
  let m = byCounty.get(idn);
  if (!m) {
    m = new Map();
    for (const x of idn.schoolList || []) (m.get(x.county) || m.set(x.county, []).get(x.county)).push(x);
    byCounty.set(idn, m);
  }
  return m.get(name) || [];
}

/** 真實學校 → 遊戲裡的學校類型（mod、補習、學費、劇情條件都掛在類型上） */
export function schoolTypeId(x) {
  if (x.tier === 'star') return 'star';
  if (x.tier === 'pstar') return 'private_elite';
  if (x.kind === '技高') return x.pub ? 'public_voc' : 'private_voc';
  if (x.kind === '綜高') return 'comprehensive';
  if (x.kind === '單科') return 'community';
  return x.pub ? 'community' : 'private_general'; // 公立普高（含非明星的一般校）都歸「社區」，劇情用 明星 條件區分
}

/** 在縣市裡依學生數抽一所真實學校，回傳 { type, sch } */
export function rollSchool(r, idn, county) {
  const sch = pickWeighted(r, countySchools(idn, county.name), (x) => x.w);
  return { type: idn.schools.find((t) => t.id === schoolTypeId(sch)), sch };
}

/** 家庭型態：獨立亂數流，結果會影響家境、零用錢與稱呼 */
export function rollStructure(rs, idn) {
  return pickWeighted(rs, idn.familyStructures, (x) => x.w);
}

const ECONS = ['寬裕', '小康', '吃緊'];
export const structureLine = (f) => ({
  離異: `爸媽離婚，平常跟${f.parent}住`,
  隔代: `爸媽在外地工作，平常由${f.parent}照顧你`,
  重組: `${f.parent}再婚了，家裡多了${f.step}`,
  喪親: `家裡只有你和${f.parent}`,
}[f.structure] || '');

export const SUBJECTS = ['國文', '英文', '數學', '自然', '社會'];

// 校名的類型決定大多數學生讀哪些群：高工多是機電、高商多是商管；工商、綜高等混合型不偏
const GROUP_FIT = [
  [/高工$/, ['機械', '電機與電子', '動力機械', '化工', '土木與建築', '設計']],
  [/高商$/, ['商業與管理', '外語', '設計', '餐旅']],
  [/(家商|家職|護家|高家)$/, ['家政', '餐旅', '商業與管理', '設計']],
  [/(高農|農工)$/, ['農業', '食品', '機械', '電機與電子']],
  [/(海事|水產)/, ['水產', '動力機械', '餐旅', '商業與管理']],
];
export function groupFit(schoolName, group) {
  const hit = GROUP_FIT.find(([re]) => re.test(schoolName));
  return !hit ? 1 : hit[1].includes(group) ? 6 : 0.1;
}

export function generateIdentity(seed, idn) {
  const r = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const surname = pickWeighted(r, idn.surnames.map((n, k) => ({ n, w: idn.surnameW[k] })), (x) => x.w).n;
  // 外貌用獨立亂數流，不影響其他抽籤；性別先決定，名字依性別挑
  const ra = mulberry32((seed ^ 0x7a3c91d5) >>> 0);
  const sex = ra() < 0.5 ? '男' : '女';
  const given = pick(r, sex === '男' ? idn.givenNamesM : idn.givenNamesF);
  const county = pickWeighted(r, idn.counties, (c) => c.w);
  const { type: schoolType, sch } = rollSchool(r, idn, county);
  const district = r() < 0.7 ? sch.district : pick(r, county.districts); // 七成住在學校同一區
  const seat = randInt(r, 1, 35);
  const school = sch.n + (sch.pub ? '' : '（私立）');
  const fam = rollFamily(r, idn, county);
  // 家庭型態、群科：獨立亂數流，不影響其他抽籤
  const rs = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const struct = rollStructure(rs, idn);
  if (struct.econDown && rs() < struct.econDown) fam.econ = ECONS[Math.min(2, ECONS.indexOf(fam.econ) + 1)]; // 單薪：家境往下一級
  // 綜高校的學生多半讀普通科或綜合學程，只有職業類科的才算技高：學程用獨立亂數流
  const program = sch.kind === '綜高' ? pickWeighted(mulberry32((seed ^ 0x2c1b3c6d) >>> 0), idn.programs, (x) => x.w).n : sch.kind === '技高' ? '專業群科' : '普通科';
  const kind = program === '職業類科' || program === '專業群科' ? '技高' : sch.kind === '單科' ? '單科' : '普高';
  const vocGroup = kind === '技高' ? pickWeighted(rs, idn.vocGroups, (x) => x.w * groupFit(sch.n, x.n)).n : null;
  const style = pick(r, idn.styles);
  // 有捷運的縣市也不是每一區都有站：住的區沒有捷運站就不會抽到捷運
  const mrt = !!county.mrt && (!county.mrtDistricts || county.mrtDistricts.includes(district));
  const commute = rollCommute(r, idn, { ...county, mrt }, fam.econ);
  const av = idn.avatar;
  const look = {
    bottom: sex === '男' ? '長褲' : (ra() < 0.75 ? '裙' : '長褲'),
    hair: Math.floor(ra() * 3),
    hairColor: pickWeighted(ra, av.hairColors.map((c, i) => ({ i, w: av.hairColorW[i] })), (x) => x.w).i,
    skin: pickWeighted(ra, av.skins.map((c, i) => ({ i, w: av.skinW[i] })), (x) => x.w).i,
    glasses: ra() < 0.35,
  };
  let parent = ra() < 0.5 ? '爸爸' : '媽媽';
  const step = struct.id === '重組' ? (parent === '爸爸' ? '繼母' : '繼父') : null;
  if (struct.id === '隔代') parent = rs() < 0.7 ? '阿嬤' : '阿公';
  const W = { 高期待: [6, 3.5, 0.5], 支持: [2.5, 5.5, 2], 放任: [1, 3, 6], 自顧不暇: [0.5, 2.5, 7] }[style] || [2, 5, 3];
  if (struct.id === '隔代') { W[0] *= 0.4; W[2] *= 1.8; } // 阿公阿嬤比較不太管
  const parentRule = ['嚴格', '普通', '不太管'][pickWeighted(ra, W.map((w, i) => ({ i, w })), (x) => x.w).i];
  const schoolKey = hashStr(sch.id) % idn.uniformPalettes.length; // 同一所學校的人穿同一套制服
  // 零用錢與各科天分：獨立亂數流，不影響其他抽籤
  const rm = mulberry32((seed ^ 0x1f2e3d4c) >>> 0);
  const ALLOW = { 寬裕: [1500, 4000], 小康: [600, 2000], 吃緊: [0, 700] }[fam.econ];
  const noAllow = rm() < { 寬裕: 0.08, 小康: 0.15, 吃緊: 0.35 }[fam.econ]; // 沒有固定零用錢，要用時再跟家裡拿
  let allowanceMonth = noAllow ? 0 : Math.round((ALLOW[0] + rm() * (ALLOW[1] - ALLOW[0])) / 100) * 100;
  if (struct.allowance) allowanceMonth = Math.round((allowanceMonth * struct.allowance) / 100) * 100;
  const aptitude = {};
  for (const sub of SUBJECTS) aptitude[sub] = Math.round((rm() - 0.5) * 30); // −15～+15
  return {
    name: surname + given,
    sex,
    ...look,
    schoolKey,
    seat,
    county: county.name,
    district,
    tier: county.tier,
    mrt,
    schoolId: schoolType.id,
    schoolType: schoolType.name,
    school,
    schoolCode: sch.id,
    schoolDistrict: sch.district,
    schoolTier: sch.tier,
    kind, // 這位學生實際走的路：普高｜技高｜單科（綜高校依 program 歸類）
    schoolKind: sch.kind,
    program,
    vocGroup,
    family: {
      support: fam.support,
      econ: fam.econ,
      job: fam.job.name,
      jobDesc: struct.id === '隔代' ? `爸媽在外地工作（${fam.job.name}），平常由${parent}照顧你` : fam.job.desc,
      sleep: struct.id === '隔代' ? 0 : fam.job.sleep,
      style,
      parent,
      structure: struct.id,
      step,
    },
    parentRule,
    allowanceMonth,
    aptitude,
    commute,
    commuteOrig: commute,
    info: idn.infoBySupport[fam.support] + (struct.資訊 || 0),
  };
}

const KIND_PHRASE = {
  普高: '和你一樣讀普通高中（含綜合高中的普通科）的大約有一半。',
  技高: '和你一樣讀技術型高中的大約四成。',
  單科: '讀專門領域單科高中的人很少，你是其中一個。',
};
export function openingText(id, idn) {
  const econ = idn.econPhrase[id.family.econ];
  const sline = id.family.structure === '隔代' ? '' : structureLine(id.family); // 隔代的說明已在 jobDesc 裡
  return [
    '你是 2026 年 8 月，全台 47 萬名高中、高職學生裡的一人。',
    `你叫${id.name}，座號 ${id.seat} 號。你住在${id.county}${id.district}，學校是${id.district === id.schoolDistrict ? '同一區的' : ''}${id.school.replace('（私立）', '')}（${id.schoolDistrict}${id.school.endsWith('（私立）') ? '，私立' : ''}）。你${idn.commutePhrase[id.commute]}。`,
    `${id.family.jobDesc}，${econ}。${sline ? sline + '。' : ''}${id.allowanceMonth ? `每個月零用錢 ${id.allowanceMonth.toLocaleString('en-US')} 元。` : '家裡沒有固定給零用錢，要用時再開口。'}`,
    `這 47 萬人裡，${KIND_PHRASE[id.kind] || KIND_PHRASE.普高}`,
  ];
}

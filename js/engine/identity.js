// 開局抽籤：玩家什麼都不用打。姓名、座號、縣市、學校、家庭、通勤全部由種子決定。
import { mulberry32, pick, pickWeighted, pickKey, randInt } from './rng.js';

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

export function rollSchool(r, idn, county) {
  return pickWeighted(r, idn.schools, (s) => s.w[county.tier]);
}

export function generateIdentity(seed, idn) {
  const r = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const surname = pickWeighted(r, idn.surnames.map((n, k) => ({ n, w: idn.surnameW[k] })), (x) => x.w).n;
  // 外貌用獨立亂數流，不影響其他抽籤；性別先決定，名字依性別挑
  const ra = mulberry32((seed ^ 0x7a3c91d5) >>> 0);
  const sex = ra() < 0.5 ? '男' : '女';
  const given = pick(r, sex === '男' ? idn.givenNamesM : idn.givenNamesF);
  const county = pickWeighted(r, idn.counties, (c) => c.w);
  const district = pick(r, county.districts);
  const seat = randInt(r, 1, 35);
  const schoolType = rollSchool(r, idn, county);
  const school = pick(r, schoolType.names) + '高中' + (schoolType.id.startsWith('private') ? '（私立）' : '');
  const fam = rollFamily(r, idn, county);
  const style = pick(r, idn.styles);
  const commute = rollCommute(r, idn, county, fam.econ);
  const av = idn.avatar;
  const look = {
    bottom: sex === '男' ? '長褲' : (ra() < 0.75 ? '裙' : '長褲'),
    hair: Math.floor(ra() * 3),
    hairColor: pickWeighted(ra, av.hairColors.map((c, i) => ({ i, w: av.hairColorW[i] })), (x) => x.w).i,
    skin: pickWeighted(ra, av.skins.map((c, i) => ({ i, w: av.skinW[i] })), (x) => x.w).i,
    glasses: ra() < 0.35,
  };
  const parent = ra() < 0.5 ? '爸爸' : '媽媽';
  const W = { 高期待: [6, 3.5, 0.5], 支持: [2.5, 5.5, 2], 放任: [1, 3, 6], 自顧不暇: [0.5, 2.5, 7] }[style] || [2, 5, 3];
  const parentRule = ['嚴格', '普通', '不太管'][pickWeighted(ra, W.map((w, i) => ({ i, w })), (x) => x.w).i];
  const schoolKey = Object.keys(idn.uniforms).find((k) => school.startsWith(k)) || Object.keys(idn.uniforms)[0];
  return {
    name: surname + given,
    sex,
    ...look,
    schoolKey,
    seat,
    county: county.name,
    district,
    tier: county.tier,
    mrt: county.mrt,
    schoolId: schoolType.id,
    schoolType: schoolType.name,
    school,
    family: {
      support: fam.support,
      econ: fam.econ,
      job: fam.job.name,
      jobDesc: fam.job.desc,
      sleep: fam.job.sleep,
      style,
      parent,
    },
    parentRule,
    commute,
    commuteOrig: commute,
    info: idn.infoBySupport[fam.support],
  };
}

export function openingText(id, idn) {
  const econ = idn.econPhrase[id.family.econ];
  return [
    '你是 2026 年 8 月，全台 47 萬名高中、高職學生裡的一人。',
    `你叫${id.name}，座號 ${id.seat} 號，在${id.county}${id.district}的一所${id.schoolType}。你${idn.commutePhrase[id.commute]}。`,
    `${id.family.jobDesc}，${econ}。`,
    `這 47 萬人裡，和你一樣讀普通高中的大約有一半。`,
  ];
}

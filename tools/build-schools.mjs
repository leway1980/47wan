// 一次性產生 data/schools.json（執行期不需要這支程式）。
// 用法：node tools/build-schools.mjs <schools_raw.json> <star_schools.json>
// 輸入是整理過的全臺高中職名冊（代碼、校名、縣市、鄉鎮市區、公私立、類型、111 學年學生數）與明星高中標記。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [rawPath, starPath] = process.argv.slice(2);
if (!rawPath || !starPath) { console.error('用法：node tools/build-schools.mjs <schools_raw.json> <star_schools.json>'); process.exit(1); }
const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const starFile = JSON.parse(readFileSync(starPath, 'utf8'));
const tagOf = new Map(Object.values(starFile).flat().map((s) => [s.code, s.tag]));

const COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
const CSHORT = [...new Set(COUNTIES.map((c) => c.slice(0, -1)))];
// 校名結尾的正規化（由長到短）
const SUFFIX = [
  [/高級家事商業職業學校$/, '家商'], [/家事商業高級中等學校$/, '家商'],
  [/高級海事水產職業學校$/, '海事水產'], [/高級農工職業學校$/, '農工'], [/高級工商職業學校$/, '工商'], [/高級商工職業學校$/, '商工'],
  [/高級工業家事職業學校$/, '工家'], [/工業家事職業學校$/, '工家'], [/農業工業高級中等學校$/, '農工'],
  [/高級工業職業學校$/, '高工'], [/工業高級中等學校$/, '高工'], [/高級商業職業學校$/, '高商'], [/商業高級中等學校$/, '高商'],
  [/商業水產職業學校$/, '商水'], [/高級農業職業學校$/, '高農'], [/高級餐旅職業學校$/, '餐旅'], [/高級職業學校$/, '高職'],
  [/實驗高級中(學|等學校)$/, '實驗高中'], [/女子高級中(學|等學校)$/, '女中'], [/高級中(學|等學校)$/, '高中'],
];
const TAILS = ['商水', '海事水產', '實驗高中', '高中', '中學', '高工', '高商', '高農', '高職', '家商', '農工', '工商', '商工', '工家', '餐旅', '女中'];

export function shortName(name) {
  let s = name;
  const i = s.lastIndexOf('財團法人');
  if (i >= 0) s = s.slice(i + 4); // 「X學校財團法人Y」只留 Y
  for (let k = 0; k < 4; k++) {
    const before = s;
    s = s.replace(/^(國立|私立|市立|縣立)/, '');
    for (const c of COUNTIES) if (s.startsWith(c)) { s = s.slice(c.length).replace(/^(私立|立)/, ''); break; }
    if (s === before) break;
  }
  const ord = s.match(/^(.+?)第(一|二|三)高級中(?:學|等學校)$/); // 臺中第一高級中學 → 臺中一中
  if (ord && CSHORT.includes(ord[1])) return ord[1] + ord[2] + '中';
  for (const [re, to] of SUFFIX) if (re.test(s)) { s = s.replace(re, to); break; }
  // 去掉開頭的縣市簡稱，但剩下要還有至少 2 個字（不含結尾），且不是大學附屬、女中、序數
  for (const c of CSHORT) {
    if (!s.startsWith(c)) continue;
    const rest = s.slice(c.length), tail = TAILS.find((t) => rest.endsWith(t)) || '';
    const stem = rest.slice(0, rest.length - tail.length);
    if (stem.length >= 2 && !/^(大學|女|第)/.test(stem) && !/大學|附設/.test(rest)) s = rest;
    break;
  }
  return s;
}
const mask = (s, at) => s.slice(0, at) + '○' + s.slice(at + 1);

const med = {};
for (const k of ['普高', '技高', '綜高', '單科']) {
  const v = raw.filter((x) => x.kind === k && x.students > 0).map((x) => x.students).sort((a, b) => a - b);
  med[k] = v.length ? v[Math.floor(v.length / 2)] : 500;
}
const out = raw.map((x) => {
  const tag = tagOf.get(x.code);
  const tier = tag === 'public_star' ? 'star' : tag === 'private_star' ? 'pstar'
    : x.public && x.kind === '普高' && ((x.students > 0 ? x.students : med.普高) < 600 || /[鄉鎮]$/.test(x.district)) ? 'community' : 'general';
  const short = shortName(x.name);
  return { id: x.code, short, n: mask(short, 1), county: x.county, district: x.district, pub: !!x.public, kind: x.kind, tier, w: x.students > 0 ? x.students : med[x.kind] };
});
// 遮罩位置的候選順序：第 2 字、其餘校名本體的字、第 1 字（結尾的「高中／高工…」不遮）。第 2 字是立／市／縣的先排後面。
const cands = (s) => {
  const tail = TAILS.find((t) => s.endsWith(t)) || '', stem = s.length - tail.length;
  const idx = [];
  for (let i = 1; i < stem; i++) idx.push(i);
  if (s.length <= 2) idx.length = 0; // 兩個字的校名只能遮第 1 個字
  idx.push(0);
  for (let i = stem; i < s.length; i++) idx.push(i);
  if (/^.[立市縣]/.test(s) && idx[0] === 1) idx.push(idx.shift());
  return idx;
};
const report = { bad2: [], moved: [], still: [] };
const used = new Set();
for (const s of out) { s.pos = cands(s.short); s.n = mask(s.short, s.pos[0]); }
// 同縣市遮罩後重名：後面的改遮下一個候選位置
for (const s of out) {
  let k = 0;
  while (used.has(s.county + s.n) && ++k < s.pos.length) s.n = mask(s.short, s.pos[k]);
  if (used.has(s.county + s.n)) report.still.push(s.short);
  if (k) report.moved.push(`${s.short}→${s.n}`);
  used.add(s.county + s.n);
}
for (const s of out) if (/^.[立市縣]/.test(s.short)) report.bad2.push(s.short);

const schools = out.map(({ short, pos, ...s }) => s);
const readme = '全臺高中職名冊（483 所；校名遮掉一個字，只暗示不點名）。來源：研究階段整理的全臺高中職名冊與 111 學年學生數（學生數缺漏者用同類型中位數；逐校出處待補）；明星高中標記（star=公立、pstar=私立）為人工整理。'
  + '規則：n=簡稱後把第 2 個字換成○（同縣市重名改遮其他校名本體的字，結尾的高中／高工等不遮）；kind=普高|技高|綜高|單科；tier=star|pstar|community（公立普高且學生數<600或在鄉鎮）|general；w=學生數（抽籤權重）。'
  + '由 tools/build-schools.mjs 產生，執行期不讀該程式。';
writeFileSync(join(ROOT, 'data', 'schools.json'), `{\n "_readme": ${JSON.stringify(readme)},\n "schools": [\n${schools.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]\n}\n`);

const cnt = (f) => schools.filter(f).length;
console.log(`學校 ${schools.length}；star ${cnt((s) => s.tier === 'star')}、pstar ${cnt((s) => s.tier === 'pstar')}、community ${cnt((s) => s.tier === 'community')}、general ${cnt((s) => s.tier === 'general')}`);
console.log('類型：' + ['普高', '技高', '綜高', '單科'].map((k) => `${k} ${cnt((s) => s.kind === k)}`).join('、'));
if (report.bad2.length) console.log('第 2 字為 立/市/縣：', report.bad2.join('、'));
if (report.moved.length) console.log('同縣市重名、改遮其他位置：', report.moved.join('、'));
if (report.still.length) console.log('遮罩後仍重名：', report.still.join('、'));
if (process.env.SAMPLE) for (const s of out) console.log(`${s.short}\t${s.n}\t${s.county}${s.district}\t${s.kind}\t${s.tier}`);

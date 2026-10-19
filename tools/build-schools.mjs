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
// 校名結尾（類型字）：遮罩不碰這些字，只遮前面「校名本體」的字
const TAILS = ['海事水產', '實驗學校', '實驗高中', '商水', '高中', '中學', '高工', '高商', '高農', '高職', '家商', '家職', '農工', '工商', '商工', '工家', '工農', '商海', '餐旅', '餐飲', '藝校', '實中', '附中', '護家', '女中', '海事'].sort((a, b) => b.length - a.length);

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
  return { id: x.code, short, n: short, county: x.county, district: x.district, pub: !!x.public, kind: x.kind, tier, w: x.students > 0 ? x.students : med[x.kind] };
});
// 遮罩：遮校名本體（類型字之前）的第 2 個字；本體只有 1 個字就整個換成○；第 2 字是立／市／縣時改遮第 3 個字。同縣市重名沒關係，畫面上旁邊會顯示鄉鎮市區
const maskName = (s) => {
  const tail = TAILS.find((t) => s.endsWith(t)) || '', stem = s.length - tail.length;
  if (stem <= 0) return mask(s, 0);
  if (stem === 1) return '○' + tail;
  const at = /^.[立市縣]/.test(s) && stem >= 3 ? 2 : 1;
  return mask(s, at);
};
const report = { bad2: [] };
for (const s of out) s.n = maskName(s.short);
for (const s of out) if (/^.[立市縣]/.test(s.short)) report.bad2.push(s.short);

const schools = out.map(({ short, ...s }) => s);
const readme = '全臺高中職名冊（483 所；校名遮掉一個字，只暗示不點名）。來源：研究階段整理的全臺高中職名冊與 111 學年學生數（學生數缺漏者用同類型中位數；逐校出處待補）；明星高中標記（star=公立、pstar=私立）為人工整理。'
  + '規則：n=簡稱後把校名本體（類型字之前）的第 2 個字換成○，結尾的高中／高工等類型字不遮，本體只有 1 字則整個換成○；同縣市可重名（畫面會並列鄉鎮市區）；kind=普高|技高|綜高|單科；tier=star|pstar|community（公立普高且學生數<600或在鄉鎮）|general；w=學生數（抽籤權重）。'
  + '由 tools/build-schools.mjs 產生，執行期不讀該程式。';
writeFileSync(join(ROOT, 'data', 'schools.json'), `{\n "_readme": ${JSON.stringify(readme)},\n "schools": [\n${schools.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]\n}\n`);

const cnt = (f) => schools.filter(f).length;
console.log(`學校 ${schools.length}；star ${cnt((s) => s.tier === 'star')}、pstar ${cnt((s) => s.tier === 'pstar')}、community ${cnt((s) => s.tier === 'community')}、general ${cnt((s) => s.tier === 'general')}`);
console.log('類型：' + ['普高', '技高', '綜高', '單科'].map((k) => `${k} ${cnt((s) => s.kind === k)}`).join('、'));
if (report.bad2.length) console.log('第 2 字為 立/市/縣：', report.bad2.join('、'));
if (process.env.SAMPLE) for (const s of out) console.log(`${s.short}\t${s.n}\t${s.county}${s.district}\t${s.kind}\t${s.tier}`);

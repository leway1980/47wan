// 學期報告與終局報告。純函式，只回傳資料或 SVG 字串。
import { rngAt } from './rng.js';
import { lifeProbTable, COMMUTE_DAYS_PER_TURN, DEATH_LINE } from './life.js';
import { peerCounts } from './peers.js';
import { focusPhrase } from './state.js';
import { composeEnding } from './ending.js';
import { buildConduct } from './conduct.js';

const WD = ['日', '一', '二', '三', '四', '五', '六'];
export function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
}
export function formatDateLong(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}
const GRADE = ['高一', '高二', '高三'];
export const turnLabel = (tl) => `${GRADE[tl.year - 1]}${tl.seg}第 ${tl.idx + 1} 回合`;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmtPct = (p) => {
  const v = p * 100;
  if (v >= 1) return Math.round(v) + '%';
  return v.toPrecision(1).replace(/0+$/, '').replace(/\.$/, '') + '%';
};

/* ───────────── 去向 ───────────── */
const DEPTS = {
  自然學群: ['電機工程系', '物理系', '資訊工程系', '化學系', '醫學檢驗系', '土木工程系'],
  文法商學群: ['企業管理系', '法律系', '社會學系', '歷史系', '外國語文學系', '心理系'],
};
// 技高的去向：科系依群科挑，直接就業的單位也依群科
const VOC_DEPTS = {
  商業與管理: ['企業管理系', '會計系', '國際貿易系', '行銷與流通管理系'], 電機與電子: ['電機工程系', '電子工程系', '資訊工程系'],
  餐旅: ['餐旅管理系', '廚藝系', '烘焙系'], 機械: ['機械工程系', '模具工程系', '機電工程系'], 動力機械: ['車輛工程系', '機械工程系'],
  設計: ['視覺傳達設計系', '商業設計系', '室內設計系'], 家政: ['幼兒保育系', '餐飲管理系', '時尚設計系'], 外語: ['應用外語系', '觀光系'],
  化工: ['化學工程系', '材料工程系'], 土木與建築: ['土木工程系', '建築系'], 農業: ['園藝系', '動物科學系'], 食品: ['食品科學系'], 水產: ['水產養殖系', '海洋休閒系'],
};
const VOC_WORK = {
  商業與管理: '公司的行政或會計部門', 電機與電子: '科技廠或電機公司', 餐旅: '飯店或餐廳', 機械: '工廠', 動力機械: '汽機車保修廠', 設計: '設計公司',
  家政: '幼兒園或餐飲業', 外語: '貿易公司或旅遊業', 化工: '化工廠', 土木與建築: '營造公司', 農業: '農場或農企業', 食品: '食品工廠', 水產: '水產公司或漁業單位',
};
export function computeOutcomeVoc(st) {
  const f = st.flags, grp = st.identity.vocGroup || '商業與管理';
  const test = 25 + 0.75 * (st.final ?? st.tcte ?? st.stats.理解);
  const ex = st.examScores && st.examScores.length ? st.examScores.reduce((a, b) => a + b, 0) / st.examScores.length : test;
  const s = 0.6 * test + 0.4 * ex + (f.申請多 ? 2 : f.申請少 ? -3 : 0);
  const u = rngAt(st.seed, 99, 'final'), uw = rngAt(st.seed, 97, 'vocwork');
  const dl = VOC_DEPTS[grp] || VOC_DEPTS.商業與管理;
  const dept = dl[Math.floor(rngAt(st.seed, 98, 'dept') * dl.length)];
  // 直接就業：基本約一成，有建教合作、實習認真、家境吃緊、分數偏低的人比較高
  const pWork = 0.08 + (f.建教合作 ? 0.14 : 0) + (f.實習認真 ? 0.04 : 0) + (st.identity.family.econ === '吃緊' ? 0.05 : 0) + (s < 45 ? 0.04 : 0);
  let type;
  if (uw < pWork) type = '直接就業';
  else if (s >= 68 && ex >= 55) type = '國立科大';
  else if (s >= 50) type = '私立科大';
  else if (s >= 40) type = u < 0.18 ? '二專或五專續讀' : '私立科大';
  else type = u < 0.35 ? '重考一年' : u < 0.7 ? '二專或五專續讀' : '私立科大';
  const retake = type === '重考一年';
  const work = VOC_WORK[grp] || '業界';
  const text = retake ? '這次沒有上到想去的學校，你決定重考一年。'
    : type === '直接就業' ? (f.建教合作 ? `實習單位留用你，畢業後直接到${work}上班。` : `你決定畢業後直接進入業界，到${work}上班。`)
    : type === '二專或五專續讀' ? `你錄取了二專的${dept}，把專業再學深兩年。` : `你錄取了${type}的${dept}。`;
  return { type, dept, group: grp, retake, text, score: Math.round(s) };
}
export function computeOutcome(st) {
  if (st.identity.kind === '技高') return computeOutcomeVoc(st);
  // 升學結果 = 學測／申請表現（換算成段考的分數尺度）六成 + 三年段考平均四成
  // 段考常常不及格的人，幾乎不可能上國立大學
  const test = 25 + 0.75 * (st.final ?? st.gsat ?? st.stats.理解);
  const ex = st.examScores && st.examScores.length ? st.examScores.reduce((a, b) => a + b, 0) / st.examScores.length : test;
  // 申請入學報的校系越多，越有機會上（報名費要自己或家裡付）
  const appBonus = st.flags.申請多 ? 2 : st.flags.申請少 ? -3 : 0;
  const s = 0.6 * test + 0.4 * ex + appBonus;
  const u = rngAt(st.seed, 99, 'final');
  const group = st.flags.自然學群 ? '自然學群' : st.flags.文法商學群 ? '文法商學群' : st.stats.理解 >= 50 ? '自然學群' : '文法商學群';
  const dept = DEPTS[group][Math.floor(rngAt(st.seed, 98, 'dept') * DEPTS[group].length)];
  let type;
  if (s >= 74 && ex >= 62) type = '國立大學';
  else if (s >= 66 && ex >= 62) type = u < 0.15 + ((s - 66) / 8) * 0.55 ? '國立大學' : '私立大學';
  else if (s >= 66) type = '私立大學'; // 段考平均不到 62，申請國立大學幾乎沒機會
  else if (s >= 55) type = u < 0.7 ? '私立大學' : '科技大學';
  else if (s >= 45) type = u < 0.15 ? '重考一年' : u < 0.4 ? '私立大學' : '科技大學';
  else type = u < 0.4 ? '重考一年' : '科技大學';
  const retake = type === '重考一年';
  const text = retake ? '這次沒有上到想去的學校，你決定重考一年。' : `你錄取了${type}的${dept}。`;
  return { type, dept, group, retake, text, score: Math.round(s) };
}

/* ───────────── 學期報告 ───────────── */
export function semesterReport(st, data, tl) {
  const S = st.stats, id = st.identity, idn = data.identities;
  const school = idn.schools.find((x) => x.id === id.schoolId);
  const phrases = [focusPhrase(S.專注)];
  if (S.睡眠債 >= 4) phrases.push('早上常常爬不起來');
  else if (S.睡眠債 < 1.5) phrases.push('最近睡得還不錯');
  if (S.聯繫 < 25) phrases.push('群組變得很安靜');
  else if (S.聯繫 > 65) phrases.push('手機裡的聊天室多到記不住');
  if (S.知心 < 1.5) phrases.push('心裡的話好像沒有地方可以講');
  else if (S.知心 >= 3) phrases.push('遇到事，你知道可以找誰');
  if (S.心情 < 40) phrases.push('最近心情有點低');
  else if (S.心情 > 65) phrases.push('最近過得蠻開心的');
  if (S.體力 < 40) phrases.push('覺得身體很累');
  if (S.錢包 < 300) phrases.push('月底的錢包有點緊');
  const pc = peerCounts(st, data);
  const n = 1000;
  const cramShare = (pc.補習 + (st.habits.補習 > 0 ? 1 : 0)) / (pc.在學 + 1);
  const inClass = Math.round(35 * cramShare);
  const schoolLine = `${school.flavor}全班 35 人裡，大約有 ${inClass} 人放學後去補習；${st.habits.補習 > 0 ? '你也是其中一個。' : '你不在其中。'}`;
  // 猜題一次只問一件事：補習和打工輪流
  const askCram = (st.quiz.length % 2) === 0;
  const cramN = pc.補習 + (st.habits.補習 > 0 ? 1 : 0), workN = pc.打工 + (st.flags.打工中 ? 1 : 0);
  const answer = Math.round(((askCram ? cramN : workN) / n) * 100);
  const quizTopic = askCram ? '補習' : '打工';
  const snap = st.peerSnap, pcu = st.peerCounts;
  const injured = pcu.受傷 - snap.受傷;
  const left = pcu.離開 - snap.離開;
  const peerLines = [
    `${pc.補習 + (st.habits.補習 > 0 ? 1 : 0)} 人在補習，${pc.打工 + (st.flags.打工中 ? 1 : 0)} 人在打工（有些人兩個都做）`,
    `${pc.手機重度} 人手機「一有空就滑」以上`,
    `${pc.交往 + (st.flags.交往中 ? 1 : 0)} 人正在交往`,
    `累計 ${pc.離開 + pc.休學} 人離開或暫時離開原本的學校（休學、轉學、轉換跑道）${left ? `，這學期新增 ${left} 人` : ''}`,
    injured ? `這學期有 ${injured} 人在通勤途中受傷` : '這學期同屆沒有太大的通勤事故消息',
  ];
  st.peerSnap = { ...pcu };
  // 這學期（10 個回合）內留下的路人消息，新的在前、最多 3 則；舊的清掉
  const feed = (st.peerFeed || []).filter((f) => f.turn > tl.turn - 10 && f.turn <= tl.turn).reverse().slice(0, 3).map((f) => f.text);
  st.peerFeed = (st.peerFeed || []).filter((f) => f.turn > tl.turn);
  const days = COMMUTE_DAYS_PER_TURN * 10;
  const commuteLine = commuteSentence(st, data, days);
  return {
    title: `${GRADE[tl.year - 1]}${tl.seg}`,
    phrases, schoolLine, peerLines, commuteLine, feed,
    quiz: { topic: quizTopic, question: `猜猜看：同屆有多少 % 的人在${quizTopic}？`, answer },
    peerHead: '這學期，跟你同屆的 1,000 人裡：',
  };
}

export function commuteSentence(st, data, days) {
  const c = st.identity.commute;
  const t = lifeProbTable(c, data.life.events, 180);
  const by = Object.fromEntries(t.map((x) => [x.id, x]));
  const own = st.identity.commuteOrig === c ? '這是你一開始抽到的通勤方式。' : '這是你自己選的通勤方式，風險和抽到的一樣。';
  if (c === '無照騎機車') {
    return `這學期你無照騎了約 ${days} 天機車。像你這樣每天騎的人，一年內因交通事故死亡的機率約 ${fmtPct(by.traffic_death_teen.pYear)}，被攔查開罰的機率約 ${fmtPct(by.unlicensed_penalty.pYear)}。${own}`;
  }
  if (c === '微電車') {
    return `這學期你騎了約 ${days} 天微電車。照真實數據推估，像你這樣每天騎的人，一年發生事故的機率大約 ${fmtPct(by.micro_escooter_crash.pYear)}。${own}`;
  }
  if (c === '腳踏車') {
    return `這學期你騎了約 ${days} 天腳踏車。照真實數據推估，像你這樣每天騎慢車上學的人，一年在事故中受傷的機率大約 ${fmtPct(by.slow_vehicle_casualty.pYear)}。${own}`;
  }
  const p = by.traffic_death_teen.pYear;
  return `這學期你有約 ${days} 天以「${c}」上學。像你這樣通勤的人，一年因交通事故死亡的機率大約 ${fmtPct(p)}，約每 ${Math.round(1 / p / 1000) * 1000 > 0 ? (Math.round(1 / p / 1000) * 1000).toLocaleString() : Math.round(1 / p)} 人有 1 人，比無照騎機車的人低了約 30 倍。${own}`;
}

/* ───────────── SVG 小圖 ───────────── */
export function sparkline(series, { min = 0, max = 100, w = 300, h = 54, label = '' } = {}) {
  const pad = 4;
  const n = Math.max(...series.map((s) => s.v.length), 2);
  const x = (i) => pad + (i * (w - pad * 2)) / (n - 1);
  const y = (v) => h - pad - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (h - pad * 2);
  const lines = series.map((s) => `<polyline class="sp ${s.cls}" fill="none" points="${s.v.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${label}">${lines}</svg>`;
}

/* ───────────── 終局 ───────────── */
const HAB_PHONE = ['幾乎不用', '需要才用', '下課會滑', '一有空就滑', '隨時在線'];

function habitStats(st) {
  const hs = st.hist;
  const col = (k) => hs.map((h) => h.h[k]);
  const third = Math.max(1, Math.floor(hs.length / 3));
  return {
    n: hs.length,
    phone: mean(col(0)), bed: mean(col(1)), cram: mean(col(2)), sport: mean(col(3)), game: mean(col(4)),
    debt: mean(hs.map((h) => h.睡眠債)), link: mean(hs.map((h) => h.聯繫)), hang: mean(hs.map((h) => h.牽掛)),
    focus: mean(hs.map((h) => h.專注)),
    early: mean(hs.slice(0, third).map((h) => h.理解)), late: mean(hs.slice(-third).map((h) => h.理解)),
    undstd: st.stats.理解,
  };
}

function pickArchetype(st, a) {
  const clubs = ['社團:音樂', '社團:科學', '社團:運動'].filter((f) => st.flags[f]).length;
  const sc = {
    A: (a.debt <= 2.6 ? 1 : 0) + (a.phone <= 1.8 ? 1 : 0) + (a.undstd >= 55 ? 1 : 0) + (a.cram <= 1 ? 0.5 : 0),
    B: (a.link >= 55 ? 1.5 : 0) + (a.phone >= 2.6 ? 1 : 0) + (st.flags.交往中 ? 0.3 : 0),
    C: (a.game >= 1.6 ? 1.5 : 0) + (a.hang >= 3.5 ? 1.5 : 0),
    D: (a.cram >= 1.8 ? 1.8 : 0) + (a.undstd < 65 && a.cram >= 1.5 ? 1 : 0),
    G: (a.late - a.early >= 10 ? 2.2 : 0) + (a.focus < 70 ? 0.3 : 0),
    F: 0.9 + (clubs >= 2 ? 1 : 0) + (st.flags.去過營隊 ? 0.4 : 0),
  };
  let best = 'F', bv = -1;
  for (const k of ['A', 'B', 'C', 'D', 'G', 'F']) if (sc[k] > bv) { bv = sc[k]; best = k; }
  return best;
}

function outcomeLine(o, voc) {
  return o.retake || o.type === '直接就業' ? o.text : voc ? `統測加甄選，${o.text}` : `學測加申請，${o.text}`;
}

// 原型只管標籤與 18 歲那句；22／25／30 歲與好的／遺憾由 data/endings.json 的條件句庫組合（見 ending.js）
function archetypeText(k, v) {
  const { o, voc } = v;
  const L = (oo) => outcomeLine(oo, voc);
  const T = {
    A: { tag: '穩定自律型', line: '沒有很亮眼，但每一步都踩得到。', a18: `${L(o)}學習歷程裡，你寫了自己讀書、運動、睡覺的方式，面試時被問到的內容你都答得出來。` },
    B: { tag: '社交型', line: '朋友很多，日子平平。', a18: `${L(o)}學習歷程很豐富：班上活動、社團成發，面試時你最自在。` },
    C: { tag: '遊戲牽掛型', line: '人在教室，心在副本。', a18: `${L(o)}你不太記得最後半年是怎麼讀的，只記得每天上課都想著晚上的活動。` },
    D: { tag: '補習全包型', line: '每一堂課都聽了，但好像什麼都沒留下。', a18: `${L(o)}你每個學期都拿了補習班的講義回家，成績一直不錯，但面試時被問到「為什麼這樣做」，你有些答不上來。` },
    F: { tag: '什麼都沾一點型', line: '每個社團都去過，履歷很長。', a18: `${L(o)}你的學習歷程五花八門：營隊、社團、志工，面試時你每個都有故事可以講。` },
    G: { tag: '大器晚成型', line: '高中很平凡，大學才開竅。', a18: `${L(o)}你的高一過得迷迷糊糊，高三才開始真正讀進去，進步幅度讓老師很驚訝。` },
  };
  const t = T[k];
  if (voc) t.a18 = t.a18.replaceAll('學習歷程', '備審資料'); // 技高：備審資料
  // 直接就業：沒有甄選面試，換成到職時的樣子
  if (o.type === '直接就業') t.a18 = L(o) + { A: '你準時、做事有條理，主管第一週就把鑰匙交給你。', B: '你很快和前輩打成一片，午餐時間總有人找你一起吃。', C: '上班第一個月，你下班後還是會先開遊戲，週一早上常常很睏。', D: '你習慣照著步驟做，但遇到沒教過的狀況時，會先站在原地等人。', F: '高中做過的東西很雜，主管說你什麼都碰過一點，先讓你到處支援。', G: '一開始你手腳比別人慢，但半年後，師傅說你是最穩的那一個。' }[k];
  return t;
}

export function buildEnding(st, data) {
  const id = st.identity, S = st.stats;
  const tlOf = (t) => data.timeline[Math.min(t, data.timeline.length - 1)];
  const friend = st.peers.known[0]?.name || '好友';
  const header = { name: id.name, line: `${id.county}${id.district}｜${id.schoolType}｜${id.family.jobDesc}` };
  const hs = st.hist;
  const curves = {
    focus: sparkline([{ v: hs.map((h) => h.專注), cls: 'a' }], { label: '專注' }),
    debt: sparkline([{ v: hs.map((h) => h.睡眠債), cls: 'b' }], { min: 0, max: 10, label: '睡眠債' }),
    mood: sparkline([{ v: hs.map((h) => h.心情), cls: 'c' }, { v: hs.map((h) => h.幸福), cls: 'a' }], { label: '心情與幸福' }),
  };
  const a = habitStats(st);
  const bedTurns = hs.filter((h) => h.h[1]).length;
  const chosen = [];
  const drawn = [];
  if (hs.length) {
    chosen.push(`手機習慣平均「${HAB_PHONE[Math.round(a.phone)]}」，其中 ${bedTurns} 個回合手機帶進房間過夜（其餘放客廳充電）`);
    chosen.push(`補習平均 ${a.cram.toFixed(1)} 科、運動平均 ${a.sport.toFixed(1)} 級、遊戲平均 ${a.game.toFixed(1)} 級`);
    chosen.push(`寫作業的方式最後是「${st.habits.作業}」，上課投入是「${st.habits.課堂}」`);
  }
  const changed = id.commute !== id.commuteOrig;
  if (changed) chosen.push(`把通勤方式從「${id.commuteOrig}」改成「${id.commute}」`);
  for (const c of st.choices.filter((c) => c.id !== 'orientation').slice(-5)) chosen.push(`「${c.title}」：${c.label}`);
  drawn.push(`出生在${id.county}${id.district}，念${id.schoolType}（座號 ${id.seat} 號）`);
  drawn.push(`家裡：${id.family.job}，${id.family.econ}，${id.family.support}${id.family.structure && id.family.structure !== '雙親' ? `（${id.family.structure}家庭）` : ''}`);
  if (!changed) drawn.push(`每天通勤的方式：${id.commuteOrig}`);
  const seen = [...new Set(st.choices.map((c) => c.title))].slice(0, 5);
  if (seen.length) drawn.push(`遇到的事：${seen.map((t) => '「' + t + '」').join('、')}`);
  const scams = st.scams || [];
  if (scams.length) {
    const tot = scams.reduce((a, x) => a + x.loss, 0);
    drawn.push(`這三年你遇過 ${scams.length} 次網路詐騙${tot ? `，損失 NT$${tot.toLocaleString('en-US')}` : '，沒有實際損失'}。`);
  }
  for (const l of st.luck) drawn.push(`${formatDate(tlOf(l.turn).start)} ${l.text}`);

  // 如果重來：專注掉最多的那個回合
  let tp = null;
  for (let i = 1; i < hs.length; i++) {
    const d = hs[i - 1].專注 - hs[i].專注;
    if (!tp || d > tp.drop) tp = { i, drop: d };
  }
  let whatIf = '';
  if (tp && tp.drop > 0.5) {
    const h = hs[tp.i], p = hs[tp.i - 1];
    const tl = tlOf(h.t);
    const bits = [`手機「${HAB_PHONE[h.h[0]]}」`];
    if (h.h[1]) bits.push('睡前還在滑手機');
    if (h.h[2]) bits.push(`補習 ${h.h[2]} 科`);
    if (h.h[4]) bits.push(`遊戲 ${h.h[4]} 級`);
    let tip = '也許可以試試先從睡眠開始調整。';
    if (h.h[1] || h.睡眠債 >= 4) tip = '也許可以試試睡前把手機放到客廳充電。';
    else if (h.h[4] >= 2) tip = '也許可以試試把遊戲少一級，看專注會不會回來。';
    else if (h.h[2] >= 2) tip = '也許可以試試少補一科，把時間留給自己寫題。';
    whatIf = `${turnLabel(tl)}（${formatDate(tl.start)}），你的專注從 ${p.專注.toFixed(0)} 掉到 ${h.專注.toFixed(0)}，是三年來掉最多的一次。那段時間你的狀態是：${bits.join('、')}。也許跟這有關。${tip}`;
  } else whatIf = '你的專注三年來沒有明顯的斷崖，也許是因為你每一步都走得很平穩。';

  // 你的選擇，後來……：早先的選擇在後面帶來的結果（最多 6 項）
  const pays = st.payoffs || [];
  const payoffs = pays.slice(0, 6).map((p) => `${p.setup} → ${p.title}`);
  // 後果最糟的一次，優先拿來當「如果重來」
  const worst = pays.filter((p) => p.tone === 'bad' && p.setupTurn != null).sort((x, y) => x.val - y.val)[0];
  if (worst) {
    const stl = tlOf(worst.setupTurn);
    whatIf = `${turnLabel(stl)}（${formatDate(stl.start)}），${worst.setup}${worst.setupLabel ? `——你選了「${worst.setupLabel}」` : ''}。後來「${worst.title}」找上門${worst.label ? `，你選了「${worst.label}」` : ''}。如果重來，也許可以在那個當下試試另一條路。`;
  }

  if (st.dead) {
    const tl = tlOf(st.deathTurn ?? st.turn);
    const ev = data.life.byId.traffic_death_teen;
    return {
      archetype: 'J', tag: '休止符', line: '短暫而璀璨的人生', header, dead: true,
      sections: [{ age: '這一年', text: DEATH_LINE }],
      left: `你留下的：${friend}手機裡你們兩個人的合照、還沒寫完的筆記，和一張還沒交的社團報名表。`,
      peerLine: `同屆的人後來：${friend}讀完了高中，繼續往前走。`,
      chosenDrawn: {
        chosen: changed ? [`把通勤方式從「${id.commuteOrig}」改成「${id.commute}」`] : [],
        drawn: [`出生在${id.county}${id.district}`, ...(!changed ? [`每天通勤的方式：${id.commuteOrig}`] : []), `${formatDate(tl.start)} 那一天`],
      },
      autoLine: st.autoTurns > 0 ? `其中有 ${st.autoTurns} 回合是他自己過的，不是你選的。` : '', truth: `在台灣：${ev.display}`, semesters: st.semesters || [], conduct: [], curves, whatIf: '', payoffs: [], good: '', regret: '', turning: null, outcome: null,
    };
  }
  const o = st.outcome || computeOutcome(st, data);
  const k = pickArchetype(st, a);
  const txt = archetypeText(k, { o, voc: id.kind === '技高' });
  const ed = composeEnding(st, data, o, k);
  return {
    archetype: k, tag: txt.tag, line: txt.line, header, dead: false, outcome: o,
    sections: [
      { age: '18 歲', text: txt.a18 + (st.flags.記_店長推薦 ? '便當店的店長說，畢業後隨時歡迎你回去上班。' : '') }, { age: '22 歲', text: ed.a22 },
      { age: '25 歲', text: ed.a25 }, { age: '30 歲', text: ed.a30 },
    ],
    semesters: st.semesters || [], conduct: buildConduct(st, data),
    good: ed.good, regret: ed.regret, curves, chosenDrawn: { chosen, drawn }, whatIf, payoffs,
    autoLine: st.autoTurns > 0 ? `其中有 ${st.autoTurns} 回合是他自己過的，不是你選的。` : '',
    reveal: `你的心情平均 ${mean(hs.map((h) => h.心情)).toFixed(0)}，真實幸福平均 ${mean(hs.map((h) => h.幸福)).toFixed(0)}。短期開心和長期過得好，不一定是同一條線。`,
    footnote: '以上是模型推估的可能性，不是預言；睡眠、手機與專注的關係來自研究共識，但數字是設計假設。' + ((st.scams || []).length ? '被騙時先保留證據、撥 165 反詐騙專線。' : ''),
  };
}

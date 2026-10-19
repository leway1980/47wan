// 學期報告與終局報告。純函式，只回傳資料或 SVG 字串。
import { rngAt } from './rng.js';
import { lifeProbTable, COMMUTE_DAYS_PER_TURN, DEATH_LINE } from './life.js';
import { peerCounts } from './peers.js';
import { focusPhrase } from './state.js';

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
export function computeOutcome(st) {
  // 升學結果 = 學測／申請表現（換算成段考的分數尺度）六成 + 三年段考平均四成
  // 段考常常不及格的人，幾乎不可能上國立大學
  const test = 25 + 0.75 * (st.final ?? st.gsat ?? st.stats.理解);
  const ex = st.examScores && st.examScores.length ? st.examScores.reduce((a, b) => a + b, 0) / st.examScores.length : test;
  const s = 0.6 * test + 0.4 * ex;
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
  const days = COMMUTE_DAYS_PER_TURN * 10;
  const commuteLine = commuteSentence(st, data, days);
  return {
    title: `${GRADE[tl.year - 1]}${tl.seg}`,
    phrases, schoolLine, peerLines, commuteLine,
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

function outcomeLine(o) {
  return o.retake ? o.text : `學測加申請，${o.text}`;
}

function archetypeText(k, v) {
  const { name, friend, school, o, dept, county } = v;
  const univ = o.retake ? '重考後的學校' : `${o.type}${dept}`;
  const T = {
    A: {
      tag: '穩定自律型', line: '沒有很亮眼，但每一步都踩得到。',
      a18: `${outcomeLine(o)}學習歷程裡，你寫了自己讀書、運動、睡覺的方式，面試時被問到的內容你都答得出來。`,
      a22: `大學畢業那天，${friend}從別的城市傳訊息給你。你習慣十二點前睡，課業很穩，但不算頂尖。你決定繼續進修。`,
      a25: `身體：每週運動兩次，坐太久會腰痠。工作：上手很快，同事說你「先自己做一次再問人」。錢：每月固定存一筆。人際：同事很多，真正會約吃飯的是兩個，高中那個${friend}還在。`,
      a30: '你升成小組長。壓力最大的那年，你發現自己睡前又開始滑手機，就像很多年前的高二。你把充電器移到客廳。生活不算精彩，但你很少在早上覺得「不想醒來」。',
      good: `高中三年，你的作息一直很穩，這成了你之後最大的本錢。`, regret: '你偶爾會想，如果當年多去幾個營隊，也許會更早知道自己喜歡什麼。',
    },
    B: {
      tag: '社交型', line: '朋友很多，日子平平。',
      a18: `${outcomeLine(o)}學習歷程很豐富：班上活動、社團成發，面試時你最自在。`,
      a22: `畢業那天你拍了 300 張照片，限動被按了 200 多個愛心。晚上回到租屋處，你卻想不起上一次和人好好聊到半夜是什麼時候。`,
      a25: `身體：常熬夜，手搖飲一天一杯。學習力：遇到要自己讀的東西會拖，習慣先問人。工作：做業務，很會開發客戶，但不太會整理資料。錢：聚餐旅行花很多，月底常常歸零。人際：手機裡有上千個聯絡人，真正心情不好時會打的，有一個高中同學${friend}。`,
      a30: '你成了業務小主管，帶三個新人，你很會帶氣氛。公司導入新系統那年，你花了比別人久的時間才學會。生活很熱鬧，自評「普通」：沒有大失敗，也說不上滿意。',
      good: `你的婚禮來了很多高中和大學同學，大家說「好像回到${school}的社團成發」。`, regret: '你常常覺得，那些熱鬧裡，能說真心話的人其實不多。',
    },
    C: {
      tag: '遊戲牽掛型', line: '人在教室，心在副本。',
      a18: `${outcomeLine(o)}你不太記得最後半年是怎麼讀的，只記得每天上課都想著晚上的活動。`,
      a22: `大學四年你換了兩次遊戲，也換了一次系。你交到的朋友，很多是線上認識的，你們到現在還會約打球。`,
      a25: `身體：視力退到近視 600 度，肩頸很硬。學習力：能專心的時候很強，但很難專心的時候也很明顯。工作：第一份工作做了一年就離職，第二份在遊戲相關公司，這次你把「想玩」變成了工作。錢：薪水不錯，但抽卡花了不少。人際：同事都是玩家，聊得來。`,
      a30: '你在遊戲公司做企劃，終於知道每日登入、限時活動是怎麼設計出來的。你開始懂得「玩」和「被牽著走」的差別，也開始把時間分給運動和家人。',
      good: `你在遊戲裡學會了團隊合作，也交到了一輩子的朋友。`, regret: '你想過，如果高中那幾年少一點「再一場就好」，也許能多讀完一個學期的書。',
    },
    D: {
      tag: '補習全包型', line: '每一堂課都聽了，但好像什麼都沒留下。',
      a18: `${outcomeLine(o)}你每個學期都拿了補習班的講義回家，成績一直不錯，但面試時被問到「為什麼這樣做」，你有些答不上來。`,
      a22: `大學畢業時你才發現，沒有補習班排好的進度，你不太知道怎麼開始。大三開始，你學著自己列出讀書清單，慢慢才上軌道。`,
      a25: `身體：睡眠一直不太夠，胃不太好。學習力：你學會了把「聽懂」和「自己會」分開，每次學新東西都先做練習。工作：穩定的辦公室工作。錢：存了一點。人際：高中補習班的朋友至今偶爾聊天。`,
      a30: '你自己帶新人，最常說的一句話是「先自己做一次，不懂再問」。你終於把當年補習班沒教你的那一課補回來了。',
      good: '你高中三年幾乎沒有一天缺課，這份紀律後來很有用。', regret: '你偶爾想起高中的社團博覽會，你那時急著趕補習班，沒有走進任何一個攤位。',
    },
    F: {
      tag: '什麼都沾一點型', line: '每個社團都去過，履歷很長。',
      a18: `${outcomeLine(o)}你的學習歷程五花八門：營隊、社團、志工，面試時你每個都有故事可以講。`,
      a22: `大學你換了兩次系，最後選了${dept}。你的朋友圈很雜，你很會在不同圈子之間當橋樑。`,
      a25: `身體：沒有特別大的問題，運動時有時無。學習力：學東西很快，但常常學一半就換下一個。工作：在一間小公司做專案，什麼都要會一點。錢：普通。人際：朋友很多，有幾個很談得來。`,
      a30: '你成了公司裡「什麼都會一點」的人，被叫去救火的次數很多。你開始想：要不要選一件事，做深一點？',
      good: `你總是第一個舉手去試，這讓你認識了很多${county}以外的人。`, regret: '你常常覺得，自己如果在某件事上堅持久一點，也許會做得更好。',
    },
    G: {
      tag: '大器晚成型', line: '高中很平凡，大學才開竅。',
      a18: `${outcomeLine(o)}你的高一過得迷迷糊糊，高三才開始真正讀進去，進步幅度讓老師很驚訝。`,
      a22: `大學畢業時，你的成績比同學們預期的好很多。你說，你只是終於找到自己讀書的方法。`,
      a25: `身體：作息比高中穩定多了。學習力：你相信自己「可以慢慢變好」。工作：進了一間你喜歡的公司，雖然起薪普通，但學得很快。錢：開始存。人際：高中那個一起混過的朋友${friend}，仍然是你最想分享好消息的人。`,
      a30: '你回頭看，覺得高中那些走了遠路的日子，後來全變成了養分。',
      good: '你比同齡人更相信「努力會有回報」，因為你親眼看過自己變好。', regret: '你偶爾想，如果高一就開竅，也許還能多出幾條路。',
    },
  };
  const t = T[k];
  t.univ = univ;
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
  drawn.push(`家裡：${id.family.job}，${id.family.econ}，${id.family.support}`);
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
    whatIf = `${turnLabel(tl)}（${formatDate(tl.start)}），你的專注從 ${p.專注.toFixed(0)} 掉到 ${h.專注.toFixed(0)}，是三年來掉最多的一次。那時你的狀態是：${bits.join('、')}${h.c ? `，剛好遇到「${h.c}」` : ''}。也許跟這有關。${tip}`;
  } else whatIf = '你的專注三年來沒有明顯的斷崖，也許是因為你每一步都走得很平穩。';

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
      truth: `在台灣：${ev.display}`, curves, whatIf: '', good: '', regret: '', turning: null, outcome: null,
    };
  }
  const o = st.outcome || computeOutcome(st, data);
  const k = pickArchetype(st, a);
  const spends = st.choices.filter((c) => c.spend).length;
  const nMode = (m) => hs.filter((h) => h.h[5] === m).length;
  const moneyLine = nMode(2) >= 36 && (S.投資 ?? 0) > 0 ? '高中開始的定期定額，到 30 歲變成一筆不小的存款。'
    : spends >= 2 || nMode(0) >= 50 ? '你的錢包常常月底歸零，但朋友很多，回憶也很多。'
      : nMode(1) >= 36 || (S.錢包 >= 3000 && spends === 0) ? '你存下了人生的第一筆錢，那是高中時一點一滴留下來的。' : '';
  const txt = archetypeText(k, { name: id.name, friend, school: id.school, o, dept: o.dept, county: id.county });
  return {
    archetype: k, tag: txt.tag, line: txt.line, header, dead: false, outcome: o,
    sections: [
      { age: '18 歲', text: txt.a18 }, { age: '22 歲', text: txt.a22 },
      { age: '25 歲', text: txt.a25 + moneyLine }, { age: '30 歲', text: txt.a30 },
    ],
    good: txt.good, regret: txt.regret, curves, chosenDrawn: { chosen, drawn }, whatIf,
    reveal: `你的心情平均 ${mean(hs.map((h) => h.心情)).toFixed(0)}，真實幸福平均 ${mean(hs.map((h) => h.幸福)).toFixed(0)}。短期開心和長期過得好，不一定是同一條線。`,
    footnote: '以上是模型推估的可能性，不是預言；睡眠、手機與專注的關係來自研究共識，但數字是設計假設。' + ((st.scams || []).length ? '被騙時先保留證據、撥 165 反詐騙專線。' : ''),
  };
}

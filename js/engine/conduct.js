// 態度與人際：師長印象／同儕信任的門檻、出缺勤計數、學期紀錄、結局的「態度與人際」句子。純函式，無 DOM。
import { SHOCKS, parentLabel } from './family.js';

export const ATT_KEYS = ['遲到', '缺掃', '缺交', '補交', '嘉獎', '警告'];
export const newAtt = () => Object.fromEntries(ATT_KEYS.map((k) => [k, 0]));
const GRADE = ['高一', '高二', '高三'];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 舊存檔沒有這些欄位：用到時才補
export function ensureConduct(st) {
  st.stats.師長印象 ??= 50; st.stats.同儕信任 ??= 50;
  st.att ??= newAtt();
  st.semesters ??= [];
  st.missed ??= { teacher: 0, peer: 0 };
  st.acts ??= [];
  st.semBase ??= { turn: -1, att: newAtt(), exam: 0, fam: 0 };
  return st;
}

/* ───────────── 資源／邀約的門檻 ───────────── */
// 卡片的 modifiers 與延遲事件的 gate 用同一組門檻：低於 35 打折、70 以上加成
export const GATES = {
  teacher: { stat: '師長印象', lo: 0.4, hi: 1.5 },
  peer: { stat: '同儕信任', lo: 0.5, hi: 1.3 },
};
export function gateFactor(kind, st) {
  const g = GATES[kind], v = st.stats[g.stat] ?? 50;
  return v < 35 ? g.lo : v >= 70 ? g.hi : 1;
}
export const STAT_MOD = /師長印象|同儕信任/;
export const modKind = (m) => (/師長印象/.test(m.if) ? 'teacher' : /同儕信任/.test(m.if) ? 'peer' : null);

/* ───────────── 活動：學期紀錄的「活動與競賽」 ───────────── */
// 既有的卡用「卡片 id + 選項文字」認出玩家真的參加了；新卡直接在選項寫 act
const ACTS = {
  teacher_camp: [[/^報名參加/, '大學科學營']],
  camp_subsidy: [[/報名/, '大學科學營（補助名額）']],
  campus_science_fair: [[/組隊|幫忙/, '校內科展']],
  voc_contest: [[/集訓|替補/, '技藝競賽']],
  voc_license: [[/報名|組讀書會/, '報名證照考試']],
  voc_coop: [[/報名建教/, '建教合作']],
  campus_cadre: [[/^接/, '班級幹部']],
  campus_chorus: [[/./, '班際合唱比賽']],
  campus_sports_day: [[/最後一棒|啦啦隊/, '校慶運動會']],
  campus_exchange: [[/報名|申請/, '海外交流']],
  campus_graduation_trip: [[/參加/, '畢業旅行']],
  part_time_job: [[/^去打工|^只排/, '打工']],
  crush_confess: [[/在一起/, '開始交往']],
};
export function actOf(card, ch) {
  if (ch.act) return ch.act;
  for (const [re, text] of ACTS[card.id] || []) if (re.test(ch.label)) return text;
  return null;
}

/* ───────────── 每學期紀錄 ───────────── */
const CLUBS = { 音樂: '熱音社', 科學: '科學研究社', 運動: '籃球隊' };
export function clubName(st) {
  if (!st.flags.社團中) return '沒有社團';
  for (const [k, v] of Object.entries(CLUBS)) if (st.flags['社團:' + k]) return v;
  return '社團';
}

function highlightOf(st, win, d) {
  const luck = st.luck.filter(win)[0];
  if (luck) return luck.text;
  const pay = (st.payoffs || []).filter(win)[0];
  if (pay) return `${pay.setup} → ${pay.title}`;
  const sh = (st.famHistory || []).slice(st.semBase.fam)[0];
  if (sh && SHOCKS[sh]) return '家裡：' + SHOCKS[sh].label.replace(/\{p\}/g, parentLabel(st));
  if (d.警告) return '收到一次警告，被要求寫反省';
  if (d.嘉獎) return `獲得 ${d.嘉獎} 次嘉獎`;
  const act = st.acts.filter(win)[0];
  if (act) return act.text;
  return '沒有特別的大事，平穩地過完一學期';
}

/** 學期結束時呼叫：把這學期的出缺勤、成績、社團、活動、最重要的事記下來（回傳該筆紀錄）。 */
export function recordSemester(st, tl) {
  ensureConduct(st);
  const b = st.semBase, win = (x) => x.turn > b.turn && x.turn <= tl.turn;
  if (st.flags.幹部) st.att.嘉獎 += 2; // 班級幹部每學期多半記嘉獎兩支
  const d = {};
  for (const k of ATT_KEYS) d[k] = st.att[k] - (b.att[k] || 0);
  const exams = st.examScores.slice(b.exam);
  const acts = [...new Set(st.acts.filter(win).map((a) => a.text))].slice(0, 3);
  const sem = { title: GRADE[tl.year - 1] + tl.seg, exam: exams.length ? Math.round(mean(exams)) : null, ...d, club: clubName(st), activities: acts, highlight: highlightOf(st, win, d) };
  st.semesters.push(sem);
  st.semBase = { turn: tl.turn, att: { ...st.att }, exam: st.examScores.length, fam: (st.famHistory || []).length };
  return sem;
}

/* ───────────── 結局：態度與人際 ───────────── */
const OFFER_NAMES = { mn_offer_camp: '營隊名額', mn_offer_fair: '科展指導', mn_offer_contest: '競賽代表', mn_offer_letter: '推薦函', mn_offer_tutor: '課輔名額' };
const countChoice = (st, id, re) => st.choices.filter((c) => c.id === id && re.test(c.label)).length;

/** 2–4 句，依師長印象、同儕信任、出缺勤與「被少掉的機會」寫成的事實描述（不說教）。 */
export function buildConduct(st, data) {
  ensureConduct(st);
  const T = st.stats.師長印象, P = st.stats.同儕信任, a = st.att;
  const ignoreN = countChoice(st, 'mn_hallway', /裝作沒看到|繞路/);
  const greetN = countChoice(st, 'mn_hallway', /問好/);
  const skipGroup = countChoice(st, 'mn_group_report', /已讀不回/);
  const lateWork = a.遲到 + a.缺掃 + a.缺交;
  const mt = Math.round(st.missed.teacher), mp = Math.round(st.missed.peer);
  const tlOf = (t) => data.timeline[Math.min(t, data.timeline.length - 1)];
  const offer = st.choices.find((c) => OFFER_NAMES[c.id]);
  const out = [];
  if (T < 40) {
    const why = ignoreN >= 2 ? '你常裝作沒看到老師' : lateWork >= 4 ? `遲到、缺掃、缺交加起來有 ${lateWork} 次` : '你和老師之間沒有太多往來';
    out.push(`${why}。後來老師要推薦營隊、競賽時，比較少想到你${mt >= 1 ? `（三年大約少了 ${mt} 次機會）` : ''}。`);
  } else if (T >= 65) {
    const why = greetN >= 2 ? '你遇到老師總會打招呼' : '交代給你的事，你大多有做到';
    const when = offer ? `${GRADE[tlOf(offer.turn).year - 1]}那年，老師主動推薦你${OFFER_NAMES[offer.id]}` : '有什麼機會，老師常會先想到你';
    out.push(`${why}。${when}。`);
  } else out.push('你和老師的關係不遠不近，該打招呼的時候多半有打招呼。');
  if (P < 40) {
    const why = skipGroup >= 1 ? `分組報告你有 ${skipGroup} 次沒交` : '班上的事你多半沒有參與';
    out.push(`${why}。之後的聚會，大家常常忘了找你${mp >= 1 ? `（三年大約少了 ${mp} 次邀約）` : ''}。`);
  } else if (P >= 65) {
    out.push(`同學交代的事你多半準時完成。班上的聚會、慶生，總有人想到你。`);
  } else out.push('你和同學的往來有來有往，邀約有時有，有時沒有。');
  const bits = [];
  if (lateWork) bits.push(`遲到 ${a.遲到} 次、缺掃 ${a.缺掃} 次、缺交 ${a.缺交} 次`);
  if (a.補交) bits.push(`補交 ${a.補交} 次`);
  if (a.嘉獎 || a.警告) bits.push(`嘉獎 ${a.嘉獎} 次、警告 ${a.警告} 次`);
  if (bits.length) out.push(`三年下來的紀錄：${bits.join('；')}。`);
  return out.slice(0, 4);
}

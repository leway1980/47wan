// 線上「同屆的其他人」動態：事件代碼表（遊戲與 worker 共用，純函式、不碰 DOM）。
// 伺服器只收這裡列出的代碼與嚴格格式的欄位，沒有任何自由文字。
export const FEED_PHRASES = {
  crash_hosp: '出車禍住院了',
  crash_light: '騎車上學出了小車禍，擦傷了',
  scam: '被網路上認識的人騙了錢',
  breakup: '和對象分手了',
  date: '交往了',
  work: '開始打工',
  exam_up: '段考進步了很多',
  exam_down: '段考退步了不少',
  camp: '去參加了營隊',
  club: '加入了社團',
  pet: '家裡養了寵物',
  phone_rule: '把手機交給家長保管',
  cram: '開始補習了',
  ig: '開了 IG 帳號',
  sport: '開始固定運動',
};
export const FEED_CODES = Object.keys(FEED_PHRASES); // 同時也是顯示優先順序
export const FEED_MAX_CODES = 2;

export const COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
export const normCounty = (c) => (typeof c === 'string' ? c.replace(/^台/, '臺') : c);
/** 去掉「（私立）」等括號，只留校名 */
export const maskSchool = (s) => String(s || '').replace(/（[^）]*）/g, '');
export const OUTCOMES = ['國立大學', '私立大學', '科技大學', '重考一年', 'J']; // J = 沒走到畢業（死亡）

/** 一個學期（回合 fromTurn 起、toTurn 前）發生的事 → 最多 2 個代碼。st.choices 的 fl 是該選項設下的旗標。 */
export function semesterCodes(st, fromTurn, toTurn) {
  const got = new Set();
  const inR = (t) => t >= fromTurn && t < toTurn;
  const flags = new Set();
  for (const c of st.choices || []) if (inR(c.turn)) for (const f of c.fl || []) flags.add(f);
  if ((st.scams || []).some((x) => inR(x.turn))) got.add('scam');
  for (const l of st.luck || []) {
    if (!inR(l.turn)) continue;
    if (/住院|重傷/.test(l.text)) got.add('crash_hosp');
    else if (/輕傷/.test(l.text)) got.add('crash_light');
  }
  if (flags.has('分手過')) got.add('breakup');
  if (flags.has('交往中')) got.add('date');
  if (flags.has('打工中')) got.add('work');
  if (flags.has('去過營隊')) got.add('camp');
  if (flags.has('社團中')) got.add('club');
  if (flags.has('寵物')) got.add('pet');
  if (flags.has('手機保管')) got.add('phone_rule');
  if (flags.has('IG')) got.add('ig');
  const hist = st.hist || [];
  const at = (t) => hist.find((h) => h.t === t);
  const a = at(fromTurn - 1), b = at(toTurn - 1);
  if (b) {
    if (a) {
      const d = b.理解 - a.理解;
      if (d >= 3) got.add('exam_up'); else if (d <= -3) got.add('exam_down');
      if (b.h[2] > 0 && a.h[2] === 0) got.add('cram');
      if (b.h[3] > 0 && a.h[3] === 0) got.add('sport');
    }
  }
  return FEED_CODES.filter((c) => got.has(c)).slice(0, FEED_MAX_CODES);
}

/** 伺服器回傳的一筆動態 → 一行文字（只用白名單代碼對應的片語；欄位已由伺服器驗證） */
export function feedLine(f) {
  const ph = (f.ev || []).map((c) => FEED_PHRASES[c]).filter(Boolean).join('，還有');
  return ph ? `📍 ${f.c}・${f.s}｜${f.nm} ${ph}` : null;
}

// 回合引擎：習慣 → 固定劇情 → 延遲佇列 → 人生事件 → 抽卡 → 選擇 → 同儕 → 紀錄。純函式、無 DOM。
import { SUBJECTS } from './identity.js';
import { mulberry32, stateRng, rngAt, gauss, pickWeighted, clamp } from './rng.js';
import { tutorMaxLevel, tutorIsFree, famStep } from './family.js';
import { buildCtx, drawCard, drawDatingCard, ensurePartner, fill, describeCard, applyChoice, applyEffects, cardById, evalCond, compile, passes } from './events.js';
import { checkLife, DEATH_LINE } from './life.js';
import { setSlotData } from './slots.js';
import { stepPeers } from './peers.js';
import { computeOutcome, semesterReport, formatDate, formatDateLong } from './report.js';

export const TOTAL_TURNS = 70; // 3 學年 × 24 回合，扣掉畢業後沒有的最後一個暑假（2 回合）
export const DATE_CARD_P = 0.65; // 交往中每回合額外嘗試抽一張交往卡的機率
const DAY = 86400000;
export { formatDate, formatDateLong };

/* ───────────── 日曆 ───────────── */
export function buildTimeline(cal) {
  const y0 = parseInt(cal.startDate.slice(0, 4), 10);
  const segs = [];
  for (let k = 0; k < cal.years; k++) {
    for (const s of cal.segments) {
      if (k === cal.years - 1 && s.name === '暑假') continue; // 畢業之後沒有暑假：最後一個學期結束就是結局
      const [mm, dd] = s.start.split('-').map(Number);
      const yr = mm >= 8 ? y0 + k : y0 + k + 1;
      segs.push({ ...s, year: k + 1, t0: Date.UTC(yr, mm - 1, dd) });
    }
  }
  segs[0].t0 = Date.parse(cal.startDate + 'T00:00:00Z');
  const lastEnd = Date.UTC(y0 + cal.years, 6, 1);
  const tls = [];
  segs.forEach((s, si) => {
    const next = si + 1 < segs.length ? segs[si + 1].t0 : lastEnd;
    const span = (next - s.t0) / DAY;
    for (let i = 0; i < s.turns; i++) {
      const a = s.t0 + Math.floor((i * span) / s.turns) * DAY;
      const b = i + 1 < s.turns ? s.t0 + Math.floor(((i + 1) * span) / s.turns) * DAY : next;
      tls.push({ turn: tls.length, year: s.year, seg: s.name, idx: i, vacation: s.vacation, start: a, end: b, days: Math.round((b - a) / DAY) });
    }
  });
  for (const tl of tls) {
    tl.fixed = cal.fixed.filter((f) => (f.year === undefined || f.year === tl.year) && f.seg === tl.seg && f.idx === tl.idx);
    tl.exam = tl.fixed.some((f) => f.kind === 'exam');
  }
  for (let i = 0; i < tls.length; i++) {
    const nx = tls[i + 1];
    tls[i].examWeek = tls[i].exam || !!(nx && nx.seg === tls[i].seg && nx.year === tls[i].year && nx.exam);
  }
  return tls;
}

export function prepareData(raw) {
  const cardIndex = {};
  for (const c of raw.events.cards) {
    if (cardIndex[c.id]) throw new Error('重複的事件卡 id: ' + c.id);
    cardIndex[c.id] = c;
  }
  setSlotData(raw.slots); // 變數槽的池（沒有就視為空，槽會被去掉而不是露出原始標記）
  const life = { events: raw.life_events.events, byId: Object.fromEntries(raw.life_events.events.map((e) => [e.id, e])) };
  return { identities: raw.identities, events: raw.events, calendar: raw.calendar, slots: raw.slots, life, cardIndex, timeline: buildTimeline(raw.calendar) };
}

/* ───────────── 習慣自動結算 ───────────── */
const CLASS_F = { 跟著上: 1, 挑重點聽: 0.75, 做自己的事: 0.35, 放空: 0.25, 補眠: 0.1 };
const ATMOS_D = { 跟著上: 0.008, 挑重點聽: 0, 做自己的事: -0.008, 放空: -0.004, 補眠: -0.012 };
const HW_F = { 紙本: 1, 上網查: 0.75, 開群組邊寫邊聊: 0.6 };
const PHONE_LINK = [-1.5, 0, 1.5, 3, 3];
const PHONE_MOOD = [-4, 0, 4, 4, 4];
const PHONE_FOCUS = [0, 0, 2, 5, 9];
const PHONE_HAPPY = [-0.5, 0.3, 0.3, -0.2, -0.6];
const COVER = { 自己就是資源: 0.4, 花錢買資源: 0.7, 自己找資源: 0 };

const IG_LOOK_LINES = ['你的自拍被很多人按愛心。', '有人在你的貼文留言「今天好好看」，你笑了一下。', '隔壁班有人私訊說想認識你。'];
const NET_LINES = [
  ['{網友}傳來一句「早安，今天也要加油喔」。', '{網友}問你今天{科目}考得怎麼樣，還記得你昨天說的事。', '你和{網友}在遊戲裡組隊打了兩場，他一直幫你補血。', '{網友}說他也是高中生，也很討厭{科目}。'],
  ['{網友}每天晚上都會傳「晚安」，你開始會等他的訊息。', '你跟家人吵架，第一個想到的是傳訊息給{網友}。', '{網友}說：「你是我在這裡最好的朋友。」', '{網友}記得你的生日，傳了一張自己畫的卡片。', '{網友}傳了一張{手搖飲}的照片：「下次請你喝」。'],
  ['{網友}說最近家裡有點狀況，心情很差。', '{網友}傳來一段很長的訊息，說只有你懂他。', '{網友}說想跟你一起做一件「很酷的事」，之後再告訴你。', '{網友}說他找到一個賺點數的好方法，下次教你。'],
];
const IG_LINES = ['你的限動被 23 個人看過，有 2 個人回覆。', '有人在限動 tag 你，你想了一下要怎麼回。', '同學私訊你：「在嗎？」你回完已經過了半小時。', '你滑了別人的出遊限動十分鐘。', '{群組}裡有人問你怎麼都沒回限動。', '有人按了你半年前的貼文愛心，你有點在意。', '你看到同學一起去吃飯的限動，你不在裡面。', '新追蹤你的人說是隔壁班的，你回追了。', '{旁人}的限動全是{手搖飲}，你按了愛心。', '你在{下課時間}回完三則 IG 訊息。', '你發了一張{零食}的限動，有 5 個人回「想吃」。', '{同學}在限動 tag 你，你們在{地點}的合照糊成一團。', '你滑到一則{科目}梗圖，轉傳給{同學}。', '{旁人}發限動抱怨今天的{科目}課，你按了愛心。', '你在{地點}拍了一張{手搖飲}的照片，修了三次才發。', '{旁人}按了你的限動，你不確定是不是故意的。', '你發的限動被{同學}截圖，傳到了{群組}。', '你追蹤的帳號今天貼了一堆{零食}開箱。', '{同學}的限動是{地點}的夕陽，你也想去。', '你打了一段回覆又刪掉，最後只按了愛心。', '有人私訊問你{科目}的{作業類}，你回了一個貼圖。', '你點進一個陌生帳號的限動，發現是學長姐。', '你的限動停在 18 個人看過，重新整理了好幾次。'];
const GAME_LINES = ['每日任務還沒解完，你先上線點一下。', '限時活動只剩三天，你又打開了遊戲。', '公會群組在討論週末的{遊戲事}時間，你被 tag 了。', '登入送十抽，你捨不得不領。', '體力條滿了，你找理由再上去一下。', '朋友說副本差一個人，你的手已經在滑。', '公會長在群組發了新的打寶表，問大家誰有空。', '同學在玩新出的音樂節奏手遊，你也下載來試了一下。', '午休時大家在玩同一款手遊的對戰，你被拉進來湊人數。', '遊戲更新要下載 3GB，你在學校用熱點偷偷載。', '你在遊戲裡抽到一隻稀有角色，截圖傳到班群。', '寒流來的晚上，你窩在被子裡打了三場排位。', '有人在公會群組賣帳號，大家吵了一晚。', '你把遊戲裡的寵物取了跟家裡的貓一樣的名字。', '{旁人}在{地點}聊昨晚的{遊戲事}，你插了兩句。', '{遊戲事}拖到{時段}還沒結束，你說再一場就好。', '你用{下課時間}把今天的日常任務刷完了。', '你在{科目}課偷偷看了一眼{遊戲事}的倒數。', '{旁人}說{遊戲事}的新角色太強，你回家馬上查了攻略。', '你在{地點}用手機打完一場排位，鐘響才發現。', '公會裡有人在{時段}還在線上，你默默看著名單。', '{遊戲事}的獎勵你差一點就拿到，隔天還是氣得睡不著。', '你把買{手搖飲}的錢省下來，拿去抽了一次。', '{科目}課的空檔，你把隊伍配置改了三次。', '你的隊友在{時段}突然斷線，剩你一個人撐完。', '{同學}借你的帳號練了一場，結果段位掉了一階。', '你關掉遊戲，十分鐘後又重新打開。', '你點開{遊戲事}的攻略影片，一看就是半小時。', '新的活動包下載完，手機只剩一格電。']
// 交往中每回合固定出現的相處小事：好處是心情與知心，代價是專注與睡眠（時間與手機）
export const COUPLE_LINES = [
  { t: '放學一起走到公車站，{對象}把耳機分你一邊。', mood: 1.2, know: 0.05, focus: 0.3 },
  { t: '睡前視訊講了一小時，掛掉才發現已經過了十二點。', mood: 1, know: 0.06, focus: 0.8, sleep: 0.25 },
  { t: '{對象}傳了一張你上{科目}課打瞌睡的照片，附上「睡得很香喔」。', mood: 0.8, know: 0.04, focus: 0.5 },
  { t: '午餐在{地點}一起吃，被同學起鬨，你們兩個都低頭扒飯。', mood: 1, know: 0.04, focus: 0.2, link: 0.3 },
  { t: '下課{對象}繞到你的教室門口，只是來說「午休不要睡過頭」。', mood: 1, know: 0.04, focus: 0.4 },
  { t: '你們傳了一整節課的貼圖，老師看了你一眼。', mood: 1, know: 0.03, focus: 1.1, sleep: 0.05 },
  { t: '{對象}幫你留了福利社最後一包{零食}。', mood: 1.2, know: 0.04, focus: 0.1 },
  { t: '晚上說好只聊五分鐘，結果聊了一個小時。', mood: 1, know: 0.06, focus: 0.6, sleep: 0.2 },
  { t: '{對象}在你的聯絡簿角落畫了一隻很醜的貓。', mood: 0.9, know: 0.03, focus: 0.2 },
  { t: '你們約好各自讀書，卻每隔十分鐘就互丟一張自拍。', mood: 0.8, know: 0.04, focus: 1, sleep: 0.05 },
  { t: '一起等公車，錯過了兩班，誰都沒說要先走。', mood: 1.2, know: 0.05, focus: 0.3 },
  { t: '你在筆記本邊角寫下{對象}的名字，又趕快塗掉。', mood: 0.8, know: 0.02, focus: 0.7 },
  { t: '{對象}陪你在{地點}寫{科目}{作業類}，寫沒兩題就開始聊天。', mood: 1, know: 0.05, focus: 0.8 },
  { t: '你們分了一杯{手搖飲}，一人一根吸管。', mood: 1.1, know: 0.04, focus: 0.2 },
  { t: '{對象}說下次{小考種類}比分數，輸的請{手搖飲}。', mood: 0.9, know: 0.04, focus: 0.5 },
  { t: '{對象}說今天的你看起來很累，硬塞了一杯{手搖飲}給你。', mood: 1.2, know: 0.06, focus: 0.1 },
];
// 抽一句不久前沒出現過的：win 回合內用過的不再抽（候選空了就退回全部）。回傳索引並記下這回合用過
export function freshIdx(st, n, key, salt, win) {
  const seen = (st.flavorSeen ||= {});
  const ok = [];
  for (let i = 0; i < n; i++) { const t = seen[key + i]; if (t === undefined || st.turn - t > win) ok.push(i); }
  const from = ok.length ? ok : Array.from({ length: n }, (_, i) => i);
  const i = from[Math.floor(rngAt(st.seed, st.turn, salt) * from.length)];
  seen[key + i] = st.turn;
  return i;
}
const NOMONEY_LINES = ['月底又沒錢了，只能吃泡麵。', '月底的零用錢見底，{手搖飲}只能用看的。', '錢包空了，你和{同學}分著吃一包{零食}。', '零用錢不夠，你把原本想買的{零食}放回架上。'];
export const PHONE_CREEP = 0.03; // 每回合手機用量慢慢變多的機率；自然爬升最多到 3 級，4 級只會因為事件
const CREEP_LINE = '不知不覺，你滑手機的時間又變長了。';
export function applyHabits(st, data, tl, r) {
  // 家規期間手機等級被壓住，但不改玩家自己的設定；期滿後自動恢復
  const H = st.habits;
  const capped = !!(st.rule && st.turn < st.rule.until);
  // 手機悄悄變多：有 IG 或在玩遊戲的人，每回合約 6% 會不知不覺滑得更久（有保管／螢幕時間限制時不會）
  const creep = !capped && (st.flags.IG || H.遊戲 >= 1) && H.手機 < 3 && rngAt(st.seed, st.turn, 'phonecreep') < PHONE_CREEP;
  if (creep) H.手機 += 1;
  const own = H.手機;
  // 手機帶進房間：沒有事件特別決定過，就跟著手機用量走（用很多的人通常會帶進房間）
  if (!st.flags.睡前定了) H.睡前手機 = H.手機 >= 4; // 4 級＝隨時在線＋睡前（設計文件 3.3）
  if (capped) H.手機 = Math.min(own, st.rule.cap);
  try { const lines = applyHabitsInner(st, data, tl, r); return creep ? [CREEP_LINE, ...lines] : lines; } finally { H.手機 = own; }
}
// 打工收入（基本時薪 NT$196）：學期中一週一天(8h)×2週≈16h≈3,100；週六日都去≈6,300；
// 假期一回合約一個月，一般兼職約 14,000，排滿班（打工加班）約 25,000。
export function workPay(st, vac) {
  if (!st.flags.打工中) return 0;
  const ot = !!st.flags.打工加班;
  return vac ? (ot ? 25000 : 14000) : (ot ? 6300 : 3100);
}
const workLoad = (st, vac) => (st.flags.打工中 ? (vac ? (st.flags.打工加班 ? 26 : 14) : (st.flags.打工加班 ? 14 : 7)) : 0);
function applyHabitsInner(st, data, tl, r) {
  const S = st.stats, H = st.habits, id = st.identity, idn = data.identities, fam = id.family;
  const vac = tl.vacation, len = vac ? 2 : 1;
  const lines = [];
  const lctx = buildCtx(st, tl); // 紀錄句的變數槽用
  /* 錢 */
  const econ = idn.econStart[fam.econ];
  const allowance = id.allowanceMonth ?? econ.allowance * 2; // 舊存檔沒有這個欄位
  const income = (allowance / 2) * len * (vac ? 0.8 : 1) + workPay(st, vac);
  const other = [0, 0, 80, 200][H.遊戲] * len + [0, 0, 0, 40, 80][H.手機] * len + (st.flags.打扮 ? 400 : st.flags.偶爾打扮 ? 120 : 0) * len; // 打扮：保養品、造型品、剪髮
  const avail = S.錢包 + income;
  // 補習由家裡出錢（不從零用錢扣），科數受家境上限限制；上限 0 時只剩免費的學校課輔
  let cram = Math.min(H.補習, tutorMaxLevel(st));
  if (cram < H.補習) { H.補習 = cram; lines.push('家裡最近手頭緊，補習先停一科。'); }
  // 零用錢怎麼用：花掉（吃喝玩樂）／存下／投資（定期定額，類似大盤 ETF 的簡化模型）
  const mode = H.零用錢 || '花掉';
  let w = Math.max(0, avail - other);
  // 零用錢大多會花在飲料、零食、交通、出去玩；只有決定存起來的人，才會留下一半左右
  const fare = vac ? 0 : ({ 公車: 400, 捷運: 400, 無照騎機車: 250, 機車: 250, 微電車: 60 }[id.commute] || 0);
  w -= Math.min(w, fare + income * { 花掉: 0.9, 存下: 0.5, 投資: 0.5 }[mode]);
  if ((S.投資 ?? 0) > 0) {
    const rr = mulberry32((st.seed ^ Math.imul(st.turn + 7, 0x85ebca6b)) >>> 0);
    const ret = 0.0027 + 0.035 * gauss(rr); // 約 +7%／年、波動約 18%／年，換算成兩週一回合
    S.投資 = Math.max(0, S.投資 * (1 + ret));
  }
  if (mode === '投資') {
    const x = Math.min(w, income * 0.4);
    w -= x; S.投資 = (S.投資 ?? 0) + x; S.投資本金 = (S.投資本金 ?? 0) + x;
    if (!st.flags.投資說明) { st.flags.投資說明 = true; lines.push('未成年要由家長協助開戶（例如定期定額 ETF）；遊戲數字是簡化的示意，不是投資建議。'); }
  }
  S.錢包 = Math.max(0, Math.round(w));
  if (mode === '花掉') {
    S.體力 = clamp(S.體力 - 0.5, 5, 100); // 手搖飲、零食（之後的體力結算會再混合，影響很小）
    if (S.錢包 < 300 && rngAt(st.seed, st.turn, 'moneyend') < 0.3) { lines.push(fill(NOMONEY_LINES[freshIdx(st, NOMONEY_LINES.length, 'nm', 'nomoney', 1)], st, lctx)); S.心情 = clamp(S.心情 - 1, 0, 100); }
  } else S.幸福 = clamp(S.幸福 + 0.3, 0, 100); // 戶頭有錢的安全感

  /* 時間：可自己運用的小時數 */
  const commH = vac ? 0 : idn.commuteHours[id.commute];
  const club = st.flags.社團中 ? 3 : 0;
  const work = workLoad(st, vac);
  let selfHours = (vac ? 40 : 22) - commH - cram * 3 - H.遊戲 * 2.5 - H.運動 * 2 - club - work - (H.手機 >= 3 ? 2 : 0);
  if (H.作業 === '上網查' && r() < 0.3) selfHours -= 1; // 順便看了一下訊息或影片
  selfHours = Math.max(1, selfHours);

  /* 學習 = 時間 × 專注 × 消化比例 × 興趣 */
  const focus = S.專注 / 100, interest = S.興趣;
  const atmos = 0.85 + 0.3 * S.班級氣氛;
  const classPart = vac ? 0 : 40 * focus * 0.35 * CLASS_F[H.課堂] * atmos * interest;
  const own = H.課堂 === '做自己的事' && !vac ? 3 : 0;
  // 在家讀書、手機或電腦就在房間：有玩手遊的人，自己讀書的時間大多被吃掉（除非手機被保管）
  const phoneAway = !!(st.rule && st.turn < st.rule.until && st.rule.cap <= 2);
  const homeLeak = H.遊戲 >= 1 && !phoneAway ? Math.max(0.25, 1 - 0.25 * H.遊戲 - (H.手機 >= 3 ? 0.15 : 0)) : 1;
  const selfPart = (selfHours + own) * focus * HW_F[H.作業] * interest * homeLeak;
  const cramPart = cram * (tutorIsFree(st) ? 0.6 : 1) * 3.5 * focus * 0.4 * interest;
  const learn = (classPart + cramPart + selfPart) * ((S.AI依賴 ?? 0) >= 1.5 ? 0.85 : 1); // 太依賴 AI，自己想的功夫變少
  const recov = st.recover > 0 ? 0.35 : 1;
  const gain = learn * 0.15 * (1 - S.理解 / 170) * recov;
  S.理解 = clamp(S.理解 + gain - S.理解 * 0.03 * len, 0, 100);
  S.假熟悉 = clamp(S.假熟悉 * 0.65 + Math.max(0, cram * 3 - selfHours * 0.25) * 0.8, 0, 30);
  if (H.作業 === '開群組邊寫邊聊') { S.聯繫 += 1; S.心情 += 1; }
  if (!vac && H.課堂 === '跟著上' && r() < 0.06) S.興趣 = clamp(S.興趣 + 0.03, 0.8, 1.2);
  if (!vac && (H.課堂 === '放空' || H.課堂 === '補眠')) S.興趣 = clamp(S.興趣 - 0.01, 0.8, 1.2);
  S.班級氣氛 = clamp(S.班級氣氛 + (vac ? 0 : ATMOS_D[H.課堂]) + (0.5 - S.班級氣氛) * 0.02, 0, 1);

  /* 睡眠債：流入 − 自然恢復 */
  const bed = H.睡前手機 || H.手機 >= 4;
  const inflow = 0.15 + (bed ? 0.8 : 0) + cram * 0.15 + H.遊戲 * 0.15 + (tl.examWeek ? 0.4 : 0) + (st.flags.打工中 ? (st.flags.打工加班 ? 0.8 : 0.4) : 0) + (st.flags.打扮 ? 0.1 : 0) - H.運動 * 0.1 + fam.sleep + (H.課堂 === '補眠' && !vac ? -0.6 : 0);
  S.睡眠債 = clamp(S.睡眠債 + (inflow - 0.25 * S.睡眠債) * len, 0, 10);

  /* 牽掛（遊戲） */
  S.牽掛 = clamp(S.牽掛 + [0, 0.4, 0.8, 1.4][H.遊戲] + (H.手機 >= 3 ? 0.1 : 0) - 0.15 * S.牽掛 - (H.遊戲 === 0 ? 0.2 : 0), 0, 10);

  /* 專注（隱藏）：睡眠、手機、牽掛、運動、體力共同決定，帶慣性 */
  const fTarget = 90 - S.睡眠債 * 4 - PHONE_FOCUS[H.手機] - S.牽掛 * 2.2 + H.運動 * 3 - Math.max(0, 40 - S.體力) * 0.3;
  S.專注 = clamp(0.5 * S.專注 + 0.5 * fTarget + gauss(r) * 2, 15, 100);

  /* 體力 */
  const tTarget = 85 - S.睡眠債 * 4.5 + H.運動 * 5 - cram * 3 - work * 0.5 - Math.max(0, commH - 6) * 0.8 - H.遊戲 * 1.5;
  S.體力 = clamp(0.5 * S.體力 + 0.5 * tTarget + (H.課堂 === '放空' ? 2 : 0), 5, 100);

  /* 心情（短期、跳動大）與幸福（長期、隱藏） */
  const mTarget = 50 + PHONE_MOOD[H.手機] + H.運動 * 3 - S.睡眠債 * 1.5 + (S.知心 - 2) * 2.5 + [0, 0, 1, 3][H.遊戲] + gauss(r) * 5 - cram * 2 + (st.flags.交往中 ? 6 : 0) - (S.體力 < 35 ? 5 : 0) - (tl.examWeek ? 4 : 0);
  S.心情 = clamp(0.4 * S.心情 + 0.6 * mTarget, 0, 100);
  if (S.錢包 < 300) S.心情 = clamp(S.心情 - 1, 0, 100); // 月底沒錢的壓力
  S.心情 = clamp(S.心情 + (mode === '花掉' ? 1 : -0.5), 0, 100);
  if (mode !== '花掉') S.聯繫 = clamp(S.聯繫 - 0.3, 0, 100);
  const noise = 0.7 + 0.6 * r();
  const hDelta = 2 * (PHONE_HAPPY[H.手機] * noise + 0.2 * (S.知心 - 2) + 0.3 * H.運動 - 0.12 * (S.睡眠債 - 2) - 0.3 * Math.max(0, cram - 1) - 0.05 * S.牽掛 + (st.flags.交往中 ? 0.2 : 0) + (st.flags.社團中 ? 0.15 : 0));
  S.幸福 = clamp(S.幸福 + hDelta * len - (S.幸福 - 50) * 0.08, 0, 100);

  /* 人際 */
  S.聯繫 = clamp(S.聯繫 + (PHONE_LINK[H.手機] + (cram > 0 ? 0.5 : 0) + (st.flags.社團中 ? 1 : 0) + (H.遊戲 > 0 ? 0.5 : 0)) * len - (S.聯繫 - 15) * 0.12, 0, 100);
  S.知心 = clamp(S.知心 + (S.聯繫 > 35 ? 0.06 : 0) + (st.flags.社團中 ? 0.02 : 0) + (st.flags.交往中 ? 0.03 : 0) - (S.知心 > 1 ? 0.07 : 0.02), 0, 5);
  S.AI依賴 = Math.max(0, (S.AI依賴 ?? 0) - 0.1); // 一段時間沒靠 AI，就慢慢回來

  /* 打工：每回合都要付出體力與讀書時間 */
  if (st.flags.打工中) { const ot = st.flags.打工加班 ? 2 : 1; S.體力 = clamp(S.體力 - ot, 5, 100); S.理解 = clamp(S.理解 - 0.15 * ot * len, 0, 100); }
  /* 手機過夜：放客廳充電的好處很小但會累積 */
  if (!H.睡前手機) {
    S.睡眠債 = clamp(S.睡眠債 - 0.3, 0, 10); S.專注 = clamp(S.專注 + 1, 15, 100);
    S.聯繫 = clamp(S.聯繫 - 0.1, 0, 100); S.牽掛 = clamp(S.牽掛 - 0.1, 0, 10);
  }
  S.幸福 = clamp(S.幸福 + 0.02 * ((S.親子 ?? 50) - 50), 0, 100);
  S.親子 = clamp((S.親子 ?? 50) + (50 - (S.親子 ?? 50)) * 0.02, 0, 100);

  /* 手遊的「牽引」：降低手遊等級不會立刻停，要兩三個回合慢慢退；期間每週都被拉一下 */
  st.pull = Math.max(H.遊戲, (st.pull ?? 0) - 0.75);
  const lv = Math.min(3, Math.round(st.pull));
  if (lv >= 1) {
    for (let i = 0; i < 2; i++) {
      lines.push(fill(GAME_LINES[freshIdx(st, GAME_LINES.length, 'gm', 'gline' + i, 5)], st, lctx));
      S.牽掛 = clamp(S.牽掛 + 0.15 + 0.07 * lv, 0, 10);
      S.專注 = clamp(S.專注 - 1, 15, 100);
      S.理解 = clamp(S.理解 - 0.1 * lv, 0, 100);
      S.心情 = clamp(S.心情 + 1, 0, 100);
    }
  }
  /* 網友：詐騙不會一開始就要錢，先噓寒問暖、一起打遊戲、送小東西，慢慢變成「最懂你的人」 */
  if (st.flags.網友) {
    if (st.netStart == null) st.netStart = st.turn;
    const k = st.turn - st.netStart;
    const tier = k < 4 ? 0 : k < 8 ? 1 : 2, pool = NET_LINES[tier];
    lines.push(fill(pool[freshIdx(st, pool.length, 'net' + tier + '_', 'net', 1)], st, lctx));
    S.心情 = clamp(S.心情 + 1, 0, 100);
    S.專注 = clamp(S.專注 - 0.5, 15, 100);
    S.牽掛 = clamp(S.牽掛 + 0.1, 0, 10);
  } else st.netStart = null;
  /* IG：加了之後，每週都有訊息、限動和回覆的人情要應付 */
  if (st.flags.IG) {
    const igLv = st.flags.IG常用 ? 2 : 1;
    for (let i = 0; i < 2; i++) {
      const look = st.flags.打扮 && rngAt(st.seed, st.turn, 'iglook' + i) < 0.35;
      lines.push(fill(look ? IG_LOOK_LINES[freshIdx(st, IG_LOOK_LINES.length, 'igl', 'ig' + i, 1)] : IG_LINES[freshIdx(st, IG_LINES.length, 'ig', 'ig' + i, 4)], st, lctx));
      S.聯繫 = clamp(S.聯繫 + 0.4 * igLv + (look ? 0.3 : 0), 0, 100);
      S.專注 = clamp(S.專注 - 0.6 * igLv, 15, 100);
      if (H.睡前手機) S.睡眠債 = clamp(S.睡眠債 + 0.08 * igLv, 0, 10);
      // 看到別人過得很好：心情偶爾小降（比較）
      if (rngAt(st.seed, st.turn, 'igcmp' + i) < 0.3) S.心情 = clamp(S.心情 - 1, 0, 100); else S.心情 = clamp(S.心情 + 0.5, 0, 100);
    }
  }
  /* 交往中：每回合 1–2 件相處的小事 */
  if (st.flags.交往中) {
    ensurePartner(st, st.turn, idn);
    const n = rngAt(st.seed, st.turn, 'cpl') < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const L = COUPLE_LINES[freshIdx(st, COUPLE_LINES.length, 'cp', 'cpl' + i, 5)];
      lines.push({ couple: true, text: fill(L.t, st, lctx) });
      S.心情 = clamp(S.心情 + L.mood, 0, 100);
      S.知心 = clamp(S.知心 + L.know, 0, 5);
      S.專注 = clamp(S.專注 - L.focus, 15, 100);
      if (L.sleep) S.睡眠債 = clamp(S.睡眠債 + L.sleep, 0, 10);
      if (L.link) S.聯繫 = clamp(S.聯繫 + L.link, 0, 100);
    }
  }
  return lines;
}

/* ───────────── 固定劇情（考試等） ───────────── */
function runFixed(st, data, tl, f, r, out) {
  const S = st.stats;
  if (f.kind === 'exam') {
    const score = clamp(Math.round(25 + S.理解 * 0.75 + S.假熟悉 * 0.6 - S.睡眠債 * 0.8 + gauss(r) * 5), 0, 100);
    st.examScores.push(score);
    // 各科成績：整體程度 + 這個人的各科天分 + 這次的運氣
    const apt = st.identity.aptitude || {};
    st.lastExam = {};
    for (const sub of SUBJECTS) st.lastExam[sub] = clamp(Math.round(score + (apt[sub] || 0) + gauss(r) * 6), 0, 100);
    S.心情 = clamp(S.心情 + clamp((score - 60) / 8, -5, 5), 0, 100);
    S.睡眠債 = clamp(S.睡眠債 + 0.3, 0, 10);
    out.lines.push({ d: 1, text: `${f.name}成績出來了：平均 ${score} 分。` });
  } else if (f.kind === 'gsat') {
    const s = clamp(S.理解 * 0.9 + S.假熟悉 * 0.3 - S.睡眠債 * 0.8 + gauss(r) * 5, 0, 100);
    st.gsat = s;
    const lv = Math.round(s * 0.75);
    out.notices.push({ kind: 'info', title: '學測', text: `一月的兩天考試結束了。放榜那天，五科合計 ${lv} 級分（滿分 75）。接下來是準備申請入學的資料和面試。` });
    out.lines.push({ d: 1, text: `學測成績出爐：${lv} 級分。` });
  } else if (f.kind === 'apply') {
    const portfolio = (st.flags['社團:科學'] ? 2 : 0) + (st.flags['社團:音樂'] ? 2 : 0) + (st.flags['社團:運動'] ? 2 : 0) + (st.flags.去過營隊 ? 3 : 0) + (st.flags.社團中 ? 1 : 0);
    const penalty = S.露餡 >= 2 ? 4 : 0;
    st.final = (st.gsat ?? S.理解) + Math.min(portfolio, 6) - penalty + gauss(r) * 4;
    st.outcome = computeOutcome(st, data);
    const o = st.outcome;
    let t = `放榜日，你的申請結果出來了：${o.text}`;
    if (penalty) t += ' 面試時教授問起你學習歷程裡寫過的內容，你答得有點吃力。';
    out.notices.push({ kind: 'info', title: '放榜', text: t });
    out.lines.push({ d: 1, text: '申請入學放榜了。' });
  } else if (f.kind === 'fenke') {
    out.notices.push({ kind: 'info', title: '畢業典禮', text: st.outcome && st.outcome.retake ? '畢業典禮結束後，你沒有跟大家一起去聚餐。你已經決定重考，七月考完分科，就要去補習班租一個位子。' : '畢業典禮那天，大家在校門口拍了很多張照片。你要去的地方已經確定了，回家路上你想起三年來的很多人。' });
  }
}

/* ───────────── 開始回合 ───────────── */
export function startTurn(st, data) {
  if (st.ended || st.dead) throw new Error('遊戲已結束');
  if (st.cur) throw new Error('上一個回合尚未結束');
  const tl = data.timeline[st.turn];
  const r = stateRng(st);
  const cur = { tl, lines: [], notices: [], card: null, cardView: null, ctx: null };
  st.cur = cur;
  if (!tl.vacation && tl.idx === 0 && st.flags.打工中 && !st.flags.長期打工) { delete st.flags.打工中; delete st.flags.打工加班; } // 暑期打工結束

  const fs = famStep(st, data, tl);
  for (const l of fs.lines) cur.lines.push({ d: 1, text: l });
  for (const l of applyHabits(st, data, tl, r)) cur.lines.push(typeof l === 'string' ? { d: 2, text: l } : { d: 2, text: l.text, couple: true });
  if (tl.vacation && tl.seg === '寒假' && tl.idx === 0) { // 過年紅包：1,000–4,000，家境寬裕的給得多
    const bonus = { 寬裕: 800, 小康: 0, 吃緊: -300 }[st.identity.family.econ];
    const amt = Math.round((1000 + rngAt(st.seed, st.turn, 'angpao') * 2700 + bonus) / 100) * 100;
    st.stats.錢包 += amt;
    cur.lines.push({ d: 3, text: `過年收到紅包，一共 NT$${amt.toLocaleString('en-US')}。` });
  }

  // 2. 固定劇情
  for (const f of tl.fixed) {
    if (f.kind === 'card') { if (!cur.card && !(st.used[f.event])) cur.card = cardById(data, f.event); }
    else runFixed(st, data, tl, f, r, cur);
  }
  // 3. 延遲佇列（家庭變動的卡優先）
  if (fs.cardId && !cur.card) cur.card = cardById(data, fs.cardId);
  else if (fs.cardId) st.delayed.push({ event: fs.cardId, due: st.turn + 1 });
  if (!cur.card) {
    // 到期的後續依到期先後出現；被固定劇情佔掉的回合不會丟掉，而是等下一個空的回合
    for (;;) {
      let k = -1;
      st.delayed.forEach((d, i) => { if (d.due <= st.turn && (k < 0 || d.due < st.delayed[k].due)) k = i; });
      if (k < 0) break;
      const d = st.delayed.splice(k, 1)[0];
      const c = data.cardIndex[d.event];
      if (!c || (c.once && st.used[c.id])) continue; // 舊存檔的事件已不存在，或這張只會出現一次
      if (d.need && !evalCond(d.need, buildCtx(st, tl))) continue; // 到期時的條件不符（例如已經分手）
      cur.card = c; break;
    }
  }
  // 4. 人生事件
  const outcomes = checkLife(st, data, tl);
  for (const o of outcomes) {
    cur.notices.push({ kind: 'life', title: o.title, text: o.text, taiwan: o.taiwan, death: !!o.death });
    st.luck.push({ turn: st.turn, text: o.death ? '一場車禍' : o.sev === '開罰' ? '無照騎車被攔查開罰' : `通勤事故（${o.sev}）`, tw: o.taiwan });
    if (o.death) { st.dead = true; st.deathTurn = st.turn; break; }
    applyEffects(st, o.effects); applyEffects(st, o.hidden);
    for (const f of o.flags || []) st.flags[f] = true;
    if (o.sev && o.sev !== '開罰') st.flags.傷至 = st.turn + 2; // 小人身上的紗布會留一陣子
    if (o.recover) st.recover = Math.max(st.recover, o.recover);
    cur.lines.push({ d: 2, text: o.sev === '開罰' ? '無照騎車被警察攔下，開了罰單。' : `通勤途中發生事故（${o.sev}），需要好好休養。` });
  }
  if (st.dead) { cur.ctx = null; return { tl, notices: cur.notices, card: null, dead: true }; }
  // 5. 一般抽卡
  const ctx = buildCtx(st, tl);
  cur.ctx = ctx;
  // 手遊的邀約：牽引越強越常出現（約 1 級 25%、2–3 級 45–55%）；一回合仍最多一張
  const gl = Math.min(3, Math.round(st.pull ?? 0));
  if (!cur.card && gl >= 1 && rngAt(st.seed, st.turn, 'gamecard') < [0, 0.25, 0.45, 0.55][gl]) {
    const pool = data.events.cards.filter((c) => c.pool === '遊戲' && (st.cooldowns[c.id] || -1) <= st.turn && passes(c, st, ctx));
    if (pool.length) cur.card = pickWeighted(r, pool, (c) => c.weight ?? 1);
  }
  // 交往中：感情卡額外加抽，讓這段關係幾乎每隔一兩回合就有新的事；固定劇情與延遲後續仍然優先
  if (!cur.card && st.flags.交往中 && rngAt(st.seed, st.turn, 'datecard') < DATE_CARD_P) cur.card = drawDatingCard(st, data, ctx, r);
  if (!cur.card && r() < (tl.vacation ? 0.85 : 0.7)) cur.card = drawCard(st, data, ctx, r);
  cur.cardView = cur.card ? describeCard(cur.card, st, ctx) : null;
  return { tl, notices: cur.notices, card: cur.cardView, dead: false };
}

/** 玩家選了某個選項 */
export function chooseCard(st, data, idx) {
  const cur = st.cur;
  if (!cur || !cur.card) throw new Error('目前沒有事件卡');
  const r = stateRng(st);
  const { line } = applyChoice(st, data, cur.card, idx, cur.ctx, r, st.turn);
  if (line) cur.lines.push({ d: 0, text: line });
  cur.cardTitle = cur.card.title;
  cur.card = null; cur.cardView = null;
  return { line };
}

/** 倒數模式或略過：照目前習慣過，不選。 */
export function skipCard(st) {
  const cur = st.cur;
  if (!cur || !cur.card) return;
  cur.lines.push({ d: 0, text: '你沒有選，所以照平常的你過了這兩週。' });
  cur.card = null; cur.cardView = null;
}

/* ───────────── 結束回合 ───────────── */
export const FLAVOR_WIN = 6; // 風味句：用過之後 6 回合內不再出現
function flavorLines(st, data, tl, r, n) {
  const ctx = buildCtx(st, tl);
  // 每句有穩定 id（沒寫就用索引）；FLAVOR_WIN 回合內用過的不再出現，候選不夠才退回全部
  const seen = (st.flavorSeen ||= {});
  const all = data.calendar.flavor.map((f, i) => ({ ...f, id: f.id ?? 'fl' + i })).filter((f) => evalCond(f.if, ctx));
  let pool = all.filter((f) => seen[f.id] === undefined || st.turn - seen[f.id] > FLAVOR_WIN);
  if (!pool.length) pool = all.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const f = pickWeighted(r, pool);
    out.push(fill(f.text, st, ctx));
    seen[f.id] = st.turn;
    pool.splice(pool.indexOf(f), 1);
  }
  return out;
}

export function finishTurn(st, data) {
  const cur = st.cur;
  if (!cur) throw new Error('沒有進行中的回合');
  if (cur.card) skipCard(st);
  const tl = cur.tl;
  const r = stateRng(st);
  const news = stepPeers(st, data, tl);
  const lines = cur.lines.slice();
  if (news.length) lines.push({ d: 3, text: news[Math.floor(r() * news.length)] });
  const want = 2 + Math.floor(r() * 3);
  const fl = flavorLines(st, data, tl, r, Math.max(1, Math.min(2, want - lines.length)));
  for (const t of fl) lines.push({ d: 1, text: t });
  // 最多 4 行（優先保留卡片結果與考試）
  // 交往中的相處小事每回合都要留一行：先丟風味句，再丟 IG／遊戲的雜訊，最後才動到其他行
  while (lines.length > 4) {
    let i = lines.findIndex((l) => l.d === 1 && fl.includes(l.text));
    if (i < 0) i = lines.map((l, k) => (l.d === 2 && !l.couple ? k : -1)).filter((k) => k >= 0).pop() ?? -1;
    if (i < 0) i = lines.map((l, k) => (!l.couple && l.d !== 0 ? k : -1)).filter((k) => k >= 0).pop() ?? -1;
    if (i < 0) i = lines.findIndex((l, k) => l.couple && lines.filter((x) => x.couple).length > 1 && k >= 0);
    lines.splice(i >= 0 ? i : lines.length - 1, 1);
  }
  // 安排日期：d=0 為本回合第一天，其餘隨機散開、排序
  const days = Math.max(2, tl.days);
  const fixedFirst = lines.filter((l) => l.d === 0);
  const rest = lines.filter((l) => l.d !== 0);
  const offs = rest.map(() => 1 + Math.floor(r() * (days - 1))).sort((a, b) => a - b);
  const sched = [...fixedFirst.map((l) => ({ day: 0, text: l.text })), ...rest.map((l, i) => ({ day: offs[i], text: l.text }))];
  sched.sort((a, b) => a.day - b.day);

  const S = st.stats, H = st.habits;
  st.hist.push({
    t: st.turn, 專注: +S.專注.toFixed(1), 睡眠債: +S.睡眠債.toFixed(2), 心情: +S.心情.toFixed(1), 幸福: +S.幸福.toFixed(1),
    理解: +S.理解.toFixed(1), 聯繫: +S.聯繫.toFixed(1), 知心: +S.知心.toFixed(2), 牽掛: +S.牽掛.toFixed(2), 體力: +S.體力.toFixed(1),
    h: [H.手機, H.睡前手機 ? 1 : 0, H.補習, H.運動, H.遊戲, ['花掉', '存下', '投資'].indexOf(H.零用錢 || '花掉')], c: cur.cardTitle || null,
  });
  st.logs.push({ turn: st.turn, lines: sched });
  if (st.logs.length > 30) st.logs.shift();
  if (st.recover > 0) st.recover--;

  const dead = st.dead;
  const finished = tl;
  st.turn++;
  st.cur = null;
  let report = null;
  if (dead) { st.ended = true; }
  else {
    if (st.turn >= TOTAL_TURNS) { st.ended = true; if (!st.outcome) st.outcome = computeOutcome(st, data); }
    if ((finished.seg === '上學期' || finished.seg === '下學期') && finished.idx === 9 && !st.ended) {
      report = semesterReport(st, data, finished);
      st.reportPending = report;
    }
  }
  return { tl: finished, lines: sched, report, ended: st.ended, dead };
}

/** 學期報告的「先猜再揭曉」：記錄玩家的猜測 */
export function answerQuiz(st, guess) {
  const rp = st.reportPending;
  if (!rp) return null;
  st.quiz.push({ sem: rp.title, guess, answer: rp.quiz.answer });
  return rp.quiz.answer;
}
export function clearReport(st) { st.reportPending = null; }

/* ───────────── 自動遊玩（測試與模擬用） ───────────── */
export function playTurn(st, data, policy) {
  const tl = data.timeline[st.turn];
  if (policy && policy.habits) policy.habits(st, tl);
  const res = startTurn(st, data);
  if (!res.dead && res.card) {
    const idx = policy && policy.choose ? policy.choose(st, res.card) : res.card.choices.find((c) => !c.disabled).i;
    chooseCard(st, data, idx);
  }
  const fin = finishTurn(st, data);
  if (st.reportPending) clearReport(st);
  return fin;
}

export function playToEnd(st, data, policy) {
  let guard = 0;
  while (!st.ended && guard++ < 200) playTurn(st, data, policy);
  return st;
}

export { DEATH_LINE };

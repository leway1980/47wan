// 控制器：時間流動、事件暫停、存檔，把引擎和畫面接起來。
import { prepareData, startTurn, chooseCard, finishTurn, answerQuiz, clearReport, TOTAL_TURNS } from './engine/turn.js';
import { newState, serialize, deserialize, SAVE_KEY } from './engine/state.js';
import { openingText } from './engine/identity.js';
import { buildEnding } from './engine/report.js';
import { avatarSpec, avatarOptsFromState } from './engine/avatar.js';
import * as ui from './ui.js';

const DAY = 86400000;
const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const TURN_MS = Math.max(200, parseInt(params.get('ms') || '8000', 10) || 8000); // 1× 時一個回合約 8 秒

/* ───── 安全的儲存（所有存取都包 try/catch；壞掉就只存在記憶體） ───── */
const mem = {};
const store = {
  get() { try { return localStorage.getItem(SAVE_KEY); } catch { return mem[SAVE_KEY] ?? null; } },
  set(v) { try { localStorage.setItem(SAVE_KEY, v); } catch { mem[SAVE_KEY] = v; } },
  del() { try { localStorage.removeItem(SAVE_KEY); } catch { delete mem[SAVE_KEY]; } },
};
function readSave() {
  const raw = store.get();
  if (!raw) return null;
  try { const s = deserialize(raw); s.cur = null; return s; } catch { return null; }
}
function writeSave(st) { try { store.set(serialize(st)); } catch { /* 存不了也要能玩 */ } }

/* ───── 資料載入 ───── */
let data;
async function loadData() {
  const get = async (f) => {
    const r = await fetch(`data/${f}`);
    if (!r.ok) throw new Error(`載入 ${f} 失敗 (${r.status})`);
    return r.json();
  };
  const [identities, events, calendar, life_events] = await Promise.all(['identities.json', 'events.json', 'calendar.json', 'life_events.json'].map(get));
  data = prepareData({ identities, events, calendar, life_events });
}

/* ───── 遊戲狀態（控制器內） ───── */
let st = null, refs = null, speed = 1, timer = null, clock = null, phase = 'idle', seed = 0, pendingFin = null;

/* ───── 小人 ───── */
const curTl = () => data.timeline[Math.min(st.turn, TOTAL_TURNS - 1)];
const avatarView = (tl = curTl()) => ({ spec: avatarSpec(st.identity, data.identities, st.seed), opts: avatarOptsFromState(st, tl) });
function refreshAvatar(tl) { if (refs) { const v = avatarView(tl); ui.setAvatar(refs, v.spec, v.opts); } }
const habitCtx = () => ({ onAfter: () => { writeSave(st); refreshAvatar(); } });

const newSeed = () => (Math.floor(Math.random() * 4294967296) >>> 0) || 1;

function showTitle() {
  stopClock();
  phase = 'idle';
  ui.renderTitle(root, {
    hasSave: !!readSave(),
    onNew: () => showIntro(params.get('seed') ? parseInt(params.get('seed'), 10) >>> 0 : newSeed()),
    onContinue: () => resume(),
  });
}

function showIntro(s) {
  seed = s >>> 0;
  const draft = newState(seed, data);
  const id = draft.identity;
  const school = data.identities.schools.find((x) => x.id === id.schoolId);
  const paras = openingText(id, data.identities);
  ui.renderIntro(root, {
    paras,
    schoolLine: `${id.school}：${school.flavor}${school.fee}`,
    supportLine: `家裡的支援方式：${id.family.support}。${data.identities.supports[id.family.support]}`,
    tags: [id.county + id.district, id.schoolType, id.family.econ, `通勤：${id.commute}`],
    seed,
    avatar: { spec: avatarSpec(id, data.identities, seed), opts: { outfit: 'uniform', mood: 'neutral' } },
    uniformCaption: `${id.schoolKey}高中制服`,
    onStart: () => startGame(draft),
    onReroll: () => showIntro(newSeed()),
  });
}

function startGame(state) {
  st = state;
  seed = st.seed;
  buildGameScreen();
  ui.appendLog(refs, null, `${st.identity.name}，座號 ${st.identity.seat} 號。高中三年開始了。`, 'sys');
  writeSave(st);
  beginTurn();
}

function resume() {
  const s = readSave();
  if (!s) { showTitle(); return; }
  st = s; seed = st.seed;
  buildGameScreen();
  // 還原最近幾回合的紀錄
  for (const lg of st.logs.slice(-3)) {
    const tl = data.timeline[lg.turn];
    for (const l of lg.lines) ui.appendLog(refs, tl.start + l.day * DAY, l.text);
  }
  ui.appendLog(refs, null, '（接續上次的存檔）', 'sys');
  if (st.reportPending) { phase = 'report'; showReportModal(); return; }
  beginTurn();
}

function buildGameScreen() {
  speed = 1;
  refs = ui.renderGame(root, { speed, onSpeed: setSpeed });
  const tl = data.timeline[Math.min(st.turn, TOTAL_TURNS - 1)];
  ui.setClock(refs, tl.start, tl, tl.turn);
  ui.renderHabits(refs, st, onHabit, habitCtx());
  refreshAvatar(tl);
  ui.updateStats(refs, st);
}

function onHabit(k, v) {
  st.habits[k] = v;
  if (!st.cur) writeSave(st);
}

/* ───── 時間 ───── */
function setSpeed(v) {
  speed = v;
  ui.setSpeedButtons(refs, speed);
  if (phase === 'ticking') scheduleTick();
}
function stopClock() { if (timer) { clearTimeout(timer); timer = null; } ui.setAvatarAnim(refs, false); }
function scheduleTick() {
  stopClock();
  if (phase !== 'ticking' || speed === 0) return;
  ui.setAvatarAnim(refs, true);
  const dt = TURN_MS / Math.max(1, clock.tl.days) / speed;
  timer = setTimeout(tick, dt);
}

function beginTurn() {
  stopClock();
  if (st.ended) { showEnding(); return; }
  // 等玩家按下非暫停速度才往下走（暫停時可先調整習慣）
  phase = 'between';
  if (speed === 0) { waitForResume(); return; }
  const res = startTurn(st, data);
  const tl = res.tl;
  ui.setClock(refs, tl.start, tl, tl.turn);
  refreshAvatar(tl);
  ui.renderHabits(refs, st, onHabit, habitCtx()); // 家境若在這回合開頭變動，標頭要跟著換
  phase = 'modal';
  const queue = [...res.notices.map((n) => ({ n })), ...(res.card ? [{ card: res.card }] : [])];
  const next = () => {
    if (res.dead && !queue.length) { endTurn(); return; }
    const item = queue.shift();
    if (!item) { endTurn(); return; }
    if (item.n) ui.showNotice(refs, item.n, () => { ui.closeModal(refs); next(); });
    else {
      ui.showCard(refs, item.card, `${ui.termLabel(tl)} · ${ui.shortDate(tl.start)}`, (i) => {
        chooseCard(st, data, i);
        ui.closeModal(refs);
        next();
      });
    }
  };
  next();
}

function waitForResume() {
  const iv = setInterval(() => {
    if (speed > 0 && phase === 'between') { clearInterval(iv); beginTurn(); }
  }, 150);
}

function endTurn() {
  const fin = finishTurn(st, data);
  pendingFin = fin;
  ui.updateStats(refs, st);
  ui.renderHabits(refs, st, onHabit, habitCtx());
  refreshAvatar(fin.tl);
  writeSave(st);
  if (st.dead) { showEnding(); return; }
  clock = { tl: fin.tl, day: 0, lines: fin.lines.slice() };
  phase = 'ticking';
  flushLines();
  scheduleTick();
}

function flushLines() {
  while (clock.lines.length && clock.lines[0].day <= clock.day) {
    const l = clock.lines.shift();
    ui.appendLog(refs, clock.tl.start + l.day * DAY, l.text);
  }
}

function tick() {
  timer = null;
  if (phase !== 'ticking') return;
  clock.day++;
  const ms = clock.tl.start + Math.min(clock.day, clock.tl.days) * DAY;
  ui.setClock(refs, ms, clock.tl, clock.tl.turn + clock.day / clock.tl.days);
  flushLines();
  if (clock.day >= clock.tl.days) {
    while (clock.lines.length) { const l = clock.lines.shift(); ui.appendLog(refs, clock.tl.start + l.day * DAY, l.text); }
    turnDone();
    return;
  }
  scheduleTick();
}

function turnDone() {
  if (st.ended) { showEnding(); return; }
  if (st.reportPending) { phase = 'report'; showReportModal(); return; }
  beginTurn();
}

function showReportModal() {
  stopClock();
  const rp = st.reportPending;
  const q = st.quiz.find((x) => x.sem === rp.title);
  ui.showReport(refs, rp, {
    guessed: q ? q.guess : null,
    st, avatar: avatarView(),
    onGuess: (g) => { answerQuiz(st, g); writeSave(st); },
    onNext: (blankAnswer) => {
      if (blankAnswer != null) ui.appendLog(refs, null, `同屆在補習或打工的比例：${blankAnswer}%`, 'sys');
      clearReport(st); writeSave(st); ui.closeModal(refs); beginTurn(); },
  });
}

/* ───── 終局 ───── */
function showEnding() {
  stopClock();
  phase = 'ended';
  const e = buildEnding(st, data);
  const av = avatarView();
  av.opts = { ...av.opts, outfit: 'uniform', dead: !!st.dead };
  store.del(); // 這一局結束了，不再顯示「繼續」
  ui.renderEnding(root, e, {
    seed: st.seed, avatar: av,
    onSame: () => { const s = newState(st.seed, data); startGame(s); },
    onNew: () => showIntro(newSeed()),
  });
  window.scrollTo(0, 0);
}

/* ───── 啟動 ───── */
(async function boot() {
  try {
    await loadData();
  } catch (err) {
    root.textContent = '載入失敗：' + err.message + '。請用 http 伺服器開啟（例如 python3 -m http.server），不要直接雙擊 index.html。';
    return;
  }
  showTitle();
})();

window.__wan47 = { get state() { return st; }, get phase() { return phase; } }; // 方便除錯與自動化測試

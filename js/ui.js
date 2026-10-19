// 畫面元件：只負責把資料畫出來，不含遊戲規則。
import { rngAt } from './engine/rng.js';
import { visibleScore, focusPhrase } from './engine/state.js';
import { formatDateLong } from './engine/report.js';
import { avatarSVG } from './engine/avatar.js';
import { shockView, parentLabel, tutorCap, tutorIsFree } from './engine/family.js';

const avHTML = (spec, opts) => avatarSVG(spec, opts);
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
export function dateStr(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日（${WD[d.getUTCDay()]}）`;
}
export function shortDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
}
const GRADE = ['高一', '高二', '高三'];
export const termLabel = (tl) => `${GRADE[tl.year - 1]}${tl.seg}`;

/* ───────────── 標題 ───────────── */
export function renderTitle(root, { hasSave, onNew, onContinue }) {
  root.replaceChildren(
    h('main', { class: 'wrap hero' },
      h('h1', null, '《47萬分之1》'),
      h('p', { class: 'sub' }, '高中人生模擬。你只負責做決定，其餘交給人生。'),
      h('p', { class: 'sub' }, '你是 2026 年，全台 47 萬名高中、高職學生裡的一人。'),
      h('div', { class: 'actions' },
        hasSave && h('button', { class: 'btn primary', 'data-act': 'continue', onClick: onContinue }, '繼續'),
        h('button', { class: hasSave ? 'btn' : 'btn primary', 'data-act': 'new', onClick: onNew }, '開始新的人生'),
      ),
      h('p', { class: 'small muted', style: 'margin-top:32px' }, '不用打字，不用註冊。名字、座號、學校、家庭，都是抽到的。'),
    ),
  );
}

/* ───────────── 開場 ───────────── */
export function renderIntro(root, { paras, tags, schoolLine, supportLine, seed, onStart, onReroll, avatar, uniformCaption }) {
  root.replaceChildren(
    h('main', { class: 'wrap', style: 'padding-top:28px;padding-bottom:40px' },
      h('div', { class: 'paper opening' },
        avatar && h('figure', { class: 'av-card' },
          h('div', { class: 'av av-lg', 'data-av': 'intro', html: avHTML(avatar.spec, avatar.opts) }),
          h('figcaption', { class: 'small muted' }, uniformCaption)),
        h('p', { class: 'big' }, paras[0]),
        paras.slice(1).map((t) => h('p', null, t)),
        h('p', { class: 'muted' }, schoolLine),
        h('p', { class: 'muted' }, supportLine),
        h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'tag' }, t))),
      ),
      h('div', { class: 'stack', style: 'margin-top:16px' },
        h('button', { class: 'btn primary block', 'data-act': 'start', onClick: onStart }, '走進教室'),
        h('button', { class: 'btn block', 'data-act': 'reroll', onClick: onReroll }, '換一個人生'),
        h('p', { class: 'small muted' }, `人生編號 ${seed}（校名皆為虛構）`),
      ),
    ),
  );
}

/* ───────────── 遊戲主畫面 ───────────── */
const PHONE = ['幾乎不用', '需要才用', '下課會滑', '一有空就滑', '隨時在線'];
const SPORT = ['不運動', '偶爾動一動', '固定運動'];
const GAME = ['不玩', '偶爾玩', '常常玩', '天天上線'];

export function renderGame(root, { onSpeed, speed }) {
  const refs = {};
  refs.avHeader = h('div', { class: 'av av-sm', 'aria-hidden': 'true' });
  refs.date = h('div', { class: 'date', id: 'date', 'aria-live': 'off' });
  refs.term = h('span', { class: 'term' });
  refs.date.append(h('span', { id: 'date-text' }), refs.term);
  refs.speedBtns = [[0, '暫停'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, t]) =>
    h('button', { 'data-speed': v, 'aria-pressed': String(v === speed), onClick: () => onSpeed(v) }, t));
  refs.prog = h('i');
  refs.stats = h('div', { class: 'stats' });
  refs.habits = h('details', { class: 'habits', open: true });
  refs.feed = h('ol', { class: 'feed', id: 'feed' });
  refs.modal = h('div', { id: 'modal-root' });
  root.replaceChildren(
    h('div', { class: 'topbar' },
      h('div', { class: 'wrap' }, refs.avHeader, refs.date, h('div', { class: 'seg', role: 'group', 'aria-label': '時間速度' }, refs.speedBtns)),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '三年進度' }, refs.prog),
    ),
    h('main', { class: 'wrap layout' },
      refs.stats,
      h('div', { class: 'feedbox' }, h('h2', { class: 'feed-head' }, '生活紀錄'), refs.feed),
      refs.habits,
    ),
    refs.modal,
  );
  return refs;
}

/* ───── 小人：標頭與習慣面板兩處同步更新；只在時間流動時才 0/1 擺動 ───── */
export function setAvatar(refs, spec, opts) {
  refs.av = { spec, opts, frame: refs.av ? refs.av.frame : 0 };
  paintAvatar(refs);
}
function paintAvatar(refs) {
  if (!refs.av) return;
  const html = avHTML(refs.av.spec, { ...refs.av.opts, frame: refs.av.frame });
  refs.avHeader.innerHTML = html;
  if (refs.avPanel) refs.avPanel.innerHTML = html;
}
export function setAvatarAnim(refs, on) {
  if (!refs || !refs.av) return;
  if (refs.avTimer) { clearInterval(refs.avTimer); refs.avTimer = null; }
  if (on && !reduceMotion()) {
    refs.avTimer = setInterval(() => { refs.av.frame = refs.av.frame ? 0 : 1; paintAvatar(refs); }, 600);
  } else if (refs.av.frame) { refs.av.frame = 0; paintAvatar(refs); }
}

export function setSpeedButtons(refs, speed) {
  for (const b of refs.speedBtns) b.setAttribute('aria-pressed', String(+b.dataset.speed === speed));
}

export function setClock(refs, ms, tl, progress) {
  refs.date.querySelector('#date-text').textContent = dateStr(ms);
  refs.term.textContent = `${termLabel(tl)} · 第 ${tl.turn + 1} / 72 回合`;
  refs.termText = `${termLabel(tl)}・${rocYear(tl.start)}學年度`;
  if (refs.profTerm) refs.profTerm.textContent = refs.termText;
  refs.prog.style.width = `${(Math.min(72, progress) / 72) * 100}%`;
}

const moodWord = (m) => (m >= 70 ? '很開心' : m >= 55 ? '還不錯' : m >= 40 ? '普通' : m >= 25 ? '有點低落' : '很低落');
const bar = (pct) => h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));

export function updateStats(refs, st) {
  const S = st.stats;
  const hearts = Math.round(S.知心);
  refs.stats.replaceChildren(
    h('div', { class: 'stat', 'data-stat': '分數' }, h('div', { class: 'k' }, '分數'), h('div', { class: 'v' }, visibleScore(st, rngAt), h('small', null, ' 分'))),
    h('div', { class: 'stat', 'data-stat': '體力' }, h('div', { class: 'k' }, '體力'), h('div', { class: 'v' }, Math.round(S.體力)), bar(S.體力)),
    h('div', { class: 'stat', 'data-stat': '聯繫' }, h('div', { class: 'k' }, '聯繫'), h('div', { class: 'v' }, Math.round(S.聯繫), h('small', null, ' 人氣')), bar(S.聯繫)),
    h('div', { class: 'stat', 'data-stat': '知心' }, h('div', { class: 'k' }, '知心'), h('div', { class: 'v hearts', 'aria-label': `${hearts} 顆心` }, '♥'.repeat(hearts) + '♡'.repeat(5 - hearts))),
    h('div', { class: 'stat', 'data-stat': '心情' }, h('div', { class: 'k' }, '心情'), h('div', { class: 'v' }, moodWord(S.心情)), bar(S.心情)),
    h('div', { class: 'stat', 'data-stat': '錢包' }, h('div', { class: 'k' }, '錢包'), h('div', { class: 'v' }, 'NT$ ' + Math.round(S.錢包).toLocaleString('en-US'))),
    h('div', { class: 'stat wide', 'data-stat': '專注' }, h('div', { class: 'k' }, '最近的狀態'), h('div', { class: 'v', style: 'font-size:16px' }, `「${focusPhrase(S.專注)}」`)),
  );
}

export function stateBadge(st) {
  const S = st.stats, H = st.habits;
  if (S.睡眠債 >= 3 || S.體力 < 35) return { i: '😴', t: '好睏' };
  if (S.心情 < 35) return { i: '😟', t: '壓力大' };
  if (H.手機 >= 3) return { i: '📱', t: '黏手機' };
  if (S.心情 >= 65) return { i: '😊', t: '心情好' };
  if (S.體力 >= 70) return { i: '💪', t: '有精神' };
  return { i: '🙂', t: '還可以' };
}
const rocYear = (ms) => { const d = new Date(ms); return (d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1) - 1911; };
const ICON = { 手機: '📱', 補習: '📚', 運動: '🏃', 寫作業: '✏️', 睡前: '🌙', 手遊: '🎮', 上課: '🏫' };
const HW_CHIPS = [{ v: '紙本', t: '紙本' }, { v: '上網查', t: '上網查' }, { v: '開群組邊寫邊聊', t: '邊聊' }];
const CLASS_CHIPS = [{ v: '跟著上', t: '跟著上' }, { v: '挑重點聽', t: '挑重點' }, { v: '做自己的事', t: '做自己的事' }, { v: '放空', t: '放空' }, { v: '補眠', t: '補眠' }];
const TUTOR = ['不補習', '補 1 科', '補 2 科', '補 3 科'];
const derived = (phone) => ({ 睡前手機: phone >= 3, 遊戲: Math.max(0, phone - 2) });

/**
 * 輕量習慣面板：只用點的。手機／補習／運動是圓點（點圓點＝設定，點標籤＝下一階）；
 * 寫作業是三顆小籤。「細節」裡有睡前手機、手遊、上課；沒碰過就由手機等級推得，碰過就記住，「自動」可還原。
 * ctx.afford(n) -> { ok, need }：補習負擔不起的階層會變暗，點了只顯示原因。
 */
export function renderHabits(refs, st, onChange, ctx = {}) {
  const H = st.habits;
  if (!st.uiAuto) st.uiAuto = { 睡前: true, 遊戲: true };
  const A = st.uiAuto;
  const open = refs.habits.dataset.sub === '1';
  const hints = {};
  const hintEl = (k) => (hints[k] = h('span', { class: 'hp-hint', 'data-hint': k }));
  const say = (k, t) => { hints[k].textContent = t; };

  const dots = (key, n, value, set, labels, blocked) => h('span', { class: 'dots', role: 'group', 'aria-label': key },
    Array.from({ length: n }, (_, i) => {
      const b = blocked ? blocked(i) : null;
      return h('button', {
        class: 'dot' + (i <= value && value > 0 ? ' on' : '') + (b ? ' off' : ''), type: 'button', 'data-dot': i + 1,
        'aria-label': `${key} ${i + 1} 階：${labels[i + 1]}`, 'aria-pressed': String(i + 1 === value), 'aria-disabled': b ? 'true' : null,
        onClick: () => { if (b) { say(key, b); return; } set(value === i + 1 ? i : i + 1); },
      }, h('i'));
    }));
  const levelRow = (key, label, n, value, labels, set, blocked, extra) => {
    const hint = hintEl(key);
    say(key, labels[value]);
    const cycle = () => {
      for (let t = 1; t <= n + 1; t++) {
        const nv = (value + t) % (n + 1);
        if (!(blocked && nv > 0 && blocked(nv - 1))) { set(nv); return; }
      }
    };
    return h('div', { class: 'hp-row', 'data-row': key },
      h('button', { class: 'hp-label', type: 'button', onClick: cycle, 'aria-label': `${label}：下一階` }, h('span', { class: 'ic' }, ICON[key]), label),
      dots(key, n, value, set, labels, blocked),
      h('span', { class: 'br' }), hint, extra);
  };
  const chips = (key, opts, value, set) => h('span', { class: 'chips-row', role: 'group', 'aria-label': key },
    opts.map((o) => h('button', { class: 'cp' + (o.v === value ? ' on' : ''), type: 'button', 'aria-pressed': String(o.v === value), 'data-v': o.v, onClick: () => set(o.v) }, o.t)));

  const setPhone = (v) => {
    onChange('手機', v);
    const d = derived(v);
    if (A.睡前) onChange('睡前手機', d.睡前手機);
    if (A.遊戲) onChange('遊戲', d.遊戲);
    redraw();
  };
  const sub = open ? h('div', { class: 'hp-sub' },
    h('div', { class: 'hp-row' },
      h('span', { class: 'hp-label static' }, h('span', { class: 'ic' }, ICON.睡前), '手機過夜'),
      chips('手機過夜', [{ v: true, t: '帶進房間' }, { v: false, t: '放客廳充電' }], !!H.睡前手機, (v) => { A.睡前 = false; onChange('睡前手機', v); redraw(); }),
      h('button', { class: 'cp auto' + (A.睡前 ? ' on' : ''), type: 'button', onClick: () => { A.睡前 = true; onChange('睡前手機', derived(H.手機).睡前手機); redraw(); } }, '自動')),
    h('div', { class: 'hp-row' },
      h('button', { class: 'hp-label', type: 'button', onClick: () => { A.遊戲 = false; onChange('遊戲', (H.遊戲 + 1) % 4); redraw(); } }, h('span', { class: 'ic' }, ICON.手遊), '手遊'),
      dots('手遊', 3, H.遊戲, (v) => { A.遊戲 = false; onChange('遊戲', v); redraw(); }, GAME),
      h('button', { class: 'cp auto' + (A.遊戲 ? ' on' : ''), type: 'button', onClick: () => { A.遊戲 = true; onChange('遊戲', derived(H.手機).遊戲); redraw(); } }, '自動'),
      hintEl('手遊')),
    h('div', { class: 'hp-row' }, h('span', { class: 'hp-label static' }, h('span', { class: 'ic' }, ICON.上課), '上課'),
      chips('上課', CLASS_CHIPS, H.課堂, (v) => { onChange('課堂', v); redraw(); })),
  ) : null;
  if (sub) say('手遊', GAME[H.遊戲]);

  // 補習由家裡出錢：超過家裡負擔上限的階層變暗；上限 0 時第 1 階是免費的學校課輔
  const cap = tutorCap(st), free = tutorIsFree(st);
  const tutorBlocked = (i) => ((free ? i + 1 > 1 : i + 1 > cap) ? '一科一個月約 3,000 元，家裡目前負擔不起' : null);
  const tutorLabels = free ? ['不補習', '學校課輔（免費）', '', ''] : TUTOR;
  const body = h('div', { class: 'hp-main' },
    levelRow('手機', '手機', 4, H.手機, PHONE, setPhone, null,
      h('button', { class: 'cp detail', type: 'button', 'aria-expanded': String(open), onClick: () => { refs.habits.dataset.sub = open ? '0' : '1'; redraw(); } }, (open ? '▾' : '▸') + ' 細節')),
    sub,
    levelRow('補習', '補習', 3, H.補習, tutorLabels, (v) => { onChange('補習', v); redraw(); }, tutorBlocked),
    levelRow('運動', '運動', 2, H.運動, SPORT, (v) => { onChange('運動', v); redraw(); }),
    h('div', { class: 'hp-row', 'data-row': '零用錢' }, h('span', { class: 'hp-label static' }, h('span', { class: 'ic' }, '💰'), '零用錢'),
      chips('零用錢', ['花掉', '存下', '投資'].map((v) => ({ v, t: v })), H.零用錢 || '花掉', (v) => { onChange('零用錢', v); redraw(); })),
    h('div', { class: 'hp-row', 'data-row': '作業' }, h('span', { class: 'hp-label static' }, h('span', { class: 'ic' }, ICON.寫作業), '寫作業'),
      chips('寫作業', HW_CHIPS, H.作業, (v) => { onChange('作業', v); redraw(); })),
  );
  refs.avPanel = h('div', { class: 'av av-md', 'aria-hidden': 'true' });
  const id = st.identity, badge = stateBadge(st), shock = shockView(st);
  refs.profTerm = h('span', { class: 'pf-term' }, refs.termText || '');
  const strip = h('summary', { class: 'profile' },
    refs.avPanel,
    h('span', { class: 'pf-col' },
      h('span', { class: 'pf-name' }, `${id.name}・${id.seat}號`),
      refs.profTerm,
      h('span', { class: 'pf-school' }, id.school),
      h('span', { class: 'pf-fam' }, `🏠 ${id.family.econ}・${parentLabel(st)}：${id.family.job}`),
      (st.stats.投資本金 || 0) > 0 && h('span', { class: 'pf-fam', 'data-invest': '1' }, `📈 投資 ${Math.round(st.stats.投資).toLocaleString('en-US')} 元（${st.stats.投資 >= st.stats.投資本金 ? '+' : ''}${Math.round((st.stats.投資 / st.stats.投資本金 - 1) * 100)}%）`),
      st.rule && st.turn < st.rule.until && st.rule.label && h('span', { class: 'pf-fam', 'data-rule': '1' }, `📵 家規：${st.rule.label}`),
      shock && h('span', { class: 'pf-shock ' + (shock.sign < 0 ? 'neg' : 'pos'), title: shock.desc, 'data-shock': shock.label }, `${shock.icon} ${shock.label}`)),
    h('span', { class: 'pf-badge', 'data-badge': badge.t }, h('span', { 'aria-hidden': 'true' }, badge.i), badge.t),
    h('span', { class: 'pf-chev', 'aria-hidden': 'true' }, '▾'));
  const redraw = () => { renderHabits(refs, st, onChange, ctx); if (ctx.onAfter) ctx.onAfter(); };
  refs.habits.replaceChildren(
    strip,
    h('div', { class: 'hp' }, h('div', { class: 'hp-col' }, body, h('p', { class: 'hp-note small muted' }, '之後每兩週都照這樣過，想改再點。'))),
  );
  paintAvatar(refs);
}

export function appendLog(refs, ms, text, cls = '') {
  const li = h('li', { class: cls }, ms != null && h('time', null, shortDate(ms)), text);
  refs.feed.prepend(li);
  while (refs.feed.children.length > 80) refs.feed.lastChild.remove();
}

/* ───────────── 對話框 ───────────── */
function overlay(refs, ...content) {
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content);
  refs.modal.replaceChildren(h('div', { class: 'overlay' }, sheet));
  return sheet;
}
export function closeModal(refs) { refs.modal.replaceChildren(); }

const chipLabel = (k) => (k === '分數' ? '分數' : k);
export function showCard(refs, card, termText, onChoose) {
  const sheet = overlay(refs,
    h('div', { class: 'eyebrow' }, termText),
    h('h2', { id: 'card-title' }, card.title),
    h('p', { class: 'body' }, card.text),
    h('div', { class: 'choices', 'data-card': card.id }, card.choices.map((c) =>
      h('button', { class: 'choice', 'data-act': 'choice', 'data-i': c.i, disabled: c.disabled, onClick: () => onChoose(c.i) },
        h('span', { class: 'lab' }, c.label),
        c.note && h('span', { class: 'note' }, c.note),
        c.disabled ? h('span', { class: 'why' }, `（${c.reason}）`)
          : c.chips.length ? h('span', { class: 'chips' }, c.chips.map((x) => h('span', { class: 'chip' + (x.dir < 0 ? ' dn' : x.dir === 0 ? ' nu' : '') }, x.dir === 0 ? x.k : `${chipLabel(x.k)} ${x.dir > 0 ? '↑' : '↓'}`))) : null,
      ))),
  );
  sheet.setAttribute('aria-labelledby', 'card-title');
  const first = sheet.querySelector('.choice:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}

export function showNotice(refs, n, onOk) {
  if (n.death) {
    const sheet = overlay(refs, h('p', { class: 'death', 'data-death': '1' }, n.text), h('button', { class: 'btn primary block', 'data-act': 'ok', onClick: onOk }, '…'));
    sheet.querySelector('button').focus({ preventScroll: true });
    return;
  }
  const sheet = overlay(refs,
    h('h2', null, n.title),
    h('p', { class: 'body' }, n.text),
    n.taiwan && h('p', { class: 'taiwan' }, '在台灣：' + n.taiwan.replace(/^在台灣：/, '')),
    h('button', { class: 'btn primary block', 'data-act': 'ok', onClick: onOk }, '知道了'),
  );
  sheet.querySelector('button').focus({ preventScroll: true });
}

const dots5 = (n) => h('span', { class: 'm5', 'aria-label': `${n} / 5` }, [0, 1, 2, 3, 4].map((i) => h('i', { class: i < n ? 'on' : '' })));
const lvl5 = (v) => Math.max(0, Math.min(5, Math.round(v / 20)));
const sleepWord = (d) => (d < 1.5 ? '睡飽了' : d < 3 ? '還行' : d < 4.5 ? '有點欠' : '很缺覺');
const focusShort = (f) => (f >= 75 ? '很清醒' : f >= 55 ? '跟得上' : f >= 38 ? '常恍神' : '霧霧的');

/** 學期報告：標頭 + 6 格狀態 + 3 行同儕事實 + 可不填的猜測；一鍵繼續。 */
export function showReport(refs, rp, { onGuess, onNext, guessed, st, avatar }) {
  const S = st.stats;
  const tiles = [
    ['📚', '學業', dots5(lvl5(S.理解))],
    ['🎯', '專注', focusShort(S.專注)],
    ['😴', '睡眠', sleepWord(S.睡眠債)],
    ['💬', '人際', dots5(lvl5(S.聯繫))],
    ['😊', '心情', dots5(lvl5(S.心情))],
    ['💰', '錢包', 'NT$ ' + Math.round(S.錢包).toLocaleString('en-US')],
  ];
  const num = (re) => { const m = rp.peerLines.join('\n').match(re); return m ? m[1] : null; };
  const cram = num(/^([\d,]+) 人在補習/m), phoneHeavy = num(/^([\d,]+) 人手機/m);
  const days = (rp.commuteLine.match(/(\d+) 天/) || [])[1], pct = (rp.commuteLine.match(/機率(?:大約|約) ?([\d.]+%)/) || [])[1];
  const facts = [
    cram && `👥 1,000 人中 ${cram} 人在補習${st.habits.補習 > 0 ? '（你也是）' : ''}`,
    phoneHeavy && `📱 ${phoneHeavy} 人手機「一有空就滑」以上`,
    days && pct && ['腳踏車', '微電車', '無照騎機車'].includes(st.identity.commute) && `${st.identity.commute === '腳踏車' ? '🚲' : '🛵'} 你騎車上學 ${days} 天，一年發生事故的機率約 ${pct}`,
  ].filter(Boolean);
  const out = h('p', { class: 'rq-out', 'data-out': '1', 'aria-live': 'polite' });
  const input = h('input', { class: 'rq-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, placeholder: '猜幾 %？（可不填）', 'aria-label': rp.quiz.question });
  const reveal = (g) => { out.textContent = `你猜 ${g}%，實際 ${rp.quiz.answer}%`; };
  const btn = h('button', { class: 'btn primary block', 'data-act': 'next', type: 'button' }, '看答案／繼續');
  let shown = false;
  btn.addEventListener('click', () => {
    const raw = input.value.trim();
    const g = /^\d{1,3}$/.test(raw) ? Math.min(100, +raw) : null;
    if (g !== null && !shown) { shown = true; onGuess(g); reveal(g); input.disabled = true; btn.textContent = '繼續'; return; }
    onNext(g === null && !shown ? rp.quiz.answer : null);
  });
  if (guessed != null) { shown = true; reveal(guessed); input.value = String(guessed); input.disabled = true; btn.textContent = '繼續'; }
  overlay(refs,
    h('div', { class: 'rp-head' }, h('div', { class: 'av av-sm', html: avatar ? avHTML(avatar.spec, avatar.opts) : '' }),
      h('div', null, h('div', { class: 'eyebrow' }, '學期報告'), h('h2', null, `${rp.title}結束了`))),
    h('div', { class: 'tiles' }, tiles.map(([ic, k, v]) => h('div', { class: 'tile' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, ic), h('span', { class: 'tk' }, k), h('span', { class: 'tv' }, v)))),
    h('ul', { class: 'facts' }, facts.map((t) => h('li', null, t))),
    h('div', { class: 'rq' }, h('p', { class: 'small muted' }, `猜猜看：同屆有多少 % 的人在補習或打工？`), input, out),
    btn,
  );
  btn.focus({ preventScroll: true });
}

/* ───────────── 終局 ───────────── */
export function renderEnding(root, e, { onSame, onNew, seed, avatar }) {
  const av = avatar ? h('div', { class: 'av av-xl', 'data-av': 'ending', html: avHTML(avatar.spec, avatar.opts) }) : null;
  const btns = h('div', { class: 'btns' },
    h('button', { class: 'btn primary block', 'data-act': 'same', onClick: onSame }, '同一個人生再來一次'),
    h('button', { class: 'btn block', 'data-act': 'new-life', onClick: onNew }, '換一個人生'),
    h('p', { class: 'small muted', style: 'text-align:center' }, `人生編號 ${seed}（同一個人生：同樣的身分、同樣的運氣，選擇由你重新決定）`),
  );
  if (e.dead) {
    root.replaceChildren(h('main', { class: 'wrap end dead-end', id: 'ending' },
      av,
      h('p', { class: 'muted small' }, `${e.header.name}｜${e.header.line}`),
      h('p', { class: 'line' }, e.sections[0].text),
      h('div', { class: 'paper', style: 'text-align:left' },
        h('p', null, e.left), h('p', null, e.peerLine),
        h('h3', { style: 'margin-top:12px' }, '選擇與運氣'),
        h('div', { class: 'two' },
          h('div', null, h('b', null, '這些是你選的'), h('ul', null, (e.chosenDrawn.chosen.length ? e.chosenDrawn.chosen : ['（這一次，沒有改變過什麼）']).map((t) => h('li', null, t)))),
          h('div', null, h('b', null, '這些是你抽到的'), h('ul', null, e.chosenDrawn.drawn.map((t) => h('li', null, t)))),
        ),
        h('p', { class: 'taiwan' }, e.truth),
      ),
      btns));
    return;
  }
  root.replaceChildren(h('main', { class: 'wrap end', id: 'ending' },
    h('div', { class: 'head' },
      av,
      h('div', { class: 'nm' }, `47萬分之1 ── 你的人生報告`),
      h('div', { class: 'nm' }, `${e.header.name}｜${e.header.line}`),
      h('h1', null, `「${e.line}」`),
      h('div', { class: 'tagline' }, e.tag),
    ),
    h('div', { class: 'paper' },
      e.sections.map((s) => h('div', { class: 'age' }, h('b', null, `【${s.age}】`), h('span', null, s.text))),
      h('div', { class: 'age' }, h('b', null, '好事'), h('span', null, e.good)),
      h('div', { class: 'age' }, h('b', null, '遺憾'), h('span', null, e.regret)),
    ),
    h('div', { class: 'paper', style: 'margin-top:14px' },
      h('h2', { style: 'font-size:18px;margin-bottom:8px' }, '後台揭露：三年的隱藏曲線'),
      h('div', { class: 'curves' },
        h('div', { class: 'curve' }, h('div', { class: 'cap' }, '專注（你以為的「讀書時間」背後，真正能用的腦力）'), h('div', { html: e.curves.focus })),
        h('div', { class: 'curve' }, h('div', { class: 'cap' }, '睡眠債'), h('div', { html: e.curves.debt })),
        h('div', { class: 'curve' }, h('div', { class: 'cap' }, '心情 vs 真實幸福'), h('div', { html: e.curves.mood }),
          h('div', { class: 'legend' }, h('i', { style: 'background:var(--c3)' }), '心情（短期）', h('i', { style: 'background:var(--c1)' }), '幸福（長期，一直是隱藏的）')),
      ),
      h('p', { style: 'margin-top:10px' }, e.reveal),
    ),
    h('div', { class: 'two', style: 'margin-top:14px' },
      h('div', { class: 'paper' }, h('h3', null, '這些是你選的'), h('ul', null, e.chosenDrawn.chosen.map((t) => h('li', null, t)))),
      h('div', { class: 'paper' }, h('h3', null, '這些是你抽到的'), h('ul', null, e.chosenDrawn.drawn.map((t) => h('li', null, t)))),
    ),
    h('div', { class: 'paper', style: 'margin-top:14px' }, h('h3', null, '如果重來'), h('p', null, e.whatIf)),
    h('p', { class: 'small muted', style: 'margin-top:14px' }, e.footnote),
    btns,
  ));
}

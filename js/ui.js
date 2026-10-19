// 畫面元件：只負責把資料畫出來，不含遊戲規則。
import { rngAt } from './engine/rng.js';
import { visibleScore, focusPhrase } from './engine/state.js';
import { formatDateLong } from './engine/report.js';

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
export function renderIntro(root, { paras, tags, schoolLine, supportLine, seed, onStart, onReroll }) {
  root.replaceChildren(
    h('main', { class: 'wrap', style: 'padding-top:28px;padding-bottom:40px' },
      h('div', { class: 'paper opening' },
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
const HW = ['紙本', '上網查', '開群組邊寫邊聊'];
const CLASS = ['跟著上', '挑重點聽', '做自己的事', '放空', '補眠'];

function selectField(label, options, value, onChange, name) {
  // options: 字串陣列（數值型，值為索引）或 {v,t} 陣列（值為字串）
  const numeric = typeof options[0] === 'string';
  const sel = h('select', { name, 'data-habit': name, onChange: (e) => onChange(numeric ? +e.target.value : e.target.value) },
    options.map((o, i) => {
      const val = numeric ? i : o.v;
      return h('option', { value: val, selected: String(val) === String(value) }, numeric ? o : o.t);
    }));
  return h('label', null, label, sel);
}

export function renderGame(root, { onSpeed, speed }) {
  const refs = {};
  refs.date = h('div', { class: 'date', id: 'date', 'aria-live': 'off' });
  refs.term = h('span', { class: 'term' });
  refs.date.append(h('span', { id: 'date-text' }), refs.term);
  refs.speedBtns = [[0, '暫停'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, t]) =>
    h('button', { 'data-speed': v, 'aria-pressed': String(v === speed), onClick: () => onSpeed(v) }, t));
  refs.prog = h('i');
  refs.stats = h('div', { class: 'stats' });
  refs.habits = h('details', { class: 'habits' });
  refs.feed = h('ol', { class: 'feed', id: 'feed' });
  refs.modal = h('div', { id: 'modal-root' });
  root.replaceChildren(
    h('div', { class: 'topbar' },
      h('div', { class: 'wrap' }, refs.date, h('div', { class: 'seg', role: 'group', 'aria-label': '時間速度' }, refs.speedBtns)),
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

export function setSpeedButtons(refs, speed) {
  for (const b of refs.speedBtns) b.setAttribute('aria-pressed', String(+b.dataset.speed === speed));
}

export function setClock(refs, ms, tl, progress) {
  refs.date.querySelector('#date-text').textContent = dateStr(ms);
  refs.term.textContent = `${termLabel(tl)} · 第 ${tl.turn + 1} / 72 回合`;
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

export function renderHabits(refs, st, onChange) {
  const H = st.habits;
  const set = (k) => (v) => onChange(k, v);
  refs.habits.replaceChildren(
    h('summary', null, '我的習慣（每回合自動執行，隨時可改）'),
    h('div', { class: 'habit-grid' },
      selectField('手機', PHONE, H.手機, set('手機'), '手機'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-habit': '睡前手機', checked: H.睡前手機, onChange: (e) => onChange('睡前手機', e.target.checked) }), '睡前還在滑手機'),
      selectField('補習', ['不補習', '補 1 科', '補 2 科', '補 3 科'], H.補習, set('補習'), '補習'),
      selectField('運動', SPORT, H.運動, set('運動'), '運動'),
      selectField('寫作業的方式', HW.map((t) => ({ v: t, t })), H.作業, set('作業'), '作業'),
      selectField('遊戲', GAME, H.遊戲, set('遊戲'), '遊戲'),
      selectField('上課投入', CLASS.map((t) => ({ v: t, t })), H.課堂, set('課堂'), '課堂'),
    ),
  );
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
          : c.chips.length ? h('span', { class: 'chips' }, c.chips.map((x) => h('span', { class: 'chip' + (x.dir < 0 ? ' dn' : '') }, `${chipLabel(x.k)} ${x.dir > 0 ? '↑' : '↓'}`))) : null,
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

export function showReport(refs, rp, { onGuess, onNext, guessed }) {
  let slider;
  const body = h('div', { class: 'rep' });
  const sheet = overlay(refs, h('div', { class: 'eyebrow' }, '學期報告'), h('h2', null, `${rp.title}結束了`), body);
  const renderFull = (guess) => {
    const diff = Math.abs(guess - rp.quiz.answer);
    body.append(
      h('div', { class: 'reveal' }, `答案是 ${rp.quiz.answer}%。你猜 ${guess}%，${diff <= 5 ? '很接近！' : diff <= 15 ? '差了一點。' : `差了 ${diff} 個百分點，大家常常低估或高估身邊的人。`}`),
      h('h3', null, rp.peerHead),
      h('ul', null, rp.peerLines.map((t) => h('li', null, t))),
      h('h3', null, '路上'),
      h('p', null, rp.commuteLine),
      h('button', { class: 'btn primary block', style: 'margin-top:16px', 'data-act': 'next', onClick: onNext }, '繼續下一學期'),
    );
    body.querySelector('[data-act="next"]').scrollIntoView({ block: 'nearest' });
  };
  body.append(
    h('h3', null, '這學期的你'),
    h('ul', null, rp.phrases.map((t) => h('li', null, t))),
    h('h3', null, '你們學校的樣子'),
    h('p', null, rp.schoolLine),
    h('h3', null, '先猜，再揭曉'),
    h('p', null, rp.quiz.question),
  );
  if (guessed != null) { renderFull(guessed); return; }
  const out = h('output', { class: 'big', 'data-out': '1' }, '50%');
  slider = h('input', { type: 'range', min: 0, max: 100, value: 50, class: 'slider', 'aria-label': '猜測的百分比', onInput: (e) => { out.textContent = e.target.value + '%'; } });
  const btn = h('button', { class: 'btn primary block', 'data-act': 'reveal', onClick: () => {
    const g = +slider.value;
    onGuess(g);
    slider.disabled = true; btn.remove();
    renderFull(g);
  } }, '我猜好了，揭曉');
  body.append(out, slider, btn);
}

/* ───────────── 終局 ───────────── */
export function renderEnding(root, e, { onSame, onNew, seed }) {
  const btns = h('div', { class: 'btns' },
    h('button', { class: 'btn primary block', 'data-act': 'same', onClick: onSame }, '同一個人生再來一次'),
    h('button', { class: 'btn block', 'data-act': 'new-life', onClick: onNew }, '換一個人生'),
    h('p', { class: 'small muted', style: 'text-align:center' }, `人生編號 ${seed}（同一個人生：同樣的身分、同樣的運氣，選擇由你重新決定）`),
  );
  if (e.dead) {
    root.replaceChildren(h('main', { class: 'wrap end dead-end', id: 'ending' },
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

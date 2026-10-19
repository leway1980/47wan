// 像素小人：純函式，不碰 DOM。回傳 SVG 字串（16×24 的像素格，viewBox 用像素單位，放大不糊）。
import { mulberry32 } from './rng.js';

export const W = 16, HT = 24;

/* ───── 色彩小工具 ───── */
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const shade = (hex, f = 0.82) => toHex(toRgb(hex).map((v) => v * f));
export const lighten = (hex, f = 0.35) => toHex(toRgb(hex).map((v) => v + (255 - v) * f));

/* ───── 範本：每個字元對應一個調色盤鍵，'.' 為透明 ───── */
// 身體（頭、頸、手臂、襯衫）。T 襯衫 t 袖子 W 領 S 膚
const BODY = [
  '................',
  '................',
  '................',
  '....SSSSSSSS....',
  '....SSSSSSSS....',
  '....SSSSSSSS....',
  '...SSSSSSSSSS...',
  '...SSSSSSSSSS...',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '.......SS.......',
  '...tTTWSSWTTt...',
  '...tTTTTTTTTt...',
  '...tTTTTTTTTt...',
  '...STTTTTTTTTS..'.slice(0, 16),
  '...STTTTTTTTTS..'.slice(0, 16),
  '...STTTTTTTTTS..'.slice(0, 16),
  '....TTTTTTTT....',
];
// 頭髮（男 3、女 3）。H 髮 h 亮點
const HAIR = {
  男: [
    ['................', '................', '.....HHHHHH.....', '....HHHHHHHH....', '....HHHHHHHH....', '....H......H....'],
    ['................', '................', '.....HHHHHH.....', '....HHHHHHHH....', '....HHHHHH......', '....H......H....'],
    ['................', '.....H.H.H......', '....HHHHHHHH....', '....HHHHHHHH....', '....HH.HH.HH....', '....H......H....'],
  ],
  女: [
    ['................', '................', '.....HHHHHH.....', '....HHHHHHHH....', '....HHHHHHHH....', ...Array(9).fill('...HH......HH...')],
    ['................', '................', '.....HHHHHH.....', '....HHHHHHHH....', '....HHHHHHHHHH..', '....H......H.HH.', '.............HH.', '.............HH.', '..............H.'].map((r) => r.padEnd(16, '.')),
    ['................', '................', '.....HHHHHH.....', '....HHHHHHHH....', '....HHHHHHHH....', ...Array(4).fill('...HH......HH...'), '....H......H....'],
  ],
};
const SHOES = ['.....OOOOOO.....', '....oooooooo....'];
const SHOES_SKIRT = ['....OOO..OOO....'];

/* ───── 畫布 ───── */
function makeLayer() { return Array.from({ length: HT }, () => Array(W).fill(null)); }
function stamp(layer, rows, y0, map, dy = 0) {
  rows.forEach((row, ry) => {
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const col = map[ch];
      const y = y0 + ry + dy;
      if (col && y >= 0 && y < HT) layer[y][x] = col;
    }
  });
}
function px(layer, x, y, col, dy = 0) { const yy = y + dy; if (col && yy >= 0 && yy < HT && x >= 0 && x < W) layer[yy][x] = col; }

/* ───── 調色盤 ───── */
export const PALETTE_KEYS = ['shirt', 'bottom', 'accentF', 'accentM', 'badge'];
export function isCompletePalette(u) {
  if (!u || typeof u !== 'object') return false;
  const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!hex(u.shirt) || !hex(u.bottom) || !hex(u.accentF) || !hex(u.badge)) return false;
  if (u.accentM !== null && !hex(u.accentM)) return false;
  if (u.bottom2 !== undefined && !hex(u.bottom2)) return false;
  return !!u.pe && hex(u.pe.top) && hex(u.pe.trim) && hex(u.pe.bottom);
}

/** 由身分 + 資料組出畫小人所需的一切（全是十六進位色，可直接存或比較） */
export function avatarSpec(identity, idn, seed = 0) {
  const av = idn.avatar;
  const r = mulberry32(((seed >>> 0) ^ 0x1f2e3d4c) >>> 0);
  return {
    sex: identity.sex,
    bottom: identity.bottom,
    hair: identity.hair,
    hairColor: av.hairColors[identity.hairColor],
    skin: av.skins[identity.skin],
    glasses: !!identity.glasses,
    uniform: idn.uniforms[identity.schoolKey],
    casual: {
      top: av.casualTops[Math.floor(r() * av.casualTops.length)],
      bottom: av.casualBottoms[Math.floor(r() * av.casualBottoms.length)],
    },
  };
}

/** 由遊戲狀態推出小人的樣子（純函式，方便測試） */
export function avatarOptsFromState(st, tl) {
  const S = st.stats, H = st.habits;
  return {
    outfit: tl && tl.vacation ? 'casual' : 'uniform',
    tired: S.睡眠債 >= 3 || !!H.睡前手機,
    phone: H.手機 >= 3,
    glow: H.手機 >= 4,
    gaming: H.遊戲 >= 2,
    sweat: H.運動 >= 1,
    bob: H.運動 >= 2 ? 2 : 1,
    backpack: H.補習 >= 2,
    hw: H.作業 === '開群組邊寫邊聊' ? 'chat' : H.作業 === '紙本' ? 'paper' : null,
    slouch: S.體力 < 35,
    mood: S.心情 >= 65 ? 'happy' : S.心情 < 35 ? 'sad' : 'neutral',
    bandage: (st.flags.傷至 || 0) > st.turn,
    dead: !!st.dead,
  };
}

function outfitColors(spec, outfit) {
  const u = spec.uniform, female = spec.sex === '女';
  if (outfit === 'pe') {
    return { shirt: u.pe.top, trim: u.pe.trim, bottom: u.pe.bottom, bottom2: null, accent: null, badge: u.pe.trim, pants: true, pe: true };
  }
  if (outfit === 'casual') {
    const c = spec.casual || { top: '#7fa7e0', bottom: '#3d5a80' };
    return { shirt: c.top, trim: null, bottom: c.bottom, bottom2: null, accent: null, badge: lighten(c.top, 0.6), pants: spec.bottom !== '裙', casual: true };
  }
  return { shirt: u.shirt, trim: null, bottom: u.bottom, bottom2: u.bottom2 || null, accent: female ? u.accentF : u.accentM, badge: u.badge, pants: spec.bottom !== '裙' };
}

const FACE_INK = '#2a2230', MOUTH = '#b5535b', BLUSH = '#f0a0a0', GLASS = '#7a84a6', PHONE = '#2b2f3a', SCREEN = '#8fd3ff', BAND = '#f7f3ea';

/**
 * spec: avatarSpec() 的結果。
 * opts: { outfit:'uniform'|'pe'|'casual', frame:0|1, tired, phone, mood:'happy'|'sad'|'neutral', bandage, dead, title }
 */
export function avatarSVG(spec, opts = {}) {
  const o = { outfit: 'uniform', frame: 0, mood: 'neutral', ...opts };
  const dy = (o.frame === 1 ? (o.bob || 1) : 0) + (o.slouch ? 1 : 0); // 上半身下沉 = 呼吸／彈跳／駝背
  const oc = outfitColors(spec, o.outfit);
  const female = spec.sex === '女';
  const skin = spec.skin;
  const up = makeLayer(), low = makeLayer();

  // 上半身：膚、襯衫
  const shirt = oc.shirt;
  stamp(up, BODY, 0, {
    S: skin, T: shirt, t: shade(shirt, 0.86),
    W: oc.casual ? shirt : oc.pe ? oc.trim : lighten(shirt, 0.55) === shirt ? '#ffffff' : lighten(shirt, 0.6),
  }, dy);
  if (oc.pe) {
    for (let y = 12; y <= 17; y++) { px(up, 4, y, oc.trim, dy); px(up, 11, y, oc.trim, dy); }
  }
  // 補習：沉重的書包（背帶 + 左右鼓出來的包身）
  if (o.backpack && !o.dead) {
    const BAGC = '#4b5a73';
    for (let y = 12; y <= 17; y++) { px(up, 1, y, BAGC, dy); px(up, 2, y, BAGC, dy); }
    for (let y = 11; y <= 16; y++) { px(up, 5, y, shade(BAGC, 0.8), dy); px(up, 10, y, shade(BAGC, 0.8), dy); }
    px(up, 1, 12, '#d9a441', dy);
  }
  // 蝴蝶結／領帶
  if (oc.accent) {
    const A = oc.accent, a = shade(A, 0.75);
    if (female) {
      px(up, 6, 12, A, dy); px(up, 7, 12, a, dy); px(up, 8, 12, a, dy); px(up, 9, 12, A, dy);
      px(up, 7, 13, A, dy); px(up, 8, 13, A, dy);
    } else {
      px(up, 7, 12, a, dy); px(up, 8, 12, a, dy);
      for (let y = 13; y <= 16; y++) { px(up, 7, y, A, dy); px(up, 8, y, A, dy); }
    }
  }
  // 校徽（運動服是胸前小字；便服是一個小圖案）
  px(up, 10, o.outfit === 'uniform' ? 14 : 13, oc.badge, dy);
  if (oc.casual) px(up, 6, 14, oc.badge, dy);

  // 頭髮
  const hairRows = HAIR[spec.sex][spec.hair % 3];
  const Hc = spec.hairColor;
  stamp(up, hairRows, 0, { H: Hc, h: lighten(Hc, 0.3) }, dy);
  px(up, 6, 3, lighten(Hc, 0.3), dy);

  // 運動：頭帶；遊戲：耳機
  if (o.sweat && !o.dead) for (let x = 4; x <= 11; x++) px(up, x, 3, x % 2 ? '#e8564a' : '#f7f3ea', dy);
  if (o.gaming && !o.dead) {
    const HP = '#3a3f55', CUP = '#e0566c';
    for (let x = 5; x <= 10; x++) px(up, x, 2, HP, dy);
    px(up, 4, 3, HP, dy); px(up, 11, 3, HP, dy); px(up, 4, 4, HP, dy); px(up, 11, 4, HP, dy);
    for (let y = 5; y <= 7; y++) { px(up, 3, y, CUP, dy); px(up, 12, y, CUP, dy); }
  }
  // 臉：腮紅、眼、嘴
  px(up, 5, 7, BLUSH, dy); px(up, 10, 7, BLUSH, dy);
  const down = o.phone && !o.dead; // 低頭滑手機：視線往下，只剩一列眼睛
  const closed = o.dead || o.frame === 1 || down;
  if (!closed) { px(up, 6, 5, FACE_INK, dy); px(up, 9, 5, FACE_INK, dy); }
  px(up, 6, 6, FACE_INK, dy); px(up, 9, 6, FACE_INK, dy);
  if (o.dead) { px(up, 5, 6, FACE_INK, dy); px(up, 7, 6, FACE_INK, dy); px(up, 8, 6, FACE_INK, dy); px(up, 10, 6, FACE_INK, dy); }
  const mood = o.dead ? 'neutral' : o.mood;
  if (mood === 'happy') { px(up, 6, 8, MOUTH, dy); px(up, 9, 8, MOUTH, dy); px(up, 7, 9, MOUTH, dy); px(up, 8, 9, MOUTH, dy); }
  else if (mood === 'sad') { px(up, 7, 8, MOUTH, dy); px(up, 8, 8, MOUTH, dy); px(up, 6, 9, MOUTH, dy); px(up, 9, 9, MOUTH, dy); }
  else { px(up, 7, 8, MOUTH, dy); px(up, 8, 8, MOUTH, dy); }

  // 眼鏡（高度近視）
  if (spec.glasses) {
    for (const x of [5, 10]) { px(up, x, 5, GLASS, dy); px(up, x, 6, GLASS, dy); }
    px(up, 7, 5, GLASS, dy); px(up, 8, 5, GLASS, dy);
    if (!closed) { px(up, 6, 5, FACE_INK, dy); px(up, 9, 5, FACE_INK, dy); }
  }
  // 手機螢幕的光打在臉上
  if (o.glow && !o.dead) {
    for (const [x, y] of [[6, 8], [9, 8]]) px(up, x, y, lighten(skin, 0.3), dy); // 螢幕光：淡淡打亮下巴兩側
  }
  // 黑眼圈
  if (o.tired && !o.dead) { px(up, 6, 7, shade(skin, 0.78), dy); px(up, 9, 7, shade(skin, 0.78), dy); } // 黑眼圈：比膚色深一階就好
  // 受傷：臉頰 OK 繃、手肘紗布
  if (o.bandage && !o.dead) { px(up, 10, 8, BAND, dy); px(up, 3, 15, BAND, dy); }
  // 手機
  if (o.phone && !o.dead) {
    px(up, 13, 11, PHONE, dy); px(up, 14, 11, PHONE, dy);
    px(up, 13, 12, SCREEN, dy); px(up, 14, 12, SCREEN, dy);
    px(up, 13, 13, PHONE, dy); px(up, 14, 13, PHONE, dy);
    px(up, 13, 14, skin, dy); px(up, 12, 14, skin, dy);
  }

  // 寫作業的方式：邊聊 = 對話泡泡；紙本 = 手上一支鉛筆
  if (o.hw === 'chat' && !o.dead) {
    for (let x = 12; x <= 15; x++) for (let y = 0; y <= 2; y++) px(low, x, y, '#ffffff');
    px(low, 12, 3, '#ffffff');
    px(low, 13, 1, '#6b7280'); px(low, 14, 1, '#6b7280');
  }
  if (o.hw === 'paper' && !o.dead) {
    px(up, 13, 15, '#f2a0a0', dy); px(up, 13, 16, '#f2c94c', dy); px(up, 13, 17, '#f2c94c', dy); px(up, 13, 18, '#444', dy);
  }
  // 下半身（後畫，蓋掉下沉的最後一列躯幹）
  const B = oc.bottom, Bs = shade(B, 0.8), B2 = oc.bottom2;
  const skirt = !oc.pants;
  if (skirt) {
    stamp(low, ['....BBBBBBBB....'], 18, { B });
    for (let y = 19; y <= 20; y++) {
      for (let x = 3; x <= 12; x++) {
        let c = B;
        if (B2 && (x + y) % 3 === 0) c = B2;
        else if ((x - 3) % 3 === 2) c = Bs;
        px(low, x, y, c);
      }
    }
    stamp(low, ['.....SS..SS.....'], 21, { S: skin });
    stamp(low, ['.....ww..ww.....'], 22, { w: '#f4f4f4' });
    stamp(low, SHOES_SKIRT, 23, { O: '#3b3b46' });
  } else {
    stamp(low, ['....BBBBBBBB....'], 18, { B });
    for (let y = 19; y <= 21; y++) stamp(low, ['.....BBbbBB.....'], y, { B, b: Bs });
    if (oc.pe) for (let y = 19; y <= 21; y++) { px(low, 5, y, oc.trim); px(low, 10, y, oc.trim); }
    stamp(low, SHOES, 22, { O: '#d9dce6', o: '#8f8fa0' });
  }

  // 合成
  const cells = makeLayer();
  for (const layer of [up, low]) for (let y = 0; y < HT; y++) for (let x = 0; x < W; x++) if (layer[y][x]) cells[y][x] = layer[y][x];
  // 輪廓陰影（腳下一小條影子，讓站姿穩）
  let rects = '';
  for (let y = 0; y < HT; y++) {
    let x = 0;
    while (x < W) {
      const c = cells[y][x];
      if (!c) { x++; continue; }
      let n = 1;
      while (x + n < W && cells[y][x + n] === c) n++;
      rects += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${c}"/>`;
      x += n;
    }
  }
  const label = o.title || (o.dead ? '像素小人（休止符）' : '像素小人');
  const dead = o.dead
    ? ' opacity="0.5" filter="url(#av-gs)"'
    : '';
  const defs = o.dead ? '<defs><filter id="av-gs"><feColorMatrix type="saturate" values="0"/></filter></defs>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="avatar" viewBox="0 0 ${W} ${HT}" shape-rendering="crispEdges" role="img" aria-label="${label}">${defs}<g${dead}>${rects}</g></svg>`;
}

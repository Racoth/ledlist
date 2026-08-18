import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { Response } from 'express';
import { db, UPLOADS_DIR } from './db.js';
import { loopLoad, naturalPlaysPerDay, calcPrice } from './engine.js';

const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
const TILE_CACHE = path.join(SERVER_ROOT, 'data', 'tiles');

/* ============================================================================
   Шрифт прайса.
   Приоритет: заданный через окружение → Mazzard, если установлен в системе →
   встроенный PT Sans. Mazzard коммерческий, поэтому в репозиторий он не
   кладётся: на другой машине без него прайс просто соберётся на PT Sans.
   PDF_FONT_DIR / PDF_FONT_FAMILY позволяют указать свой шрифт.
   ========================================================================== */
const PT_DIR = path.join(SERVER_ROOT, 'node_modules', '@expo-google-fonts', 'pt-sans');
const FALLBACK = {
  name: 'PT Sans',
  regular: path.join(PT_DIR, '400Regular', 'PTSans_400Regular.ttf'),
  // у PT Sans нет промежуточного веса — акцент даёт bold
  medium: path.join(PT_DIR, '700Bold', 'PTSans_700Bold.ttf'),
  bold: path.join(PT_DIR, '700Bold', 'PTSans_700Bold.ttf'),
};

function pickFont() {
  const family = process.env.PDF_FONT_FAMILY ?? 'MazzardM';
  const dirs = [
    process.env.PDF_FONT_DIR,
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
    'C:\\Windows\\Fonts',
    '/usr/share/fonts/truetype',
    path.join(os.homedir(), '.local', 'share', 'fonts'),
  ].filter(Boolean) as string[];

  for (const dir of dirs) {
    const regular = path.join(dir, `${family}-Regular.ttf`);
    const bold = path.join(dir, `${family}-Bold.ttf`);
    if (!fs.existsSync(regular) || !fs.existsSync(bold)) continue;
    const mid = path.join(dir, `${family}-Medium.ttf`);
    return { name: family, regular, medium: fs.existsSync(mid) ? mid : bold, bold };
  }
  return FALLBACK;
}

const FONT = pickFont();

/** Знак рубля есть далеко не в каждом шрифте (в Mazzard его нет) — иначе «руб.». */
function currencySign(file: string): string {
  try {
    const f = fontkit.openSync(file) as any;
    return f.hasGlyphForCodePoint?.(0x20bd) ? '₽' : 'руб.';
  } catch {
    return '₽';
  }
}
const RUB = currencySign(FONT.regular);
console.log(`PDF-прайс: шрифт ${FONT.name}, знак валюты «${RUB}»`);

// A4 портрет: 595.28 × 841.89 pt
const PAGE = { w: 595.28, h: 841.89 };
const M = 42;                       // поля
const CONTENT_W = PAGE.w - M * 2;

const INK = '#161a22';
const MUTED = '#616a7a';
const LINE = '#dde1e9';
const ACCENT = '#2a78d6';

// Intl разделяет разряды неразрывным пробелом; в подмножестве шрифта он может
// не иметь Unicode-соответствия, и текст из PDF копируется с мусором — берём обычный.
const groups = (v: number, digits = 0) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v).replace(/[  ]/g, ' ');

const money = (v: number) => `${groups(v)} ${RUB}`;
const num = (v: number) => groups(v);
/** Размер по-русски: 6,4 × 13,4 м, а не 6.4 × 13.4 */
const dim = (v: number) => groups(v, 2);

/* ============================================================================
   Карта: собираем из тайлов OpenStreetMap прямо в PDF.
   Тайлы кладутся в clip-прямоугольник со сдвигом, чтобы точка была в центре —
   так не нужна библиотека склейки картинок.
   ========================================================================== */
const TILE_PX = 256;
const TILE_PT = 128;                // 2 px на точку ≈ 144 dpi
const ZOOM = 16;

const lonToTileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function tile(z: number, x: number, y: number): Promise<Buffer | null> {
  const max = 2 ** z;
  if (y < 0 || y >= max) return null;
  const wrapped = ((x % max) + max) % max;
  fs.mkdirSync(TILE_CACHE, { recursive: true });
  const file = path.join(TILE_CACHE, `${z}-${wrapped}-${y}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${wrapped}/${y}.png`, {
      headers: { 'User-Agent': 'LED-List/1.0 (DOOH inventory price sheets)' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    return buf;
  } catch {
    return null;                    // без интернета просто не будет карты
  }
}

async function drawMap(
  doc: PDFKit.PDFDocument,
  lat: number, lng: number,
  box: { x: number; y: number; w: number; h: number },
) {
  const cx = lonToTileX(lng, ZOOM);
  const cy = latToTileY(lat, ZOOM);
  // левый-верхний угол рамки в «тайловых» координатах
  const originX = cx - box.w / 2 / TILE_PT;
  const originY = cy - box.h / 2 / TILE_PT;
  const fromX = Math.floor(originX), fromY = Math.floor(originY);
  const toX = Math.floor(originX + box.w / TILE_PT);
  const toY = Math.floor(originY + box.h / TILE_PT);

  doc.save();
  doc.rect(box.x, box.y, box.w, box.h).clip();
  let drew = 0;
  for (let tx = fromX; tx <= toX; tx++) {
    for (let ty = fromY; ty <= toY; ty++) {
      const img = await tile(ZOOM, tx, ty);
      if (!img) continue;
      const px = box.x + (tx - originX) * TILE_PT;
      const py = box.y + (ty - originY) * TILE_PT;
      try {
        doc.image(img, px, py, { width: TILE_PT, height: TILE_PT });
        drew++;
      } catch { /* битый тайл — пропускаем */ }
    }
  }
  doc.restore();

  if (drew === 0) {
    doc.save().rect(box.x, box.y, box.w, box.h).fill('#f2f4f8').restore();
    doc.fillColor(MUTED).font('ru').fontSize(9)
      .text('Карта недоступна', box.x, box.y + box.h / 2 - 14, { width: box.w, align: 'center' })
      .text(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, box.x, box.y + box.h / 2, { width: box.w, align: 'center' });
  } else {
    // метка в центре
    const mx = box.x + box.w / 2, my = box.y + box.h / 2;
    doc.save();
    doc.circle(mx, my, 7).fillOpacity(1).fill(ACCENT);
    doc.circle(mx, my, 7).lineWidth(2).stroke('#ffffff');
    doc.circle(mx, my, 2.5).fill('#ffffff');
    doc.restore();
  }
  doc.rect(box.x, box.y, box.w, box.h).lineWidth(0.7).stroke(LINE);
}

/* ============================================================================
   Страница прайса — один экран на лист A4
   ========================================================================== */
function label(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font('ru-b').fontSize(7.5).fillColor(MUTED).text(text.toUpperCase(), x, y, { characterSpacing: 0.6 });
}

/** Шапка страницы: компания слева, дата справа, линия под ними. Возвращает новый y. */
function pageHeader(doc: PDFKit.PDFDocument, company: string): number {
  let y = M;
  doc.font('ru').fontSize(8).fillColor(MUTED)
    .text(company || 'Прайс на размещение', M, y, { width: CONTENT_W });
  doc.text(`Действует на ${new Date().toLocaleDateString('ru-RU')}`, M, y, { width: CONTENT_W, align: 'right' });
  y += 16;
  doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.7).stroke(LINE);
  return y + 18;
}

function pageFooter(doc: PDFKit.PDFDocument, left: string, right: string) {
  const fy = PAGE.h - M + 6;
  doc.font('ru').fontSize(7.5).fillColor(MUTED)
    .text(left, M, fy, { width: CONTENT_W })
    .text(right, M, fy, { width: CONTENT_W, align: 'right' });
}

/** Цена ролика 10 сек за 30 дней — та же цифра, что крупно на странице экрана. */
function price10(s: any): number {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
  const calc = calcPrice({ screen_id: s.id, duration_sec: 10, date_from: from, date_to: to });
  return calc?.total ?? s.price_per_sec_month * 10;
}

function specRow(doc: PDFKit.PDFDocument, k: string, v: string, x: number, y: number, w: number) {
  doc.font('ru').fontSize(9.5).fillColor(MUTED).text(k, x, y, { width: w * 0.45 });
  doc.font('ru-m').fontSize(9.5).fillColor(INK).text(v, x + w * 0.45, y, { width: w * 0.55 });
  doc.moveTo(x, y + 15).lineTo(x + w, y + 15).lineWidth(0.5).stroke(LINE);
}

async function screenPage(doc: PDFKit.PDFDocument, s: any, company: string) {
  let y = pageHeader(doc, company);

  // Название крупно, код — подписью под ним, сторона — плашкой справа
  const badgeW = 88;
  const titleW = CONTENT_W - badgeW - 16;
  doc.font('ru-b').fontSize(16).fillColor(INK).text(s.name ?? '', M, y, { width: titleW });
  const titleH = doc.heightOfString(s.name ?? '', { width: titleW });

  if (s.side) {
    // Слово и буква одного кегля и на одной базовой линии: рисуем двумя
    // вызовами с одинаковым y и размером, а не через continued со сменой кегля.
    const bx = M + CONTENT_W - badgeW;
    const boxY = y - 2, boxH = 24, size = 8.5, gap = 7;
    doc.roundedRect(bx, boxY, badgeW, boxH, 4).fill('#eef3fb');

    const word = 'СТОРОНА';
    const letter = String(s.side);
    doc.font('ru').fontSize(size);
    const wordW = doc.widthOfString(word, { characterSpacing: 0.6 });
    doc.font('ru-m').fontSize(size);
    const letterW = doc.widthOfString(letter);
    const startX = bx + (badgeW - (wordW + gap + letterW)) / 2;
    const textY = boxY + (boxH - size * 1.18) / 2;

    doc.font('ru').fontSize(size).fillColor(MUTED)
      .text(word, startX, textY, { characterSpacing: 0.6, lineBreak: false });
    doc.font('ru-m').fontSize(size).fillColor(ACCENT)
      .text(letter, startX + wordW + gap, textY, { lineBreak: false });
  }
  y += titleH + 3;

  doc.font('ru').fontSize(9.5).fillColor(MUTED).text(s.code, M, y, { width: titleW });
  y += 26;

  const place = [s.city_name ? `г. ${s.city_name}` : null, s.address].filter(Boolean).join(', ');
  doc.font('ru').fontSize(11).fillColor(INK).text(place, M, y, { width: CONTENT_W });
  y += doc.heightOfString(place, { width: CONTENT_W }) + 20;

  // Две колонки: характеристики | цена
  const colW = (CONTENT_W - 20) / 2;
  const colTop = y;

  label(doc, 'Характеристики экрана', M, y);
  let ry = y + 14;
  const specs: [string, string][] = [
    ['Размер', s.width_m ? `${dim(s.width_m)} × ${dim(s.height_m)} м` : '—'],
    ['Разрешение', s.res_w ? `${s.res_w} × ${s.res_h} px` : '—'],
    ['Тип', s.type_name ?? '—'],
  ];
  for (const [k, v] of specs) { specRow(doc, k, v, M, ry, colW); ry += 25; }

  // Блок ротации
  ry += 8;
  label(doc, 'Блок ротации', M, ry);
  ry += 14;
  const plays = naturalPlaysPerDay(s.work_from, s.work_to, s.loop_duration_sec);
  const blockSpecs: [string, string][] = [
    ['Длина блока', `${s.loop_duration_sec} сек`],
    ['Выходов в месяц', `≈ ${num(plays * 30)}`],
  ];
  for (const [k, v] of blockSpecs) { specRow(doc, k, v, M, ry, colW); ry += 25; }

  // Цена — правая колонка
  const px = M + colW + 20;
  let py = colTop;
  label(doc, 'Стоимость размещения', px, py);
  py += 16;

  const calc = calcPrice({
    screen_id: s.id, duration_sec: 10,
    date_from: new Date().toISOString().slice(0, 10),
    date_to: new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10),
  });
  const price10 = calc?.total ?? s.price_per_sec_month * 10;

  doc.roundedRect(px, py, colW, 96, 6).fill('#f6f8fb');
  doc.font('ru').fontSize(9.5).fillColor(MUTED).text('Ролик 10 секунд, 30 дней', px + 14, py + 14, { width: colW - 28 });
  doc.font('ru-b').fontSize(26).fillColor(INK).text(money(price10), px + 14, py + 32, { width: colW - 28 });
  doc.font('ru').fontSize(9).fillColor(MUTED)
    .text(`${money(s.price_per_sec_month)} за 1 секунду в месяц`, px + 14, py + 68, { width: colW - 28 });
  if (calc && calc.tax_rate > 0) {
    doc.fontSize(8).text(`включая ${calc.tax_name}`, px + 14, py + 80, { width: colW - 28 });
  }
  py += 108;

  // Прайс по длительностям
  label(doc, 'Другие длительности', px, py);
  py += 14;
  for (const d of [5, 15]) {
    const c = calcPrice({
      screen_id: s.id, duration_sec: d,
      date_from: new Date().toISOString().slice(0, 10),
      date_to: new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10),
    });
    specRow(doc, `${d} сек / 30 дней`, money(c?.total ?? 0), px, py, colW);
    py += 25;
  }

  // Фото и карта — во всю ширину, друг под другом, поделив остаток страницы
  const photo = db.prepare(`
    SELECT stored_name, mime FROM screen_photos
    WHERE screen_id = ? AND mime IN ('image/jpeg','image/png')
    ORDER BY sort_order, id LIMIT 1
  `).get(s.id) as { stored_name: string; mime: string } | undefined;

  const LABEL_H = 13;
  const GAP = 14;
  const mediaTop = Math.max(ry, py) + 14;
  const boxH = Math.max(130, (PAGE.h - M - 20 - mediaTop - LABEL_H * 2 - GAP) / 2);

  // Фотография — сверху
  label(doc, photo ? 'Фотография' : 'Фотография — не загружена', M, mediaTop);
  const photoY = mediaTop + LABEL_H;
  if (photo) {
    try {
      doc.save().rect(M, photoY, CONTENT_W, boxH).clip();
      doc.image(path.join(UPLOADS_DIR, photo.stored_name), M, photoY,
        { cover: [CONTENT_W, boxH], align: 'center', valign: 'center' });
      doc.restore();
    } catch {
      doc.restore();
      doc.rect(M, photoY, CONTENT_W, boxH).fill('#f2f4f8');
    }
  } else {
    doc.rect(M, photoY, CONTENT_W, boxH).fill('#f2f4f8');
    doc.fillColor(MUTED).font('ru').fontSize(9)
      .text('Фото не загружено', M, photoY + boxH / 2 - 5, { width: CONTENT_W, align: 'center' });
  }
  doc.rect(M, photoY, CONTENT_W, boxH).lineWidth(0.7).stroke(LINE);

  // Карта — под фотографией
  const mapLabelY = photoY + boxH + GAP;
  label(doc, 'Расположение', M, mapLabelY);
  const mapY = mapLabelY + LABEL_H;
  if (s.lat != null && s.lng != null) {
    await drawMap(doc, s.lat, s.lng, { x: M, y: mapY, w: CONTENT_W, h: boxH });
  } else {
    doc.rect(M, mapY, CONTENT_W, boxH).fill('#f2f4f8');
    doc.fillColor(MUTED).font('ru').fontSize(9)
      .text('Координаты не указаны', M, mapY + boxH / 2 - 5, { width: CONTENT_W, align: 'center' });
    doc.rect(M, mapY, CONTENT_W, boxH).lineWidth(0.7).stroke(LINE);
  }

  pageFooter(doc, `${s.code}${s.side ? ` · сторона ${s.side}` : ''}`,
    'Данные о свободной ёмкости актуальны на дату формирования');
}

/* ============================================================================
   Закрывающая страница: перечень подборки с ценами и итогом
   ========================================================================== */
const SUM_COLS = [
  { key: 'n',     title: '№',        w: 24,  align: 'left' as const },
  { key: 'code',  title: 'Код',      w: 104, align: 'left' as const },
  { key: 'place', title: 'Экран и адрес', w: 206, align: 'left' as const },
  { key: 'side',  title: 'Сторона',  w: 50,  align: 'center' as const },
  { key: 'loop',  title: 'Блок',     w: 44,  align: 'center' as const },
  { key: 'price', title: 'Цена, 30 дней', w: 83, align: 'right' as const },
];

function sumTableHead(doc: PDFKit.PDFDocument, y: number): number {
  let x = M;
  for (const c of SUM_COLS) {
    doc.font('ru-b').fontSize(7.5).fillColor(MUTED)
      .text(c.title.toUpperCase(), x, y, { width: c.w, align: c.align, characterSpacing: 0.5 });
    x += c.w;
  }
  const ly = y + 13;
  doc.moveTo(M, ly).lineTo(M + CONTENT_W, ly).lineWidth(0.7).stroke(LINE);
  return ly + 8;
}

function summaryPages(doc: PDFKit.PDFDocument, screens: any[], company: string) {
  const total = screens.reduce((a, s) => a + price10(s), 0);
  const BOTTOM = PAGE.h - M - 122;         // оставляем место под итог и сноску

  doc.addPage({ size: 'A4', margin: 0 });
  let y = pageHeader(doc, company);

  doc.font('ru-b').fontSize(16).fillColor(INK).text('Сводка по подборке', M, y);
  y += 20;
  doc.font('ru').fontSize(9.5).fillColor(MUTED).text(
    `${screens.length} ${plural(screens.length, ['экран', 'экрана', 'экранов'])} · цены за ролик 10 секунд на 30 дней`,
    M, y, { width: CONTENT_W });
  y += 18;
  y = sumTableHead(doc, y);

  screens.forEach((s, i) => {
    if (y > BOTTOM) {                      // перенос на следующий лист
      pageFooter(doc, 'Сводка по подборке', 'продолжение на следующей странице');
      doc.addPage({ size: 'A4', margin: 0 });
      y = sumTableHead(doc, pageHeader(doc, company));
    }
    const place = [s.city_name ? `г. ${s.city_name}` : null, s.address].filter(Boolean).join(', ');
    const cells: Record<string, string> = {
      n: String(i + 1),
      code: s.code,
      place,
      side: s.side ?? '—',
      loop: `${Math.round(s.loop_duration_sec / 60)} мин`,
      price: money(price10(s)),
    };
    const placeCol = SUM_COLS.find((c) => c.key === 'place')!;
    doc.font('ru').fontSize(9);
    const rowH = Math.max(16, doc.heightOfString(place, { width: placeCol.w, lineGap: 1 }) + 4);

    let x = M;
    for (const c of SUM_COLS) {
      const bold = c.key === 'price' || c.key === 'code';
      doc.font(bold ? 'ru-m' : 'ru').fontSize(9)
        .fillColor(c.key === 'place' ? MUTED : INK)
        .text(cells[c.key], x, y, { width: c.w, align: c.align, lineGap: 1 });
      x += c.w;
    }
    y += rowH;
    doc.moveTo(M, y - 4).lineTo(M + CONTENT_W, y - 4).lineWidth(0.4).stroke('#eef1f5');
  });

  // Итог
  y += 10;
  doc.roundedRect(M, y, CONTENT_W, 46, 6).fill('#f6f8fb');
  doc.font('ru').fontSize(9.5).fillColor(MUTED)
    .text('Итого за размещение на 30 дней', M + 16, y + 19);
  doc.font('ru-b').fontSize(17).fillColor(INK)
    .text(money(total), M + 16, y + 14, { width: CONTENT_W - 32, align: 'right' });
  y += 58;

  doc.font('ru').fontSize(8).fillColor(MUTED).text(
    'Цены указаны за ролик 10 секунд на 30 дней и включают налог, если он предусмотрен режимом экрана. ' +
    'Скидки и коэффициенты тайм-слотов не учтены; предложение не является публичной офертой.',
    M, y, { width: CONTENT_W, lineGap: 2 });

  pageFooter(doc, 'Сводка по подборке', `${screens.length} ${plural(screens.length, ['позиция', 'позиции', 'позиций'])} · ${money(total)}`);
}

function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Прайс выбранных экранов: по странице A4 на экран, в конце — сводка (по желанию). */
export async function writeScreensPdf(
  res: Response, tenantId: number, screenIds: number[] | null,
  opts: { summary?: boolean } = {},
) {
  const rows = db.prepare(`
    SELECT s.*, c.name AS city_name, c.region, st.name AS type_name
    FROM screens s
    LEFT JOIN cities c ON c.id = s.city_id
    LEFT JOIN screen_types st ON st.id = s.screen_type_id
    WHERE s.tenant_id = ? ORDER BY s.code
  `).all(tenantId) as any[];
  const screens = screenIds && screenIds.length ? rows.filter((s) => screenIds.includes(s.id)) : rows;
  if (screens.length === 0) return null;

  const settings = db.prepare('SELECT legal_name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any;

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: false });
  doc.registerFont('ru', FONT.regular);
  doc.registerFont('ru-m', FONT.medium);
  doc.registerFont('ru-b', FONT.bold);
  doc.info.Title = 'Прайс на размещение — LED-экраны';
  doc.info.Author = settings?.legal_name ?? 'LED-List';
  doc.pipe(res);

  const company = settings?.legal_name ?? '';
  for (const s of screens) {
    doc.addPage({ size: 'A4', margin: 0 });
    await screenPage(doc, s, company);
  }
  if (opts.summary !== false) summaryPages(doc, screens, company);

  doc.end();
  return screens.length;
}

import { db } from './db.js';

/**
 * Движок проверки ёмкости петли.
 * Модель: петля экрана длиной loop_duration_sec крутится непрерывно в часы работы.
 * Каждый активный (бронь/продано) слот занимает duration_sec секунд петли
 * в каждый день своего периода. Ёмкость: сумма длительностей активных роликов
 * в любой день не должна превышать длину петли.
 */

export interface DayLoad {
  date: string;        // YYYY-MM-DD
  used_sec: number;
  load_pct: number;
}

interface ActiveSlot {
  duration_sec: number;
  date_from: string;
  date_to: string;
  campaign_id: number;
  status: string;
  time_slot_id: number | null;
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  // ограничение на всякий случай — не более 2 лет
  for (let i = 0; d <= end && i < 731; i++) {
    days.push(fmtLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function activeSlots(screenId: number, from: string, to: string, excludeCampaignId?: number): ActiveSlot[] {
  return db.prepare(`
    SELECT s.duration_sec, s.date_from, s.date_to, s.campaign_id, c.status, s.time_slot_id
    FROM ad_slots s JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.screen_id = ? AND c.status IN ('reserved','sold')
      AND s.date_from <= ? AND s.date_to >= ?
      AND (? IS NULL OR s.campaign_id != ?)
  `).all(screenId, to, from, excludeCampaignId ?? null, excludeCampaignId ?? null) as ActiveSlot[];
}

export function loopLoad(screenId: number, from: string, to: string, excludeCampaignId?: number) {
  const screen = db.prepare('SELECT id, loop_duration_sec FROM screens WHERE id = ?').get(screenId) as
    { id: number; loop_duration_sec: number } | undefined;
  if (!screen) return null;
  const loop = screen.loop_duration_sec;
  const slots = activeSlots(screenId, from, to, excludeCampaignId);

  const days: DayLoad[] = eachDay(from, to).map((date) => {
    let used = 0;
    for (const s of slots) if (s.date_from <= date && s.date_to >= date) used += s.duration_sec;
    return { date, used_sec: used, load_pct: Math.round((used / loop) * 1000) / 10 };
  });

  const maxUsed = days.reduce((m, d) => Math.max(m, d.used_sec), 0);
  const avg = days.length ? days.reduce((a, d) => a + d.load_pct, 0) / days.length : 0;
  return {
    screen_id: screenId,
    loop_duration_sec: loop,
    max_used_sec: maxUsed,
    max_load_pct: Math.round((maxUsed / loop) * 1000) / 10,
    avg_load_pct: Math.round(avg * 10) / 10,
    free_sec: Math.max(0, loop - maxUsed),
    days,
  };
}

/** Проверка: помещается ли ролик длительностью durationSec в петлю на всём периоде. */
export function checkCapacity(screenId: number, from: string, to: string, durationSec: number, excludeCampaignId?: number) {
  const load = loopLoad(screenId, from, to, excludeCampaignId);
  if (!load) return { ok: false, reason: 'Экран не найден' };
  const overflowDays = load.days.filter((d) => d.used_sec + durationSec > load.loop_duration_sec);
  if (overflowDays.length > 0) {
    return {
      ok: false,
      reason: `Петля переполнена: не хватает места в ${overflowDays.length} дн. (свободно ${load.free_sec} сек, требуется ${durationSec} сек)`,
      load,
      overflow_days: overflowDays.map((d) => d.date),
    };
  }
  return { ok: true, load };
}

/**
 * Агрегатная проверка кампании перед бронью/продажей:
 * по каждому экрану и каждому дню сумма длительностей ВСЕХ роликов кампании
 * плюс ролики других активных кампаний не должна превышать длину петли.
 * (Проверка слотов по одному пропустила бы переполнение собственными роликами.)
 */
export function checkCampaignCapacity(campaignId: number): { ok: boolean; reason?: string } {
  const own = db.prepare('SELECT screen_id, duration_sec, date_from, date_to FROM ad_slots WHERE campaign_id = ?')
    .all(campaignId) as { screen_id: number; duration_sec: number; date_from: string; date_to: string }[];
  const byScreen = new Map<number, typeof own>();
  for (const s of own) {
    if (!byScreen.has(s.screen_id)) byScreen.set(s.screen_id, []);
    byScreen.get(s.screen_id)!.push(s);
  }
  for (const [screenId, slots] of byScreen) {
    const from = slots.reduce((m, s) => (s.date_from < m ? s.date_from : m), slots[0].date_from);
    const to = slots.reduce((m, s) => (s.date_to > m ? s.date_to : m), slots[0].date_to);
    const load = loopLoad(screenId, from, to, campaignId);
    if (!load) return { ok: false, reason: 'Экран не найден' };
    for (const day of load.days) {
      const ownUsed = slots.reduce((a, s) => a + (s.date_from <= day.date && s.date_to >= day.date ? s.duration_sec : 0), 0);
      if (day.used_sec + ownUsed > load.loop_duration_sec) {
        const scr = db.prepare('SELECT code FROM screens WHERE id = ?').get(screenId) as any;
        return {
          ok: false,
          reason: `Экран ${scr?.code}: петля переполнена ${day.date.split('-').reverse().join('.')} — занято ${day.used_sec} сек другими кампаниями + ${ownUsed} сек роликов кампании при петле ${load.loop_duration_sec} сек`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Калькулятор стоимости слота.
 * база = цена_за_секунду × длительность × выходов_в_сутки × дней
 * (если задана только цена за выход — она трактуется как цена 1 выхода 5-секундного ролика)
 * итог = база × коэф_тайм-слота × (1 − скидка%) ; налог считается сверху, если режим с НДС.
 */
export function calcPrice(params: {
  screen_id: number;
  duration_sec: number;
  plays_per_day: number;
  date_from: string;
  date_to: string;
  time_slot_id?: number | null;
  discount_percent?: number;
}) {
  const screen = db.prepare(`
    SELECT s.*, t.rate AS tax_rate, t.name AS tax_name FROM screens s
    LEFT JOIN tax_regimes t ON t.id = s.tax_regime_id WHERE s.id = ?
  `).get(params.screen_id) as any;
  if (!screen) return null;

  const days = eachDay(params.date_from, params.date_to).length;
  const perSec = screen.price_per_sec > 0 ? screen.price_per_sec : screen.price_per_play / 5;
  let coef = 1;
  let timeSlotName: string | null = null;
  if (params.time_slot_id) {
    const ts = db.prepare('SELECT name, price_coef FROM time_slots WHERE id = ?').get(params.time_slot_id) as any;
    if (ts) { coef = ts.price_coef; timeSlotName = ts.name; }
  }
  const base = perSec * params.duration_sec * params.plays_per_day * days;
  const withCoef = base * coef;
  const discountPct = params.discount_percent ?? 0;
  const discountAmount = withCoef * (discountPct / 100);
  const net = withCoef - discountAmount;
  const taxRate = screen.tax_rate ?? 0;
  const tax = net * (taxRate / 100);
  return {
    days,
    price_per_sec: perSec,
    base: Math.round(base * 100) / 100,
    time_slot: timeSlotName,
    coef,
    discount_percent: discountPct,
    discount_amount: Math.round(discountAmount * 100) / 100,
    net: Math.round(net * 100) / 100,
    tax_name: screen.tax_name ?? null,
    tax_rate: taxRate,
    tax: Math.round(tax * 100) / 100,
    total: Math.round((net + tax) * 100) / 100,
  };
}

/** Снятие просроченных броней: campaign.reserve_until < сегодня → cancelled. */
export function expireReservations() {
  db.prepare(`UPDATE campaigns SET status='cancelled', comment=COALESCE(comment,'') || ' [бронь истекла]'
    WHERE status='reserved' AND reserve_until IS NOT NULL AND reserve_until < date('now')`).run();
}

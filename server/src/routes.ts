import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, hashPassword, verifyPassword, UPLOADS_DIR } from './db.js';
import { issueToken, login, requireAuth, requireRole, tenantOf } from './auth.js';
import { loopLoad, checkCapacity, checkCapacityForSlot, checkCampaignCapacity, calcPrice, expireReservations } from './engine.js';
import { writeScreensPdf } from './pdf.js';
import { cloudEnabled, storeUpload, signedUrl, removeStored } from './storage.js';

export const api = Router();

// ---------- Auth ----------
api.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const result = login(String(email ?? ''), String(password ?? ''));
  if (!result) return res.status(401).json({ error: 'Неверный email или пароль' });
  res.json(result);
});

api.use(requireAuth);

api.get('/auth/me', (req, res) => res.json(req.user));

// ---------- Универсальный CRUD для справочников ----------
type DictConfig = { table: string; fields: string[]; adminOnly?: boolean; deleteAdminOnly?: boolean };

/** Продажу правит только администратор: менеджер ведёт черновики и брони. */
function isManager(req: any): boolean {
  return req.user?.role === 'manager';
}
const SOLD_LOCKED = 'Кампания продана — изменить или отменить её может только администратор';
const dicts: Record<string, DictConfig> = {
  cities:       { table: 'cities', fields: ['name', 'region'] },
  'screen-types': { table: 'screen_types', fields: ['name'] },
  'time-slots': { table: 'time_slots', fields: ['name', 'time_from', 'time_to', 'price_coef'] },
  discounts:    { table: 'discounts', fields: ['name', 'percent'] },
  'tax-regimes': { table: 'tax_regimes', fields: ['name', 'rate'] },
  owners:       { table: 'owners', fields: ['name', 'phone', 'email', 'comment'] },
  clients:      { table: 'clients', fields: ['name', 'phone', 'email', 'address', 'contacts', 'comment'], deleteAdminOnly: true },
};

for (const [route, cfg] of Object.entries(dicts)) {
  api.get(`/${route}`, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${cfg.table} WHERE tenant_id = ? ORDER BY id`).all(tenantOf(req));
    res.json(rows);
  });
  api.post(`/${route}`, (req, res) => {
    const cols = cfg.fields.filter((f) => req.body[f] !== undefined);
    const info = db.prepare(
      `INSERT INTO ${cfg.table} (tenant_id${cols.map((c) => ',' + c).join('')}) VALUES (?${cols.map(() => ',?').join('')})`
    ).run(tenantOf(req), ...cols.map((c) => req.body[c]));
    res.json(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(info.lastInsertRowid));
  });
  api.put(`/${route}/:id`, (req, res) => {
    const cols = cfg.fields.filter((f) => req.body[f] !== undefined);
    if (cols.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });
    db.prepare(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id, tenantOf(req));
    res.json(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id));
  });
  const delGuards = cfg.deleteAdminOnly ? [requireRole('admin')] : [];
  api.delete(`/${route}/:id`, ...delGuards, (req, res) => {
    try {
      db.prepare(`DELETE FROM ${cfg.table} WHERE id = ? AND tenant_id = ?`).run(req.params.id, tenantOf(req));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Запись используется и не может быть удалена' });
    }
  });
}

// ---------- Менеджеры и их учётные записи ----------
// Менеджер — это и запись справочника (к ней привязаны кампании), и вход в систему.
// Логин с паролем задаёт администратор: своей регистрации в системе нет.
api.get('/managers', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.email AS login, u.id AS account_id
    FROM managers m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ? ORDER BY m.id
  `).all(tenantOf(req));
  res.json(rows);
});

function emailTaken(email: string, exceptUserId?: number | null): boolean {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
  return !!row && row.id !== exceptUserId;
}

const PASSWORD_MIN = 6;

api.post('/managers', requireRole('admin'), (req, res) => {
  const t = tenantOf(req);
  const { name, phone, email, login, password } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'Укажите ФИО менеджера' });
  if (login && !password) return res.status(400).json({ error: 'Задайте пароль для входа' });
  if (password && String(password).length < PASSWORD_MIN) {
    return res.status(400).json({ error: `Пароль короче ${PASSWORD_MIN} символов` });
  }
  if (login && emailTaken(String(login))) {
    return res.status(409).json({ error: 'Этот логин уже занят' });
  }

  const create = db.transaction(() => {
    let userId: number | null = null;
    if (login && password) {
      userId = db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (?,?,?,?,'manager')`)
        .run(t, String(login), hashPassword(String(password)), name).lastInsertRowid as number;
    }
    const id = db.prepare('INSERT INTO managers (tenant_id,user_id,name,phone,email) VALUES (?,?,?,?,?)')
      .run(t, userId, name, phone ?? null, email ?? null).lastInsertRowid as number;
    return id;
  });
  const id = create();
  res.json(db.prepare('SELECT * FROM managers WHERE id = ?').get(id));
});

api.put('/managers/:id', requireRole('admin'), (req, res) => {
  const t = tenantOf(req);
  const m = db.prepare('SELECT * FROM managers WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!m) return res.status(404).json({ error: 'Менеджер не найден' });
  const { name, phone, email, login, password } = req.body ?? {};
  if (password && String(password).length < PASSWORD_MIN) {
    return res.status(400).json({ error: `Пароль короче ${PASSWORD_MIN} символов` });
  }
  if (login && emailTaken(String(login), m.user_id)) {
    return res.status(409).json({ error: 'Этот логин уже занят' });
  }
  if (login && !m.user_id && !password) {
    return res.status(400).json({ error: 'Для нового входа нужен и логин, и пароль' });
  }

  const update = db.transaction(() => {
    let userId: number | null = m.user_id;
    if (login && !userId) {
      // Учётной записи ещё не было — создаём вместе с первым логином
      userId = db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (?,?,?,?,'manager')`)
        .run(t, String(login), hashPassword(String(password)), name ?? m.name).lastInsertRowid as number;
    } else if (userId) {
      if (login) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(String(login), userId);
      if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), userId);
      if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    }
    db.prepare('UPDATE managers SET name = ?, phone = ?, email = ?, user_id = ? WHERE id = ? AND tenant_id = ?')
      .run(name ?? m.name, phone ?? null, email ?? null, userId, m.id, t);
  });
  update();
  res.json(db.prepare('SELECT * FROM managers WHERE id = ?').get(m.id));
});

api.delete('/managers/:id', requireRole('admin'), (req, res) => {
  const t = tenantOf(req);
  const m = db.prepare('SELECT * FROM managers WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!m) return res.json({ ok: true });
  try {
    // Учётная запись уходит вместе с менеджером, иначе останется живой вход в систему
    const drop = db.transaction(() => {
      db.prepare('DELETE FROM managers WHERE id = ? AND tenant_id = ?').run(m.id, t);
      if (m.user_id) db.prepare('DELETE FROM users WHERE id = ?').run(m.user_id);
    });
    drop();
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'На менеджера оформлены кампании — удаление запрещено' });
  }
});

// ---------- Свой аккаунт ----------
api.get('/account', (req, res) => {
  const row = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.user!.id);
  res.json(row);
});

// Смена email или пароля требует текущий пароль: сессия могла быть перехвачена.
api.put('/account', (req, res) => {
  const { name, email, password, current_password } = req.body ?? {};
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!me) return res.status(404).json({ error: 'Пользователь не найден' });

  const changesEmail = email && email !== me.email;
  if ((changesEmail || password) && !verifyPassword(String(current_password ?? ''), me.password_hash)) {
    return res.status(403).json({ error: 'Неверный текущий пароль' });
  }
  if (password && String(password).length < PASSWORD_MIN) {
    return res.status(400).json({ error: `Пароль короче ${PASSWORD_MIN} символов` });
  }
  if (changesEmail && emailTaken(String(email), me.id)) {
    return res.status(409).json({ error: 'Этот email уже занят' });
  }

  db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?').run(
    name ?? me.name,
    email ?? me.email,
    password ? hashPassword(String(password)) : me.password_hash,
    me.id,
  );
  // Имя и email лежат в токене — выдаём новый, иначе в интерфейсе останутся старые данные
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id) as any;
  res.json(issueToken(fresh));
});

// ---------- Экраны ----------
const SCREEN_FIELDS = ['code','name','side','address','city_id','lat','lng','width_m','height_m','res_w','res_h','pixel_pitch',
  'brightness','screen_type_id','orientation','loop_duration_sec','work_from','work_to','price_per_play','price_per_sec','price_per_sec_month',
  'tax_regime_id','owner_id','status','tags','comment'];

api.get('/screens', (req, res) => {
  expireReservations();
  const t = tenantOf(req);
  const rows = db.prepare(`
    SELECT s.*, c.name AS city_name, c.region, st.name AS type_name, o.name AS owner_name, tr.name AS tax_name
    FROM screens s
    LEFT JOIN cities c ON c.id = s.city_id
    LEFT JOIN screen_types st ON st.id = s.screen_type_id
    LEFT JOIN owners o ON o.id = s.owner_id
    LEFT JOIN tax_regimes tr ON tr.id = s.tax_regime_id
    WHERE s.tenant_id = ? ORDER BY s.code
  `).all(t) as any[];

  // загрузка блока на период (по умолчанию — ближайшие 30 дней)
  const from = String(req.query.from ?? new Date().toISOString().slice(0, 10));
  const toDefault = new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
  const to = String(req.query.to ?? toDefault);
  for (const s of rows) {
    const load = loopLoad(s.id, from, to);
    s.load = load ? { max_load_pct: load.max_load_pct, avg_load_pct: load.avg_load_pct, free_sec: load.free_sec, loop: load.loop_duration_sec } : null;
  }
  res.json(rows);
});

api.get('/screens/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM screens WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantOf(req));
  if (!row) return res.status(404).json({ error: 'Экран не найден' });
  res.json(row);
});

api.post('/screens', requireRole('admin'), (req, res) => {
  const cols = SCREEN_FIELDS.filter((f) => req.body[f] !== undefined);
  const info = db.prepare(
    `INSERT INTO screens (tenant_id${cols.map((c) => ',' + c).join('')}) VALUES (?${cols.map(() => ',?').join('')})`
  ).run(tenantOf(req), ...cols.map((c) => req.body[c]));
  res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(info.lastInsertRowid));
});

api.put('/screens/:id', requireRole('admin'), (req, res) => {
  const cols = SCREEN_FIELDS.filter((f) => req.body[f] !== undefined);
  if (cols.length === 0) return res.status(400).json({ error: 'Нет полей' });
  db.prepare(`UPDATE screens SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
    .run(...cols.map((c) => req.body[c]), req.params.id, tenantOf(req));
  res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id));
});

api.delete('/screens/:id', requireRole('admin'), (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM ad_slots WHERE screen_id = ?').get(req.params.id) as any;
  if (used.c > 0) return res.status(409).json({ error: 'По экрану есть размещения — удаление запрещено' });
  db.prepare('DELETE FROM screens WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
});

// Загрузка блока экрана по датам + текущий плейлист
api.get('/screens/:id/availability', (req, res) => {
  expireReservations();
  const from = String(req.query.from ?? new Date().toISOString().slice(0, 10));
  const to = String(req.query.to ?? from);
  const load = loopLoad(Number(req.params.id), from, to);
  if (!load) return res.status(404).json({ error: 'Экран не найден' });
  res.json(load);
});

// Расписание занятости за год: строки-клиенты с полосами по месяцам + пиковая загрузка блока по клиентам
api.get('/screens/:id/schedule', (req, res) => {
  expireReservations();
  const id = Number(req.params.id);
  const screen = db.prepare('SELECT id, loop_duration_sec FROM screens WHERE id = ? AND tenant_id = ?')
    .get(id, tenantOf(req)) as { id: number; loop_duration_sec: number } | undefined;
  if (!screen) return res.status(404).json({ error: 'Экран не найден' });
  const year = Number(req.query.year) || new Date().getFullYear();
  const yFrom = `${year}-01-01`, yTo = `${year}-12-31`;

  // Все брони/продажи, пересекающиеся с годом (для сетки по месяцам)
  const slots = db.prepare(`
    SELECT s.id, s.campaign_id, s.duration_sec, s.plays_per_day, s.date_from, s.date_to,
           c.number AS campaign_number, c.status, c.client_id, cl.name AS client_name,
           ts.name AS time_slot_name
    FROM ad_slots s
    JOIN campaigns c ON c.id = s.campaign_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN time_slots ts ON ts.id = s.time_slot_id
    WHERE s.screen_id = ? AND c.status IN ('reserved','sold') AND s.date_from <= ? AND s.date_to >= ?
    ORDER BY cl.name, s.date_from
  `).all(id, yTo, yFrom) as any[];

  // Загрузка блока по месяцам считается на клиенте из слотов.
  res.json({ loop_duration_sec: screen.loop_duration_sec, year, slots });
});

// Быстрое бронирование клиента на экране (из окна занятости): создаёт кампанию-бронь + слот
api.post('/screens/:id/book', (req, res) => {
  const t = tenantOf(req);
  const id = Number(req.params.id);
  const screen = db.prepare('SELECT id FROM screens WHERE id = ? AND tenant_id = ?').get(id, t);
  if (!screen) return res.status(404).json({ error: 'Экран не найден' });
  const { client_id, date_from, date_to, duration_sec, plays_per_day, time_slot_id } = req.body ?? {};
  if (!client_id || !date_from || !date_to || !duration_sec) {
    return res.status(400).json({ error: 'Обязательные поля: клиент, период, длительность ролика' });
  }
  if (date_to < date_from) return res.status(400).json({ error: 'Дата окончания раньше даты начала' });

  const check = checkCapacity(id, date_from, date_to, Number(duration_sec));
  if (!check.ok) return res.status(409).json({ error: check.reason });

  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT COUNT(*) c FROM campaigns WHERE tenant_id = ? AND number LIKE ?`).get(t, `${year}-%`) as any;
  const number = `${year}-${String(last.c + 1).padStart(3, '0')}`;
  const campId = db.prepare(`
    INSERT INTO campaigns (tenant_id, number, client_id, status, reserve_until) VALUES (?,?,?,'reserved',NULL)
  `).run(t, number, client_id).lastInsertRowid as number;

  const calc = calcPrice({
    screen_id: id, duration_sec: Number(duration_sec),
    date_from, date_to, time_slot_id: time_slot_id ?? null,
  });
  db.prepare(`
    INSERT INTO ad_slots (tenant_id, campaign_id, screen_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, price)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(t, campId, id, duration_sec, date_from, date_to,
    plays_per_day ?? calc?.plays_per_day ?? 0, time_slot_id ?? null, calc?.total ?? 0);
  res.json({ campaign_id: campId, number });
});

api.get('/screens/:id/playlist', (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const rows = db.prepare(`
    SELECT s.id, s.duration_sec, s.plays_per_day, s.date_from, s.date_to, s.time_slot_id,
           ts.name AS time_slot_name, c.number AS campaign_number, c.status, cl.name AS client_name,
           cr.filename AS creative_name
    FROM ad_slots s
    JOIN campaigns c ON c.id = s.campaign_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN creatives cr ON cr.id = s.creative_id
    LEFT JOIN time_slots ts ON ts.id = s.time_slot_id
    WHERE s.screen_id = ? AND c.status IN ('reserved','sold') AND s.date_from <= ? AND s.date_to >= ?
    ORDER BY s.id
  `).all(req.params.id, date, date);
  res.json(rows);
});

// ---------- Проверка ёмкости и калькулятор ----------
api.post('/capacity/check', (req, res) => {
  const { screen_id, date_from, date_to, duration_sec, exclude_campaign_id, exclude_slot_id } = req.body ?? {};
  // При правке существующего слота исключаем его самого, иначе он попадёт в занятое
  // место и любое изменение выглядело бы переполнением блока.
  if (exclude_slot_id) {
    return res.json(checkCapacityForSlot(
      Number(exclude_slot_id), Number(screen_id), String(date_from), String(date_to), Number(duration_sec)));
  }
  const result = checkCapacity(Number(screen_id), String(date_from), String(date_to), Number(duration_sec), exclude_campaign_id ? Number(exclude_campaign_id) : undefined);
  res.json(result);
});

api.post('/calc/price', (req, res) => {
  const r = calcPrice(req.body);
  if (!r) return res.status(404).json({ error: 'Экран не найден' });
  res.json(r);
});

// Пакетная проверка ёмкости + расчёт цены по списку экранов (для подбора экранов клиенту)
/**
 * Скидка суммой задаётся на всю продажу, а цена считается по каждому экрану.
 * Делим её пропорционально стоимости экранов — тогда сумма частей совпадает
 * с задуманной скидкой, а дешёвый экран не уходит в минус.
 */
function splitDiscount(
  screens: any[],
  base: { date_from: string; date_to: string; time_slot_id?: number | null; discount_percent: number },
  discountSum: number,
  tenantId: number,
): Map<number, number> {
  const shares = new Map<number, number>();
  if (!discountSum || discountSum <= 0) return shares;

  const prices = new Map<number, number>();
  let total = 0;
  for (const s of screens) {
    const screenId = Number(s.screen_id);
    const duration = Number(s.duration_sec);
    if (!duration) continue;
    const exists = db.prepare('SELECT id FROM screens WHERE id = ? AND tenant_id = ?').get(screenId, tenantId);
    if (!exists) continue;
    const calc = calcPrice({
      screen_id: screenId, duration_sec: duration,
      date_from: base.date_from, date_to: base.date_to,
      time_slot_id: base.time_slot_id ?? null, discount_percent: base.discount_percent,
    });
    const net = calc?.net ?? 0;
    prices.set(screenId, net);
    total += net;
  }
  if (total <= 0) return shares;

  const capped = Math.min(discountSum, total);   // больше стоимости скидка быть не может
  for (const [screenId, net] of prices) {
    shares.set(screenId, Math.round(capped * (net / total) * 100) / 100);
  }
  return shares;
}

api.post('/capacity/quote', (req, res) => {
  expireReservations();
  const t = tenantOf(req);
  const { date_from, date_to, plays_per_day, time_slot_id, discount_percent, discount_sum, screens } = req.body ?? {};
  if (!date_from || !date_to) return res.status(400).json({ error: 'Укажите период трансляции' });
  if (date_to < date_from) return res.status(400).json({ error: 'Дата окончания раньше даты начала' });
  if (!Array.isArray(screens)) return res.status(400).json({ error: 'Не передан список экранов' });

  const pct = Number(discount_percent) || 0;
  const shares = splitDiscount(screens, { date_from, date_to, time_slot_id, discount_percent: pct }, Number(discount_sum) || 0, t);

  const items = screens.map((s: any) => {
    const screenId = Number(s.screen_id);
    const duration = Number(s.duration_sec);
    const scr = db.prepare('SELECT id, code FROM screens WHERE id = ? AND tenant_id = ?').get(screenId, t) as any;
    if (!scr) return { screen_id: screenId, ok: false, reason: 'Экран не найден' };
    if (!duration) return { screen_id: screenId, ok: false, reason: 'Не задана длительность ролика' };
    const check = checkCapacity(screenId, date_from, date_to, duration);
    const calc = calcPrice({
      screen_id: screenId, duration_sec: duration,
      date_from, date_to, time_slot_id: time_slot_id ?? null, discount_percent: pct,
      discount_sum: shares.get(screenId) ?? 0,
    });
    return {
      screen_id: screenId, code: scr.code, ok: check.ok, reason: check.reason ?? null,
      load: check.load ?? null, price: calc?.total ?? 0, days: calc?.days ?? 0,
      discount_sum: calc?.discount_sum ?? 0,
    };
  });
  res.json({ items, total: items.reduce((a, i: any) => a + (i.ok ? i.price ?? 0 : 0), 0) });
});

// ---------- Кампании ----------
api.get('/campaigns', (req, res) => {
  expireReservations();
  const rows = db.prepare(`
    SELECT c.*, cl.name AS client_name, m.name AS manager_name, d.name AS discount_name,
      (SELECT COALESCE(SUM(price),0) FROM ad_slots WHERE campaign_id = c.id) AS placement_cost,
      (SELECT COUNT(*) FROM ad_slots WHERE campaign_id = c.id) AS slots_count,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE campaign_id = c.id) AS paid
    FROM campaigns c
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN managers m ON m.id = c.manager_id
    LEFT JOIN discounts d ON d.id = c.discount_id
    WHERE c.tenant_id = ? ORDER BY c.id DESC
  `).all(tenantOf(req));
  res.json(rows);
});

api.get('/campaigns/:id', (req, res) => {
  const c = db.prepare(`
    SELECT c.*, cl.name AS client_name, m.name AS manager_name
    FROM campaigns c
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN managers m ON m.id = c.manager_id
    WHERE c.id = ? AND c.tenant_id = ?
  `).get(req.params.id, tenantOf(req)) as any;
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  c.slots = db.prepare(`
    SELECT s.*, sc.code AS screen_code, sc.name AS screen_name, ts.name AS time_slot_name, cr.filename AS creative_name
    FROM ad_slots s
    JOIN screens sc ON sc.id = s.screen_id
    LEFT JOIN time_slots ts ON ts.id = s.time_slot_id
    LEFT JOIN creatives cr ON cr.id = s.creative_id
    WHERE s.campaign_id = ? ORDER BY s.id
  `).all(c.id);
  c.creatives = db.prepare('SELECT * FROM creatives WHERE campaign_id = ? ORDER BY id').all(c.id);
  c.payments = db.prepare('SELECT * FROM payments WHERE campaign_id = ? ORDER BY pay_date').all(c.id);
  res.json(c);
});

api.post('/campaigns', (req, res) => {
  const t = tenantOf(req);
  const { client_id, manager_id, discount_id, discount_percent, production_cost, comment } = req.body ?? {};
  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT COUNT(*) c FROM campaigns WHERE tenant_id = ? AND number LIKE ?`).get(t, `${year}-%`) as any;
  const number = `${year}-${String(last.c + 1).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO campaigns (tenant_id, number, client_id, manager_id, discount_id, discount_percent, production_cost, comment)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(t, number, client_id ?? null, manager_id ?? null, discount_id ?? null, discount_percent ?? 0, production_cost ?? 0, comment ?? null);
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
});

// Кампания сразу на несколько экранов: клиент + менеджер + скидка + слоты одним действием
api.post('/campaigns/bulk', (req, res) => {
  expireReservations();
  const t = tenantOf(req);
  const {
    client_id, manager_id, discount_id, discount_percent, discount_sum, production_cost, comment,
    date_from, date_to, plays_per_day, time_slot_id, status, screens,
  } = req.body ?? {};

  if (!client_id) return res.status(400).json({ error: 'Выберите клиента' });
  if (!Array.isArray(screens) || screens.length === 0) return res.status(400).json({ error: 'Выберите хотя бы один экран' });
  if (!date_from || !date_to) return res.status(400).json({ error: 'Укажите период трансляции' });
  if (date_to < date_from) return res.status(400).json({ error: 'Дата окончания раньше даты начала' });

  const target = status === 'draft' ? 'draft' : status === 'sold' ? 'sold' : 'reserved';
  const pct = Number(discount_percent) || 0;
  const sum = Number(discount_sum) || 0;

  const items = screens.map((s: any) => ({ screen_id: Number(s.screen_id), duration_sec: Number(s.duration_sec) }));
  for (const it of items) {
    const scr = db.prepare('SELECT id, code FROM screens WHERE id = ? AND tenant_id = ?').get(it.screen_id, t) as any;
    if (!scr) return res.status(404).json({ error: 'Экран не найден' });
    if (!it.duration_sec) return res.status(400).json({ error: `Экран ${scr.code}: не задана длительность ролика` });
    // Черновик ёмкость не удерживает — проверяем при брони и продаже.
    if (target !== 'draft') {
      const check = checkCapacity(it.screen_id, date_from, date_to, it.duration_sec);
      if (!check.ok) return res.status(409).json({ error: `Экран ${scr.code}: ${check.reason}` });
    }
  }

  const create = db.transaction(() => {
    const year = new Date().getFullYear();
    const last = db.prepare(`SELECT COUNT(*) c FROM campaigns WHERE tenant_id = ? AND number LIKE ?`).get(t, `${year}-%`) as any;
    const number = `${year}-${String(last.c + 1).padStart(3, '0')}`;

    let reserveUntil: string | null = null;
    if (target === 'reserved') {
      const cs = db.prepare('SELECT reserve_days FROM company_settings WHERE tenant_id = ?').get(t) as any;
      reserveUntil = new Date(Date.now() + (cs?.reserve_days ?? 3) * 86400000).toISOString().slice(0, 10);
    }

    const campId = db.prepare(`
      INSERT INTO campaigns (tenant_id, number, client_id, manager_id, discount_id, discount_percent, discount_sum, production_cost, comment, status, reserve_until)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(t, number, client_id, manager_id ?? null, discount_id ?? null, pct, sum,
      production_cost ?? 0, comment ?? null, target, reserveUntil).lastInsertRowid as number;

    const insertSlot = db.prepare(`
      INSERT INTO ad_slots (tenant_id, campaign_id, screen_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, discount_sum, price)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    // Скидка суммой делится между экранами пропорционально их стоимости
    const shares = splitDiscount(items, { date_from, date_to, time_slot_id, discount_percent: pct }, sum, t);
    let total = 0;
    for (const it of items) {
      const share = shares.get(it.screen_id) ?? 0;
      const calc = calcPrice({
        screen_id: it.screen_id, duration_sec: it.duration_sec,
        date_from, date_to, time_slot_id: time_slot_id ?? null, discount_percent: pct,
        discount_sum: share,
      });
      const price = calc?.total ?? 0;
      total += price;
      insertSlot.run(t, campId, it.screen_id, it.duration_sec, date_from, date_to,
        plays_per_day ?? calc?.plays_per_day ?? 0, time_slot_id ?? null, share, price);
    }
    return { campaign_id: campId, number, status: target, reserve_until: reserveUntil, slots: items.length, total };
  });

  res.json(create());
});

api.put('/campaigns/:id', (req, res) => {
  const fields = ['client_id','manager_id','discount_id','discount_percent','production_cost','comment'];
  const cols = fields.filter((f) => req.body[f] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE campaigns SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id, tenantOf(req));
  }
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id));
});

// Переходы статуса: draft → reserved → sold; отмена в любой момент.
api.post('/campaigns/:id/status', (req, res) => {
  const t = tenantOf(req);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  const target = String(req.body?.status);
  const allowed: Record<string, string[]> = {
    draft: ['reserved', 'cancelled'],
    reserved: ['sold', 'cancelled', 'draft'],
    sold: ['cancelled'],
    cancelled: ['draft'],
  };
  if (!allowed[c.status]?.includes(target)) {
    return res.status(400).json({ error: `Переход ${c.status} → ${target} недопустим` });
  }
  if (c.status === 'sold' && isManager(req)) return res.status(403).json({ error: SOLD_LOCKED });

  // При активации (бронь/продажа) — агрегатная проверка ёмкости блока по всем слотам кампании.
  if ((target === 'reserved' || target === 'sold') && (c.status === 'draft' || c.status === 'cancelled')) {
    const slotsCount = db.prepare('SELECT COUNT(*) c FROM ad_slots WHERE campaign_id = ?').get(c.id) as any;
    if (slotsCount.c === 0) return res.status(400).json({ error: 'В кампании нет слотов размещения' });
    const check = checkCampaignCapacity(c.id);
    if (!check.ok) return res.status(409).json({ error: check.reason });
  }

  let reserveUntil: string | null = null;
  if (target === 'reserved') {
    const cs = db.prepare('SELECT reserve_days FROM company_settings WHERE tenant_id = ?').get(t) as any;
    const days = cs?.reserve_days ?? 3;
    reserveUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  }
  db.prepare('UPDATE campaigns SET status = ?, reserve_until = ? WHERE id = ?').run(target, reserveUntil, c.id);
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c.id));
});

// Полное удаление кампании вместе со слотами, креативами и платежами.
// Ёмкость блока освобождается сама: слоты исчезают, движок считает по факту.
api.delete('/campaigns/:id', requireRole('admin'), async (req, res) => {
  const t = tenantOf(req);
  const c = db.prepare('SELECT id, number FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });

  // Файлы роликов лежат на диске — каскад по внешнему ключу их не тронет
  const files = db.prepare('SELECT stored_name, storage FROM creatives WHERE campaign_id = ? AND tenant_id = ?')
    .all(c.id, t) as { stored_name: string; storage: string }[];

  const drop = db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE campaign_id = ? AND tenant_id = ?').run(c.id, t);
    // ad_slots и creatives уходят каскадом (ON DELETE CASCADE)
    db.prepare('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?').run(c.id, t);
  });
  drop();

  for (const f of files) await removeStored(f.stored_name, f.storage);
  res.json({ ok: true, number: c.number });
});

// ---------- Слоты размещения ----------
api.post('/campaigns/:id/slots', (req, res) => {
  const t = tenantOf(req);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  const { screen_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, creative_id, price } = req.body ?? {};
  if (!screen_id || !duration_sec || !date_from || !date_to) {
    return res.status(400).json({ error: 'Обязательные поля: экран, длительность, период' });
  }
  if (date_to < date_from) return res.status(400).json({ error: 'Дата окончания раньше даты начала' });

  // Для активных кампаний проверяем ёмкость сразу; для черновика — предупреждаем, но не блокируем.
  // Собственные слоты кампании не исключаем: если кампания активна, они реально занимают блок.
  const check = checkCapacity(Number(screen_id), date_from, date_to, Number(duration_sec));
  if (!check.ok && (c.status === 'reserved' || c.status === 'sold')) {
    return res.status(409).json({ error: check.reason });
  }

  const calc = calcPrice({
    screen_id: Number(screen_id), duration_sec: Number(duration_sec),
    date_from, date_to, time_slot_id: time_slot_id ?? null, discount_percent: c.discount_percent,
  });
  const finalPrice = price ?? calc?.total ?? 0;
  const info = db.prepare(`
    INSERT INTO ad_slots (tenant_id, campaign_id, screen_id, creative_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, price)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(t, c.id, screen_id, creative_id ?? null, duration_sec, date_from, date_to,
    plays_per_day ?? calc?.plays_per_day ?? 0, time_slot_id ?? null, finalPrice);
  res.json({ slot: db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(info.lastInsertRowid), capacity_warning: check.ok ? null : check.reason });
});

/** Слот проданной кампании менеджер не удаляет: это уменьшение продажи. */
function soldSlotBlocked(req: any): boolean {
  if (!isManager(req)) return false;
  const row = db.prepare(`
    SELECT c.status FROM ad_slots s JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.id = ? AND s.tenant_id = ?
  `).get(req.params.id, tenantOf(req)) as any;
  return row?.status === 'sold';
}

// Правка слота: меняются экран, длительность, период, тайм-слот и ролик.
// Цена пересчитывается сама — иначе после смены длительности в кампании
// осталась бы сумма от прежних параметров.
api.put('/slots/:id', (req, res) => {
  expireReservations();
  const t = tenantOf(req);
  const slot = db.prepare(`
    SELECT s.*, c.status, c.discount_percent
    FROM ad_slots s JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.id = ? AND s.tenant_id = ?
  `).get(req.params.id, t) as any;
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const next = {
    screen_id: Number(req.body?.screen_id ?? slot.screen_id),
    duration_sec: Number(req.body?.duration_sec ?? slot.duration_sec),
    date_from: String(req.body?.date_from ?? slot.date_from),
    date_to: String(req.body?.date_to ?? slot.date_to),
    time_slot_id: req.body?.time_slot_id === undefined ? slot.time_slot_id
      : (req.body.time_slot_id ? Number(req.body.time_slot_id) : null),
    creative_id: req.body?.creative_id === undefined ? slot.creative_id
      : (req.body.creative_id ? Number(req.body.creative_id) : null),
  };
  if (!next.duration_sec) return res.status(400).json({ error: 'Укажите длительность ролика' });
  if (next.date_to < next.date_from) return res.status(400).json({ error: 'Дата окончания раньше даты начала' });

  const screen = db.prepare('SELECT id, code FROM screens WHERE id = ? AND tenant_id = ?').get(next.screen_id, t) as any;
  if (!screen) return res.status(404).json({ error: 'Экран не найден' });

  // Черновик и отменённая ёмкость не удерживают — проверяем бронь и продажу
  if (slot.status === 'reserved' || slot.status === 'sold') {
    const check = checkCapacityForSlot(slot.id, next.screen_id, next.date_from, next.date_to, next.duration_sec);
    if (!check.ok) return res.status(409).json({ error: `Экран ${screen.code}: ${check.reason}` });
  }

  const calc = calcPrice({
    screen_id: next.screen_id, duration_sec: next.duration_sec,
    date_from: next.date_from, date_to: next.date_to,
    time_slot_id: next.time_slot_id, discount_percent: slot.discount_percent ?? 0,
    // Скидка суммой закреплена за слотом: при правке длительности она не «тает»
    discount_sum: req.body?.discount_sum !== undefined ? Number(req.body.discount_sum) : (slot.discount_sum ?? 0),
  });
  const price = req.body?.price !== undefined ? Number(req.body.price) : (calc?.total ?? slot.price);

  db.prepare(`
    UPDATE ad_slots SET screen_id = ?, duration_sec = ?, date_from = ?, date_to = ?,
      time_slot_id = ?, creative_id = ?, plays_per_day = ?, discount_sum = ?, price = ?
    WHERE id = ? AND tenant_id = ?
  `).run(next.screen_id, next.duration_sec, next.date_from, next.date_to,
    next.time_slot_id, next.creative_id, calc?.plays_per_day ?? slot.plays_per_day,
    calc?.discount_sum ?? 0, price, slot.id, t);

  res.json(db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(slot.id));
});

api.delete('/slots/:id', (req, res) => {
  if (soldSlotBlocked(req)) return res.status(403).json({ error: SOLD_LOCKED });
  db.prepare('DELETE FROM ad_slots WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
});

// ---------- Креативы ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['video/mp4', 'image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Допустимые форматы: mp4, jpg, png, gif'));
  },
});

api.post('/campaigns/:id/creatives', upload.single('file'), async (req, res) => {
  const t = tenantOf(req);
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const { duration_sec, width, height } = req.body;

  let storage: 's3' | 'local' = 'local';
  try {
    storage = await storeUpload(req.file.filename, req.file.mimetype);
  } catch (e: any) {
    // Файл остался на диске — запись всё равно создаём, ролик не потеряется
    console.error('Не удалось выгрузить креатив в облако:', e?.message ?? e);
  }

  const info = db.prepare(`
    INSERT INTO creatives (tenant_id, campaign_id, filename, stored_name, mime, size_bytes, duration_sec, width, height, storage)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(t, req.params.id, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), req.file.filename,
    req.file.mimetype, req.file.size, duration_sec ?? null, width ?? null, height ?? null, storage);
  res.json(db.prepare('SELECT * FROM creatives WHERE id = ?').get(info.lastInsertRowid));
});

api.get('/creatives/:id/file', async (req, res) => {
  const cr = db.prepare('SELECT * FROM creatives WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantOf(req)) as any;
  if (!cr) return res.status(404).json({ error: 'Не найдено' });
  if (cr.storage === 's3') {
    // Временная ссылка: файл скачивается прямо из облака, минуя наш сервер
    try { return res.redirect(await signedUrl(`uploads/${cr.stored_name}`)); }
    catch (e: any) { return res.status(502).json({ error: `Облако недоступно: ${e?.message ?? e}` }); }
  }
  res.sendFile(path.join(UPLOADS_DIR, cr.stored_name));
});

api.delete('/creatives/:id', async (req, res) => {
  const t = tenantOf(req);
  const cr = db.prepare('SELECT stored_name, storage FROM creatives WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, t) as any;
  db.prepare('UPDATE ad_slots SET creative_id = NULL WHERE creative_id = ? AND tenant_id = ?').run(req.params.id, t);
  db.prepare('DELETE FROM creatives WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  if (cr) await removeStored(cr.stored_name, cr.storage);
  res.json({ ok: true });
});

// ---------- Экспорт инвентаря в Excel ----------
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Доступные столбцы выгрузки: ключ → заголовок, ширина и как достать значение. */
const EXPORT_COLUMNS: Record<string, { title: string; width: number; value: (s: any) => any }> = {
  code:        { title: 'Код', width: 16, value: (s) => s.code },
  name:        { title: 'Название', width: 26, value: (s) => s.name },
  side:        { title: 'Сторона', width: 9, value: (s) => s.side ?? '' },
  region:      { title: 'Область', width: 22, value: (s) => s.region ?? '' },
  city:        { title: 'Город', width: 16, value: (s) => s.city_name ?? '' },
  address:     { title: 'Адрес, направление', width: 34, value: (s) => s.address ?? '' },
  type:        { title: 'Тип экрана', width: 15, value: (s) => s.type_name ?? '' },
  size:        { title: 'Размер, м', width: 12, value: (s) => (s.width_m ? `${s.width_m}×${s.height_m}` : '') },
  resolution:  { title: 'Разрешение, px', width: 15, value: (s) => (s.res_w ? `${s.res_w}×${s.res_h}` : '') },
  pitch:       { title: 'Шаг пикселя', width: 12, value: (s) => s.pixel_pitch ?? '' },
  brightness:  { title: 'Яркость, нит', width: 13, value: (s) => s.brightness ?? '' },
  orientation: { title: 'Ориентация', width: 14, value: (s) => (s.orientation === 'vertical' ? 'Вертикальная' : 'Горизонтальная') },
  loop:        { title: 'Блок, сек', width: 11, value: (s) => s.loop_duration_sec },
  work:        { title: 'Часы работы', width: 14, value: (s) => `${s.work_from}–${s.work_to}` },
  price:       { title: 'Ставка ₽/сек за 30 дн.', width: 21, value: (s) => s.price_per_sec_month },
  price10:     { title: 'Ролик 10 сек / 30 дн., ₽', width: 22, value: (s) => s.price_per_sec_month * 10 },
  tax:         { title: 'Налог', width: 16, value: (s) => s.tax_name ?? '' },
  owner:       { title: 'Владелец', width: 26, value: (s) => s.owner_name ?? '' },
  status:      { title: 'Статус', width: 17, value: (s) => ({ active: 'Активен', maintenance: 'На обслуживании', inactive: 'Отключён' } as any)[s.status] ?? s.status },
  tags:        { title: 'Теги', width: 18, value: (s) => s.tags ?? '' },
  coords:      { title: 'Координаты', width: 20, value: (s) => (s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : '') },
  comment:     { title: 'Комментарий', width: 30, value: (s) => s.comment ?? '' },
};

api.post('/screens/export', async (req, res) => {
  expireReservations();
  const t = tenantOf(req);
  const { screen_ids, columns, months, photo_links } = req.body ?? {};

  const rows = db.prepare(`
    SELECT s.*, c.name AS city_name, c.region, st.name AS type_name,
           o.name AS owner_name, tr.name AS tax_name,
           (SELECT COUNT(*) FROM screen_photos p WHERE p.screen_id = s.id) AS photo_count
    FROM screens s
    LEFT JOIN cities c ON c.id = s.city_id
    LEFT JOIN screen_types st ON st.id = s.screen_type_id
    LEFT JOIN owners o ON o.id = s.owner_id
    LEFT JOIN tax_regimes tr ON tr.id = s.tax_regime_id
    WHERE s.tenant_id = ? ORDER BY s.code
  `).all(t) as any[];

  const ids: number[] | null = Array.isArray(screen_ids) && screen_ids.length > 0 ? screen_ids.map(Number) : null;
  const screens = ids ? rows.filter((s) => ids.includes(s.id)) : rows;
  if (screens.length === 0) return res.status(400).json({ error: 'Нет экранов для выгрузки' });

  const colKeys: string[] = (Array.isArray(columns) && columns.length > 0 ? columns : ['code', 'name', 'side', 'city', 'address'])
    .filter((k: string) => EXPORT_COLUMNS[k]);
  if (!colKeys.includes('code')) colKeys.unshift('code');   // код — обязательный идентификатор строки

  const monthList: { year: number; month: number }[] = Array.isArray(months)
    ? months.map((m: any) => ({ year: Number(m.year), month: Number(m.month) }))
        .filter((m) => m.year > 1970 && m.month >= 1 && m.month <= 12)
        .sort((a, b) => a.year - b.year || a.month - b.month)
    : [];

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LED-List';
  wb.created = new Date();
  const ws = wb.addWorksheet('Адресная программа', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });

  ws.columns = [
    ...colKeys.map((k) => ({ header: EXPORT_COLUMNS[k].title, key: k, width: EXPORT_COLUMNS[k].width })),
    ...(photo_links ? [
      { header: 'Карта', key: '_map', width: 14 },
      { header: 'Фото', key: '_photo', width: 14 },
    ] : []),
    ...monthList.map((m) => ({
      header: `${MONTHS_RU[m.month - 1]} ${m.year}`,
      key: `m${m.year}_${m.month}`,
      width: 15,
    })),
  ];

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12161D' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 30;

  for (const s of screens) {
    const row: any = {};
    for (const k of colKeys) row[k] = EXPORT_COLUMNS[k].value(s);

    if (photo_links) {
      row._map = s.lat != null && s.lng != null
        ? { text: 'Открыть карту', hyperlink: `https://yandex.ru/maps/?pt=${s.lng},${s.lat}&z=17&l=map` }
        : '';
      // Фото отдаются только авторизованным, поэтому ссылка ведёт в приложение, а не на файл:
      // класть токен доступа в файл, который уйдёт по почте, нельзя.
      row._photo = s.photo_count > 0
        ? { text: `Фото (${s.photo_count})`, hyperlink: `${req.protocol}://${req.get('host')}/screens?screen=${s.id}` }
        : '';
    }

    // Загрузка блока по выбранным месяцам: пиковый день месяца
    for (const m of monthList) {
      const from = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
      const last = new Date(m.year, m.month, 0).getDate();
      const to = `${m.year}-${String(m.month).padStart(2, '0')}-${last}`;
      const load = loopLoad(s.id, from, to);
      row[`m${m.year}_${m.month}`] = load ? `${load.max_load_pct}% · своб. ${load.free_sec} сек` : '';
    }
    ws.addRow(row);
  }

  // Оформление: рамки, выравнивание, заливка месячных ячеек по уровню загрузки
  const monthStart = colKeys.length + (photo_links ? 2 : 0) + 1;
  ws.eachRow((row, i) => {
    row.eachCell((cell, col) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDE1E9' } },
        left: { style: 'thin', color: { argb: 'FFDDE1E9' } },
        bottom: { style: 'thin', color: { argb: 'FFDDE1E9' } },
        right: { style: 'thin', color: { argb: 'FFDDE1E9' } },
      };
      if (i === 1) return;
      cell.alignment = { vertical: 'middle', wrapText: col <= colKeys.length };
      if (col >= monthStart) {
        const pct = Number(String(cell.value ?? '').split('%')[0]);
        if (!Number.isNaN(pct)) {
          const argb = pct >= 95 ? 'FFF6D6D6' : pct >= 70 ? 'FFFDEBC8' : pct > 0 ? 'FFD9F0DC' : 'FFF3F5F8';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      }
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colKeys.length } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// Прайс выбранных экранов в PDF: страница A4 на экран
api.post('/screens/export-pdf', async (req, res) => {
  const t = tenantOf(req);
  const ids = Array.isArray(req.body?.screen_ids) && req.body.screen_ids.length
    ? req.body.screen_ids.map(Number) : null;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="price.pdf"');
  const written = await writeScreensPdf(res, t, ids, { summary: req.body?.summary !== false });
  if (written === null && !res.headersSent) res.status(400).json({ error: 'Нет экранов для прайса' });
});

// ---------- Фотографии экрана ----------
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `scr-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Допустимые форматы фото: jpg, png, webp'));
  },
});

api.get('/screens/:id/photos', (req, res) => {
  const rows = db.prepare(`
    SELECT id, filename, mime, size_bytes, sort_order, uploaded_at
    FROM screen_photos WHERE screen_id = ? AND tenant_id = ?
    ORDER BY sort_order, id
  `).all(req.params.id, tenantOf(req));
  res.json(rows);
});

api.post('/screens/:id/photos', requireRole('admin'), photoUpload.single('file'), async (req, res) => {
  const t = tenantOf(req);
  const screen = db.prepare('SELECT id FROM screens WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!screen) return res.status(404).json({ error: 'Экран не найден' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM screen_photos WHERE screen_id = ?')
    .get(req.params.id) as any;

  let storage: 's3' | 'local' = 'local';
  try {
    storage = await storeUpload(req.file.filename, req.file.mimetype);
  } catch (e: any) {
    console.error('Не удалось выгрузить фото в облако:', e?.message ?? e);
  }

  const info = db.prepare(`
    INSERT INTO screen_photos (tenant_id, screen_id, filename, stored_name, mime, size_bytes, sort_order, storage)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(t, req.params.id, Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
    req.file.filename, req.file.mimetype, req.file.size, next.n, storage);
  res.json(db.prepare('SELECT id, filename, mime, size_bytes, sort_order FROM screen_photos WHERE id = ?')
    .get(info.lastInsertRowid));
});

api.get('/photos/:id/file', async (req, res) => {
  const p = db.prepare('SELECT stored_name, storage FROM screen_photos WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, tenantOf(req)) as any;
  if (!p) return res.status(404).json({ error: 'Не найдено' });
  if (p.storage === 's3') {
    try { return res.redirect(await signedUrl(`uploads/${p.stored_name}`)); }
    catch (e: any) { return res.status(502).json({ error: `Облако недоступно: ${e?.message ?? e}` }); }
  }
  res.sendFile(path.join(UPLOADS_DIR, p.stored_name));
});

// Сделать фото главным: уходит в начало списка
api.post('/photos/:id/primary', requireRole('admin'), (req, res) => {
  const t = tenantOf(req);
  const p = db.prepare('SELECT screen_id FROM screen_photos WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!p) return res.status(404).json({ error: 'Не найдено' });
  const min = db.prepare('SELECT COALESCE(MIN(sort_order), 0) AS n FROM screen_photos WHERE screen_id = ?')
    .get(p.screen_id) as any;
  db.prepare('UPDATE screen_photos SET sort_order = ? WHERE id = ?').run(min.n - 1, req.params.id);
  res.json({ ok: true });
});

api.delete('/photos/:id', requireRole('admin'), async (req, res) => {
  const t = tenantOf(req);
  const p = db.prepare('SELECT stored_name, storage FROM screen_photos WHERE id = ? AND tenant_id = ?').get(req.params.id, t) as any;
  if (!p) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('DELETE FROM screen_photos WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  await removeStored(p.stored_name, p.storage);
  res.json({ ok: true });
});

// ---------- Платежи ----------
api.get('/payments', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.number AS campaign_number, cl.name AS client_name
    FROM payments p
    JOIN campaigns c ON c.id = p.campaign_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    WHERE p.tenant_id = ? ORDER BY p.pay_date DESC, p.id DESC
  `).all(tenantOf(req));
  res.json(rows);
});

api.post('/payments', (req, res) => {
  const { campaign_id, pay_date, amount, method, comment } = req.body ?? {};
  if (!campaign_id || !amount) return res.status(400).json({ error: 'Укажите кампанию и сумму' });
  const info = db.prepare(`INSERT INTO payments (tenant_id, campaign_id, pay_date, amount, method, comment) VALUES (?,?,?,?,?,?)`)
    .run(tenantOf(req), campaign_id, pay_date ?? new Date().toISOString().slice(0, 10), amount, method ?? 'bank', comment ?? null);
  res.json(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid));
});

api.delete('/payments/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
});

// ---------- Настройки компании ----------
api.get('/settings/company', (req, res) => {
  res.json(db.prepare('SELECT * FROM company_settings WHERE tenant_id = ?').get(tenantOf(req)) ?? {});
});

api.put('/settings/company', requireRole('admin'), (req, res) => {
  const t = tenantOf(req);
  const fields = ['legal_name', 'inn', 'address', 'phone', 'email', 'reserve_days', 'columns_config'];
  const cols = fields.filter((f) => req.body[f] !== undefined);
  db.prepare(`INSERT INTO company_settings (tenant_id) VALUES (?) ON CONFLICT(tenant_id) DO NOTHING`).run(t);
  if (cols.length) {
    db.prepare(`UPDATE company_settings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE tenant_id = ?`)
      .run(...cols.map((c) => req.body[c]), t);
  }
  res.json(db.prepare('SELECT * FROM company_settings WHERE tenant_id = ?').get(t));
});

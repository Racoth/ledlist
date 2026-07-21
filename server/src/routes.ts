import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, hashPassword, UPLOADS_DIR } from './db.js';
import { login, requireAuth, requireRole, tenantOf } from './auth.js';
import { loopLoad, checkCapacity, checkCampaignCapacity, calcPrice, expireReservations } from './engine.js';

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
type DictConfig = { table: string; fields: string[]; adminOnly?: boolean };
const dicts: Record<string, DictConfig> = {
  cities:       { table: 'cities', fields: ['name', 'region'] },
  'screen-types': { table: 'screen_types', fields: ['name'] },
  'time-slots': { table: 'time_slots', fields: ['name', 'time_from', 'time_to', 'price_coef'] },
  discounts:    { table: 'discounts', fields: ['name', 'percent'] },
  'tax-regimes': { table: 'tax_regimes', fields: ['name', 'rate'] },
  owners:       { table: 'owners', fields: ['name', 'phone', 'email', 'comment'] },
  clients:      { table: 'clients', fields: ['name', 'phone', 'email', 'address', 'contacts', 'comment'] },
  managers:     { table: 'managers', fields: ['name', 'phone', 'email', 'user_id'] },
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
  api.delete(`/${route}/:id`, (req, res) => {
    try {
      db.prepare(`DELETE FROM ${cfg.table} WHERE id = ? AND tenant_id = ?`).run(req.params.id, tenantOf(req));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Запись используется и не может быть удалена' });
    }
  });
}

// ---------- Экраны ----------
const SCREEN_FIELDS = ['code','name','side','address','city_id','lat','lng','width_m','height_m','res_w','res_h','pixel_pitch',
  'brightness','screen_type_id','orientation','loop_duration_sec','work_from','work_to','price_per_play','price_per_sec',
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

  // загрузка петли на период (по умолчанию — ближайшие 30 дней)
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

api.post('/screens', requireRole('admin', 'superadmin'), (req, res) => {
  const cols = SCREEN_FIELDS.filter((f) => req.body[f] !== undefined);
  const info = db.prepare(
    `INSERT INTO screens (tenant_id${cols.map((c) => ',' + c).join('')}) VALUES (?${cols.map(() => ',?').join('')})`
  ).run(tenantOf(req), ...cols.map((c) => req.body[c]));
  res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(info.lastInsertRowid));
});

api.put('/screens/:id', requireRole('admin', 'superadmin'), (req, res) => {
  const cols = SCREEN_FIELDS.filter((f) => req.body[f] !== undefined);
  if (cols.length === 0) return res.status(400).json({ error: 'Нет полей' });
  db.prepare(`UPDATE screens SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
    .run(...cols.map((c) => req.body[c]), req.params.id, tenantOf(req));
  res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id));
});

api.delete('/screens/:id', requireRole('admin', 'superadmin'), (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM ad_slots WHERE screen_id = ?').get(req.params.id) as any;
  if (used.c > 0) return res.status(409).json({ error: 'По экрану есть размещения — удаление запрещено' });
  db.prepare('DELETE FROM screens WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
});

// Загрузка петли экрана по датам + текущий плейлист
api.get('/screens/:id/availability', (req, res) => {
  expireReservations();
  const from = String(req.query.from ?? new Date().toISOString().slice(0, 10));
  const to = String(req.query.to ?? from);
  const load = loopLoad(Number(req.params.id), from, to);
  if (!load) return res.status(404).json({ error: 'Экран не найден' });
  res.json(load);
});

// Расписание занятости за год: строки-клиенты с полосами по месяцам + пиковая загрузка петли по клиентам
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

  // Пиковый день: максимум одновременно занятых секунд петли за год
  let peakDate = yFrom, peakUsed = -1, peakSlots: any[] = [];
  const d = new Date(yFrom + 'T00:00:00'), end = new Date(yTo + 'T00:00:00');
  for (let i = 0; d <= end && i < 366; i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const active = slots.filter((s) => s.date_from <= iso && s.date_to >= iso);
    const used = active.reduce((a, s) => a + s.duration_sec, 0);
    if (used > peakUsed) { peakUsed = used; peakDate = iso; peakSlots = active; }
    d.setDate(d.getDate() + 1);
  }
  if (peakUsed < 0) peakUsed = 0;

  res.json({
    loop_duration_sec: screen.loop_duration_sec,
    year,
    slots,
    peak: {
      date: peakDate,
      used_sec: peakUsed,
      free_sec: Math.max(0, screen.loop_duration_sec - peakUsed),
      segments: peakSlots.map((s) => ({
        client_name: s.client_name ?? 'Без клиента',
        duration_sec: s.duration_sec,
        campaign_id: s.campaign_id,
        status: s.status,
      })),
    },
  });
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
    screen_id: id, duration_sec: Number(duration_sec), plays_per_day: Number(plays_per_day ?? 0),
    date_from, date_to, time_slot_id: time_slot_id ?? null,
  });
  db.prepare(`
    INSERT INTO ad_slots (tenant_id, campaign_id, screen_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, price)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(t, campId, id, duration_sec, date_from, date_to, plays_per_day ?? 0, time_slot_id ?? null, calc?.total ?? 0);
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
  const { screen_id, date_from, date_to, duration_sec, exclude_campaign_id } = req.body ?? {};
  const result = checkCapacity(Number(screen_id), String(date_from), String(date_to), Number(duration_sec), exclude_campaign_id ? Number(exclude_campaign_id) : undefined);
  res.json(result);
});

api.post('/calc/price', (req, res) => {
  const r = calcPrice(req.body);
  if (!r) return res.status(404).json({ error: 'Экран не найден' });
  res.json(r);
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

  // При активации (бронь/продажа) — агрегатная проверка ёмкости петли по всем слотам кампании.
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

api.delete('/campaigns/:id', requireRole('admin', 'superadmin'), (req, res) => {
  db.prepare('DELETE FROM payments WHERE campaign_id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  db.prepare('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
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
  // Собственные слоты кампании не исключаем: если кампания активна, они реально занимают петлю.
  const check = checkCapacity(Number(screen_id), date_from, date_to, Number(duration_sec));
  if (!check.ok && (c.status === 'reserved' || c.status === 'sold')) {
    return res.status(409).json({ error: check.reason });
  }

  let finalPrice = price;
  if (finalPrice === undefined || finalPrice === null) {
    const calc = calcPrice({
      screen_id: Number(screen_id), duration_sec: Number(duration_sec), plays_per_day: Number(plays_per_day ?? 0),
      date_from, date_to, time_slot_id: time_slot_id ?? null, discount_percent: c.discount_percent,
    });
    finalPrice = calc?.total ?? 0;
  }
  const info = db.prepare(`
    INSERT INTO ad_slots (tenant_id, campaign_id, screen_id, creative_id, duration_sec, date_from, date_to, plays_per_day, time_slot_id, price)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(t, c.id, screen_id, creative_id ?? null, duration_sec, date_from, date_to, plays_per_day ?? 0, time_slot_id ?? null, finalPrice);
  res.json({ slot: db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(info.lastInsertRowid), capacity_warning: check.ok ? null : check.reason });
});

api.put('/slots/:id', (req, res) => {
  const fields = ['creative_id', 'duration_sec', 'date_from', 'date_to', 'plays_per_day', 'time_slot_id', 'price'];
  const cols = fields.filter((f) => req.body[f] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE ad_slots SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id, tenantOf(req));
  }
  res.json(db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(req.params.id));
});

api.delete('/slots/:id', (req, res) => {
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

api.post('/campaigns/:id/creatives', upload.single('file'), (req, res) => {
  const t = tenantOf(req);
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const { duration_sec, width, height } = req.body;
  const info = db.prepare(`
    INSERT INTO creatives (tenant_id, campaign_id, filename, stored_name, mime, size_bytes, duration_sec, width, height)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(t, req.params.id, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), req.file.filename,
    req.file.mimetype, req.file.size, duration_sec ?? null, width ?? null, height ?? null);
  res.json(db.prepare('SELECT * FROM creatives WHERE id = ?').get(info.lastInsertRowid));
});

api.get('/creatives/:id/file', (req, res) => {
  const cr = db.prepare('SELECT * FROM creatives WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantOf(req)) as any;
  if (!cr) return res.status(404).json({ error: 'Не найдено' });
  res.sendFile(path.join(UPLOADS_DIR, cr.stored_name));
});

api.delete('/creatives/:id', (req, res) => {
  db.prepare('UPDATE ad_slots SET creative_id = NULL WHERE creative_id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  db.prepare('DELETE FROM creatives WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
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

api.delete('/payments/:id', requireRole('admin', 'superadmin'), (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantOf(req));
  res.json({ ok: true });
});

// ---------- Подписки (суперадмин) ----------
api.get('/tenants', requireRole('superadmin'), (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM screens WHERE tenant_id = t.id) AS screens_count,
      (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) AS users_count
    FROM tenants t ORDER BY t.id
  `).all();
  res.json(rows);
});

api.post('/tenants', requireRole('superadmin'), (req, res) => {
  const { name, inn, contact_email, expires_at, admin_email, admin_password } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const info = db.prepare(`INSERT INTO tenants (name, inn, contact_email, expires_at) VALUES (?,?,?,?)`)
    .run(name, inn ?? null, contact_email ?? null, expires_at ?? null);
  const tid = info.lastInsertRowid as number;
  db.prepare(`INSERT INTO company_settings (tenant_id, legal_name) VALUES (?,?)`).run(tid, name);
  if (admin_email && admin_password) {
    db.prepare(`INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES (?,?,?,?,'admin')`)
      .run(tid, admin_email, hashPassword(admin_password), 'Администратор');
  }
  res.json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid));
});

api.put('/tenants/:id', requireRole('superadmin'), (req, res) => {
  const fields = ['name', 'inn', 'contact_email', 'expires_at', 'active'];
  const cols = fields.filter((f) => req.body[f] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE tenants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id);
  }
  res.json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id));
});

// ---------- Настройки компании ----------
api.get('/settings/company', (req, res) => {
  res.json(db.prepare('SELECT * FROM company_settings WHERE tenant_id = ?').get(tenantOf(req)) ?? {});
});

api.put('/settings/company', requireRole('admin', 'superadmin'), (req, res) => {
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

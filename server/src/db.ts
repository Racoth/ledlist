import Database from 'better-sqlite3';
import { scryptSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const db = new Database(path.join(DATA_DIR, 'led.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return scryptSync(password, salt, 32).toString('hex') === hash;
}

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  inn TEXT,
  contact_email TEXT,
  registered_at TEXT NOT NULL DEFAULT (date('now')),
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','manager'))
);

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  region TEXT
);

CREATE TABLE IF NOT EXISTS screen_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  price_coef REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  percent REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_regimes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT, email TEXT, comment TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT,
  contacts TEXT NOT NULL DEFAULT '[]',
  comment TEXT
);

CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT, email TEXT
);

CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  city_id INTEGER REFERENCES cities(id),
  lat REAL, lng REAL,
  width_m REAL, height_m REAL,
  res_w INTEGER, res_h INTEGER,
  pixel_pitch TEXT,
  brightness INTEGER,
  screen_type_id INTEGER REFERENCES screen_types(id),
  orientation TEXT NOT NULL DEFAULT 'horizontal' CHECK (orientation IN ('horizontal','vertical')),
  loop_duration_sec INTEGER NOT NULL DEFAULT 60,
  work_from TEXT NOT NULL DEFAULT '06:00',
  work_to TEXT NOT NULL DEFAULT '24:00',
  price_per_play REAL NOT NULL DEFAULT 0,
  price_per_sec REAL NOT NULL DEFAULT 0,
  tax_regime_id INTEGER REFERENCES tax_regimes(id),
  owner_id INTEGER REFERENCES owners(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  tags TEXT,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  number TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  manager_id INTEGER REFERENCES managers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reserved','sold','cancelled')),
  reserve_until TEXT,
  discount_id INTEGER REFERENCES discounts(id),
  discount_percent REAL NOT NULL DEFAULT 0,
  production_cost REAL NOT NULL DEFAULT 0,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  duration_sec REAL,
  width INTEGER, height INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ad_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  screen_id INTEGER NOT NULL REFERENCES screens(id),
  creative_id INTEGER REFERENCES creatives(id),
  duration_sec INTEGER NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  plays_per_day INTEGER NOT NULL DEFAULT 0,
  time_slot_id INTEGER REFERENCES time_slots(id),
  price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  pay_date TEXT NOT NULL DEFAULT (date('now')),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('bank','cash','card')),
  comment TEXT
);

CREATE TABLE IF NOT EXISTS company_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),
  legal_name TEXT, inn TEXT, address TEXT, phone TEXT, email TEXT,
  reserve_days INTEGER NOT NULL DEFAULT 3,
  columns_config TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_slots_screen ON ad_slots(screen_id, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_screens_tenant ON screens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
`);

// ---------- Seed ----------
const hasUsers = db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
if (hasUsers.c === 0) {
  const seed = db.transaction(() => {
    db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (NULL,?,?,?,'superadmin')`)
      .run('admin@platform.ru', hashPassword('admin'), 'Суперадмин платформы');

    const t1 = db.prepare(`INSERT INTO tenants (name,inn,contact_email,registered_at,expires_at) VALUES (?,?,?,?,?)`)
      .run('ООО «ГородМедиа»', '2013001122', 'admin@gorodmedia.ru', '2025-11-01', '2027-11-01').lastInsertRowid as number;
    const t2 = db.prepare(`INSERT INTO tenants (name,inn,contact_email,registered_at,expires_at) VALUES (?,?,?,?,?)`)
      .run('ООО «Экран-Юг»', '6167004455', 'info@ekran-ug.ru', '2026-02-15', '2027-02-15').lastInsertRowid as number;

    db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (?,?,?,?,'admin')`)
      .run(t1, 'admin@gorodmedia.ru', hashPassword('admin'), 'Ахмед Дааев');
    const mgrUser = db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (?,?,?,?,'manager')`)
      .run(t1, 'manager@gorodmedia.ru', hashPassword('manager'), 'Мадина Исаева').lastInsertRowid as number;
    db.prepare(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES (?,?,?,?,'admin')`)
      .run(t2, 'admin@ekran-ug.ru', hashPassword('admin'), 'Сергей Волков');

    db.prepare(`INSERT INTO company_settings (tenant_id,legal_name,inn,phone,email,reserve_days) VALUES (?,?,?,?,?,3)`)
      .run(t1, 'ООО «ГородМедиа»', '2013001122', '+7 (871) 222-33-44', 'admin@gorodmedia.ru');
    db.prepare(`INSERT INTO company_settings (tenant_id,legal_name,reserve_days) VALUES (?,?,3)`).run(t2, 'ООО «Экран-Юг»');

    const city = db.prepare(`INSERT INTO cities (tenant_id,name,region) VALUES (?,?,?)`);
    const cGrz = city.run(t1, 'Грозный', 'Чеченская Республика').lastInsertRowid as number;
    const cArg = city.run(t1, 'Аргун', 'Чеченская Республика').lastInsertRowid as number;
    const cGud = city.run(t1, 'Гудермес', 'Чеченская Республика').lastInsertRowid as number;
    city.run(t2, 'Ростов-на-Дону', 'Ростовская область');

    const st = db.prepare(`INSERT INTO screen_types (tenant_id,name) VALUES (?,?)`);
    const stOut = st.run(t1, 'Уличный').lastInsertRowid as number;
    const stIn = st.run(t1, 'Внутренний').lastInsertRowid as number;
    const stMedia = st.run(t1, 'Медиафасад').lastInsertRowid as number;
    st.run(t2, 'Уличный');

    const ts = db.prepare(`INSERT INTO time_slots (tenant_id,name,time_from,time_to,price_coef) VALUES (?,?,?,?,?)`);
    ts.run(t1, 'Утро', '06:00', '12:00', 0.8);
    const tsDay = ts.run(t1, 'День', '12:00', '18:00', 1.0).lastInsertRowid as number;
    ts.run(t1, 'Вечер', '18:00', '24:00', 1.2);
    const tsPrime = ts.run(t1, 'Прайм-тайм', '19:00', '22:00', 1.5).lastInsertRowid as number;

    const disc = db.prepare(`INSERT INTO discounts (tenant_id,name,percent) VALUES (?,?,?)`);
    disc.run(t1, 'Партнёрская', 10);
    const dVol = disc.run(t1, 'Объёмная', 15).lastInsertRowid as number;
    disc.run(t1, 'Сезонная', 20);
    disc.run(t1, 'Индивидуальная', 5);

    const tax = db.prepare(`INSERT INTO tax_regimes (tenant_id,name,rate) VALUES (?,?,?)`);
    const taxUsn = tax.run(t1, 'УСН 6%', 0).lastInsertRowid as number;
    const taxNds = tax.run(t1, 'ОСН (НДС 20%)', 20).lastInsertRowid as number;
    tax.run(t1, 'Без налога', 0);

    const own = db.prepare(`INSERT INTO owners (tenant_id,name,phone,email,comment) VALUES (?,?,?,?,?)`);
    const o1 = own.run(t1, 'ООО «ГородМедиа» (собственные)', '+7 (871) 222-33-44', 'admin@gorodmedia.ru', null).lastInsertRowid as number;
    const o2 = own.run(t1, 'ИП Магомадов Р.С.', '+7 (928) 111-22-33', 'magomadov@mail.ru', 'Агентская схема 15%').lastInsertRowid as number;

    const mgr = db.prepare(`INSERT INTO managers (tenant_id,user_id,name,phone,email) VALUES (?,?,?,?,?)`);
    const m1 = mgr.run(t1, mgrUser, 'Мадина Исаева', '+7 (928) 555-66-77', 'manager@gorodmedia.ru').lastInsertRowid as number;
    const m2 = mgr.run(t1, null, 'Тимур Эльдаров', '+7 (928) 777-88-99', 'eldarov@gorodmedia.ru').lastInsertRowid as number;

    const cl = db.prepare(`INSERT INTO clients (tenant_id,name,phone,email,address,contacts) VALUES (?,?,?,?,?,?)`);
    const cl1 = cl.run(t1, 'ООО «Лидер-Авто»', '+7 (871) 233-44-55', 'ad@lider-avto.ru', 'г. Грозный, пр. Кадырова, 12',
      JSON.stringify([{ name: 'Руслан', position: 'Директор по маркетингу', phone: '+7 (928) 001-02-03' }])).lastInsertRowid as number;
    const cl2 = cl.run(t1, 'Сеть «Беркат»', '+7 (871) 244-55-66', 'reklama@berkat.ru', 'г. Грозный, ул. Мира, 30', '[]').lastInsertRowid as number;
    const cl3 = cl.run(t1, 'Фитнес-клуб «Атлант»', '+7 (928) 333-22-11', 'atlant@fitness.ru', 'г. Аргун, ул. Шоссейная, 5', '[]').lastInsertRowid as number;

    const scr = db.prepare(`INSERT INTO screens (tenant_id,code,name,address,city_id,lat,lng,width_m,height_m,res_w,res_h,pixel_pitch,brightness,screen_type_id,orientation,loop_duration_sec,work_from,work_to,price_per_play,price_per_sec,tax_regime_id,owner_id,status,tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const s1 = scr.run(t1, 'GRZLED04001', 'Экран «Центр»', 'пр. Кадырова / ул. Мира', cGrz, 43.3119, 45.6889, 6, 3, 1152, 576, 'P5.2', 5500, stOut, 'horizontal', 60, '06:00', '24:00', 15, 3, taxUsn, o1, 'active', 'центр,трафик').lastInsertRowid as number;
    const s2 = scr.run(t1, 'GRZLED04002', 'Экран «Беркат»', 'ул. Мира, рынок Беркат', cGrz, 43.3178, 45.6949, 4, 3, 768, 576, 'P5.2', 5000, stOut, 'horizontal', 60, '07:00', '23:00', 12, 2.4, taxUsn, o1, 'active', 'рынок').lastInsertRowid as number;
    const s3 = scr.run(t1, 'GRZLED04003', 'Медиафасад «Грозный-Сити»', 'пр. Кадырова, Грозный-Сити', cGrz, 43.3168, 45.6947, 12, 20, 960, 1600, 'P12.5', 6500, stMedia, 'vertical', 120, '08:00', '24:00', 40, 8, taxNds, o1, 'active', 'премиум,имидж').lastInsertRowid as number;
    const s4 = scr.run(t1, 'ARGLED01001', 'Экран «Аргун-Сити»', 'ул. Шоссейная, в/д ТЦ', cArg, 43.2903, 45.8743, 6, 3, 1152, 576, 'P6.6', 5000, stOut, 'horizontal', 60, '06:00', '23:00', 10, 2, taxUsn, o2, 'active', null).lastInsertRowid as number;
    const s5 = scr.run(t1, 'GUDLED02001', 'Экран «Вокзал»', 'Привокзальная площадь', cGud, 43.3506, 46.1039, 4, 3, 768, 576, 'P6.6', 4500, stOut, 'horizontal', 45, '06:00', '22:00', 8, 1.6, taxUsn, o2, 'maintenance', null).lastInsertRowid as number;
    scr.run(t1, 'GRZLED04004', 'Видеостена ТЦ «Гранд Парк»', 'ул. Мира, ТЦ Гранд Парк, атриум', cGrz, 43.3140, 45.6920, 3, 2, 1920, 1080, 'P2.5', 1200, stIn, 'horizontal', 90, '10:00', '22:00', 6, 1.2, taxUsn, o1, 'active', 'indoor,тц');

    // demo campaigns
    const camp = db.prepare(`INSERT INTO campaigns (tenant_id,number,client_id,manager_id,created_at,status,reserve_until,discount_id,discount_percent,production_cost) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const slot = db.prepare(`INSERT INTO ad_slots (tenant_id,campaign_id,screen_id,duration_sec,date_from,date_to,plays_per_day,time_slot_id,price) VALUES (?,?,?,?,?,?,?,?,?)`);

    const k1 = camp.run(t1, '2026-041', cl1, m1, '2026-06-25 11:20', 'sold', null, null, 0, 15000).lastInsertRowid as number;
    slot.run(t1, k1, s1, 10, '2026-07-01', '2026-07-31', 720, null, 111600);
    slot.run(t1, k1, s3, 15, '2026-07-01', '2026-07-31', 480, tsPrime, 267840);
    db.prepare(`INSERT INTO payments (tenant_id,campaign_id,pay_date,amount,method,comment) VALUES (?,?,?,?,?,?)`)
      .run(t1, k1, '2026-06-28', 394440, 'bank', 'Оплата по счёту №41');

    const k2 = camp.run(t1, '2026-042', cl2, m1, '2026-07-02 09:05', 'sold', null, dVol, 15, 0).lastInsertRowid as number;
    slot.run(t1, k2, s1, 5, '2026-07-10', '2026-08-10', 1080, null, 76500);
    slot.run(t1, k2, s2, 5, '2026-07-10', '2026-08-10', 1080, null, 61200);
    db.prepare(`INSERT INTO payments (tenant_id,campaign_id,pay_date,amount,method) VALUES (?,?,?,?,?)`)
      .run(t1, k2, '2026-07-05', 70000, 'bank');

    const k3 = camp.run(t1, '2026-043', cl3, m2, '2026-07-15 16:40', 'reserved', '2026-07-24', null, 0, 8000).lastInsertRowid as number;
    slot.run(t1, k3, s4, 10, '2026-07-20', '2026-08-20', 600, tsDay, 64000);

    camp.run(t1, '2026-044', cl1, m2, '2026-07-18 10:00', 'draft', null, null, 0, 0);
  });
  seed();
  console.log('База создана и наполнена демо-данными.');
}

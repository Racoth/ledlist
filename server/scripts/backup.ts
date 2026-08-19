// Резервная копия БД через встроенный backup API better-sqlite3 —
// безопасен при активном WAL-режиме (не хватает захвата «на лету», как cp файла).
// Запуск: node_modules/.bin/tsx scripts/backup.ts
// Крон: 0 3 * * * cd /var/www/led-list/server && node_modules/.bin/tsx scripts/backup.ts >> /var/log/led-list-backup.log 2>&1
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../src/db.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(BACKUP_DIR, `led-${stamp}.db`);

await db.backup(dest);
console.log(`Бэкап сохранён: ${dest}`);

// Храним последние 14 копий, старые удаляем
const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
for (const f of files.slice(0, -14)) fs.unlinkSync(path.join(BACKUP_DIR, f));

process.exit(0);

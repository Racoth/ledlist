// Резервная копия БД через встроенный backup API better-sqlite3 —
// безопасен при активном WAL-режиме (в отличие от копирования файла «на ходу»).
// Если настроено облако, копия сразу уезжает туда: бэкап на том же диске
// не спасает от потери самого сервера.
// Запуск: node_modules/.bin/tsx scripts/backup.ts
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { cloudEnabled, putFile, listKeys, deleteObject } from '../src/storage.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(BACKUP_DIR, `led-${stamp}.db`);

await db.backup(dest);
console.log(`Бэкап сохранён: ${dest}`);

// Храним последние 14 копий на диске, старые удаляем
const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
for (const f of files.slice(0, -14)) fs.unlinkSync(path.join(BACKUP_DIR, f));

// В облаке держим больше — место там дешёвое, а история глубже полезнее
const CLOUD_KEEP = Number(process.env.BACKUP_KEEP_CLOUD ?? 60);
if (cloudEnabled) {
  const key = `backups/${path.basename(dest)}`;
  await putFile(dest, key, 'application/x-sqlite3');
  console.log(`Отправлено в облако: ${key}`);

  const remote = (await listKeys('backups/')).filter((k) => k.endsWith('.db')).sort();
  for (const old of remote.slice(0, -CLOUD_KEEP)) {
    await deleteObject(old);
    console.log(`Удалена старая копия из облака: ${old}`);
  }
} else {
  console.log('Облако не настроено — копия осталась только на диске сервера');
}

process.exit(0);

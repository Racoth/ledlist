/**
 * Хранилище файлов: локальный диск или объектное хранилище (S3-совместимое,
 * по умолчанию Yandex Object Storage).
 *
 * Облако включается только если заданы бакет и ключи доступа — иначе всё
 * работает как раньше, с диска. Так локальная разработка и уже загруженные
 * файлы не ломаются: у каждой записи в БД хранится, где лежит её файл.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from './db.js';

const BUCKET = process.env.S3_BUCKET ?? '';
const KEY_ID = process.env.S3_ACCESS_KEY_ID ?? '';
const SECRET = process.env.S3_SECRET_ACCESS_KEY ?? '';

/** Облако настроено? Если нет — файлы остаются на диске сервера. */
export const cloudEnabled = Boolean(BUCKET && KEY_ID && SECRET);

/** Общий префикс внутри бакета, чтобы можно было делить бакет с другими проектами. */
const PREFIX = (process.env.S3_PREFIX ?? 'led-list').replace(/^\/+|\/+$/g, '');

const client = cloudEnabled
  ? new S3Client({
      region: process.env.S3_REGION ?? 'ru-central1',
      endpoint: process.env.S3_ENDPOINT ?? 'https://storage.yandexcloud.net',
      credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
    })
  : null;

if (cloudEnabled) {
  console.log(`Облако: ${process.env.S3_ENDPOINT ?? 'storage.yandexcloud.net'}, бакет «${BUCKET}», префикс «${PREFIX}»`);
} else {
  console.log('Облако не настроено — файлы хранятся на диске сервера');
}

const fullKey = (key: string) => (PREFIX ? `${PREFIX}/${key}` : key);

/** Загрузить файл с диска в облако и вернуть ключ объекта. */
export async function putFile(localPath: string, key: string, contentType?: string): Promise<string> {
  if (!client) throw new Error('Облако не настроено');
  // Читаем файл целиком: креативы до 200 МБ, поток был бы экономнее по памяти,
  // но требует известной длины — S3 не принимает chunked-загрузку без неё.
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: fullKey(key),
    Body: fs.readFileSync(localPath),
    ContentType: contentType,
  }));
  return key;
}

/** Временная ссылка на объект — по ней браузер скачивает файл напрямую из облака. */
export async function signedUrl(key: string, seconds = 600): Promise<string> {
  if (!client) throw new Error('Облако не настроено');
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }), { expiresIn: seconds });
}

/** Скачать объект в память — нужно для вставки фото в PDF-прайс. */
export async function getBuffer(key: string): Promise<Buffer> {
  if (!client) throw new Error('Облако не настроено');
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as any) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }));
}

/** Список ключей по префиксу — для ротации старых бэкапов. */
export async function listKeys(prefix: string): Promise<string[]> {
  if (!client) return [];
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res: any = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: fullKey(prefix), ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push(PREFIX ? o.Key.slice(PREFIX.length + 1) : o.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out.sort();
}

/**
 * Файл только что принят multer'ом на диск. Если облако включено — переносим
 * туда и убираем локальную копию, возвращая место на диске сервера.
 * Возвращает, где файл в итоге лежит.
 */
export async function storeUpload(storedName: string, mime?: string): Promise<'s3' | 'local'> {
  if (!cloudEnabled) return 'local';
  const localPath = path.join(UPLOADS_DIR, storedName);
  await putFile(localPath, `uploads/${storedName}`, mime);
  fs.rmSync(localPath, { force: true });
  return 's3';
}

/** Содержимое файла независимо от места хранения — для PDF и прочей серверной работы. */
export async function readStored(storedName: string, storage: string): Promise<Buffer> {
  if (storage === 's3') return getBuffer(`uploads/${storedName}`);
  return fs.readFileSync(path.join(UPLOADS_DIR, storedName));
}

/** Удалить файл там, где он лежит. Ошибки глушим: записи в БД уже нет. */
export async function removeStored(storedName: string, storage: string): Promise<void> {
  try {
    if (storage === 's3') await deleteObject(`uploads/${storedName}`);
    else fs.rmSync(path.join(UPLOADS_DIR, storedName), { force: true });
  } catch { /* файла уже нет — не страшно */ }
}

// Смена пароля пользователя из консоли сервера — нужна на проде, чтобы сразу
// заменить пароли демо-аккаунтов (admin/admin, manager/manager), для которых
// в интерфейсе нет формы смены пароля.
// Запуск: node_modules/.bin/tsx scripts/set-password.ts user@example.ru 'новый-пароль'
import { db, hashPassword } from '../src/db.js';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Использование: tsx scripts/set-password.ts user@example.ru 'новый-пароль'");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Пароль слишком короткий (минимум 8 символов).');
  process.exit(1);
}

const info = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
  .run(hashPassword(password), email);

if (info.changes === 0) {
  console.error(`Пользователь с email «${email}» не найден.`);
  process.exit(1);
}
console.log(`Пароль обновлён для ${email}.`);

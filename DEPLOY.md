# Развёртывание на VPS

Проект — обычный Node-процесс (API) + статическая сборка React (клиент) + файл SQLite.
Ничего специфичного под serverless/PaaS нет, поэтому проще всего разместить на своём VPS:
Node-процесс под systemd, клиент и `/api` — через один nginx на 80/443.

Ориентир: Ubuntu 22.04/24.04 LTS. Ниже — команды под неё; на другом дистрибутиве
изменится только установка пакетов (`apt` → `dnf`/`yum` и т.п.).

## 0. Что подготовить заранее

- VPS с белым IP и SSH-доступом (root или sudo-пользователь).
- Домен, A-запись которого указывает на IP сервера (нужен для TLS через Let's Encrypt).
- Репозиторий на GitHub (`https://github.com/Racoth/ledlist`) — на сервере понадобится
  либо `git clone` по HTTPS (публичный репозиторий), либо деплой-ключ (приватный).

## 1. Базовая настройка сервера

```bash
apt update && apt upgrade -y
apt install -y curl git nginx

# Node.js LTS через NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Отдельный пользователь для приложения — без root-прав
adduser --system --group --home /var/www/led-list led-list
```

## 2. Код и зависимости

```bash
su - led-list -s /bin/bash
cd /var/www
git clone https://github.com/Racoth/ledlist.git led-list
cd led-list

cd server && npm ci
cd ../client && npm ci && npm run build   # → client/dist
exit   # обратно на root/sudo-пользователя
```

Сервер запускается через `tsx` прямо из TypeScript — отдельной сборки для API не нужно.
Клиент — обычный Vite-билд в `client/dist`, его отдаёт nginx как статику.

## 3. Секреты и конфигурация API

```bash
mkdir -p /etc/led-list
cp /var/www/led-list/server/.env.example /etc/led-list/api.env
```

Откройте `/etc/led-list/api.env` и заполните:

```ini
JWT_SECRET=<результат: openssl rand -hex 32>
PORT=3001
HOST=127.0.0.1
NODE_ENV=production
```

Без `JWT_SECRET` в `NODE_ENV=production` процесс не запустится (сработает намеренная
проверка в [server/src/auth.ts](server/src/auth.ts) — иначе легко забыть заменить
дефолтный секрет и оставить токены подделываемыми).

`HOST=127.0.0.1` — API слушает только локально, наружу его выставляет nginx.
Заводить отдельный файрвол-порт для 3001 не нужно.

## 4. Systemd-юнит API

```bash
cp /var/www/led-list/deploy/led-list-api.service /etc/systemd/system/
# Проверьте пути и имя пользователя внутри файла, если репозиторий лежит не в /var/www/led-list
chown -R led-list:led-list /var/www/led-list

systemctl daemon-reload
systemctl enable --now led-list-api
systemctl status led-list-api      # должен быть active (running)
journalctl -u led-list-api -f      # логи в реальном времени
```

## 5. nginx и TLS

```bash
cp /var/www/led-list/deploy/nginx.conf /etc/nginx/sites-available/led-list
# замените led-list.example.ru на свой домен внутри файла
ln -s /etc/nginx/sites-available/led-list /etc/nginx/sites-enabled/led-list
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d led-list.example.ru   # выпустит сертификат и допишет server{} для 443
```

## 6. Файрвол

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'   # 80 и 443
ufw enable
```

Порт 3001 наружу не открываем — он и так слушает только `127.0.0.1`.

## 7. Проверка

```bash
curl -I https://led-list.example.ru              # клиент
curl https://led-list.example.ru/api/auth/me      # 401 без токена — это нормально, значит API отвечает
```

Откройте домен в браузере, войдите под демо-доступами из README — и сразу переходите к шагу 8.

## 8. Обязательно перед реальным использованием: смена демо-паролей

При первом запуске на пустой БД автоматически создаются демо-аккаунты с тривиальными
паролями (`admin@platform.ru` / `admin`, `admin@gorodmedia.ru` / `admin`,
`manager@gorodmedia.ru` / `manager`, `admin@ekran-ug.ru` / `admin`) — это осознанное
решение для локальной разработки, но на публичном сервере эти пароли нужно сменить
до того, как об адресе узнает кто-то посторонний. Формы смены пароля в интерфейсе
пока нет, поэтому — консольный скрипт:

```bash
cd /var/www/led-list/server
node_modules/.bin/tsx scripts/set-password.ts admin@gorodmedia.ru 'новый-надёжный-пароль'
```

Смените так все аккаунты, которыми реально будете пользоваться; лишние демо-тенанты
и пользователей, если они не нужны, проще удалить через раздел «Подписки» суперадмина
или напрямую в БД.

## 9. Резервные копии БД

БД — единственное хранилище данных (плюс файлы в `server/data/uploads` и
`server/data/tiles` — фото экранов и кэш карт, второе можно не бэкапить, оно
перекачается заново). Копия через встроенный backup API SQLite (безопасна при
активном WAL, в отличие от простого `cp` файла):

```bash
cd /var/www/led-list/server
node_modules/.bin/tsx scripts/backup.ts
# → server/data/backups/led-<дата>.db, хранит последние 14 копий, старые удаляет сам
```

Добавьть в крон и **обязательно копировать бэкапы за пределы сервера** (тот же диск —
не защита от отказа диска или взлома):

```bash
crontab -e -u led-list
# 0 3 * * * cd /var/www/led-list/server && node_modules/.bin/tsx scripts/backup.ts >> /var/log/led-list-backup.log 2>&1
```

Куда копировать за пределы сервера (например, `rclone`/`rsync` на другой хост или
в объектное хранилище) — на ваше усмотрение, зависит от того, что уже есть в инфраструктуре.

## 10. Обновление после изменений в репозитории

```bash
su - led-list -s /bin/bash
cd /var/www/led-list
git pull
cd server && npm ci
cd ../client && npm ci && npm run build
exit

systemctl restart led-list-api
# nginx перезапускать не нужно — он просто отдаёт файлы из client/dist заново
```

## Примечания

- **Фирменный шрифт Mazzard** для PDF-прайса в репозиторий не входит (коммерческая
  лицензия). На сервере его не будет — код автоматически откатится на встроенный
  PT Sans, PDF всё равно соберётся корректно. Если шрифт нужен именно фирменный,
  положите `.ttf`-файлы в `/etc/led-list/fonts` и раскомментируйте `PDF_FONT_DIR`/
  `PDF_FONT_FAMILY` в `api.env`.
- **CORS** в API открыт (`cors()` без ограничений) — это не проблема при связке
  через один nginx-домен, но если решите обращаться к API с другого домена, стоит
  сузить список источников в [server/src/index.ts](server/src/index.ts).
- Мультитенантность работает через `tenant_id` в токене — на одном сервере можно
  держать сколько угодно тенантов (арендаторов), заводить их через раздел
  «Подписки» суперадмина.

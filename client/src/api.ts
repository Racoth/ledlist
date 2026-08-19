export interface User {
  id: number;
  tenant_id: number | null;
  email: string;
  name: string;
  role: 'admin' | 'manager';
}

let token: string | null = localStorage.getItem('token');
let currentUser: User | null = JSON.parse(localStorage.getItem('user') ?? 'null');

export function getUser(): User | null { return currentUser; }
/** Права администратора: полный доступ к деньгам, экранам и продажам. */
export function isAdmin(): boolean {
  return currentUser?.role === 'admin';
}
export function getToken(): string | null { return token; }

export function setAuth(t: string, u: User) {
  token = t; currentUser = u;
  localStorage.setItem('token', t);
  localStorage.setItem('user', JSON.stringify(u));
}

export function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401 && !path.startsWith('/auth/login')) { logout(); throw new ApiError(401, 'Сессия истекла'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? `Ошибка ${res.status}`);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const put = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

/** POST, ответ которого — файл: скачивает его под указанным именем. */
export async function downloadPost(path: string, body: any, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as any).error ?? `Ошибка ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function uploadFile<T = any>(path: string, file: File, extra: Record<string, string | number> = {}): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? `Ошибка ${res.status}`);
  return data as T;
}

// ---------- Форматирование ----------
export const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + ' ₽';

/** Число с разрядами, но без знака валюты — когда ₽ ставится один раз на пару значений. */
export const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v);

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const plusDaysISO = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик', reserved: 'Бронь', sold: 'Продано', cancelled: 'Отменён',
  active: 'Активен', maintenance: 'На обслуживании', inactive: 'Отключён',
};

export const STATUS_COLORS: Record<string, string> = {
  draft: '#8a8f98', reserved: '#e8a13c', sold: '#3ca55c', cancelled: '#d05555',
  active: '#3ca55c', maintenance: '#e8a13c', inactive: '#8a8f98',
};

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db, verifyPassword } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'led-list-dev-secret';

export interface AuthUser {
  id: number;
  tenant_id: number | null;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'manager';
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export function login(email: string, password: string): { token: string; user: AuthUser } | null {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  if (row.tenant_id) {
    const t = db.prepare('SELECT active, expires_at FROM tenants WHERE id = ?').get(row.tenant_id) as any;
    if (!t || !t.active) return null;
  }
  const user: AuthUser = { id: row.id, tenant_id: row.tenant_id, email: row.email, name: row.name, role: row.role };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '12h' });
  return { token, user };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

/** tenant_id текущего пользователя (у суперадмина — из query для просмотра). */
export function tenantOf(req: Request): number {
  if (req.user!.role === 'superadmin') {
    const q = Number(req.query.tenant_id);
    return Number.isFinite(q) && q > 0 ? q : 0;
  }
  return req.user!.tenant_id!;
}

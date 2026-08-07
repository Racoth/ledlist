import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { getUser, logout } from './api';
import { Icon } from './components/icons';
import { Brand } from './components/Brand';
import Login from './pages/Login';
import Screens from './pages/Screens';
import Campaigns from './pages/Campaigns';
import CampaignCard from './pages/CampaignCard';
import Bookings from './pages/Bookings';
import { ClientsPage, ManagersPage, OwnersPage } from './pages/Directory';
import Payments from './pages/Payments';
import Tenants from './pages/Tenants';
import Settings from './pages/Settings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = getUser();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}

interface MenuLink { to: string; label: string; sub?: string }

/** Выпадающее меню: открывается кликом, закрывается Escape и щелчком снаружи. */
function NavMenu({ label, links }: { label: string; links: MenuLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();

  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const here = links.some((l) => loc.pathname.startsWith(l.to));

  return (
    <div className="nav-item" ref={ref}>
      <button
        className={'nav-link' + (here ? ' active' : '')}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <Icon name="chevronDown" size={12} className="caret" />
      </button>
      {open && (
        <div className="nav-dropdown">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}>
              {l.label}
              {l.sub && <span className="sub">{l.sub}</span>}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const user = getUser();
  if (!user) return null;
  const roleLabel = { superadmin: 'Суперадмин', admin: 'Администратор', manager: 'Менеджер' }[user.role];
  const initials = user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

  return (
    <header className="topbar">
      <Brand />
      {user.role !== 'superadmin' && (
        <nav className="nav" aria-label="Основная навигация">
          <div className="nav-item">
            <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/screens">
              Инвентарь
            </NavLink>
          </div>
          <NavMenu
            label="Продажи"
            links={[
              { to: '/campaigns', label: 'Заказы и кампании', sub: 'Все размещения по клиентам' },
              { to: '/bookings', label: 'Брони', sub: 'Резервы, удерживающие блок' },
              { to: '/payments', label: 'Платежи', sub: 'Реестр поступлений' },
            ]}
          />
          <NavMenu
            label="Контрагенты"
            links={[
              { to: '/clients', label: 'Клиенты', sub: 'Рекламодатели' },
              { to: '/managers', label: 'Менеджеры', sub: 'Отдел продаж' },
              { to: '/owners', label: 'Владельцы экранов', sub: 'Собственники конструкций' },
            ]}
          />
          {user.role === 'admin' && (
            <div className="nav-item">
              <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/settings">
                Настройки
              </NavLink>
            </div>
          )}
        </nav>
      )}
      {user.role === 'superadmin' && (
        <nav className="nav" aria-label="Основная навигация">
          <div className="nav-item">
            <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/tenants">
              Подписки
            </NavLink>
          </div>
        </nav>
      )}
      <div className="spacer" />
      <div className="userbox">
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="who">
          <span>{user.name}</span>
          <span className="role">{roleLabel}</span>
        </span>
      </div>
      <button className="btn-logout" onClick={logout}>
        <Icon name="logout" size={14} /> Выйти
      </button>
    </header>
  );
}

export default function App() {
  const user = getUser();
  const home = user?.role === 'superadmin' ? '/tenants' : '/screens';
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">К основному содержимому</a>
      <TopBar />
      <main id="main">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/screens" element={<RequireAuth><Screens /></RequireAuth>} />
          <Route path="/campaigns" element={<RequireAuth><Campaigns /></RequireAuth>} />
          <Route path="/campaigns/:id" element={<RequireAuth><CampaignCard /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
          <Route path="/clients" element={<RequireAuth><ClientsPage /></RequireAuth>} />
          <Route path="/managers" element={<RequireAuth><ManagersPage /></RequireAuth>} />
          <Route path="/owners" element={<RequireAuth><OwnersPage /></RequireAuth>} />
          <Route path="/payments" element={<RequireAuth><Payments /></RequireAuth>} />
          <Route path="/tenants" element={<RequireAuth><Tenants /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

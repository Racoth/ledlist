import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { getUser, logout } from './api';
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

function TopBar() {
  const user = getUser();
  if (!user) return null;
  const roleLabel = { superadmin: 'Суперадмин', admin: 'Администратор', manager: 'Менеджер' }[user.role];
  return (
    <header className="topbar">
      <div className="logo">LED<span>List</span></div>
      {user.role !== 'superadmin' && (
        <>
          <div className="nav-item"><NavLink className="nav-link" to="/screens">Инвентарь экранов</NavLink></div>
          <div className="nav-item">
            <NavLink className="nav-link" to="/campaigns">Продажи ▾</NavLink>
            <div className="nav-dropdown">
              <NavLink to="/campaigns">Заказы / Кампании</NavLink>
              <NavLink to="/bookings">Брони / Резервы</NavLink>
              <NavLink to="/payments">Платежи</NavLink>
            </div>
          </div>
          <div className="nav-item">
            <NavLink className="nav-link" to="/clients">Контрагенты ▾</NavLink>
            <div className="nav-dropdown">
              <NavLink to="/clients">Клиенты (рекламодатели)</NavLink>
              <NavLink to="/managers">Менеджеры</NavLink>
              <NavLink to="/owners">Владельцы экранов</NavLink>
            </div>
          </div>
          {user.role === 'admin' && (
            <div className="nav-item"><NavLink className="nav-link" to="/settings">Настройки</NavLink></div>
          )}
        </>
      )}
      {user.role === 'superadmin' && (
        <div className="nav-item"><NavLink className="nav-link" to="/tenants">Подписки</NavLink></div>
      )}
      <div className="spacer" />
      <div className="userbox">
        <div>{user.name}</div>
        <div className="role">{roleLabel}</div>
      </div>
      <button className="btn-logout" onClick={logout}>Выйти</button>
    </header>
  );
}

export default function App() {
  const user = getUser();
  const home = user?.role === 'superadmin' ? '/tenants' : '/screens';
  return (
    <BrowserRouter>
      <TopBar />
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
    </BrowserRouter>
  );
}

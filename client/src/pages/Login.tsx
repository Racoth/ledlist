import { useState } from 'react';
import { post, setAuth } from '../api';

export default function Login() {
  const [email, setEmail] = useState('admin@gorodmedia.ru');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { token, user } = await post('/auth/login', { email, password });
      setAuth(token, user);
      window.location.href = user.role === 'superadmin' ? '/tenants' : '/screens';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>LED<span>List</span></h1>
        <div className="sub">Управление сетью LED-экранов (DOOH)</div>
        {error && <div className="error-box">{error}</div>}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <div className="login-demo">
          Демо-доступы:<br />
          Администратор: admin@gorodmedia.ru / admin<br />
          Менеджер: manager@gorodmedia.ru / manager<br />
          Суперадмин: admin@platform.ru / admin
        </div>
      </form>
    </div>
  );
}

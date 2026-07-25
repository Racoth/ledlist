import { useState } from 'react';
import { post, setAuth } from '../api';
import { Brand } from '../components/Brand';
import { Alert, LoopTape, LoopRuler } from '../components/ui';

const DEMO = [
  { who: 'Администратор', email: 'admin@gorodmedia.ru', password: 'admin' },
  { who: 'Менеджер', email: 'manager@gorodmedia.ru', password: 'manager' },
  { who: 'Суперадмин', email: 'admin@platform.ru', password: 'admin' },
];

// Витрина петли на экране входа: 60 секунд эфира, три рекламодателя в ротации.
const SHOWCASE = [
  { label: 'Лидер-Авто', sec: 15, color: '#3987e5' },
  { label: 'Беркат', sec: 10, color: '#d95926' },
  { label: 'Атлант', sec: 5, color: '#199e70' },
];

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

  const used = SHOWCASE.reduce((a, s) => a + s.sec, 0);

  return (
    <div className="login-wrap">
      <section className="login-stage">
        <Brand as="plain" />

        <div className="login-lede">
          <h2>Петля <span className="lit">на 60 секунд</span>. Продайте каждую.</h2>
          <p>
            Инвентарь LED-экранов, ёмкость ротации и продажи слотов — в одном рабочем месте.
          </p>

          <div className="login-loop">
            <div className="cap">
              <span>Экран GRZLED04001 · петля 60 сек</span>
              <span>занято {used} · свободно {60 - used}</span>
            </div>
            <LoopTape loop={60} segments={SHOWCASE} />
            <LoopRuler loop={60} />
          </div>
        </div>

        <div />
      </section>

      <section className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <h1>Вход в систему</h1>
          <div className="sub">Управление сетью LED-экранов (DOOH)</div>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="login-password">Пароль</label>
            <input id="login-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>

          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'Проверяем…' : 'Войти'}
          </button>

          <div className="login-demo">
            <span className="eyebrow">Демо-доступы — нажмите, чтобы подставить</span>
            {DEMO.map((d) => (
              <button key={d.email} type="button"
                onClick={() => { setEmail(d.email); setPassword(d.password); }}>
                <span className="who">{d.who}</span>
                <span className="cred">{d.email} / {d.password}</span>
              </button>
            ))}
          </div>
        </form>
      </section>
    </div>
  );
}

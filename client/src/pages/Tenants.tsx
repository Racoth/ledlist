import { useEffect, useState } from 'react';
import { get, post, put, fmtDate } from '../api';
import { DataTable, Modal, TextInput, Column, Alert, Icon } from '../components/ui';

export default function Tenants() {
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () => get('/tenants').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const columns: Column<any>[] = [
    { key: 'id', title: 'ID' },
    { key: 'name', title: 'Компания-оператор' },
    { key: 'inn', title: 'ИНН' },
    { key: 'contact_email', title: 'Email' },
    { key: 'registered_at', title: 'Дата регистрации', render: (t) => fmtDate(t.registered_at) },
    { key: 'expires_at', title: 'Действует до', render: (t) => {
      const expired = t.expires_at && t.expires_at < new Date().toISOString().slice(0, 10);
      return (
        <span className="cell-stack" style={{ justifyItems: 'start' }}>
          <b className="num">{fmtDate(t.expires_at)}</b>
          {expired && <span className="badge is-crit"><Icon name="alert" size={11} /> истекла</span>}
        </span>
      );
    } },
    { key: 'screens_count', title: 'Экранов', render: (t) => <span className="num">{t.screens_count}</span> },
    { key: 'users_count', title: 'Пользователей', render: (t) => <span className="num">{t.users_count}</span> },
    { key: 'active', title: 'Статус', render: (t) => (
      <span className={'badge ' + (t.active ? 'is-good' : 'is-idle')}>
        <span className="dot" style={{ background: t.active ? '#0ca30c' : '#8b95a5' }} />
        {t.active ? 'Активна' : 'Заблокирована'}
      </span>
    ) },
    { key: '_a', title: '', sortable: false, render: (t) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setEdit(t)}>
          <Icon name="edit" size={13} /> Изменить
        </button>
        <button className="btn small secondary" onClick={async () => { await put(`/tenants/${t.id}`, { active: t.active ? 0 : 1 }); load(); }}>
          {t.active ? 'Заблокировать' : 'Разблокировать'}
        </button>
      </span>
    ) },
  ];

  async function save() {
    setError('');
    try {
      const body = {
        name: edit.name, inn: edit.inn, contact_email: edit.contact_email, expires_at: edit.expires_at,
        ...(edit.id ? {} : { admin_email: edit.admin_email, admin_password: edit.admin_password }),
      };
      if (edit.id) await put(`/tenants/${edit.id}`, body);
      else await post('/tenants', body);
      setEdit(null); load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Подписки</h1>
        <button className="btn" onClick={() => setEdit({})}>
          <Icon name="plus" size={14} /> Новая компания
        </button>
      </div>
      <div className="page-sub">Компании-операторы платформы. Каждая работает в изолированном пространстве данных.</div>
      {error && <Alert tone="error">{error}</Alert>}
      <DataTable caption="Компании-операторы" columns={columns} rows={rows}
        emptyText="Компаний нет" emptyHint="Создайте первую — вместе с ней заведётся её администратор." />
      {edit && (
        <Modal title={edit.id ? `Подписка: ${edit.name}` : 'Новая компания-оператор'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button className="btn" onClick={save}>Сохранить</button>
          </>}>
          <div className="form-grid">
            <TextInput label="Название" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <TextInput label="ИНН" value={edit.inn} onChange={(v) => setEdit({ ...edit, inn: v })} />
            <TextInput label="Контактный email" value={edit.contact_email} onChange={(v) => setEdit({ ...edit, contact_email: v })} />
            <TextInput label="Подписка до" type="date" value={edit.expires_at} onChange={(v) => setEdit({ ...edit, expires_at: v })} />
            {!edit.id && <>
              <TextInput label="Email администратора" value={edit.admin_email} onChange={(v) => setEdit({ ...edit, admin_email: v })}
                hint="Будет создан пользователь с ролью «Администратор компании»" />
              <TextInput label="Пароль администратора" value={edit.admin_password} onChange={(v) => setEdit({ ...edit, admin_password: v })} />
            </>}
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { get, post, put, del, isAdmin } from '../api';
import { DataTable, Modal, TextInput, TextArea, Column, Alert, Icon } from '../components/ui';

interface FieldDef { key: string; label: string; type?: string; wide?: boolean }

function CrudPage(props: {
  title: string;
  endpoint: string;
  fields: FieldDef[];
  subtitle?: string;
  extraColumns?: Column<any>[];
  canDelete?: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () => get(props.endpoint).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [props.endpoint]);

  const columns: Column<any>[] = [
    ...props.fields.map((f) => ({ key: f.key, title: f.label })),
    ...(props.extraColumns ?? []),
    { key: '_actions', title: '', sortable: false, render: (r) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setEdit(r)}>
          <Icon name="edit" size={13} /> Изменить
        </button>
        {props.canDelete !== false && (
          <button className="btn small ghost" aria-label={`Удалить «${r.name}»`} onClick={async () => {
            if (!confirm(`Удалить «${r.name}»? Действие необратимо.`)) return;
            try { await del(`${props.endpoint}/${r.id}`); load(); } catch (e: any) { setError(e.message); }
          }}><Icon name="trash" size={14} /></button>
        )}
      </span>
    ) },
  ];

  async function save() {
    setError('');
    const body: any = {};
    for (const f of props.fields) body[f.key] = edit[f.key] ?? null;
    try {
      if (edit.id) await put(`${props.endpoint}/${edit.id}`, body);
      else await post(props.endpoint, body);
      setEdit(null); load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{props.title}</h1>
        <button className="btn" onClick={() => setEdit({})}>
          <Icon name="plus" size={14} /> Добавить
        </button>
      </div>
      {props.subtitle && <div className="page-sub">{props.subtitle}</div>}
      {error && <Alert tone="error">{error}</Alert>}
      <DataTable caption={props.title} columns={columns} rows={rows} onRowClick={(r) => setEdit(r)}
        emptyText="Записей пока нет" emptyHint="Нажмите «Добавить», чтобы создать первую." />
      {edit && (
        <Modal title={edit.id ? `Изменить: ${edit.name ?? 'запись'}` : 'Новая запись'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button className="btn" onClick={save}>Сохранить</button>
          </>}>
          <div className="form-grid">
            {props.fields.map((f) => f.type === 'textarea' ? (
              <TextArea key={f.key} label={f.label} value={edit[f.key]}
                onChange={(v) => setEdit({ ...edit, [f.key]: v })} />
            ) : (
              <TextInput key={f.key} label={f.label} type={f.type} value={edit[f.key]}
                onChange={(v) => setEdit({ ...edit, [f.key]: v })} />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ClientsPage() {
  return <CrudPage
    title="Клиенты (рекламодатели)"
    endpoint="/clients"
    canDelete={isAdmin()}
    subtitle="Рекламодатели: контакты, контактные лица, почтовый адрес."
    fields={[
      { key: 'name', label: 'Название' },
      { key: 'phone', label: 'Телефон' },
      { key: 'email', label: 'Email' },
      { key: 'address', label: 'Почтовый адрес' },
      { key: 'comment', label: 'Комментарий', type: 'textarea' },
    ]}
    extraColumns={[{
      key: 'contacts', title: 'Контактные лица', render: (r) => {
        try {
          const list = JSON.parse(r.contacts || '[]');
          return list.length ? list.map((c: any) => `${c.name} (${c.position ?? ''})`).join('; ') : '—';
        } catch { return '—'; }
      },
    }]}
  />;
}

/**
 * Менеджеры — отдельная страница, а не универсальный справочник: у менеджера
 * есть ещё и вход в систему, логин с паролем ему выдаёт администратор.
 */
export function ManagersPage() {
  const admin = isAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () => get('/managers').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const columns: Column<any>[] = [
    { key: 'name', title: 'ФИО' },
    { key: 'phone', title: 'Телефон' },
    { key: 'email', title: 'Email' },
    { key: 'login', title: 'Вход в систему', render: (r) => r.login
      ? <span className="cell-stack"><b className="mono">{r.login}</b><span className="sub">пароль задан</span></span>
      : <span className="muted">нет доступа</span> },
    ...(admin ? [{ key: '_actions', title: '', sortable: false, render: (r: any) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setEdit({ ...r, password: '' })}>
          <Icon name="edit" size={13} /> Изменить
        </button>
        <button className="btn small ghost" aria-label={`Удалить «${r.name}»`} onClick={async () => {
          if (!confirm(`Удалить «${r.name}»? Вход в систему будет закрыт.`)) return;
          try { await del(`/managers/${r.id}`); load(); } catch (e: any) { setError(e.message); }
        }}><Icon name="trash" size={14} /></button>
      </span>
    ) }] : []),
  ];

  async function save() {
    setError('');
    const body = {
      name: edit.name, phone: edit.phone ?? null, email: edit.email ?? null,
      login: edit.login || undefined,
      password: edit.password || undefined,
    };
    try {
      if (edit.id) await put(`/managers/${edit.id}`, body);
      else await post('/managers', body);
      setEdit(null); load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Менеджеры</h1>
        {admin && (
          <button className="btn" onClick={() => setEdit({ name: '', phone: '', email: '', login: '', password: '' })}>
            <Icon name="plus" size={14} /> Добавить
          </button>
        )}
      </div>
      <div className="page-sub">
        Сотрудники отдела продаж. Кампании привязываются к менеджеру, а логин с паролем открывает ему вход в систему.
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <DataTable caption="Менеджеры" columns={columns} rows={rows}
        onRowClick={admin ? (r) => setEdit({ ...r, password: '' }) : undefined}
        emptyText="Менеджеров пока нет" emptyHint="Нажмите «Добавить», чтобы завести первого." />

      {edit && (
        <Modal title={edit.id ? `Менеджер: ${edit.name}` : 'Новый менеджер'} onClose={() => setEdit(null)}
          subtitle="Логин и пароль можно задать сразу или позже — без них менеджер просто числится в справочнике"
          footer={<>
            <button className="btn secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button className="btn" onClick={save} disabled={!edit.name?.trim()}>Сохранить</button>
          </>}>
          <div className="form-grid">
            <TextInput label="ФИО" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <TextInput label="Телефон" value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} />
            <TextInput label="Email" type="email" value={edit.email} onChange={(v) => setEdit({ ...edit, email: v })}
              hint="Контактный адрес для связи" />
          </div>

          <div className="export-section">
            <span className="eyebrow">Доступ в систему</span>
            <div className="form-grid">
              <TextInput label="Логин" type="email" value={edit.login} onChange={(v) => setEdit({ ...edit, login: v })}
                hint="Email, под которым менеджер входит" />
              <TextInput label="Пароль" type="password" value={edit.password}
                onChange={(v) => setEdit({ ...edit, password: v })}
                hint={edit.account_id ? 'Заполните, чтобы задать новый пароль' : 'Минимум 6 символов'} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function OwnersPage() {
  return <CrudPage
    title="Владельцы экранов"
    endpoint="/owners"
    subtitle="Собственники конструкций — для расчётов по агентской модели."
    fields={[
      { key: 'name', label: 'Название / ФИО' },
      { key: 'phone', label: 'Телефон' },
      { key: 'email', label: 'Email' },
      { key: 'comment', label: 'Комментарий', type: 'textarea' },
    ]}
  />;
}

import { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { DataTable, Modal, TextInput, Column, Field } from '../components/ui';

interface FieldDef { key: string; label: string; type?: string; wide?: boolean }

function CrudPage(props: {
  title: string;
  endpoint: string;
  fields: FieldDef[];
  subtitle?: string;
  extraColumns?: Column<any>[];
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () => get(props.endpoint).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [props.endpoint]);

  const columns: Column<any>[] = [
    ...props.fields.map((f) => ({ key: f.key, title: f.label })),
    ...(props.extraColumns ?? []),
    { key: '_actions', title: '', render: (r) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setEdit(r)}>Изменить</button>
        <button className="btn small danger" onClick={async () => {
          if (!confirm('Удалить запись?')) return;
          try { await del(`${props.endpoint}/${r.id}`); load(); } catch (e: any) { setError(e.message); }
        }}>✕</button>
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
        <button className="btn" onClick={() => setEdit({})}>+ Добавить</button>
      </div>
      {props.subtitle && <div className="page-sub">{props.subtitle}</div>}
      {error && <div className="error-box">{error}</div>}
      <DataTable columns={columns} rows={rows} onRowClick={(r) => setEdit(r)} />
      {edit && (
        <Modal title={edit.id ? 'Изменить запись' : 'Новая запись'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button className="btn" onClick={save}>Сохранить</button>
          </>}>
          <div className="form-grid">
            {props.fields.map((f) => f.type === 'textarea' ? (
              <Field key={f.key} label={f.label}>
                <textarea rows={2} value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
              </Field>
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

export function ManagersPage() {
  return <CrudPage
    title="Менеджеры"
    endpoint="/managers"
    subtitle="Сотрудники отдела продаж. Кампании привязываются к менеджеру."
    fields={[
      { key: 'name', label: 'ФИО' },
      { key: 'phone', label: 'Телефон' },
      { key: 'email', label: 'Email' },
    ]}
  />;
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

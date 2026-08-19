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

import { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { Modal, TextInput, Alert, Icon } from '../components/ui';

interface DictField { key: string; label: string; type?: string }
interface DictDef { key: string; title: string; endpoint: string; fields: DictField[] }

const DICTS: DictDef[] = [
  { key: 'cities', title: 'Города / области', endpoint: '/cities', fields: [
    { key: 'name', label: 'Город' }, { key: 'region', label: 'Область / регион' }] },
  { key: 'types', title: 'Типы экранов', endpoint: '/screen-types', fields: [{ key: 'name', label: 'Название' }] },
  { key: 'timeslots', title: 'Тайм-слоты', endpoint: '/time-slots', fields: [
    { key: 'name', label: 'Название' }, { key: 'time_from', label: 'С (чч:мм)' },
    { key: 'time_to', label: 'До (чч:мм)' }, { key: 'price_coef', label: 'Коэф. цены', type: 'number' }] },
  { key: 'discounts', title: 'Скидки', endpoint: '/discounts', fields: [
    { key: 'name', label: 'Название' }, { key: 'percent', label: 'Процент', type: 'number' }] },
  { key: 'taxes', title: 'Налоговые режимы', endpoint: '/tax-regimes', fields: [
    { key: 'name', label: 'Название' }, { key: 'rate', label: 'Ставка сверху, %', type: 'number' }] },
];

export default function Settings() {
  const [tab, setTab] = useState('company');

  return (
    <div className="page">
      <div className="page-head"><h1>Настройки</h1></div>
      <div className="page-sub">Реквизиты компании и справочники, из которых собираются экраны и кампании.</div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'company'} className={`tab ${tab === 'company' ? 'active' : ''}`}
          onClick={() => setTab('company')}>Данные о компании</button>
        {DICTS.map((d) => (
          <button key={d.key} role="tab" aria-selected={tab === d.key} className={`tab ${tab === d.key ? 'active' : ''}`}
            onClick={() => setTab(d.key)}>{d.title}</button>
        ))}
      </div>
      {tab === 'company' && <CompanyTab />}
      {DICTS.filter((d) => d.key === tab).map((d) => <DictTab key={d.key} def={d} />)}
    </div>
  );
}

function CompanyTab() {
  const [form, setForm] = useState<any>({});
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { get('/settings/company').then(setForm).catch(() => {}); }, []);

  async function save() {
    setOk(''); setError('');
    try {
      await put('/settings/company', {
        legal_name: form.legal_name, inn: form.inn, address: form.address,
        phone: form.phone, email: form.email, reserve_days: Number(form.reserve_days) || 3,
      });
      setOk('Настройки сохранены');
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      {ok && <Alert tone="ok">{ok}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <TextInput label="Юридическое название" value={form.legal_name} onChange={(v) => setForm({ ...form, legal_name: v })} />
        <TextInput label="ИНН" value={form.inn} onChange={(v) => setForm({ ...form, inn: v })} />
        <TextInput label="Адрес" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
        <TextInput label="Телефон" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <TextInput label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <TextInput label="Срок брони по умолчанию, дней" type="number" value={form.reserve_days}
          onChange={(v) => setForm({ ...form, reserve_days: v })}
          hint="Сколько дней кампания в статусе «Бронь» удерживает ёмкость блока" />
      </div>
      <div style={{ marginTop: 14 }}><button className="btn" onClick={save}>Сохранить</button></div>
    </div>
  );
}

function DictTab({ def }: { def: DictDef }) {
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [error, setError] = useState('');

  const load = () => get(def.endpoint).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [def.endpoint]);

  async function save() {
    setError('');
    const body: any = {};
    for (const f of def.fields) body[f.key] = f.type === 'number' ? Number(edit[f.key]) || 0 : edit[f.key] ?? null;
    try {
      if (edit.id) await put(`${def.endpoint}/${edit.id}`, body);
      else await post(def.endpoint, body);
      setEdit(null); load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => setEdit({})}>
          <Icon name="plus" size={14} /> Добавить
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            {def.fields.map((f) => <th key={f.key} scope="col"><span className="th-btn">{f.label}</span></th>)}
            <th scope="col"><span className="th-btn" /></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="empty-row" colSpan={def.fields.length + 1}>
                <span className="empty-state"><b>Справочник пуст</b><span>Добавьте первую запись — она станет доступна в формах.</span></span>
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setEdit(r)}>
                {def.fields.map((f) => <td key={f.key}>{r[f.key] ?? '—'}</td>)}
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn small ghost" aria-label={`Удалить «${r.name}»`} onClick={async () => {
                    if (!confirm(`Удалить «${r.name}»?`)) return;
                    try { await del(`${def.endpoint}/${r.id}`); load(); } catch (e: any) { setError(e.message); }
                  }}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Изменить: ${edit.name ?? def.title}` : def.title} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button className="btn" onClick={save}>Сохранить</button>
          </>}>
          <div className="form-grid">
            {def.fields.map((f) => (
              <TextInput key={f.key} label={f.label} type={f.type} value={edit[f.key]}
                onChange={(v) => setEdit({ ...edit, [f.key]: v })} />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

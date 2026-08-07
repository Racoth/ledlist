import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, fmtMoney, fmtDate } from '../api';
import { DataTable, Modal, SelectInput, StatusBadge, Column, TextInput, Alert, Icon } from '../components/ui';

export interface CampaignRow {
  id: number; number: string; client_id: number | null; client_name?: string;
  manager_name?: string; created_at: string; status: string; reserve_until: string | null;
  discount_percent: number; discount_name?: string; production_cost: number;
  placement_cost: number; slots_count: number; paid: number;
}

export default function Campaigns() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const nav = useNavigate();

  const load = () => get('/campaigns').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  const columns: Column<CampaignRow>[] = [
    { key: 'number', title: '№', render: (c) => <b className="mono">{c.number}</b> },
    { key: 'created_at', title: 'Создан', render: (c) => `${fmtDate(c.created_at)} ${c.created_at.slice(11, 16)}` },
    { key: 'client_name', title: 'Клиент' },
    { key: 'manager_name', title: 'Менеджер' },
    { key: 'slots_count', title: 'Слотов', render: (c) => <span className="num">{c.slots_count}</span> },
    { key: 'placement_cost', title: 'Размещение', sortValue: (c) => c.placement_cost, render: (c) => <span className="num">{fmtMoney(c.placement_cost)}</span> },
    { key: 'production_cost', title: 'Производство', sortValue: (c) => c.production_cost, render: (c) => <span className="num">{fmtMoney(c.production_cost)}</span> },
    { key: 'total', title: 'Итого', sortValue: (c) => c.placement_cost + c.production_cost, render: (c) => <b className="num">{fmtMoney(c.placement_cost + c.production_cost)}</b> },
    { key: 'paid', title: 'Оплачено', sortValue: (c) => c.paid, render: (c) => {
      const full = c.paid > 0 && c.paid >= c.placement_cost + c.production_cost;
      return <span className="num" style={{ color: full ? 'var(--good-ink)' : undefined, fontWeight: full ? 600 : undefined }}>{fmtMoney(c.paid)}</span>;
    } },
    { key: 'status', title: 'Статус', render: (c) => (
      <span className="cell-stack" style={{ justifyItems: 'start' }}>
        <StatusBadge status={c.status} />
        {c.status === 'reserved' && c.reserve_until && <span className="sub">до {fmtDate(c.reserve_until)}</span>}
      </span>
    ) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Заказы и кампании</h1>
        <div className="toolbar">
          <select className="plain" aria-label="Фильтр по статусу" value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="reserved">Бронь</option>
            <option value="sold">Продано</option>
            <option value="cancelled">Отменён</option>
          </select>
          <button className="btn" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> Новая кампания
          </button>
        </div>
      </div>
      <div className="page-sub">
        Кампания собирает слоты в блоках экранов. Пока она в черновике, ёмкость не удерживается —
        бронь и продажа проверяют блок целиком.
      </div>
      <DataTable
        caption="Кампании"
        columns={columns}
        rows={filtered}
        onRowClick={(c) => nav(`/campaigns/${c.id}`)}
        emptyText={statusFilter ? 'В этом статусе кампаний нет' : 'Кампаний пока нет'}
        emptyHint={statusFilter ? 'Снимите фильтр по статусу.' : 'Создайте первую — или забронируйте клиента прямо из инвентаря экранов.'}
      />
      {createOpen && <CreateCampaignModal onClose={() => setCreateOpen(false)} onCreated={(id) => nav(`/campaigns/${id}`)} />}
    </div>
  );
}

export function CreateCampaignModal(props: { onClose: () => void; onCreated: (id: number) => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ client_id: '', manager_id: '', discount_id: '', discount_percent: 0, production_cost: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get('/clients'), get('/managers'), get('/discounts')]).then(([c, m, d]) => {
      setClients(c); setManagers(m); setDiscounts(d);
    });
  }, []);

  async function create() {
    setError('');
    try {
      const c = await post('/campaigns', {
        client_id: form.client_id ? Number(form.client_id) : null,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        discount_id: form.discount_id ? Number(form.discount_id) : null,
        discount_percent: Number(form.discount_percent) || 0,
        production_cost: Number(form.production_cost) || 0,
      });
      props.onCreated(c.id);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title="Новая рекламная кампания" subtitle="Номер присвоится автоматически" onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={create}>Создать черновик</button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <SelectInput label="Клиент (рекламодатель)" value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })}
          options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        <SelectInput label="Менеджер" value={form.manager_id} onChange={(v) => setForm({ ...form, manager_id: v })}
          options={managers.map((m) => ({ value: m.id, label: m.name }))} />
        <SelectInput label="Скидка (из справочника)" value={form.discount_id}
          onChange={(v) => {
            const d = discounts.find((x) => String(x.id) === v);
            setForm({ ...form, discount_id: v, discount_percent: d ? d.percent : form.discount_percent });
          }}
          options={discounts.map((d) => ({ value: d.id, label: `${d.name} (${d.percent}%)` }))} />
        <TextInput label="Скидка, %" type="number" value={form.discount_percent} onChange={(v) => setForm({ ...form, discount_percent: v })} />
        <TextInput label="Производство ролика, ₽" type="number" value={form.production_cost} onChange={(v) => setForm({ ...form, production_cost: v })}
          hint="Отдельная услуга (вместо «монтаж/печать» у билбордов)" />
      </div>
    </Modal>
  );
}

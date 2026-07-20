import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, fmtMoney, fmtDate } from '../api';
import { DataTable, Column, StatusBadge } from '../components/ui';
import type { CampaignRow } from './Campaigns';

export default function Bookings() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    get('/campaigns').then((all) => setRows(all.filter((c: CampaignRow) => c.status === 'reserved')));
  }, []);

  const columns: Column<CampaignRow>[] = [
    { key: 'number', title: '№', render: (c) => <b className="mono">{c.number}</b> },
    { key: 'client_name', title: 'Клиент' },
    { key: 'manager_name', title: 'Менеджер' },
    { key: 'slots_count', title: 'Слотов' },
    { key: 'placement_cost', title: 'Сумма', render: (c) => fmtMoney(c.placement_cost + c.production_cost) },
    { key: 'reserve_until', title: 'Бронь до', render: (c) => {
      const expiringSoon = c.reserve_until && c.reserve_until <= new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      return <b style={{ color: expiringSoon ? '#d05555' : '#c07f18' }}>{fmtDate(c.reserve_until)}</b>;
    } },
    { key: 'status', title: 'Статус', render: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>Брони / Резервы</h1></div>
      <div className="page-sub">
        Забронированные кампании удерживают ёмкость петли до даты «Бронь до». Просроченные брони снимаются автоматически, ёмкость освобождается.
      </div>
      <DataTable columns={columns} rows={rows} onRowClick={(c) => nav(`/campaigns/${c.id}`)}
        emptyText="Активных броней нет" />
    </div>
  );
}

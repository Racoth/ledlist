import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, fmtMoney, fmtDate } from '../api';
import { DataTable, Column, StatusBadge, Icon } from '../components/ui';
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
    { key: 'slots_count', title: 'Слотов', render: (c) => <span className="num">{c.slots_count}</span> },
    { key: 'placement_cost', title: 'Сумма', sortValue: (c) => c.placement_cost + c.production_cost,
      render: (c) => <span className="num">{fmtMoney(c.placement_cost + c.production_cost)}</span> },
    { key: 'reserve_until', title: 'Бронь до', render: (c) => {
      const soon = c.reserve_until && c.reserve_until <= new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      return (
        <span className="cell-stack" style={{ justifyItems: 'start' }}>
          <b className="num">{fmtDate(c.reserve_until)}</b>
          {soon && <span className="badge is-crit"><Icon name="alert" size={11} /> истекает</span>}
        </span>
      );
    } },
    { key: 'status', title: 'Статус', render: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>Брони</h1></div>
      <div className="page-sub">
        Бронь удерживает секунды блока до указанной даты. Когда срок проходит, бронь снимается автоматически
        и ёмкость возвращается в продажу.
      </div>
      <DataTable caption="Активные брони" columns={columns} rows={rows} onRowClick={(c) => nav(`/campaigns/${c.id}`)}
        emptyText="Активных броней нет"
        emptyHint="Забронировать клиента можно из карточки кампании или прямо из окна занятости экрана." />
    </div>
  );
}

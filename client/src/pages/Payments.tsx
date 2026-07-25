import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, fmtMoney, fmtDate } from '../api';
import { DataTable, Column } from '../components/ui';

export default function Payments() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => { get('/payments').then(setRows).catch(() => {}); }, []);

  const total = rows.reduce((a, p) => a + p.amount, 0);

  const columns: Column<any>[] = [
    { key: 'pay_date', title: 'Дата', render: (p) => fmtDate(p.pay_date) },
    { key: 'campaign_number', title: 'Кампания', render: (p) => <Link to={`/campaigns/${p.campaign_id}`} className="mono">{p.campaign_number}</Link> },
    { key: 'client_name', title: 'Клиент' },
    { key: 'amount', title: 'Сумма', sortValue: (p) => p.amount, render: (p) => <b className="num">{fmtMoney(p.amount)}</b> },
    { key: 'method', title: 'Способ', render: (p) => ({ bank: 'Банковский перевод', cash: 'Наличные', card: 'Карта' } as any)[p.method] },
    { key: 'comment', title: 'Комментарий', render: (p) => p.comment ?? <span className="muted">—</span> },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>Платежи</h1></div>
      <div className="summary-cards">
        <div className="scard"><div className="l">Всего платежей</div><div className="v">{rows.length}</div></div>
        <div className="scard is-money"><div className="l">Сумма поступлений</div><div className="v">{fmtMoney(total)}</div></div>
      </div>
      <div className="page-sub">Реестр всех поступлений. Новый платёж проводится в карточке кампании, на вкладке «Оплата».</div>
      <DataTable caption="Реестр платежей" columns={columns} rows={rows}
        emptyText="Платежей нет"
        emptyHint="Откройте кампанию и проведите оплату — платёж появится здесь." />
    </div>
  );
}

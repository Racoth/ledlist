import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { get, post, put, del, uploadFile, fmtMoney, fmtDate, todayISO, plusDaysISO, getToken } from '../api';
import { Modal, TextInput, SelectInput, StatusBadge, LoadBar, Field } from '../components/ui';

export default function CampaignCard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<any | null>(null);
  const [tab, setTab] = useState<'placement' | 'creatives' | 'payment'>('placement');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);

  const load = () => get(`/campaigns/${id}`).then(setC).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (!c) return <div className="page">{error ? <div className="error-box">{error}</div> : 'Загрузка…'}</div>;

  const placement = c.slots.reduce((a: number, s: any) => a + s.price, 0);
  const total = placement + c.production_cost;
  const paid = c.payments.reduce((a: number, p: any) => a + p.amount, 0);

  async function setStatus(status: string) {
    setError(''); setOk('');
    try {
      await post(`/campaigns/${id}/status`, { status });
      setOk(status === 'reserved' ? 'Слоты забронированы — ёмкость петли удержана.' : status === 'sold' ? 'Кампания продана.' : 'Статус обновлён.');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const transitions: Record<string, { to: string; label: string; cls?: string }[]> = {
    draft: [{ to: 'reserved', label: 'Забронировать слоты' }, { to: 'cancelled', label: 'Отменить', cls: 'danger' }],
    reserved: [{ to: 'sold', label: 'Продано (оплачено)' }, { to: 'draft', label: 'Вернуть в черновик', cls: 'secondary' }, { to: 'cancelled', label: 'Отменить', cls: 'danger' }],
    sold: [{ to: 'cancelled', label: 'Отменить (освободить петлю)', cls: 'danger' }],
    cancelled: [{ to: 'draft', label: 'Возобновить как черновик', cls: 'secondary' }],
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Кампания {c.number} <StatusBadge status={c.status} /></h1>
        {transitions[c.status]?.map((t) => (
          <button key={t.to} className={`btn ${t.cls ?? ''}`} onClick={() => setStatus(t.to)}>{t.label}</button>
        ))}
      </div>
      <div className="page-sub">
        <Link to="/campaigns">← к списку кампаний</Link> · Создана {fmtDate(c.created_at)} {c.created_at.slice(11, 16)}
        {c.status === 'reserved' && c.reserve_until && <> · <b style={{ color: '#c07f18' }}>бронь до {fmtDate(c.reserve_until)}</b></>}
      </div>

      {error && <div className="error-box">{error}</div>}
      {ok && <div className="ok-box">{ok}</div>}

      <div className="summary-cards">
        <div className="scard"><div className="v">{c.client_name ?? '—'}</div><div className="l">Клиент</div></div>
        <div className="scard"><div className="v">{c.manager_name ?? '—'}</div><div className="l">Менеджер</div></div>
        <div className="scard"><div className="v">{fmtMoney(placement)}</div><div className="l">Размещение</div></div>
        <div className="scard"><div className="v">{fmtMoney(c.production_cost)}</div><div className="l">Производство ролика</div></div>
        <div className="scard"><div className="v">{fmtMoney(total)}</div><div className="l">Итого</div></div>
        <div className="scard"><div className="v" style={{ color: paid >= total && total > 0 ? '#3ca55c' : '#c07f18' }}>{fmtMoney(paid)}</div><div className="l">Оплачено</div></div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'placement' ? 'active' : ''}`} onClick={() => setTab('placement')}>Размещение ({c.slots.length})</button>
        <button className={`tab ${tab === 'creatives' ? 'active' : ''}`} onClick={() => setTab('creatives')}>Креативы ({c.creatives.length})</button>
        <button className={`tab ${tab === 'payment' ? 'active' : ''}`} onClick={() => setTab('payment')}>Оплата ({c.payments.length})</button>
      </div>

      {tab === 'placement' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={() => setSlotOpen(true)}>+ Добавить слот размещения</button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Экран</th><th>Ролик</th><th>Длит., сек</th><th>Выходов/сут</th><th>Период</th><th>Тайм-слот</th><th>Цена</th><th></th></tr></thead>
              <tbody>
                {c.slots.length === 0 && <tr><td className="empty-row" colSpan={8}>Слоты не добавлены. Добавьте размещение на экранах.</td></tr>}
                {c.slots.map((s: any) => (
                  <tr key={s.id}>
                    <td><b className="mono">{s.screen_code}</b><br /><span className="muted" style={{ fontSize: 12 }}>{s.screen_name}</span></td>
                    <td>{s.creative_name ?? <span className="muted">—</span>}</td>
                    <td>{s.duration_sec}</td>
                    <td>{s.plays_per_day || '—'}</td>
                    <td>{fmtDate(s.date_from)} — {fmtDate(s.date_to)}</td>
                    <td>{s.time_slot_name ?? 'Весь день'}</td>
                    <td><b>{fmtMoney(s.price)}</b></td>
                    <td>
                      <button className="btn small danger" onClick={async () => {
                        if (!confirm('Удалить слот?')) return;
                        await del(`/slots/${s.id}`); load();
                      }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'creatives' && <CreativesTab campaign={c} reload={load} />}
      {tab === 'payment' && <PaymentTab campaign={c} reload={load} total={total} paid={paid} />}

      {slotOpen && (
        <AddSlotModal campaign={c} onClose={() => setSlotOpen(false)}
          onAdded={(warn) => { setSlotOpen(false); if (warn) setError(`Слот добавлен в черновик, но: ${warn}`); load(); }} />
      )}
    </div>
  );
}

// ---------- Добавление слота: доступность + калькулятор ----------
function AddSlotModal(props: { campaign: any; onClose: () => void; onAdded: (warning: string | null) => void }) {
  const [screens, setScreens] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    screen_id: '', duration_sec: 10, plays_per_day: 720,
    date_from: todayISO(), date_to: plusDaysISO(29), time_slot_id: '', creative_id: '',
  });
  const [capacity, setCapacity] = useState<any | null>(null);
  const [calc, setCalc] = useState<any | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get('/screens'), get('/time-slots')]).then(([s, t]) => { setScreens(s); setTimeSlots(t); });
  }, []);

  // проверка доступности и расчёт цены при изменении параметров
  useEffect(() => {
    setCapacity(null); setCalc(null);
    if (!form.screen_id || !form.duration_sec || !form.date_from || !form.date_to) return;
    const timer = setTimeout(async () => {
      try {
        const [cap, price] = await Promise.all([
          post('/capacity/check', {
            screen_id: Number(form.screen_id), date_from: form.date_from, date_to: form.date_to,
            duration_sec: Number(form.duration_sec),
          }),
          post('/calc/price', {
            screen_id: Number(form.screen_id), duration_sec: Number(form.duration_sec),
            plays_per_day: Number(form.plays_per_day), date_from: form.date_from, date_to: form.date_to,
            time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
            discount_percent: props.campaign.discount_percent,
          }),
        ]);
        setCapacity(cap); setCalc(price);
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.screen_id, form.duration_sec, form.date_from, form.date_to, form.plays_per_day, form.time_slot_id]);

  async function add() {
    setError('');
    try {
      const res = await post(`/campaigns/${props.campaign.id}/slots`, {
        screen_id: Number(form.screen_id), duration_sec: Number(form.duration_sec),
        date_from: form.date_from, date_to: form.date_to, plays_per_day: Number(form.plays_per_day),
        time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
        creative_id: form.creative_id ? Number(form.creative_id) : null,
        price: calc?.total,
      });
      props.onAdded(res.capacity_warning);
    } catch (e: any) { setError(e.message); }
  }

  const screen = screens.find((s) => String(s.id) === String(form.screen_id));
  const capBlocked = capacity && !capacity.ok && ['reserved', 'sold'].includes(props.campaign.status);

  return (
    <Modal title="Слот размещения в петле" wide onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={add} disabled={!form.screen_id || !!capBlocked}>
          Добавить слот {calc ? `— ${fmtMoney(calc.total)}` : ''}
        </button>
      </>}>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid">
        <SelectInput label="Экран" required value={form.screen_id} onChange={(v) => setForm({ ...form, screen_id: v })}
          options={screens.filter((s) => s.status === 'active').map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
        <SelectInput label="Длительность ролика, сек" required value={form.duration_sec} allowEmpty={false}
          onChange={(v) => setForm({ ...form, duration_sec: v })}
          options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} сек` }))} />
        <TextInput label="Выходов в сутки" type="number" value={form.plays_per_day} onChange={(v) => setForm({ ...form, plays_per_day: v })}
          hint={screen ? `≈ ${Math.round(Number(form.plays_per_day || 0) / 18)} в час при 18 ч работы` : undefined} />
        <TextInput label="Период: с" type="date" value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
        <TextInput label="Период: по" type="date" value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
        <SelectInput label="Тайм-слот (часть суток)" value={form.time_slot_id} onChange={(v) => setForm({ ...form, time_slot_id: v })}
          options={timeSlots.map((t) => ({ value: t.id, label: `${t.name} ${t.time_from}–${t.time_to} (×${t.price_coef})` }))} />
        <SelectInput label="Ролик (из загруженных)" value={form.creative_id} onChange={(v) => setForm({ ...form, creative_id: v })}
          options={props.campaign.creatives.map((cr: any) => ({ value: cr.id, label: cr.filename }))} />
      </div>

      {capacity && (
        <div className="panel" style={{ marginTop: 16, marginBottom: 0, borderColor: capacity.ok ? '#b3dfc2' : '#f0b8b8' }}>
          <h3>Проверка ёмкости петли</h3>
          {capacity.ok ? (
            <div className="ok-box" style={{ marginBottom: 8 }}>
              Ролик помещается. Загрузка петли на периоде: до {capacity.load.max_load_pct}%
              (свободно {capacity.load.free_sec} сек из {capacity.load.loop_duration_sec}).
            </div>
          ) : (
            <div className="error-box" style={{ marginBottom: 8 }}>{capacity.reason}</div>
          )}
          {(capacity.load ?? capacity)?.days && (
            <LoadBar pct={(capacity.load ?? capacity).max_load_pct + (capacity.ok ? Math.round((Number(form.duration_sec) / (capacity.load ?? capacity).loop_duration_sec) * 1000) / 10 : 0)} />
          )}
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>прогноз с учётом добавляемого ролика</span>
        </div>
      )}

      {calc && (
        <div className="panel" style={{ marginTop: 16, marginBottom: 0 }}>
          <h3>Калькулятор стоимости</h3>
          <dl className="kv">
            <dt>Дней в периоде</dt><dd>{calc.days}</dd>
            <dt>База ({fmtMoney(calc.price_per_sec)}/сек × {form.duration_sec} сек × {form.plays_per_day} вых. × {calc.days} дн.)</dt><dd>{fmtMoney(calc.base)}</dd>
            {calc.coef !== 1 && <><dt>Коэффициент тайм-слота «{calc.time_slot}»</dt><dd>×{calc.coef}</dd></>}
            {calc.discount_percent > 0 && <><dt>Скидка {calc.discount_percent}%</dt><dd>−{fmtMoney(calc.discount_amount)}</dd></>}
            {calc.tax_rate > 0 && <><dt>Налог ({calc.tax_name})</dt><dd>+{fmtMoney(calc.tax)}</dd></>}
            <dt><b>Итого за слот</b></dt><dd><b>{fmtMoney(calc.total)}</b></dd>
          </dl>
        </div>
      )}
    </Modal>
  );
}

// ---------- Креативы ----------
function CreativesTab({ campaign, reload }: { campaign: any; reload: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setBusy(true);
    try {
      // валидация: разрешение и длительность считываются в браузере
      const meta = await readMediaMeta(file);
      await uploadFile(`/campaigns/${campaign.id}/creatives`, file, {
        duration_sec: meta.duration ?? '',
        width: meta.width ?? '',
        height: meta.height ?? '',
      } as any);
      reload();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); e.target.value = ''; }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div style={{ marginBottom: 12 }}>
        <label className="btn" style={{ display: 'inline-block' }}>
          {busy ? 'Загрузка…' : '+ Загрузить ролик (mp4, jpg, png, gif)'}
          <input type="file" accept="video/mp4,image/jpeg,image/png,image/gif" style={{ display: 'none' }} onChange={onFile} disabled={busy} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Файл</th><th>Тип</th><th>Разрешение</th><th>Длительность</th><th>Размер</th><th>Загружен</th><th></th></tr></thead>
          <tbody>
            {campaign.creatives.length === 0 && <tr><td className="empty-row" colSpan={7}>Креативы не загружены</td></tr>}
            {campaign.creatives.map((cr: any) => (
              <tr key={cr.id}>
                <td><a href={`/api/creatives/${cr.id}/file?token=${getToken()}`} target="_blank" rel="noreferrer">{cr.filename}</a></td>
                <td>{cr.mime}</td>
                <td>{cr.width ? `${cr.width}×${cr.height}` : '—'}</td>
                <td>{cr.duration_sec ? `${Math.round(cr.duration_sec * 10) / 10} сек` : '—'}</td>
                <td>{cr.size_bytes ? `${(cr.size_bytes / 1024 / 1024).toFixed(1)} МБ` : '—'}</td>
                <td>{fmtDate(cr.uploaded_at)}</td>
                <td><button className="btn small danger" onClick={async () => { if (confirm('Удалить креатив?')) { await del(`/creatives/${cr.id}`); reload(); } }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function readMediaMeta(file: File): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); URL.revokeObjectURL(url); };
      v.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
      img.src = url;
    }
  });
}

// ---------- Оплата ----------
function PaymentTab({ campaign, reload, total, paid }: { campaign: any; reload: () => void; total: number; paid: number }) {
  const [form, setForm] = useState<any>({ pay_date: todayISO(), amount: '', method: 'bank', comment: '' });
  const [error, setError] = useState('');

  async function add() {
    setError('');
    try {
      await post('/payments', { campaign_id: campaign.id, ...form, amount: Number(form.amount) });
      setForm({ ...form, amount: '', comment: '' });
      reload();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div className="panel">
        <h3>Добавить платёж {total > paid && <span className="muted" style={{ fontWeight: 400 }}>— остаток {fmtMoney(total - paid)}</span>}</h3>
        <div className="form-grid">
          <TextInput label="Дата" type="date" value={form.pay_date} onChange={(v) => setForm({ ...form, pay_date: v })} />
          <TextInput label="Сумма, ₽" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          <SelectInput label="Способ" value={form.method} allowEmpty={false} onChange={(v) => setForm({ ...form, method: v })}
            options={[{ value: 'bank', label: 'Банковский перевод' }, { value: 'cash', label: 'Наличные' }, { value: 'card', label: 'Карта' }]} />
          <TextInput label="Комментарий" value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={add} disabled={!form.amount}>Провести платёж</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Дата</th><th>Сумма</th><th>Способ</th><th>Комментарий</th></tr></thead>
          <tbody>
            {campaign.payments.length === 0 && <tr><td className="empty-row" colSpan={4}>Платежей нет</td></tr>}
            {campaign.payments.map((p: any) => (
              <tr key={p.id}>
                <td>{fmtDate(p.pay_date)}</td>
                <td><b>{fmtMoney(p.amount)}</b></td>
                <td>{{ bank: 'Банковский перевод', cash: 'Наличные', card: 'Карта' }[p.method as string]}</td>
                <td>{p.comment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

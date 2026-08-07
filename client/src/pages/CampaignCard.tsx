import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { get, post, del, uploadFile, fmtMoney, fmtDate, todayISO, plusDaysISO, getToken } from '../api';
import { Modal, TextInput, SelectInput, StatusBadge, LoadBar, Alert, Icon } from '../components/ui';

const METHOD_RU: Record<string, string> = { bank: 'Банковский перевод', cash: 'Наличные', card: 'Карта' };

export default function CampaignCard() {
  const { id } = useParams();
  const [c, setC] = useState<any | null>(null);
  const [tab, setTab] = useState<'placement' | 'creatives' | 'payment'>('placement');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);

  const load = () => get(`/campaigns/${id}`).then(setC).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (!c) return <div className="page">{error ? <Alert tone="error">{error}</Alert> : <p className="muted">Загружаем кампанию…</p>}</div>;

  const placement = c.slots.reduce((a: number, s: any) => a + s.price, 0);
  const total = placement + c.production_cost;
  const paid = c.payments.reduce((a: number, p: any) => a + p.amount, 0);

  async function setStatus(status: string) {
    setError(''); setOk('');
    try {
      await post(`/campaigns/${id}/status`, { status });
      setOk(
        status === 'reserved' ? 'Слоты забронированы — ёмкость блока удержана.'
        : status === 'sold' ? 'Кампания продана.'
        : status === 'cancelled' ? 'Кампания отменена, блок освобождён.'
        : 'Кампания возвращена в черновик.');
      load();
    } catch (e: any) { setError(e.message); }
  }

  const transitions: Record<string, { to: string; label: string; cls?: string }[]> = {
    draft: [{ to: 'reserved', label: 'Забронировать слоты' }, { to: 'cancelled', label: 'Отменить', cls: 'secondary' }],
    reserved: [{ to: 'sold', label: 'Отметить проданной' }, { to: 'draft', label: 'Вернуть в черновик', cls: 'secondary' }, { to: 'cancelled', label: 'Отменить', cls: 'danger' }],
    sold: [{ to: 'cancelled', label: 'Отменить и освободить блок', cls: 'danger' }],
    cancelled: [{ to: 'draft', label: 'Возобновить как черновик', cls: 'secondary' }],
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <span className="mono">{c.number}</span>
          <StatusBadge status={c.status} />
        </h1>
        <div className="toolbar">
          {transitions[c.status]?.map((t) => (
            <button key={t.to} className={`btn ${t.cls ?? ''}`} onClick={() => setStatus(t.to)}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="page-sub">
        <Link to="/campaigns"><Icon name="back" size={12} /> Все кампании</Link>
        {' · '}создана {fmtDate(c.created_at)} в {c.created_at.slice(11, 16)}
        {c.status === 'reserved' && c.reserve_until && <> · <b style={{ color: 'var(--warn-ink)' }}>бронь держится до {fmtDate(c.reserve_until)}</b></>}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}

      <div className="summary-cards">
        <div className="scard"><div className="l">Клиент</div><div className="v" style={{ fontSize: 15 }}>{c.client_name ?? '—'}</div></div>
        <div className="scard"><div className="l">Менеджер</div><div className="v" style={{ fontSize: 15 }}>{c.manager_name ?? '—'}</div></div>
        <div className="scard is-money"><div className="l">Размещение</div><div className="v">{fmtMoney(placement)}</div></div>
        <div className="scard is-money"><div className="l">Производство ролика</div><div className="v">{fmtMoney(c.production_cost)}</div></div>
        <div className="scard is-money"><div className="l">Итого</div><div className="v">{fmtMoney(total)}</div></div>
        <div className="scard is-money">
          <div className="l">Оплачено</div>
          <div className={'v ' + (paid >= total && total > 0 ? 'paid-full' : paid > 0 ? 'paid-part' : '')}>{fmtMoney(paid)}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'placement'} className={`tab ${tab === 'placement' ? 'active' : ''}`} onClick={() => setTab('placement')}>
          Размещение <span className="count">{c.slots.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'creatives'} className={`tab ${tab === 'creatives' ? 'active' : ''}`} onClick={() => setTab('creatives')}>
          Креативы <span className="count">{c.creatives.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'payment'} className={`tab ${tab === 'payment' ? 'active' : ''}`} onClick={() => setTab('payment')}>
          Оплата <span className="count">{c.payments.length}</span>
        </button>
      </div>

      {tab === 'placement' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={() => setSlotOpen(true)}>
              <Icon name="plus" size={14} /> Добавить слот размещения
            </button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th scope="col"><span className="th-btn">Экран</span></th>
                <th scope="col"><span className="th-btn">Ролик</span></th>
                <th scope="col"><span className="th-btn">Длит., сек</span></th>
                <th scope="col"><span className="th-btn">Выходов/сут</span></th>
                <th scope="col"><span className="th-btn">Период</span></th>
                <th scope="col"><span className="th-btn">Тайм-слот</span></th>
                <th scope="col"><span className="th-btn">Цена</span></th>
                <th scope="col"><span className="th-btn" /></th>
              </tr></thead>
              <tbody>
                {c.slots.length === 0 && (
                  <tr><td className="empty-row" colSpan={8}>
                    <span className="empty-state">
                      <b>Слотов пока нет</b>
                      <span>Добавьте размещение на экране — калькулятор посчитает стоимость, а проверка покажет, влезает ли ролик в блок.</span>
                    </span>
                  </td></tr>
                )}
                {c.slots.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <span className="screen-name">
                        <b className="mono">{s.screen_code}</b>
                        <span className="addr">{s.screen_name}</span>
                      </span>
                    </td>
                    <td>{s.creative_name ?? <span className="muted">не назначен</span>}</td>
                    <td className="num">{s.duration_sec}</td>
                    <td className="num">{s.plays_per_day || '—'}</td>
                    <td>{fmtDate(s.date_from)} — {fmtDate(s.date_to)}</td>
                    <td>{s.time_slot_name ?? 'Весь день'}</td>
                    <td><b className="num">{fmtMoney(s.price)}</b></td>
                    <td>
                      <button className="btn small ghost" aria-label="Удалить слот" onClick={async () => {
                        if (!confirm('Удалить слот размещения?')) return;
                        await del(`/slots/${s.id}`); load();
                      }}><Icon name="trash" size={14} /></button>
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

// ---------- Добавление слота: проверка ёмкости + калькулятор ----------
function AddSlotModal(props: { campaign: any; onClose: () => void; onAdded: (warning: string | null) => void }) {
  const [screens, setScreens] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    screen_id: '', duration_sec: 10,
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
            date_from: form.date_from, date_to: form.date_to,
            time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
            discount_percent: props.campaign.discount_percent,
          }),
        ]);
        setCapacity(cap); setCalc(price);
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.screen_id, form.duration_sec, form.date_from, form.date_to, form.time_slot_id]);

  async function add() {
    setError('');
    try {
      const res = await post(`/campaigns/${props.campaign.id}/slots`, {
        screen_id: Number(form.screen_id), duration_sec: Number(form.duration_sec),
        date_from: form.date_from, date_to: form.date_to,
        time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
        creative_id: form.creative_id ? Number(form.creative_id) : null,
        price: calc?.total,
      });
      props.onAdded(res.capacity_warning);
    } catch (e: any) { setError(e.message); }
  }

  const screen = screens.find((s) => String(s.id) === String(form.screen_id));
  const capBlocked = capacity && !capacity.ok && ['reserved', 'sold'].includes(props.campaign.status);
  const cap = capacity?.load ?? capacity;
  const forecast = cap?.days
    ? cap.max_load_pct + (capacity.ok ? Math.round((Number(form.duration_sec) / cap.loop_duration_sec) * 1000) / 10 : 0)
    : null;

  return (
    <Modal title="Слот размещения в блоке" subtitle={`Кампания ${props.campaign.number}`} wide onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={add} disabled={!form.screen_id || !!capBlocked}>
          Добавить слот{calc ? ` — ${fmtMoney(calc.total)}` : ''}
        </button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <SelectInput label="Экран" required value={form.screen_id} onChange={(v) => setForm({ ...form, screen_id: v })}
          options={screens.filter((s) => s.status === 'active').map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
        <SelectInput label="Длительность ролика" required value={form.duration_sec} allowEmpty={false}
          onChange={(v) => setForm({ ...form, duration_sec: v })}
          options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} сек` }))} />
        <TextInput label="Период: с" type="date" value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
        <TextInput label="Период: по" type="date" value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
        <SelectInput label="Тайм-слот" value={form.time_slot_id} onChange={(v) => setForm({ ...form, time_slot_id: v })}
          hint="Часть суток; влияет на цену"
          options={timeSlots.map((t) => ({ value: t.id, label: `${t.name} ${t.time_from}–${t.time_to} (×${t.price_coef})` }))} />
        <SelectInput label="Ролик" value={form.creative_id} onChange={(v) => setForm({ ...form, creative_id: v })}
          hint="Из загруженных на вкладке «Креативы»"
          options={props.campaign.creatives.map((cr: any) => ({ value: cr.id, label: cr.filename }))} />
      </div>

      {capacity && (
        <div className="panel" style={{ marginTop: 16, marginBottom: 0 }}>
          <h3>Ёмкость блока</h3>
          {capacity.ok
            ? <Alert tone="ok">Ролик помещается: до {cap.max_load_pct}% загрузки, свободно {cap.free_sec} из {cap.loop_duration_sec} сек.</Alert>
            : <Alert tone="error">{capacity.reason}</Alert>}
          {forecast != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LoadBar pct={forecast} loop={cap.loop_duration_sec} />
              <span className="muted" style={{ fontSize: 12 }}>прогноз с учётом добавляемого ролика</span>
            </div>
          )}
        </div>
      )}

      {calc && (
        <div className="panel" style={{ marginTop: 16, marginBottom: 0 }}>
          <h3>Расчёт стоимости</h3>
          <dl className="kv">
            <dt>Ставка экрана</dt><dd>{fmtMoney(calc.price_per_sec_month)} за 1 сек / 30 дней</dd>
            <dt>Ролик {form.duration_sec} сек на 30 дней</dt><dd>{fmtMoney(calc.month_price)}</dd>
            <dt>Период: {calc.days} дн. из {calc.period_days}</dt><dd>{fmtMoney(calc.base)}</dd>
            {calc.coef !== 1 && <><dt>Коэффициент тайм-слота «{calc.time_slot}»</dt><dd>×{calc.coef}</dd></>}
            {calc.discount_percent > 0 && <><dt>Скидка {calc.discount_percent}%</dt><dd>−{fmtMoney(calc.discount_amount)}</dd></>}
            {calc.tax_rate > 0 && <><dt>Налог ({calc.tax_name})</dt><dd>+{fmtMoney(calc.tax)}</dd></>}
            <dt><b>Итого за слот</b></dt><dd><b>{fmtMoney(calc.total)}</b></dd>
            <dt>Выходов в сутки</dt><dd>≈ {calc.plays_per_day} <span className="muted">(один показ за оборот блока)</span></dd>
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
      // разрешение и длительность считываются в браузере
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
      {error && <Alert tone="error">{error}</Alert>}
      <div style={{ marginBottom: 12 }}>
        <label className="btn" style={{ display: 'inline-flex' }}>
          <Icon name="upload" size={14} />
          {busy ? 'Загружаем…' : 'Загрузить ролик'}
          <input type="file" accept="video/mp4,image/jpeg,image/png,image/gif" style={{ display: 'none' }} onChange={onFile} disabled={busy} />
        </label>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: 10 }}>mp4, jpg, png, gif</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            <th scope="col"><span className="th-btn">Файл</span></th>
            <th scope="col"><span className="th-btn">Тип</span></th>
            <th scope="col"><span className="th-btn">Разрешение</span></th>
            <th scope="col"><span className="th-btn">Длительность</span></th>
            <th scope="col"><span className="th-btn">Размер</span></th>
            <th scope="col"><span className="th-btn">Загружен</span></th>
            <th scope="col"><span className="th-btn" /></th>
          </tr></thead>
          <tbody>
            {campaign.creatives.length === 0 && (
              <tr><td className="empty-row" colSpan={7}>
                <span className="empty-state">
                  <b>Роликов нет</b>
                  <span>Загрузите креатив — его длительность подскажет, сколько секунд блока занять.</span>
                </span>
              </td></tr>
            )}
            {campaign.creatives.map((cr: any) => (
              <tr key={cr.id}>
                <td><a href={`/api/creatives/${cr.id}/file?token=${getToken()}`} target="_blank" rel="noreferrer">{cr.filename}</a></td>
                <td className="muted">{cr.mime}</td>
                <td className="mono">{cr.width ? `${cr.width}×${cr.height}` : '—'}</td>
                <td className="num">{cr.duration_sec ? `${Math.round(cr.duration_sec * 10) / 10} сек` : '—'}</td>
                <td className="num">{cr.size_bytes ? `${(cr.size_bytes / 1024 / 1024).toFixed(1)} МБ` : '—'}</td>
                <td>{fmtDate(cr.uploaded_at)}</td>
                <td>
                  <button className="btn small ghost" aria-label={`Удалить ${cr.filename}`}
                    onClick={async () => { if (confirm('Удалить креатив?')) { await del(`/creatives/${cr.id}`); reload(); } }}>
                    <Icon name="trash" size={14} />
                  </button>
                </td>
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

  const left = total - paid;

  return (
    <div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="panel">
        <h3>
          Провести платёж
          {left > 0
            ? <span className="muted" style={{ fontWeight: 400 }}>остаток {fmtMoney(left)}</span>
            : total > 0 && <span style={{ fontWeight: 400, color: 'var(--good-ink)' }}>кампания оплачена полностью</span>}
        </h3>
        <div className="form-grid">
          <TextInput label="Дата" type="date" value={form.pay_date} onChange={(v) => setForm({ ...form, pay_date: v })} />
          <TextInput label="Сумма, ₽" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })}
            placeholder={left > 0 ? String(Math.round(left)) : ''} />
          <SelectInput label="Способ" value={form.method} allowEmpty={false} onChange={(v) => setForm({ ...form, method: v })}
            options={Object.entries(METHOD_RU).map(([value, label]) => ({ value, label }))} />
          <TextInput label="Комментарий" value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} />
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={add} disabled={!form.amount}>Провести платёж</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            <th scope="col"><span className="th-btn">Дата</span></th>
            <th scope="col"><span className="th-btn">Сумма</span></th>
            <th scope="col"><span className="th-btn">Способ</span></th>
            <th scope="col"><span className="th-btn">Комментарий</span></th>
          </tr></thead>
          <tbody>
            {campaign.payments.length === 0 && (
              <tr><td className="empty-row" colSpan={4}>
                <span className="empty-state"><b>Платежей нет</b><span>Проведите первый — он появится и в общем реестре.</span></span>
              </td></tr>
            )}
            {campaign.payments.map((p: any) => (
              <tr key={p.id}>
                <td>{fmtDate(p.pay_date)}</td>
                <td><b className="num">{fmtMoney(p.amount)}</b></td>
                <td>{METHOD_RU[p.method as string]}</td>
                <td className="muted">{p.comment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

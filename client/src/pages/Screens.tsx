import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put, del, fmtMoney, fmtDate, getUser, todayISO, plusDaysISO } from '../api';
import { DataTable, Modal, TextInput, SelectInput, StatusBadge, LoadBar, ColumnsButton, Column, Field } from '../components/ui';

interface Screen {
  id: number; code: string; name: string; side: string | null; address: string; city_id: number | null;
  city_name?: string; region?: string; lat: number | null; lng: number | null;
  width_m: number | null; height_m: number | null; res_w: number | null; res_h: number | null;
  pixel_pitch: string | null; brightness: number | null; screen_type_id: number | null; type_name?: string;
  orientation: string; loop_duration_sec: number; work_from: string; work_to: string;
  price_per_play: number; price_per_sec: number; tax_regime_id: number | null; tax_name?: string;
  owner_id: number | null; owner_name?: string; status: string; tags: string | null; comment: string | null;
  load?: { max_load_pct: number; avg_load_pct: number; free_sec: number; loop: number } | null;
}

// ---------- Фильтр с несколькими условиями ----------
interface FilterCond { field: string; op: string; value: string }

const FILTER_FIELDS = [
  { key: 'code', label: 'Код экрана', type: 'text' },
  { key: 'name', label: 'Название/адрес', type: 'text' },
  { key: 'side', label: 'Сторона', type: 'text' },
  { key: 'city_name', label: 'Город', type: 'text' },
  { key: 'type_name', label: 'Тип экрана', type: 'text' },
  { key: 'pixel_pitch', label: 'Шаг пикселя', type: 'text' },
  { key: 'owner_name', label: 'Владелец', type: 'text' },
  { key: 'status', label: 'Статус', type: 'select', options: ['active', 'maintenance', 'inactive'] },
  { key: 'tags', label: 'Теги', type: 'text' },
  { key: 'load_pct', label: 'Загрузка петли, %', type: 'number' },
  { key: 'brightness', label: 'Яркость, нит', type: 'number' },
];

function condMatches(s: Screen, c: FilterCond): boolean {
  let v: any;
  if (c.field === 'load_pct') v = s.load?.max_load_pct ?? 0;
  else if (c.field === 'name') v = `${s.name} ${s.address ?? ''}`;
  else v = (s as any)[c.field];
  const sv = String(v ?? '').toLowerCase();
  const cv = c.value.toLowerCase();
  switch (c.op) {
    case 'contains': return sv.includes(cv);
    case 'eq': return sv === cv || Number(v) === Number(c.value);
    case 'gte': return Number(v) >= Number(c.value);
    case 'lte': return Number(v) <= Number(c.value);
    default: return true;
  }
}

export default function Screens() {
  const user = getUser()!;
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  const [rows, setRows] = useState<Screen[]>([]);
  const [dicts, setDicts] = useState<any>({ cities: [], types: [], owners: [], taxes: [] });
  const [period, setPeriod] = useState({ from: todayISO(), to: plusDaysISO(29) });
  const [conds, setConds] = useState<FilterCond[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editScreen, setEditScreen] = useState<Partial<Screen> | null>(null);
  const [playlistScreen, setPlaylistScreen] = useState<Screen | null>(null);
  const [scheduleScreen, setScheduleScreen] = useState<Screen | null>(null);
  const [visibleCols, setVisibleCols] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem('screens_cols') ?? 'null') ??
    ['size', 'resolution', 'pitch', 'type_name', 'loop', 'price', 'owner_name']);
  const [error, setError] = useState('');

  useEffect(() => { localStorage.setItem('screens_cols', JSON.stringify(visibleCols)); }, [visibleCols]);

  async function load() {
    try {
      const [screens, cities, types, owners, taxes] = await Promise.all([
        get(`/screens?from=${period.from}&to=${period.to}`),
        get('/cities'), get('/screen-types'), get('/owners'), get('/tax-regimes'),
      ]);
      setRows(screens); setDicts({ cities, types, owners, taxes });
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [period.from, period.to]);

  const filtered = useMemo(
    () => rows.filter((s) => conds.every((c) => c.value === '' || condMatches(s, c))),
    [rows, conds]);

  const columns: Column<Screen>[] = [
    { key: 'code', title: 'Код', render: (s) => <b className="mono">{s.code}</b> },
    { key: 'name', title: 'Название / адрес', render: (s) => (
      <span>
        <a style={{ cursor: 'pointer', fontWeight: 600 }} title="Открыть занятость экрана"
          onClick={(e) => { e.stopPropagation(); setScheduleScreen(s); }}>{s.name}</a>
        <br /><span className="muted" style={{ fontSize: 12 }}>{s.address}</span>
      </span>
    ) },
    { key: 'side', title: 'Сторона', render: (s) => s.side || '—' },
    { key: 'city_name', title: 'Город' },
    { key: 'load', title: 'Загрузка петли', sortValue: (s) => s.load?.max_load_pct ?? 0,
      render: (s) => s.load ? <LoadBar pct={s.load.max_load_pct} /> : '—' },
    { key: 'free', title: 'Свободно, сек', optional: true, sortValue: (s) => s.load?.free_sec ?? 0,
      render: (s) => s.load ? `${s.load.free_sec} / ${s.load.loop}` : '—' },
    { key: 'size', title: 'Размер, м', optional: true, render: (s) => s.width_m ? `${s.width_m}×${s.height_m}` : '—' },
    { key: 'resolution', title: 'Разрешение', optional: true, render: (s) => s.res_w ? `${s.res_w}×${s.res_h}` : '—' },
    { key: 'pitch', title: 'Шаг пикселя', optional: true, render: (s) => s.pixel_pitch ?? '—' },
    { key: 'brightness', title: 'Яркость, нит', optional: true },
    { key: 'type_name', title: 'Тип', optional: true },
    { key: 'orientation', title: 'Ориентация', optional: true, render: (s) => s.orientation === 'vertical' ? 'Вертикальная' : 'Горизонтальная' },
    { key: 'loop', title: 'Петля, сек', optional: true, sortValue: (s) => s.loop_duration_sec, render: (s) => s.loop_duration_sec },
    { key: 'work', title: 'Часы работы', optional: true, render: (s) => `${s.work_from}–${s.work_to}` },
    { key: 'price', title: 'Цена, ₽/сек', optional: true, sortValue: (s) => s.price_per_sec, render: (s) => fmtMoney(s.price_per_sec) },
    { key: 'owner_name', title: 'Владелец', optional: true },
    { key: 'tax_name', title: 'Налоговый режим', optional: true },
    { key: 'tags', title: 'Теги', optional: true },
    { key: 'status', title: 'Статус', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'actions', title: '', render: (s) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setPlaylistScreen(s)}>Плейлист</button>
        {isAdmin && <button className="btn small secondary" onClick={() => setEditScreen(s)}>Изменить</button>}
      </span>
    ) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Инвентарь экранов</h1>
        <label className="muted" style={{ fontSize: 13 }}>Загрузка за период:</label>
        <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
        <span>—</span>
        <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        <button className="btn secondary" onClick={() => setFilterOpen(true)}>
          Фильтр {conds.length > 0 && `(${conds.length})`}
        </button>
        <ColumnsButton columns={columns} visible={visibleCols} onChange={setVisibleCols} />
        {isAdmin && <button className="btn" onClick={() => setEditScreen({ orientation: 'horizontal', loop_duration_sec: 60, work_from: '06:00', work_to: '24:00', status: 'active' })}>+ Добавить экран</button>}
      </div>

      {error && <div className="error-box">{error}</div>}

      {conds.length > 0 && (
        <div className="filter-chips">
          {conds.map((c, i) => {
            const f = FILTER_FIELDS.find((x) => x.key === c.field);
            const opLabel = { contains: 'содержит', eq: '=', gte: '≥', lte: '≤' }[c.op];
            return (
              <span className="chip" key={i}>
                {f?.label} {opLabel} «{c.value}»
                <button onClick={() => setConds(conds.filter((_, j) => j !== i))}>✕</button>
              </span>
            );
          })}
          <span className="chip"><button onClick={() => setConds([])}>Сбросить все ✕</button></span>
        </div>
      )}

      <div className="page-sub">Показано {filtered.length} из {rows.length} экранов. Загрузка петли — максимум за выбранный период.</div>

      <DataTable variant="inventory" columns={columns} rows={filtered} visibleKeys={[...visibleCols, 'code', 'name', 'side', 'city_name', 'load', 'status', 'actions']} />

      {filterOpen && (
        <FilterModal conds={conds} onApply={(c) => { setConds(c); setFilterOpen(false); }} onClose={() => setFilterOpen(false)} />
      )}
      {editScreen && (
        <ScreenForm screen={editScreen} dicts={dicts} onClose={() => setEditScreen(null)}
          onSaved={() => { setEditScreen(null); load(); }} />
      )}
      {playlistScreen && <PlaylistModal screen={playlistScreen} onClose={() => setPlaylistScreen(null)} />}
      {scheduleScreen && <ScheduleModal screen={scheduleScreen} onClose={() => setScheduleScreen(null)} />}
    </div>
  );
}

// ---------- Модальный фильтр ----------
function FilterModal(props: { conds: FilterCond[]; onApply: (c: FilterCond[]) => void; onClose: () => void }) {
  const [conds, setConds] = useState<FilterCond[]>(props.conds.length ? [...props.conds] : [{ field: 'code', op: 'contains', value: '' }]);

  function update(i: number, patch: Partial<FilterCond>) {
    setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <Modal title="Фильтр инвентаря" wide onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={() => setConds([{ field: 'code', op: 'contains', value: '' }])}>Сбросить</button>
        <button className="btn" onClick={() => props.onApply(conds.filter((c) => c.value !== ''))}>Применить</button>
      </>}>
      {conds.map((c, i) => {
        const f = FILTER_FIELDS.find((x) => x.key === c.field)!;
        const ops = f.type === 'number' ? [['gte', '≥'], ['lte', '≤'], ['eq', '=']] : [['contains', 'содержит'], ['eq', 'равно']];
        return (
          <div className="filter-row" key={i}>
            <select value={c.field} onChange={(e) => {
              const nf = FILTER_FIELDS.find((x) => x.key === e.target.value)!;
              update(i, { field: e.target.value, op: nf.type === 'number' ? 'gte' : 'contains', value: '' });
            }}>
              {FILTER_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={c.op} onChange={(e) => update(i, { op: e.target.value })} style={{ width: 110 }}>
                {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {f.type === 'select' ? (
                <select value={c.value} onChange={(e) => update(i, { value: e.target.value })} style={{ flex: 1 }}>
                  <option value="">—</option>
                  {f.options!.map((o) => <option key={o} value={o}>{{ active: 'Активен', maintenance: 'На обслуживании', inactive: 'Отключён' }[o]}</option>)}
                </select>
              ) : (
                <input style={{ flex: 1 }} type={f.type === 'number' ? 'number' : 'text'} value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })} placeholder="Значение…" />
              )}
            </div>
            <button className="btn small secondary" onClick={() => setConds(conds.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <button className="btn secondary small" onClick={() => setConds([...conds, { field: 'code', op: 'contains', value: '' }])}>
        + Добавить условие
      </button>
    </Modal>
  );
}

// ---------- Форма экрана (по секциям) ----------
function ScreenForm(props: { screen: Partial<Screen>; dicts: any; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<any>({ ...props.screen });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: any) => setS((prev: any) => ({ ...prev, [k]: v }));

  async function save() {
    if (!s.code || !s.name) { setError('Код и название обязательны'); return; }
    setBusy(true); setError('');
    const body: any = { ...s };
    delete body.id; delete body.city_name; delete body.region; delete body.type_name;
    delete body.owner_name; delete body.tax_name; delete body.load;
    for (const k of ['city_id', 'screen_type_id', 'owner_id', 'tax_regime_id']) body[k] = body[k] ? Number(body[k]) : null;
    for (const k of ['lat', 'lng', 'width_m', 'height_m', 'res_w', 'res_h', 'brightness', 'loop_duration_sec', 'price_per_play', 'price_per_sec']) {
      body[k] = body[k] === '' || body[k] == null ? null : Number(body[k]);
    }
    body.loop_duration_sec = body.loop_duration_sec ?? 60;
    body.price_per_play = body.price_per_play ?? 0;
    body.price_per_sec = body.price_per_sec ?? 0;
    try {
      if (props.screen.id) await put(`/screens/${props.screen.id}`, body);
      else await post('/screens', body);
      props.onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Удалить экран? Действие необратимо.')) return;
    try { await del(`/screens/${props.screen.id}`); props.onSaved(); }
    catch (e: any) { setError(e.message); }
  }

  const d = props.dicts;
  return (
    <Modal title={props.screen.id ? `Экран ${props.screen.code}` : 'Новый LED-экран'} wide onClose={props.onClose}
      footer={<>
        {props.screen.id && <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>Удалить</button>}
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
      </>}>
      {error && <div className="error-box">{error}</div>}

      <div className="form-section">
        <h3>Характеристики</h3>
        <div className="form-grid">
          <TextInput label="Код" required value={s.code} onChange={set('code')} placeholder="GRZLED04001" />
          <TextInput label="Название" required value={s.name} onChange={set('name')} placeholder="Экран «Центр»" />
          <TextInput label="Сторона" value={s.side} onChange={set('side')} placeholder="А"
            hint="Для двусторонних конструкций: А / Б. Для односторонних — А" />
          <SelectInput label="Тип экрана" value={s.screen_type_id} onChange={set('screen_type_id')}
            options={d.types.map((t: any) => ({ value: t.id, label: t.name }))} />
          <SelectInput label="Ориентация" value={s.orientation} onChange={set('orientation')} allowEmpty={false}
            options={[{ value: 'horizontal', label: 'Горизонтальная' }, { value: 'vertical', label: 'Вертикальная' }]} />
          <SelectInput label="Статус" value={s.status} onChange={set('status')} allowEmpty={false}
            options={[{ value: 'active', label: 'Активен' }, { value: 'maintenance', label: 'На обслуживании' }, { value: 'inactive', label: 'Отключён' }]} />
        </div>
      </div>

      <div className="form-section">
        <h3>Адрес и координаты</h3>
        <div className="form-grid">
          <SelectInput label="Город" value={s.city_id} onChange={set('city_id')}
            options={d.cities.map((c: any) => ({ value: c.id, label: `${c.name} (${c.region ?? '—'})` }))} />
          <TextInput label="Адрес" value={s.address} onChange={set('address')} placeholder="пр. Кадырова / ул. Мира" />
          <TextInput label="Широта" type="number" step="0.0001" value={s.lat} onChange={set('lat')} />
          <TextInput label="Долгота" type="number" step="0.0001" value={s.lng} onChange={set('lng')} />
        </div>
      </div>

      <div className="form-section">
        <h3>Технические параметры</h3>
        <div className="form-grid">
          <TextInput label="Ширина, м" type="number" step="0.1" value={s.width_m} onChange={set('width_m')} />
          <TextInput label="Высота, м" type="number" step="0.1" value={s.height_m} onChange={set('height_m')} />
          <TextInput label="Разрешение: ширина, px" type="number" value={s.res_w} onChange={set('res_w')} />
          <TextInput label="Разрешение: высота, px" type="number" value={s.res_h} onChange={set('res_h')} />
          <TextInput label="Шаг пикселя" value={s.pixel_pitch} onChange={set('pixel_pitch')} placeholder="P6.6" />
          <TextInput label="Яркость, нит" type="number" value={s.brightness} onChange={set('brightness')} />
          <TextInput label="Длина петли, сек" type="number" value={s.loop_duration_sec} onChange={set('loop_duration_sec')}
            hint="Определяет ёмкость: сколько секунд рекламы вмещает один оборот ротации" />
          <TextInput label="Работает с" value={s.work_from} onChange={set('work_from')} placeholder="06:00" />
          <TextInput label="Работает до" value={s.work_to} onChange={set('work_to')} placeholder="24:00" />
        </div>
      </div>

      <div className="form-section">
        <h3>Финансы</h3>
        <div className="form-grid">
          <TextInput label="Цена за секунду показа, ₽" type="number" step="0.1" value={s.price_per_sec} onChange={set('price_per_sec')}
            hint="Базовая ставка для калькулятора" />
          <TextInput label="Цена за выход (5 сек), ₽" type="number" step="0.1" value={s.price_per_play} onChange={set('price_per_play')}
            hint="Используется, если не задана цена за секунду" />
          <SelectInput label="Налоговый режим" value={s.tax_regime_id} onChange={set('tax_regime_id')}
            options={d.taxes.map((t: any) => ({ value: t.id, label: t.name }))} />
        </div>
      </div>

      <div className="form-section">
        <h3>Владелец и дополнительно</h3>
        <div className="form-grid">
          <SelectInput label="Владелец конструкции" value={s.owner_id} onChange={set('owner_id')}
            options={d.owners.map((o: any) => ({ value: o.id, label: o.name }))} />
          <TextInput label="Теги (через запятую)" value={s.tags} onChange={set('tags')} placeholder="центр,трафик" />
          <Field label="Комментарий">
            <textarea rows={2} value={s.comment ?? ''} onChange={(e) => set('comment')(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Занятость экрана: шапка + сетка по месяцам + полоса за месяц ----------
const MONTHS_SHORT = ['янв', 'февр', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

interface ScheduleSlot {
  id: number; campaign_id: number; duration_sec: number; plays_per_day: number;
  date_from: string; date_to: string; campaign_number: string; status: string;
  client_id: number | null; client_name: string | null; time_slot_name: string | null;
}
interface ScheduleData {
  loop_duration_sec: number; year: number; slots: ScheduleSlot[];
}

function ScheduleModal(props: { screen: Screen; onClose: () => void }) {
  const nav = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1); // 1..12
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const load = () => get(`/screens/${props.screen.id}/schedule?year=${year}`)
    .then((d) => { setData(d); setError(''); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, [year]);

  // группировка слотов по клиенту → строки сетки
  const rows = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { key: string; client: string; slots: ScheduleSlot[] }>();
    for (const s of data.slots) {
      const key = s.client_id ? `c${s.client_id}` : `n:${s.client_name ?? '—'}`;
      if (!map.has(key)) map.set(key, { key, client: s.client_name ?? 'Без клиента', slots: [] });
      map.get(key)!.slots.push(s);
    }
    return [...map.values()];
  }, [data]);

  // месяцы, покрываемые слотом в пределах года (1..12)
  const monthSpan = (s: ScheduleSlot) => {
    const startM = s.date_from < `${year}-01-01` ? 1 : Number(s.date_from.slice(5, 7));
    const endM = s.date_to > `${year}-12-31` ? 12 : Number(s.date_to.slice(5, 7));
    return { startM, endM };
  };

  const loop = data?.loop_duration_sec ?? 0;

  // Загрузка петли за выбранный месяц: пиковый день месяца, сегменты по клиентам
  const monthLoad = useMemo(() => {
    if (!data) return null;
    const daysInMonth = new Date(year, selMonth, 0).getDate();
    let peakUsed = 0, peakSlots: ScheduleSlot[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(selMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const active = data.slots.filter((s) => s.date_from <= iso && s.date_to >= iso);
      const u = active.reduce((a, s) => a + s.duration_sec, 0);
      if (u > peakUsed) { peakUsed = u; peakSlots = active; }
    }
    const byClient = new Map<string, number>();
    for (const s of peakSlots) {
      const k = s.client_name ?? 'Без клиента';
      byClient.set(k, (byClient.get(k) ?? 0) + s.duration_sec);
    }
    return {
      used: peakUsed,
      free: Math.max(0, loop - peakUsed),
      pct: loop ? Math.round((peakUsed / loop) * 1000) / 10 : 0,
      segments: [...byClient.entries()].map(([client_name, duration_sec]) => ({ client_name, duration_sec })),
    };
  }, [data, selMonth, year, loop]);

  return (
    <Modal title={`Экран ${props.screen.code}`} wide onClose={props.onClose}>
      {error && <div className="error-box">{error}</div>}

      {/* Шапка экрана */}
      <div className="scr-head">
        <div>{props.screen.city_name ? `г. ${props.screen.city_name}` : '—'}</div>
        <div>{props.screen.address || props.screen.name}</div>
        <div>{props.screen.side || '—'}</div>
        <div className="mono">{props.screen.code}</div>
      </div>

      {/* Сетка по месяцам */}
      {data && (
        <div className="sgrid-wrap">
          {/* шапка: «+» и месяцы (кликабельны) */}
          <div className="sgrid-row sgrid-head">
            <div className="sgrid-corner">
              <button className="sgrid-plus" title="Добавить клиента на экран" onClick={() => setAddOpen(true)}>+</button>
            </div>
            {MONTHS_SHORT.map((m, i) => (
              <div key={i} className={'sgrid-month' + (selMonth === i + 1 ? ' sel' : '')}
                title={`Показать загрузку за ${MONTHS_FULL[i]}`} onClick={() => setSelMonth(i + 1)}>{m}</div>
            ))}
          </div>
          {rows.length === 0 && (
            <div className="sgrid-row">
              <div className="sgrid-client muted">Нет размещений</div>
              {MONTHS_SHORT.map((_, i) => <div key={i} className={'sgrid-cell' + (selMonth === i + 1 ? ' sel' : '')} />)}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.key} className="sgrid-row">
              <div className="sgrid-client">{row.client}</div>
              {MONTHS_SHORT.map((_, i) => (
                <div key={i} className={'sgrid-cell' + (selMonth === i + 1 ? ' sel' : '')}
                  style={{ gridColumn: i + 2 }} onClick={() => setSelMonth(i + 1)} />
              ))}
              {row.slots.map((s) => {
                const { startM, endM } = monthSpan(s);
                return (
                  <div key={s.id} className="sgrid-bar"
                    style={{ gridColumn: `${startM + 1} / ${endM + 2}`, gridRow: 1 }}
                    title={`${row.client} · кампания ${s.campaign_number}\n${fmtDate(s.date_from)} — ${fmtDate(s.date_to)}\n${s.duration_sec} сек × ${s.plays_per_day || '—'}/сут · ${s.time_slot_name ?? 'весь день'}`}
                    onClick={() => nav(`/campaigns/${s.campaign_id}`)} />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Полоса загруженности за выбранный месяц */}
      {data && monthLoad && (
        <div className="loopbar">
          <div className="loopbar-head">
            <b>Загрузка экрана — {MONTHS_FULL[selMonth - 1]} {year}</b>
            <span className="muted">петля {loop} сек · заполнено {monthLoad.pct}%</span>
          </div>
          <div className="loopbar-labels">
            <span>{monthLoad.used} сек</span>
            <span>свободно {monthLoad.free} / {loop} сек</span>
          </div>
          <div className="loopbar-track">
            {monthLoad.segments.map((seg, i) => (
              <div key={i} className="loopbar-seg"
                style={{ width: `${loop ? (seg.duration_sec / loop) * 100 : 0}%` }}
                title={`${seg.client_name}: ${seg.duration_sec} сек`} />
            ))}
          </div>
          <div className="loopbar-chips">
            {monthLoad.segments.map((seg, i) => (
              <div key={i} className="loopbar-chip" style={{ width: `${loop ? (seg.duration_sec / loop) * 100 : 0}%` }}
                title={`${seg.client_name}: ${seg.duration_sec} сек`}>{seg.client_name}</div>
            ))}
            {monthLoad.segments.length === 0 && <span className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>Петля свободна — размещений в этом месяце нет</span>}
          </div>
        </div>
      )}

      <div className="sgrid-foot">
        <button className="btn secondary small" onClick={() => setYear(year - 1)}>‹ {year - 1}</button>
        <b>{year}</b>
        <button className="btn secondary small" onClick={() => setYear(year + 1)}>{year + 1} ›</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
          Кликните месяц — увидите загрузку экрана за него. Полоса-период — клиент; клик по ней открывает кампанию.
        </span>
      </div>

      {addOpen && (
        <AddClientToScreenModal screen={props.screen} year={year}
          onClose={() => setAddOpen(false)}
          onBooked={() => { setAddOpen(false); load(); }} />
      )}
    </Modal>
  );
}

// ---------- Добавление клиента на экран (быстрое бронирование) ----------
function AddClientToScreenModal(props: { screen: Screen; year: number; onClose: () => void; onBooked: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    client_id: '', duration_sec: 10, plays_per_day: 720,
    date_from: `${props.year}-01-01`, date_to: `${props.year}-03-31`, time_slot_id: '',
  });
  const [capacity, setCapacity] = useState<any | null>(null);
  const [calc, setCalc] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([get('/clients'), get('/time-slots')]).then(([c, t]) => { setClients(c); setTimeSlots(t); });
  }, []);

  useEffect(() => {
    setCapacity(null); setCalc(null);
    if (!form.duration_sec || !form.date_from || !form.date_to || form.date_to < form.date_from) return;
    const timer = setTimeout(async () => {
      try {
        const [cap, price] = await Promise.all([
          post('/capacity/check', { screen_id: props.screen.id, date_from: form.date_from, date_to: form.date_to, duration_sec: Number(form.duration_sec) }),
          post('/calc/price', {
            screen_id: props.screen.id, duration_sec: Number(form.duration_sec), plays_per_day: Number(form.plays_per_day),
            date_from: form.date_from, date_to: form.date_to, time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
          }),
        ]);
        setCapacity(cap); setCalc(price);
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.duration_sec, form.date_from, form.date_to, form.plays_per_day, form.time_slot_id]);

  async function book() {
    if (!form.client_id) { setError('Выберите клиента'); return; }
    setBusy(true); setError('');
    try {
      await post(`/screens/${props.screen.id}/book`, {
        client_id: Number(form.client_id), date_from: form.date_from, date_to: form.date_to,
        duration_sec: Number(form.duration_sec), plays_per_day: Number(form.plays_per_day),
        time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
      });
      props.onBooked();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const blocked = capacity && !capacity.ok;
  return (
    <Modal title={`Добавить клиента — ${props.screen.code}`} onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={book} disabled={busy || !form.client_id || !!blocked}>
          Забронировать{calc ? ` — ${fmtMoney(calc.total)}` : ''}
        </button>
      </>}>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid">
        <SelectInput label="Клиент" required value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })}
          options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        <SelectInput label="Длительность ролика, сек" required value={form.duration_sec} allowEmpty={false}
          onChange={(v) => setForm({ ...form, duration_sec: v })}
          options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} сек` }))} />
        <TextInput label="Выходов в сутки" type="number" value={form.plays_per_day} onChange={(v) => setForm({ ...form, plays_per_day: v })} />
        <TextInput label="Период: с" type="date" value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
        <TextInput label="Период: по" type="date" value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
        <SelectInput label="Тайм-слот" value={form.time_slot_id} onChange={(v) => setForm({ ...form, time_slot_id: v })}
          options={timeSlots.map((t) => ({ value: t.id, label: `${t.name} ${t.time_from}–${t.time_to} (×${t.price_coef})` }))} />
      </div>

      {capacity && (
        <div className={capacity.ok ? 'ok-box' : 'error-box'} style={{ marginTop: 14 }}>
          {capacity.ok
            ? `Ролик помещается. Загрузка петли на периоде: до ${capacity.load.max_load_pct}% (свободно ${capacity.load.free_sec} из ${capacity.load.loop_duration_sec} сек).`
            : capacity.reason}
        </div>
      )}
      {calc && (
        <div className="panel" style={{ marginTop: 12, marginBottom: 0 }}>
          <dl className="kv">
            <dt>Дней в периоде</dt><dd>{calc.days}</dd>
            <dt>Стоимость размещения</dt><dd><b>{fmtMoney(calc.total)}</b></dd>
          </dl>
        </div>
      )}
      <div className="page-sub" style={{ marginTop: 10, marginBottom: 0 }}>
        Будет создана кампания-бронь для клиента. Продажу и оплату оформляйте в карточке кампании.
      </div>
    </Modal>
  );
}

// ---------- Плейлист и загрузка по дням ----------
function PlaylistModal(props: { screen: Screen; onClose: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [avail, setAvail] = useState<any | null>(null);
  const [range, setRange] = useState({ from: todayISO(), to: plusDaysISO(13) });

  useEffect(() => {
    get(`/screens/${props.screen.id}/playlist?date=${date}`).then(setPlaylist).catch(() => setPlaylist([]));
  }, [date]);
  useEffect(() => {
    get(`/screens/${props.screen.id}/availability?from=${range.from}&to=${range.to}`).then(setAvail).catch(() => setAvail(null));
  }, [range.from, range.to]);

  const used = playlist.reduce((a, p) => a + p.duration_sec, 0);
  return (
    <Modal title={`${props.screen.code} — плейлист и загрузка петли`} wide onClose={props.onClose}>
      <div className="panel">
        <h3>Загрузка петли по дням</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span>—</span>
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          {avail && <span className="muted" style={{ marginLeft: 10 }}>
            Максимум: <b>{avail.max_load_pct}%</b> · Свободно: <b>{avail.free_sec} сек</b> из {avail.loop_duration_sec}
          </span>}
        </div>
        {avail && (
          <div className="days-strip">
            {avail.days.map((day: any) => {
              const color = day.load_pct >= 95 ? '#d05555' : day.load_pct >= 70 ? '#e8a13c' : day.load_pct > 0 ? '#3ca55c' : '#c3cad4';
              return (
                <div key={day.date} className="day-cell" style={{ background: color }}
                  title={`${fmtDate(day.date)}: занято ${day.used_sec} сек (${day.load_pct}%)`}>
                  <div>{day.date.slice(8)}</div>
                  <div style={{ fontWeight: 700 }}>{Math.round(day.load_pct)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <h3 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          Ротация на дату
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
            занято {used} из {props.screen.loop_duration_sec} сек петли
          </span>
        </h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>#</th><th>Кампания</th><th>Клиент</th><th>Ролик</th><th>Длит., сек</th><th>Выходов/сут</th><th>Тайм-слот</th><th>Период</th><th>Статус</th></tr></thead>
            <tbody>
              {playlist.length === 0 && <tr><td className="empty-row" colSpan={9}>Петля свободна — размещений нет</td></tr>}
              {playlist.map((p, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td className="mono">{p.campaign_number}</td>
                  <td>{p.client_name ?? '—'}</td>
                  <td>{p.creative_name ?? <span className="muted">не загружен</span>}</td>
                  <td>{p.duration_sec}</td>
                  <td>{p.plays_per_day || '—'}</td>
                  <td>{p.time_slot_name ?? 'Весь день'}</td>
                  <td>{fmtDate(p.date_from)} — {fmtDate(p.date_to)}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put, del, uploadFile, downloadPost, getToken, fmtMoney, fmtDate, getUser, todayISO, plusDaysISO } from '../api';
import {
  DataTable, Modal, TextInput, SelectInput, TextArea, StatusBadge, LoadBar, ColumnsButton,
  Column, Alert, Icon, LoopTape, LoopRuler, TapeLegend, TapeSegment, seriesColor, loadTone, onColor,
} from '../components/ui';

interface Screen {
  id: number; code: string; name: string; side: string | null; address: string; city_id: number | null;
  city_name?: string; region?: string; lat: number | null; lng: number | null;
  width_m: number | null; height_m: number | null; res_w: number | null; res_h: number | null;
  pixel_pitch: string | null; brightness: number | null; screen_type_id: number | null; type_name?: string;
  orientation: string; loop_duration_sec: number; work_from: string; work_to: string;
  price_per_play: number; price_per_sec: number; price_per_sec_month: number;
  tax_regime_id: number | null; tax_name?: string;
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

const OP_LABELS: Record<string, string> = { contains: 'содержит', eq: 'равно', gte: '≥', lte: '≤' };

/** Подсказка к ставке: во что она превращается для типового ролика. */
function ratePreview(rate: any): string {
  const r = Number(rate);
  if (!r) return 'Ставка, из которой считается размещение: ставка × длительность × дней/30';
  return `Ролик 10 сек на 30 дней — ${fmtMoney(r * 10)}`;
}
const STATUS_RU: Record<string, string> = { active: 'Активен', maintenance: 'На обслуживании', inactive: 'Отключён' };

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
  const nav = useNavigate();
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  const [rows, setRows] = useState<Screen[]>([]);
  const [dicts, setDicts] = useState<any>({ cities: [], types: [], owners: [], taxes: [] });
  const [period, setPeriod] = useState({ from: todayISO(), to: plusDaysISO(29) });
  const [conds, setConds] = useState<FilterCond[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editScreen, setEditScreen] = useState<Partial<Screen> | null>(null);
  const [playlistScreen, setPlaylistScreen] = useState<Screen | null>(null);
  const [scheduleScreen, setScheduleScreen] = useState<Screen | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
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

  // Сводка по отфильтрованному инвентарю
  const summary = useMemo(() => {
    const withLoad = filtered.filter((s) => s.load);
    const freeSec = withLoad.reduce((a, s) => a + (s.load!.free_sec ?? 0), 0);
    const avg = withLoad.length
      ? Math.round(withLoad.reduce((a, s) => a + s.load!.max_load_pct, 0) / withLoad.length)
      : 0;
    return { freeSec, avg, full: withLoad.filter((s) => s.load!.max_load_pct >= 95).length };
  }, [filtered]);

  const columns: Column<Screen>[] = [
    { key: 'code', title: 'Код', sortValue: (s) => s.code, render: (s) => (
      <>
        <span className={'rowstate ' + s.status} title={STATUS_RU[s.status]} />
        <b className="mono">{s.code}</b>
      </>
    ) },
    { key: 'name', title: 'Название и адрес', sortValue: (s) => s.name, render: (s) => (
      <span className="screen-name">
        <button className="nm" title="Открыть занятость экрана"
          onClick={(e) => { e.stopPropagation(); setScheduleScreen(s); }}>{s.name}</button>
        <span className="addr">{s.address}</span>
      </span>
    ) },
    { key: 'side', title: 'Сторона', render: (s) => s.side || '—' },
    { key: 'city_name', title: 'Город' },
    { key: 'load', title: 'Загрузка петли', sortValue: (s) => s.load?.max_load_pct ?? 0,
      render: (s) => s.load
        ? <LoadBar pct={s.load.max_load_pct} loop={s.load.loop} />
        : <span className="muted">—</span> },
    { key: 'free', title: 'Свободно, сек', optional: true, sortValue: (s) => s.load?.free_sec ?? 0,
      render: (s) => s.load
        ? <span className="cell-stack"><b className="num">{s.load.free_sec}</b><span className="sub">из {s.load.loop}</span></span>
        : '—' },
    { key: 'size', title: 'Размер, м', optional: true, render: (s) => s.width_m ? `${s.width_m}×${s.height_m}` : '—' },
    { key: 'resolution', title: 'Разрешение', optional: true, render: (s) => s.res_w ? <span className="mono">{s.res_w}×{s.res_h}</span> : '—' },
    { key: 'pitch', title: 'Шаг пикселя', optional: true, render: (s) => s.pixel_pitch ?? '—' },
    { key: 'brightness', title: 'Яркость, нит', optional: true },
    { key: 'type_name', title: 'Тип', optional: true },
    { key: 'orientation', title: 'Ориентация', optional: true, render: (s) => s.orientation === 'vertical' ? 'Вертикальная' : 'Горизонтальная' },
    { key: 'loop', title: 'Петля, сек', optional: true, sortValue: (s) => s.loop_duration_sec, render: (s) => <span className="num">{s.loop_duration_sec}</span> },
    { key: 'work', title: 'Часы работы', optional: true, render: (s) => <span className="mono">{s.work_from}–{s.work_to}</span> },
    { key: 'price', title: 'Цена ₽/сек за 30 дн.', optional: true, sortValue: (s) => s.price_per_sec_month,
      render: (s) => (
        <span className="cell-stack">
          <b className="num">{fmtMoney(s.price_per_sec_month)}</b>
          <span className="sub">10 сек — {fmtMoney(s.price_per_sec_month * 10)}</span>
        </span>
      ) },
    { key: 'owner_name', title: 'Владелец', optional: true },
    { key: 'tax_name', title: 'Налоговый режим', optional: true },
    { key: 'tags', title: 'Теги', optional: true },
    { key: 'status', title: 'Статус', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'actions', title: '', sortable: false, render: (s) => (
      <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="btn small secondary" onClick={() => setPlaylistScreen(s)}>
          <Icon name="list" size={13} /> Плейлист
        </button>
        {isAdmin && (
          <button className="btn small secondary" onClick={() => setEditScreen(s)} aria-label={`Изменить экран ${s.code}`}>
            <Icon name="edit" size={13} /> Изменить
          </button>
        )}
      </span>
    ) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Инвентарь экранов</h1>
        <div className="toolbar">
          <span className="field-inline">
            <Icon name="calendar" size={14} />
            Загрузка за период
            <input type="date" aria-label="Начало периода" value={period.from}
              onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            <span aria-hidden="true">—</span>
            <input type="date" aria-label="Конец периода" value={period.to}
              onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          </span>
          <span className="sep" aria-hidden="true" />
          <button className="btn secondary" onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={14} /> Фильтр
            {conds.length > 0 && <span className="num">{conds.length}</span>}
          </button>
          <ColumnsButton columns={columns} visible={visibleCols} onChange={setVisibleCols} />
          <button className="btn secondary" onClick={() => setExportOpen(true)} disabled={filtered.length === 0}>
            <Icon name="upload" size={14} /> Экспорт в Excel
            {selectedIds.length > 0 && <span className="num">{selectedIds.length}</span>}
          </button>
          <button className="btn" onClick={() => setAddClientOpen(true)}>
            <Icon name="users" size={14} /> Добавить клиента
          </button>
          {isAdmin && (
            <button className="btn" onClick={() => setEditScreen({ orientation: 'horizontal', loop_duration_sec: 60, work_from: '06:00', work_to: '24:00', status: 'active', side: 'А' })}>
              <Icon name="plus" size={14} /> Добавить экран
            </button>
          )}
        </div>
      </div>

      <div className="page-sub">
        Кликните название экрана — откроется занятость по месяцам и загрузка петли.
        Показатель «Загрузка петли» — пиковый день выбранного периода.
        {selectedIds.length > 0
          ? ` Отмечено ${selectedIds.length} — в Excel уйдут только они.`
          : ' Отметьте строки галочками, чтобы выгрузить только их, иначе выгрузится вся выборка.'}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="summary-cards">
        <div className="scard"><div className="l">Экранов в выборке</div><div className="v">{filtered.length} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>из {rows.length}</span></div></div>
        <div className="scard"><div className="l">Средняя загрузка</div><div className="v">{summary.avg}%</div></div>
        <div className="scard"><div className="l">Свободно секунд</div><div className="v">{summary.freeSec}</div></div>
        <div className="scard"><div className="l">Петля заполнена</div><div className="v">{summary.full}</div></div>
      </div>

      {conds.length > 0 && (
        <div className="filter-chips">
          {conds.map((c, i) => {
            const f = FILTER_FIELDS.find((x) => x.key === c.field);
            return (
              <span className="chip" key={i}>
                {f?.label} {OP_LABELS[c.op]} <b>{f?.type === 'select' ? STATUS_RU[c.value] ?? c.value : c.value}</b>
                <button onClick={() => setConds(conds.filter((_, j) => j !== i))}
                  aria-label={`Убрать фильтр «${f?.label}»`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            );
          })}
          <button className="chip reset" onClick={() => setConds([])}>Сбросить всё</button>
        </div>
      )}

      <DataTable
        variant="inventory"
        caption="Инвентарь LED-экранов"
        columns={columns}
        rows={filtered}
        visibleKeys={[...visibleCols, 'code', 'name', 'side', 'city_name', 'load', 'status', 'actions']}
        emptyText="Ни один экран не подходит под фильтр"
        emptyHint="Измените условия или сбросьте фильтр."
        selected={selectedIds}
        onSelectedChange={setSelectedIds}
      />

      {filterOpen && (
        <FilterModal conds={conds} onApply={(c) => { setConds(c); setFilterOpen(false); }} onClose={() => setFilterOpen(false)} />
      )}
      {editScreen && (
        <ScreenForm screen={editScreen} dicts={dicts} onClose={() => setEditScreen(null)}
          onSaved={() => { setEditScreen(null); load(); }} />
      )}
      {exportOpen && (
        <ExportModal
          screens={selectedIds.length > 0 ? filtered.filter((s) => selectedIds.includes(s.id)) : filtered}
          onClose={() => setExportOpen(false)} />
      )}
      {addClientOpen && (
        <AddClientModal screens={rows} onClose={() => setAddClientOpen(false)}
          onCreated={(id) => { setAddClientOpen(false); nav(`/campaigns/${id}`); }} />
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
    <Modal title="Фильтр инвентаря" subtitle="Экран попадёт в выборку, если выполнены все условия" wide onClose={props.onClose}
      footer={<>
        <button className="btn ghost" style={{ marginRight: 'auto' }}
          onClick={() => setConds([{ field: 'code', op: 'contains', value: '' }])}>Очистить условия</button>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={() => props.onApply(conds.filter((c) => c.value !== ''))}>Применить фильтр</button>
      </>}>
      {conds.map((c, i) => {
        const f = FILTER_FIELDS.find((x) => x.key === c.field)!;
        const ops = f.type === 'number' ? [['gte', '≥'], ['lte', '≤'], ['eq', '=']] : [['contains', 'содержит'], ['eq', 'равно']];
        return (
          <div className="filter-row" key={i}>
            <select aria-label="Поле" value={c.field} onChange={(e) => {
              const nf = FILTER_FIELDS.find((x) => x.key === e.target.value)!;
              update(i, { field: e.target.value, op: nf.type === 'number' ? 'gte' : 'contains', value: '' });
            }}>
              {FILTER_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select aria-label="Условие" value={c.op} onChange={(e) => update(i, { op: e.target.value })}>
              {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {f.type === 'select' ? (
              <select aria-label="Значение" value={c.value} onChange={(e) => update(i, { value: e.target.value })}>
                <option value="">Не выбрано</option>
                {f.options!.map((o) => <option key={o} value={o}>{STATUS_RU[o]}</option>)}
              </select>
            ) : (
              <input aria-label="Значение" type={f.type === 'number' ? 'number' : 'text'} value={c.value}
                onChange={(e) => update(i, { value: e.target.value })} placeholder="Значение" />
            )}
            <button className="btn small ghost" onClick={() => setConds(conds.filter((_, j) => j !== i))}
              aria-label="Удалить условие">
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <button className="btn secondary small" style={{ marginTop: 4 }}
        onClick={() => setConds([...conds, { field: 'code', op: 'contains', value: '' }])}>
        <Icon name="plus" size={13} /> Добавить условие
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
    if (!s.code || !s.name) { setError('Заполните код и название — по ним экран находят в инвентаре.'); return; }
    setBusy(true); setError('');
    const body: any = { ...s };
    delete body.id; delete body.city_name; delete body.region; delete body.type_name;
    delete body.owner_name; delete body.tax_name; delete body.load;
    for (const k of ['city_id', 'screen_type_id', 'owner_id', 'tax_regime_id']) body[k] = body[k] ? Number(body[k]) : null;
    for (const k of ['lat', 'lng', 'width_m', 'height_m', 'res_w', 'res_h', 'brightness', 'loop_duration_sec', 'price_per_play', 'price_per_sec', 'price_per_sec_month']) {
      body[k] = body[k] === '' || body[k] == null ? null : Number(body[k]);
    }
    body.loop_duration_sec = body.loop_duration_sec ?? 60;
    body.price_per_play = body.price_per_play ?? 0;
    body.price_per_sec = body.price_per_sec ?? 0;
    body.price_per_sec_month = body.price_per_sec_month ?? 0;
    try {
      if (props.screen.id) await put(`/screens/${props.screen.id}`, body);
      else await post('/screens', body);
      props.onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Удалить экран ${s.code}? Действие необратимо.`)) return;
    try { await del(`/screens/${props.screen.id}`); props.onSaved(); }
    catch (e: any) { setError(e.message); }
  }

  const d = props.dicts;
  return (
    <Modal
      title={props.screen.id ? `Экран ${props.screen.code}` : 'Новый LED-экран'}
      subtitle={props.screen.id ? props.screen.address ?? undefined : 'Экран появится в инвентаре сразу после сохранения'}
      wide onClose={props.onClose}
      footer={<>
        {props.screen.id && <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>
          <Icon name="trash" size={14} /> Удалить экран
        </button>}
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить экран'}</button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="form-section">
        <h3>Характеристики</h3>
        <div className="form-grid">
          <TextInput label="Код" required value={s.code} onChange={set('code')} placeholder="GRZLED04001" />
          <TextInput label="Название" required value={s.name} onChange={set('name')} placeholder="Экран «Центр»" />
          <TextInput label="Сторона" value={s.side} onChange={set('side')} placeholder="А"
            hint="Двусторонняя конструкция: А и Б. Односторонняя — А" />
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
            hint="Сколько секунд рекламы вмещает один оборот ротации" />
          <TextInput label="Работает с" value={s.work_from} onChange={set('work_from')} placeholder="06:00" />
          <TextInput label="Работает до" value={s.work_to} onChange={set('work_to')} placeholder="24:00" />
        </div>
      </div>

      <div className="form-section">
        <h3>Финансы</h3>
        <div className="form-grid">
          <TextInput label="Цена 1 секунды за 30 дней, ₽" type="number" step="50" required
            value={s.price_per_sec_month} onChange={set('price_per_sec_month')}
            hint={ratePreview(s.price_per_sec_month)} />
          <SelectInput label="Налоговый режим" value={s.tax_regime_id} onChange={set('tax_regime_id')}
            options={d.taxes.map((t: any) => ({ value: t.id, label: t.name }))} />
        </div>
      </div>

      <div className="form-section">
        <h3>Владелец и дополнительно</h3>
        <div className="form-grid">
          <SelectInput label="Владелец конструкции" value={s.owner_id} onChange={set('owner_id')}
            options={d.owners.map((o: any) => ({ value: o.id, label: o.name }))} />
          <TextInput label="Теги" value={s.tags} onChange={set('tags')} placeholder="центр, трафик" hint="Через запятую" />
          <TextArea label="Комментарий" value={s.comment} onChange={set('comment')} />
        </div>
      </div>

      <div className="form-section">
        <h3>Карта и фото</h3>
        <div className="media-grid" style={{ marginBottom: 'var(--sp-3)' }}>
          <ScreenMap
            lat={s.lat === '' || s.lat == null ? null : Number(s.lat)}
            lng={s.lng === '' || s.lng == null ? null : Number(s.lng)}
            address={s.address} />
          <div>
            {props.screen.id ? (
              <ScreenPhotoManager screenId={props.screen.id} />
            ) : (
              <Alert tone="note">Сохраните экран — после этого можно будет загрузить фотографии.</Alert>
            )}
          </div>
        </div>
        <span className="hint">
          Координаты задаются в секции «Адрес и координаты» — карта обновится сразу после их ввода.
        </span>
      </div>
    </Modal>
  );
}

// ---------- Экспорт инвентаря в Excel ----------
const EXPORT_COLUMNS: { key: string; label: string; always?: boolean }[] = [
  { key: 'code', label: 'Код', always: true },
  { key: 'name', label: 'Название' },
  { key: 'side', label: 'Сторона' },
  { key: 'region', label: 'Область' },
  { key: 'city', label: 'Город' },
  { key: 'address', label: 'Адрес, направление' },
  { key: 'type', label: 'Тип экрана' },
  { key: 'size', label: 'Размер, м' },
  { key: 'resolution', label: 'Разрешение' },
  { key: 'pitch', label: 'Шаг пикселя' },
  { key: 'brightness', label: 'Яркость' },
  { key: 'orientation', label: 'Ориентация' },
  { key: 'loop', label: 'Длина петли' },
  { key: 'work', label: 'Часы работы' },
  { key: 'price', label: 'Ставка ₽/сек за 30 дн.' },
  { key: 'price10', label: 'Ролик 10 сек / 30 дн.' },
  { key: 'tax', label: 'Налог' },
  { key: 'owner', label: 'Владелец' },
  { key: 'status', label: 'Статус' },
  { key: 'tags', label: 'Теги' },
  { key: 'coords', label: 'Координаты' },
  { key: 'comment', label: 'Комментарий' },
];

const DEFAULT_EXPORT_COLS = ['code', 'name', 'side', 'city', 'address', 'type', 'size', 'loop', 'price', 'owner', 'status'];

function ExportModal(props: { screens: Screen[]; onClose: () => void }) {
  const today = new Date();
  const [filename, setFilename] = useState(`Адресная программа - ${fmtDate(todayISO())}`);
  const [links, setLinks] = useState(true);
  const [cols, setCols] = useState<string[]>(DEFAULT_EXPORT_COLS);
  const [year, setYear] = useState(today.getFullYear());
  const [months, setMonths] = useState<string[]>([`${today.getFullYear()}-${today.getMonth() + 1}`]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const years = [today.getFullYear(), today.getFullYear() + 1];
  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  async function run() {
    setBusy(true); setError('');
    try {
      await downloadPost('/screens/export', {
        screen_ids: props.screens.map((s) => s.id),
        columns: cols,
        photo_links: links,
        months: months.map((m) => {
          const [y, mo] = m.split('-').map(Number);
          return { year: y, month: mo };
        }),
      }, `${filename || 'Экспорт экранов'}.xlsx`);
      props.onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Экспорт в Microsoft Excel"
      subtitle={`${props.screens.length} ${plural(props.screens.length, ['экран', 'экрана', 'экранов'])} в выгрузке`}
      onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={run} disabled={busy || cols.length === 0}>
          {busy ? 'Готовим файл…' : 'Экспорт'}
        </button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}

      <TextInput label="Название файла" value={filename} onChange={setFilename} hint="Расширение .xlsx добавится само" />

      <label className="check-row" style={{ marginTop: 'var(--sp-3)' }}>
        <input type="checkbox" checked={links} onChange={(e) => setLinks(e.target.checked)} />
        <span>
          Фото и карта как ссылки
          <span className="hint">Карта — ссылка на Яндекс.Карты, фото — ссылка на карточку экрана в системе</span>
        </span>
      </label>

      <div className="export-section">
        <span className="eyebrow">Столбцы</span>
        <div className="check-grid">
          {EXPORT_COLUMNS.map((c) => (
            <label key={c.key} className={'check-row' + (c.always ? ' is-locked' : '')}>
              <input type="checkbox" checked={c.always || cols.includes(c.key)} disabled={c.always}
                onChange={() => toggle(cols, setCols, c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="export-section">
        <span className="eyebrow">Месяцы — загрузка петли</span>
        <div className="tabs" style={{ marginBottom: 'var(--sp-3)' }}>
          {years.map((y) => (
            <button key={y} className={`tab ${year === y ? 'active' : ''}`} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
        <div className="check-grid">
          {MONTHS_FULL.map((m, i) => {
            const key = `${year}-${i + 1}`;
            return (
              <label key={key} className="check-row">
                <input type="checkbox" checked={months.includes(key)} onChange={() => toggle(months, setMonths, key)} />
                <span style={{ textTransform: 'capitalize' }}>{m}</span>
              </label>
            );
          })}
        </div>
        <span className="hint">
          {months.length === 0
            ? 'Месяцы не выбраны — файл будет без колонок занятости.'
            : `Выбрано ${months.length}: по каждому месяцу колонка с пиковой загрузкой петли и свободными секундами.`}
        </span>
      </div>
    </Modal>
  );
}

// ---------- Карта и фотографии экрана ----------
interface ScreenPhoto { id: number; filename: string; mime: string; size_bytes: number; sort_order: number }

const photoUrl = (id: number) => `/api/photos/${id}/file?token=${getToken()}`;

function ScreenMap({ lat, lng, address }: { lat: number | null; lng: number | null; address?: string }) {
  if (lat == null || lng == null) {
    return (
      <div className="map-box is-empty">
        <span className="empty-state">
          <b>Координаты не указаны</b>
          <span>Задайте широту и долготу в карточке экрана — здесь появится карта.</span>
        </span>
      </div>
    );
  }
  const d = 0.004;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((v) => v.toFixed(5)).join('%2C');
  return (
    <div className="map-box">
      <iframe
        title={`Карта: ${address ?? 'расположение экрана'}`}
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`}
      />
      <div className="map-links">
        <span className="mono">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
        <a href={`https://yandex.ru/maps/?pt=${lng},${lat}&z=17&l=map`} target="_blank" rel="noreferrer">Яндекс</a>
        <a href={`https://2gis.ru/geo/${lng},${lat}`} target="_blank" rel="noreferrer">2ГИС</a>
        <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noreferrer">OSM</a>
      </div>
    </div>
  );
}

/** Блок «Карта и фото» для окна занятости: карта слева, галерея справа. */
function ScreenMedia({ screen }: { screen: Screen }) {
  const [photos, setPhotos] = useState<ScreenPhoto[]>([]);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    get(`/screens/${screen.id}/photos`).then((p) => { setPhotos(p); setActive(0); }).catch(() => setPhotos([]));
  }, [screen.id]);

  const current = photos[active];
  return (
    <div className="media-block">
      <span className="eyebrow">Карта и фото</span>
      <div className="media-grid">
        <ScreenMap lat={screen.lat} lng={screen.lng} address={screen.address} />
        <div className="photo-box">
          {current ? (
            <>
              <button className="photo-main" onClick={() => setZoom(true)} title="Открыть крупно">
                <img src={photoUrl(current.id)} alt={`Фото экрана ${screen.code}`} />
              </button>
              {photos.length > 1 && (
                <div className="photo-thumbs">
                  {photos.map((p, i) => (
                    <button key={p.id} className={'thumb' + (i === active ? ' sel' : '')}
                      onClick={() => setActive(i)} aria-label={`Фото ${i + 1}`}>
                      <img src={photoUrl(p.id)} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="photo-main is-empty">
              <span className="empty-state">
                <b>Фотографий нет</b>
                <span>Загрузите их в карточке экрана — кнопка «Изменить» в инвентаре.</span>
              </span>
            </div>
          )}
        </div>
      </div>
      {zoom && current && (
        <div className="lightbox" onClick={() => setZoom(false)} role="dialog" aria-label="Просмотр фото">
          <img src={photoUrl(current.id)} alt={`Фото экрана ${screen.code}`} />
          <button className="lightbox-close" aria-label="Закрыть"><Icon name="close" size={22} /></button>
        </div>
      )}
    </div>
  );
}

/** Управление фотографиями в карточке экрана: загрузка, удаление, выбор главной. */
function ScreenPhotoManager({ screenId }: { screenId: number }) {
  const [photos, setPhotos] = useState<ScreenPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => get(`/screens/${screenId}/photos`).then(setPhotos).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [screenId]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    if (files.length === 0) return;
    setBusy(true); setError('');
    try {
      for (const f of files) await uploadFile(`/screens/${screenId}/photos`, f);
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); e.target.value = ''; }
  }

  return (
    <div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="photo-manager">
        {photos.map((p, i) => (
          <div key={p.id} className={'pm-item' + (i === 0 ? ' is-primary' : '')}>
            <img src={photoUrl(p.id)} alt={p.filename} />
            {i === 0 && <span className="pm-badge">Главное</span>}
            <div className="pm-actions">
              {i !== 0 && (
                <button type="button" className="btn small secondary" title="Сделать главным"
                  onClick={async () => { await post(`/photos/${p.id}/primary`); load(); }}>
                  <Icon name="check" size={13} />
                </button>
              )}
              <button type="button" className="btn small danger" title="Удалить фото"
                onClick={async () => {
                  if (!confirm(`Удалить фото «${p.filename}»?`)) return;
                  try { await del(`/photos/${p.id}`); load(); } catch (e: any) { setError(e.message); }
                }}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
        <label className={'pm-add' + (busy ? ' is-busy' : '')}>
          <Icon name="upload" size={18} />
          <span>{busy ? 'Загрузка…' : 'Добавить фото'}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple
            style={{ display: 'none' }} onChange={onFiles} disabled={busy} />
        </label>
      </div>
      <span className="hint">Первое фото показывается как главное. jpg, png, webp — до 20 МБ.</span>
    </div>
  );
}

// ---------- Занятость экрана: шапка + сетка по месяцам + секундная лента ----------
const MONTHS_SHORT = ['янв', 'февр', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

interface ScheduleSlot {
  id: number; campaign_id: number; duration_sec: number; plays_per_day: number;
  date_from: string; date_to: string; campaign_number: string; status: string;
  client_id: number | null; client_name: string | null; time_slot_name: string | null;
}
interface ScheduleData {
  loop_duration_sec: number; year: number; slots: ScheduleSlot[];
}

const clientKey = (s: ScheduleSlot) => (s.client_id ? `c${s.client_id}` : `n:${s.client_name ?? '—'}`);

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
      const key = clientKey(s);
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

  // Загрузка петли за выбранный месяц: пиковый день, сегменты по клиентам
  const monthLoad = useMemo(() => {
    if (!data) return null;
    const daysInMonth = new Date(year, selMonth, 0).getDate();
    let peakUsed = 0, peakSlots: ScheduleSlot[] = [], peakDay = 1;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(selMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const active = data.slots.filter((s) => s.date_from <= iso && s.date_to >= iso);
      const u = active.reduce((a, s) => a + s.duration_sec, 0);
      if (u > peakUsed) { peakUsed = u; peakSlots = active; peakDay = d; }
    }
    const byClient = new Map<string, { label: string; sec: number; key: string }>();
    for (const s of peakSlots) {
      const k = clientKey(s);
      const cur = byClient.get(k) ?? { label: s.client_name ?? 'Без клиента', sec: 0, key: k };
      cur.sec += s.duration_sec;
      byClient.set(k, cur);
    }
    const segments: TapeSegment[] = [...byClient.values()]
      .sort((a, b) => b.sec - a.sec)
      .map((c) => ({ label: c.label, sec: c.sec, color: seriesColor(c.key, true) }));
    return {
      used: peakUsed,
      peakDay,
      free: Math.max(0, loop - peakUsed),
      pct: loop ? Math.round((peakUsed / loop) * 1000) / 10 : 0,
      segments,
    };
  }, [data, selMonth, year, loop]);

  const tone = monthLoad ? loadTone(monthLoad.pct) : 'good';

  return (
    <Modal
      title={`Занятость экрана ${props.screen.code}`}
      subtitle={`${props.screen.name} · петля ${props.screen.loop_duration_sec} сек`}
      wide onClose={props.onClose}
    >
      {error && <Alert tone="error">{error}</Alert>}

      {/* Шапка экрана */}
      <div className="scr-head">
        <div>
          <div className="k">Город</div>
          <div className="v">{props.screen.city_name ? `г. ${props.screen.city_name}` : '—'}</div>
        </div>
        <div>
          <div className="k">Адрес</div>
          <div className="v" title={props.screen.address}>{props.screen.address || props.screen.name}</div>
        </div>
        <div>
          <div className="k">Сторона</div>
          <div className="v">{props.screen.side || '—'}</div>
        </div>
        <div>
          <div className="k">Код экрана</div>
          <div className="v mono">{props.screen.code}</div>
        </div>
      </div>

      {/* Сетка по месяцам */}
      {data && (
        <div className="sgrid-wrap">
          <div className="sgrid-row sgrid-head">
            <div className="sgrid-corner">
              <button className="sgrid-plus" title="Добавить клиента на экран"
                aria-label="Добавить клиента на экран" onClick={() => setAddOpen(true)}>
                <Icon name="plus" size={16} />
              </button>
              <span className="eyebrow">Клиенты<br />{year}</span>
            </div>
            {MONTHS_SHORT.map((m, i) => (
              <button key={i} className={'sgrid-month' + (selMonth === i + 1 ? ' sel' : '')}
                aria-pressed={selMonth === i + 1}
                title={`Показать загрузку за ${MONTHS_FULL[i]}`} onClick={() => setSelMonth(i + 1)}>{m}</button>
            ))}
          </div>
          {rows.length === 0 && (
            <div className="sgrid-row">
              <div className="sgrid-client muted">Размещений в {year} году нет</div>
              {MONTHS_SHORT.map((_, i) => <div key={i} className={'sgrid-cell' + (selMonth === i + 1 ? ' sel' : '')} />)}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.key} className="sgrid-row">
              <div className="sgrid-client">
                <span className="sw" style={{ background: seriesColor(row.key) }} aria-hidden="true" />
                <span className="nm" title={row.client}>{row.client}</span>
              </div>
              {MONTHS_SHORT.map((_, i) => (
                <div key={i} className={'sgrid-cell' + (selMonth === i + 1 ? ' sel' : '')}
                  style={{ gridColumn: i + 2 }} onClick={() => setSelMonth(i + 1)} />
              ))}
              {row.slots.map((s) => {
                const { startM, endM } = monthSpan(s);
                const bg = seriesColor(row.key);
                return (
                  <button key={s.id} className={'sgrid-bar' + (s.status === 'reserved' ? ' pending' : '')}
                    style={{ gridColumn: `${startM + 1} / ${endM + 2}`, gridRow: 1, background: bg, color: onColor(bg) }}
                    title={`${row.client} · кампания ${s.campaign_number}\n${fmtDate(s.date_from)} — ${fmtDate(s.date_to)}\n${s.duration_sec} сек × ${s.plays_per_day || '—'}/сут · ${s.time_slot_name ?? 'весь день'}`}
                    onClick={() => nav(`/campaigns/${s.campaign_id}`)}>
                    {s.duration_sec} сек
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Секундная лента за выбранный месяц */}
      {data && monthLoad && (
        <div style={{ marginTop: 20 }}>
          <div className="tape-readout">
            <div>
              <span className="eyebrow">Загрузка петли — {MONTHS_FULL[selMonth - 1]} {year}</span>
              <div className={`big is-${tone}`}>{monthLoad.pct}%</div>
            </div>
            <div className="side">
              занято <b>{monthLoad.used}</b> из <b>{loop}</b> сек · свободно <b>{monthLoad.free}</b> сек
              {monthLoad.used > 0 && (
                <><br /><span className="muted">пиковый день — {monthLoad.peakDay} {MONTHS_GEN[selMonth - 1]}</span></>
              )}
            </div>
          </div>
          <LoopTape loop={loop} segments={monthLoad.segments} />
          <LoopRuler loop={loop} />
          <TapeLegend segments={monthLoad.segments} free={monthLoad.free} loop={loop} />
        </div>
      )}

      <ScreenMedia screen={props.screen} />

      <div className="sgrid-foot">
        <span className="year-switch">
          <button onClick={() => setYear(year - 1)} aria-label={`Показать ${year - 1} год`}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <span className="y">{year}</span>
          <button onClick={() => setYear(year + 1)} aria-label={`Показать ${year + 1} год`}>
            <Icon name="chevronRight" size={14} />
          </button>
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Полоса — период размещения клиента; клик открывает кампанию. Штриховка означает бронь.
        </span>
      </div>

      {addOpen && (
        <AddClientToScreenModal screen={props.screen} year={year} month={selMonth}
          onClose={() => setAddOpen(false)}
          onBooked={() => { setAddOpen(false); load(); }} />
      )}
    </Modal>
  );
}

// ---------- Добавление клиента на экран (быстрое бронирование) ----------
function AddClientToScreenModal(props: { screen: Screen; year: number; month: number; onClose: () => void; onBooked: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const lastDay = new Date(props.year, props.month, 0).getDate();
  const mm = String(props.month).padStart(2, '0');
  const [form, setForm] = useState<any>({
    client_id: '', duration_sec: 10,
    date_from: `${props.year}-${mm}-01`, date_to: `${props.year}-${mm}-${lastDay}`, time_slot_id: '',
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
            screen_id: props.screen.id, duration_sec: Number(form.duration_sec),
            date_from: form.date_from, date_to: form.date_to, time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
          }),
        ]);
        setCapacity(cap); setCalc(price);
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.duration_sec, form.date_from, form.date_to, form.time_slot_id]);

  async function book() {
    if (!form.client_id) { setError('Выберите клиента — на него будет оформлена бронь.'); return; }
    setBusy(true); setError('');
    try {
      await post(`/screens/${props.screen.id}/book`, {
        client_id: Number(form.client_id), date_from: form.date_from, date_to: form.date_to,
        duration_sec: Number(form.duration_sec),
        time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
      });
      props.onBooked();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const blocked = capacity && !capacity.ok;
  return (
    <Modal title="Добавить клиента на экран" subtitle={`${props.screen.code} · петля ${props.screen.loop_duration_sec} сек`}
      onClose={props.onClose}
      footer={<>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={book} disabled={busy || !form.client_id || !!blocked}>
          {busy ? 'Бронируем…' : `Забронировать${calc ? ` — ${fmtMoney(calc.total)}` : ''}`}
        </button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <SelectInput label="Клиент" required value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })}
          options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        <SelectInput label="Длительность ролика" required value={form.duration_sec} allowEmpty={false}
          onChange={(v) => setForm({ ...form, duration_sec: v })}
          options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} сек` }))} />
        <TextInput label="Период: с" type="date" value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
        <TextInput label="Период: по" type="date" value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
        <SelectInput label="Тайм-слот" value={form.time_slot_id} onChange={(v) => setForm({ ...form, time_slot_id: v })}
          hint="Часть суток; влияет на цену"
          options={timeSlots.map((t) => ({ value: t.id, label: `${t.name} ${t.time_from}–${t.time_to} (×${t.price_coef})` }))} />
      </div>

      {capacity && (
        <div style={{ marginTop: 16 }}>
          {capacity.ok ? (
            <Alert tone="ok">
              Ролик помещается: загрузка петли за период дойдёт до {capacity.load.max_load_pct}%,
              свободно {capacity.load.free_sec} из {capacity.load.loop_duration_sec} сек.
            </Alert>
          ) : (
            <Alert tone="error">{capacity.reason}</Alert>
          )}
        </div>
      )}
      {calc && (
        <div className="panel" style={{ marginTop: 4, marginBottom: 0 }}>
          <dl className="kv">
            <dt>Ставка экрана</dt><dd>{fmtMoney(calc.price_per_sec_month)} за 1 сек / 30 дней</dd>
            <dt>Ролик {form.duration_sec} сек на 30 дней</dt><dd>{fmtMoney(calc.month_price)}</dd>
            <dt>Период: {calc.days} дн. из {calc.period_days}</dt><dd>{fmtMoney(calc.base)}</dd>
            {calc.coef !== 1 && <><dt>Тайм-слот «{calc.time_slot}»</dt><dd>×{calc.coef}</dd></>}
            {calc.tax_rate > 0 && <><dt>Налог ({calc.tax_name})</dt><dd>+{fmtMoney(calc.tax)}</dd></>}
            <dt><b>Стоимость размещения</b></dt><dd><b>{fmtMoney(calc.total)}</b></dd>
            <dt>Выходов в сутки</dt><dd>≈ {calc.plays_per_day}</dd>
          </dl>
        </div>
      )}
      <p className="page-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        Будет создана кампания в статусе «Бронь». Продажу и оплату оформите в карточке кампании.
      </p>
    </Modal>
  );
}

// ---------- Добавить клиента: одна кампания сразу на несколько экранов ----------
function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function AddClientModal(props: { screens: Screen[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [dicts, setDicts] = useState<any>({ clients: [], managers: [], discounts: [], timeSlots: [] });
  const [form, setForm] = useState<any>({
    client_id: '', manager_id: '', discount_id: '', discount_percent: 0,
    date_from: todayISO(), date_to: plusDaysISO(29),
    duration_sec: 10, time_slot_id: '', status: 'reserved',
  });
  const [sel, setSel] = useState<Record<number, number>>({});
  const [q, setQ] = useState('');
  const [quote, setQuote] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([get('/clients'), get('/managers'), get('/discounts'), get('/time-slots')])
      .then(([clients, managers, discounts, timeSlots]) => setDicts({ clients, managers, discounts, timeSlots }))
      .catch((e) => setError(e.message));
  }, []);

  const selKey = JSON.stringify(sel);
  const selIds = useMemo(() => Object.keys(sel).map(Number), [selKey]);

  // Пакетная проверка ёмкости и расчёт цены по выбранным экранам
  useEffect(() => {
    setQuote(null);
    if (selIds.length === 0 || !form.date_from || !form.date_to || form.date_to < form.date_from) return;
    const timer = setTimeout(async () => {
      try {
        setQuote(await post('/capacity/quote', {
          date_from: form.date_from, date_to: form.date_to,
          time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
          discount_percent: Number(form.discount_percent) || 0,
          screens: selIds.map((id) => ({ screen_id: id, duration_sec: sel[id] })),
        }));
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(timer);
  }, [selKey, form.date_from, form.date_to, form.time_slot_id, form.discount_percent]);

  const available = props.screens.filter((s) => s.status === 'active');
  const shown = available.filter((s) => !q ||
    `${s.code} ${s.name} ${s.address ?? ''} ${s.city_name ?? ''} ${s.tags ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const byScreen: Record<number, any> = {};
  for (const it of quote?.items ?? []) byScreen[it.screen_id] = it;
  const conflicts = (quote?.items ?? []).filter((i: any) => !i.ok);

  function toggle(id: number) {
    setSel((prev) => {
      const next = { ...prev };
      if (next[id] !== undefined) delete next[id];
      else next[id] = Number(form.duration_sec);
      return next;
    });
  }

  // Общая длительность применяется ко всем выбранным экранам
  function setAllDuration(v: string) {
    const d = Number(v);
    setForm((f: any) => ({ ...f, duration_sec: v }));
    setSel((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, d])));
  }

  async function submit() {
    if (!form.client_id) { setError('Выберите клиента.'); return; }
    if (selIds.length === 0) { setError('Отметьте хотя бы один экран.'); return; }
    setBusy(true); setError('');
    try {
      const r = await post('/campaigns/bulk', {
        client_id: Number(form.client_id),
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        discount_id: form.discount_id ? Number(form.discount_id) : null,
        discount_percent: Number(form.discount_percent) || 0,
        date_from: form.date_from, date_to: form.date_to,
        time_slot_id: form.time_slot_id ? Number(form.time_slot_id) : null,
        status: form.status,
        screens: selIds.map((id) => ({ screen_id: id, duration_sec: sel[id] })),
      });
      props.onCreated(r.campaign_id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const blocked = form.status === 'reserved' && conflicts.length > 0;
  const total = quote?.total ?? 0;

  return (
    <Modal title="Добавить клиента" subtitle="Одна кампания сразу на нескольких экранах" wide onClose={props.onClose}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>
          {selIds.length > 0
            ? `${selIds.length} ${plural(selIds.length, ['экран', 'экрана', 'экранов'])}${total ? ` · ${fmtMoney(total)}` : ''}`
            : 'Экраны не выбраны'}
        </span>
        <button className="btn secondary" onClick={props.onClose}>Отмена</button>
        <button className="btn" onClick={submit} disabled={busy || !form.client_id || selIds.length === 0 || blocked}>
          {busy ? 'Создаём…' : form.status === 'draft' ? 'Создать черновик' : 'Забронировать'}
        </button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="form-grid">
        <SelectInput label="Клиент" required value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })}
          options={dicts.clients.map((c: any) => ({ value: c.id, label: c.name }))} />
        <SelectInput label="Менеджер" value={form.manager_id} onChange={(v) => setForm({ ...form, manager_id: v })}
          options={dicts.managers.map((m: any) => ({ value: m.id, label: m.name }))} />
        <SelectInput label="Скидка" value={form.discount_id}
          onChange={(v) => {
            const d = dicts.discounts.find((x: any) => String(x.id) === v);
            setForm({ ...form, discount_id: v, discount_percent: d ? d.percent : 0 });
          }}
          hint={form.discount_percent > 0 ? `Применяется −${form.discount_percent}% к размещению` : 'Из справочника скидок'}
          options={dicts.discounts.map((d: any) => ({ value: d.id, label: `${d.name} (−${d.percent}%)` }))} />
        <SelectInput label="Длительность ролика" required value={form.duration_sec} allowEmpty={false}
          onChange={setAllDuration} hint="Применяется ко всем выбранным экранам"
          options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} сек` }))} />
        <TextInput label="Период: с" type="date" value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
        <TextInput label="Период: по" type="date" value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
        <SelectInput label="Тайм-слот" value={form.time_slot_id} onChange={(v) => setForm({ ...form, time_slot_id: v })}
          hint="Часть суток; влияет на цену"
          options={dicts.timeSlots.map((t: any) => ({ value: t.id, label: `${t.name} ${t.time_from}–${t.time_to} (×${t.price_coef})` }))} />
        <SelectInput label="Статус кампании" value={form.status} allowEmpty={false}
          onChange={(v) => setForm({ ...form, status: v })}
          hint={form.status === 'draft' ? 'Черновик не удерживает ёмкость петли' : 'Бронь удержит ёмкость петли'}
          options={[{ value: 'reserved', label: 'Бронь' }, { value: 'draft', label: 'Черновик' }]} />
      </div>

      <div className="picker">
        <div className="picker-head">
          <span className="eyebrow">Экраны размещения</span>
          <span className="field-inline">
            <Icon name="search" size={14} />
            <input type="search" placeholder="Код, адрес, город, тег" aria-label="Поиск по экранам"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <button className="btn small secondary" onClick={() => {
            const d = Number(form.duration_sec);
            setSel(Object.fromEntries(shown.map((s) => [s.id, d])));
          }}>Выбрать все ({shown.length})</button>
          <button className="btn small ghost" onClick={() => setSel({})} disabled={selIds.length === 0}>Снять выбор</button>
        </div>

        <div className="table-wrap picker-body">
          <table className="data">
            <thead>
              <tr>
                <th scope="col"><span className="th-btn" /></th>
                <th scope="col"><span className="th-btn">Код</span></th>
                <th scope="col"><span className="th-btn">Экран</span></th>
                <th scope="col"><span className="th-btn">Петля</span></th>
                <th scope="col"><span className="th-btn">Ролик</span></th>
                <th scope="col"><span className="th-btn">Стоимость</span></th>
                <th scope="col"><span className="th-btn">Ёмкость</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td className="empty-row" colSpan={7}>
                  <span className="empty-state"><b>Экраны не найдены</b><span>Измените строку поиска.</span></span>
                </td></tr>
              )}
              {shown.map((s) => {
                const on = sel[s.id] !== undefined;
                const q1 = byScreen[s.id];
                return (
                  <tr key={s.id} className={'clickable' + (on ? ' is-picked' : '')} onClick={() => toggle(s.id)}>
                    <td><input type="checkbox" checked={on} onChange={() => toggle(s.id)}
                      aria-label={`Выбрать экран ${s.code}`} onClick={(e) => e.stopPropagation()} /></td>
                    <td><b className="mono">{s.code}</b></td>
                    <td>
                      <span className="cell-stack">
                        <span>{s.name}</span>
                        <span className="sub">{s.city_name ?? '—'}{s.side ? ` · сторона ${s.side}` : ''}</span>
                      </span>
                    </td>
                    <td className="num">{s.loop_duration_sec} сек</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select value={sel[s.id] ?? form.duration_sec} disabled={!on}
                        aria-label={`Длительность ролика на экране ${s.code}`}
                        onChange={(e) => setSel((prev) => ({ ...prev, [s.id]: Number(e.target.value) }))}>
                        {[5, 10, 15, 20, 30].map((v) => <option key={v} value={v}>{v} сек</option>)}
                      </select>
                    </td>
                    <td className="num">{on ? (q1 ? fmtMoney(q1.price) : '…') : <span className="muted">—</span>}</td>
                    <td>
                      {!on ? <span className="muted">—</span>
                        : !q1 ? <span className="muted">проверяем…</span>
                        : q1.ok ? <span className="cap ok"><Icon name="check" size={13} /> помещается</span>
                        : <span className="cap bad" title={q1.reason}><Icon name="alert" size={13} /> не помещается</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {blocked && (
        <Alert tone="error">
          Петля переполнена на {conflicts.length} {plural(conflicts.length, ['экране', 'экранах', 'экранах'])}:{' '}
          {conflicts.map((c: any) => c.code).join(', ')}. Снимите их, уменьшите длительность или сохраните как черновик.
        </Alert>
      )}
      {!blocked && quote && selIds.length > 0 && (
        <div className="panel" style={{ marginBottom: 0 }}>
          <dl className="kv">
            <dt>Экранов в кампании</dt><dd>{selIds.length}</dd>
            <dt>Период</dt><dd>{fmtDate(form.date_from)} — {fmtDate(form.date_to)} ({quote.items[0]?.days ?? 0} дн.)</dd>
            <dt>Стоимость размещения</dt><dd><b>{fmtMoney(total)}</b></dd>
          </dl>
        </div>
      )}
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

  const loop = props.screen.loop_duration_sec;
  const used = playlist.reduce((a, p) => a + p.duration_sec, 0);
  const segments: TapeSegment[] = playlist.map((p) => ({
    label: p.client_name ?? p.campaign_number,
    sec: p.duration_sec,
    color: seriesColor(p.client_id ? `c${p.client_id}` : `n:${p.client_name ?? '—'}`, true),
  }));

  return (
    <Modal title={`Плейлист ${props.screen.code}`} subtitle={`${props.screen.name} · петля ${loop} сек`} wide onClose={props.onClose}>
      <div className="panel">
        <h3>
          Загрузка петли по дням
          <span className="field-inline" style={{ marginLeft: 'auto', fontWeight: 400 }}>
            <input type="date" aria-label="Начало периода" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span aria-hidden="true">—</span>
            <input type="date" aria-label="Конец периода" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </span>
        </h3>
        {avail && (
          <>
            <div className="days-strip">
              {avail.days.map((day: any) => {
                const tone = day.load_pct > 0 ? loadTone(day.load_pct) : null;
                const color = tone === 'crit' ? '#d03b3b' : tone === 'warn' ? '#fab219' : tone === 'good' ? '#0ca30c' : 'transparent';
                return (
                  <div key={day.date} className="day-cell"
                    title={`${fmtDate(day.date)}: занято ${day.used_sec} сек из ${avail.loop_duration_sec} (${day.load_pct}%)`}>
                    <span className="d">{day.date.slice(8)}</span>
                    <span className="bar" style={{ background: color, boxShadow: tone ? 'none' : 'inset 0 0 0 1px rgba(231,235,242,.22)' }}>
                      {tone ? Math.round(day.load_pct) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Пик за период — <b>{avail.max_load_pct}%</b>, свободно <b>{avail.free_sec} сек</b> из {avail.loop_duration_sec}.
            </p>
          </>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>
          Ротация на дату
          <input type="date" aria-label="Дата ротации" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
            занято {used} из {loop} сек
          </span>
        </h3>

        <LoopTape loop={loop} segments={segments} slim />
        <LoopRuler loop={loop} />

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data">
            <thead><tr>
              <th scope="col"><span className="th-btn">#</span></th>
              <th scope="col"><span className="th-btn">Кампания</span></th>
              <th scope="col"><span className="th-btn">Клиент</span></th>
              <th scope="col"><span className="th-btn">Ролик</span></th>
              <th scope="col"><span className="th-btn">Длит., сек</span></th>
              <th scope="col"><span className="th-btn">Выходов/сут</span></th>
              <th scope="col"><span className="th-btn">Тайм-слот</span></th>
              <th scope="col"><span className="th-btn">Период</span></th>
              <th scope="col"><span className="th-btn">Статус</span></th>
            </tr></thead>
            <tbody>
              {playlist.length === 0 && (
                <tr><td className="empty-row" colSpan={9}>
                  <span className="empty-state">
                    <b>Петля свободна</b>
                    <span>На {fmtDate(date)} размещений нет — все {loop} секунд можно продать.</span>
                  </span>
                </td></tr>
              )}
              {playlist.map((p, i) => (
                <tr key={p.id}>
                  <td className="muted num">{i + 1}</td>
                  <td className="mono">{p.campaign_number}</td>
                  <td>
                    <span className="tape-legend" style={{ margin: 0 }}>
                      <span className="item">
                        <span className="sw" style={{ background: seriesColor(p.client_id ? `c${p.client_id}` : `n:${p.client_name ?? '—'}`) }} />
                        <b>{p.client_name ?? '—'}</b>
                      </span>
                    </span>
                  </td>
                  <td>{p.creative_name ?? <span className="muted">не загружен</span>}</td>
                  <td className="num">{p.duration_sec}</td>
                  <td className="num">{p.plays_per_day || '—'}</td>
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

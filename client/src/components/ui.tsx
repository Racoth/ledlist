import React, { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_LABELS } from '../api';
import { Icon } from './icons';
import type { IconName } from './icons';

export { Icon };
export type { IconName };

/* ============================================================================
   Клиентские серии — проверенная категориальная палитра.
   Порядок фиксирован: цвет закреплён за клиентом, а не за его местом в списке.
   `lit` — вариант для тёмной подложки (секундная лента), базовый — для светлой.
   ========================================================================== */
export const SERIES = [
  { base: '#2a78d6', lit: '#3987e5' },
  { base: '#eb6834', lit: '#d95926' },
  { base: '#1baf7a', lit: '#199e70' },
  { base: '#eda100', lit: '#c98500' },
  { base: '#e87ba4', lit: '#d55181' },
  { base: '#008300', lit: '#008300' },
  { base: '#4a3aa7', lit: '#9085e9' },
  { base: '#e34948', lit: '#e66767' },
];

/** Цвет закрепляется за сущностью (клиентом), а не за порядком в выборке. */
export function seriesColor(key: string | number, lit = false) {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const slot = SERIES[h % SERIES.length];
  return lit ? slot.lit : slot.base;
}

/** Читаемый цвет подписи поверх заливки серии (жёлтый и аква требуют тёмного текста). */
export function onColor(hex: string) {
  const v = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // контраст с белым против контраста с чернильным
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.0946) ? '#ffffff' : '#12161d';
}

/** Тон загрузки петли: <70 — свободно, <95 — плотно, ≥95 — заполнено. */
export function loadTone(pct: number): 'good' | 'warn' | 'crit' {
  return pct >= 95 ? 'crit' : pct >= 70 ? 'warn' : 'good';
}
export const TONE_COLOR = { good: '#0ca30c', warn: '#fab219', crit: '#d03b3b' } as const;

/* ============================================================================
   Модальное окно
   ========================================================================== */
let modalSeq = 0;

export function Modal(props: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useMemo(() => `modal-title-${++modalSeq}`, []);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    bodyRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href]'
    )?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>
            {props.title}
            {props.subtitle && <span className="modal-sub">{props.subtitle}</span>}
          </h2>
          <button className="modal-close" onClick={props.onClose} aria-label="Закрыть окно">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/* ============================================================================
   Поля формы
   ========================================================================== */
let fieldSeq = 0;

export function Field(props: { label: string; hint?: string; required?: boolean; children: (id: string) => React.ReactNode }) {
  const id = useMemo(() => `f${++fieldSeq}`, []);
  return (
    <div className="field">
      <label htmlFor={id}>
        {props.label}
        {props.required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {props.children(id)}
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );
}

export function TextInput(props: {
  label: string; value: any; onChange: (v: string) => void;
  type?: string; hint?: string; required?: boolean; placeholder?: string; step?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint} required={props.required}>
      {(id) => (
        <input
          id={id}
          type={props.type ?? 'text'}
          value={props.value ?? ''}
          step={props.step}
          required={props.required}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectInput(props: {
  label: string; value: any; onChange: (v: string) => void;
  options: { value: any; label: string }[]; allowEmpty?: boolean; required?: boolean; hint?: string;
}) {
  return (
    <Field label={props.label} required={props.required} hint={props.hint}>
      {(id) => (
        <select id={id} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)}>
          {props.allowEmpty !== false && <option value="">Не выбрано</option>}
          {props.options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function TextArea(props: { label: string; value: any; onChange: (v: string) => void; hint?: string; rows?: number }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <textarea id={id} rows={props.rows ?? 2} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

/* ============================================================================
   Оповещения — цвет всегда в паре с иконкой и текстом
   ========================================================================== */
export function Alert({ tone, children }: { tone: 'error' | 'ok' | 'note'; children: React.ReactNode }) {
  const icon: IconName = tone === 'error' ? 'alert' : tone === 'ok' ? 'checkCircle' : 'info';
  return (
    <div className={`${tone === 'error' ? 'error' : tone === 'ok' ? 'ok' : 'note'}-box`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </div>
  );
}

/* ============================================================================
   Бейдж статуса — точка + подпись (никогда только цвет)
   ========================================================================== */
const STATUS_TONE: Record<string, { cls: string; dot: string }> = {
  draft:       { cls: 'is-idle', dot: '#8b95a5' },
  reserved:    { cls: 'is-warn', dot: '#fab219' },
  sold:        { cls: 'is-good', dot: '#0ca30c' },
  cancelled:   { cls: 'is-crit', dot: '#d03b3b' },
  active:      { cls: 'is-good', dot: '#0ca30c' },
  maintenance: { cls: 'is-warn', dot: '#fab219' },
  inactive:    { cls: 'is-idle', dot: '#8b95a5' },
};

export function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { cls: 'is-idle', dot: '#8b95a5' };
  return (
    <span className={`badge ${t.cls}`}>
      <span className="dot" style={{ background: t.dot }} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ============================================================================
   Метр загрузки петли — миниатюра светодиодной ленты
   ========================================================================== */
const TRACK_PX = 84;   // ширина дорожки метра в инвентаре
const MIN_TICK_PX = 4; // ниже этого деления сливаются в сплошную заливку

export function LoadBar({ pct, loop }: { pct: number; loop?: number }) {
  const tone = loadTone(pct);
  const width = Math.min(100, Math.max(pct > 0 ? 2 : 0, pct));
  // деление ставим не чаще, чем раз в MIN_TICK_PX — иначе шкала перестаёт читаться
  const secPx = loop ? TRACK_PX / loop : 0;
  const tick = secPx > 0 ? Math.ceil(MIN_TICK_PX / secPx) * secPx : MIN_TICK_PX + 3;
  return (
    <span className={`loadbar is-${tone}`}>
      <span
        className="track"
        style={{ '--tick': `${tick}px` } as React.CSSProperties}
        role="img"
        aria-label={`Загрузка петли ${pct}%`}
      >
        <span className="fill" style={{ width: `${width}%`, background: TONE_COLOR[tone] }} />
      </span>
      <span className="pct">{pct}%</span>
    </span>
  );
}

/* ============================================================================
   СИГНАТУРА — секундная лента петли.
   Одно деление = одна секунда эфира. Занятые секунды светятся цветом клиента,
   свободные остаются погашенными.
   ========================================================================== */
export interface TapeSegment { label: string; sec: number; color: string }

export function LoopTape(props: { loop: number; segments: TapeSegment[]; slim?: boolean; dark?: boolean }) {
  const { loop, segments } = props;
  const tickEvery = loop <= 90 ? 1 : loop <= 300 ? 5 : 15;
  const tickPct = loop > 0 ? (100 * tickEvery) / loop : 100;

  return (
    <div
      className={'tape' + (props.slim ? ' slim' : '')}
      style={{ '--tick': `${tickPct}%` } as React.CSSProperties}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          className="tape-seg"
          style={{ width: `${loop ? (s.sec / loop) * 100 : 0}%`, background: s.color }}
          title={`${s.label}: ${s.sec} сек`}
        />
      ))}
    </div>
  );
}

export function LoopRuler({ loop }: { loop: number }) {
  const step = loop <= 60 ? 15 : loop <= 120 ? 30 : 60;
  const marks: number[] = [];
  if (loop > 0 && loop % step === 0) {
    for (let s = 0; s <= loop; s += step) marks.push(s);
  } else {
    marks.push(0, loop);
  }
  return (
    <div className="tape-ruler" aria-hidden="true">
      {marks.map((m) => <span key={m}>{m === loop ? `${m} сек` : m}</span>)}
    </div>
  );
}

export function TapeLegend({ segments, free, loop }: { segments: TapeSegment[]; free: number; loop: number }) {
  if (segments.length === 0) {
    return <div className="tape-empty">Петля свободна — размещений в этом месяце нет. Все {loop} секунд можно продать.</div>;
  }
  return (
    <div className="tape-legend">
      {segments.map((s, i) => (
        <span className="item" key={i}>
          <span className="sw" style={{ background: s.color }} />
          <b>{s.label}</b>
          <span className="sec">{s.sec} сек</span>
        </span>
      ))}
      <span className="item">
        <span className="sw" style={{ background: 'var(--night)', boxShadow: 'inset 0 0 0 1px var(--line-2)' }} />
        Свободно <span className="sec">{free} сек</span>
      </span>
    </div>
  );
}

/* ============================================================================
   Таблица
   ========================================================================== */
export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  optional?: boolean;   // можно скрыть в настройке колонок
  sortable?: boolean;   // по умолчанию true
}

export function DataTable<T extends { id: number }>(props: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  visibleKeys?: string[];       // null = все
  emptyText?: string;
  emptyHint?: string;
  variant?: string;             // доп. класс оформления (напр. 'inventory')
  rowClass?: (row: T) => string | undefined;
  caption?: string;
  selected?: number[];                          // включает колонку выбора
  onSelectedChange?: (ids: number[]) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const selectable = !!props.onSelectedChange;
  const selectedSet = new Set(props.selected ?? []);

  const cols = props.visibleKeys
    ? props.columns.filter((c) => !c.optional || props.visibleKeys!.includes(c.key))
    : props.columns;

  const sorted = useMemo(() => {
    if (!sortKey) return props.rows;
    const col = props.columns.find((c) => c.key === sortKey);
    if (!col) return props.rows;
    const val = (r: T) => col.sortValue ? col.sortValue(r) : (r as any)[sortKey] ?? '';
    return [...props.rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv), 'ru') * sortDir;
    });
  }, [props.rows, sortKey, sortDir]);

  return (
    <div className={'table-wrap' + (props.variant ? ' ' + props.variant : '')}>
      <table className="data">
        {props.caption && <caption className="visually-hidden">{props.caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="sel-cell">
                <input
                  type="checkbox"
                  aria-label="Выбрать все строки"
                  checked={sorted.length > 0 && sorted.every((r) => selectedSet.has(r.id))}
                  ref={(el) => {
                    if (el) el.indeterminate = sorted.some((r) => selectedSet.has(r.id)) && !sorted.every((r) => selectedSet.has(r.id));
                  }}
                  onChange={(e) => props.onSelectedChange!(e.target.checked ? sorted.map((r) => r.id) : [])}
                />
              </th>
            )}
            {cols.map((c) => {
              const sortable = c.sortable !== false && c.title !== '';
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sortDir === 1 ? 'ascending' : 'descending') : undefined}
                >
                  {sortable ? (
                    <button
                      className="th-btn"
                      onClick={() => {
                        if (active) setSortDir((d) => (d === 1 ? -1 : 1));
                        else { setSortKey(c.key); setSortDir(1); }
                      }}
                    >
                      {c.title}
                      {active && <Icon name={sortDir === 1 ? 'chevronUp' : 'chevronDown'} size={11} className="sort" />}
                    </button>
                  ) : (
                    <span className="th-btn">{c.title}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td className="empty-row" colSpan={cols.length + (selectable ? 1 : 0)}>
                <span className="empty-state">
                  <b>{props.emptyText ?? 'Пока пусто'}</b>
                  {props.emptyHint && <span>{props.emptyHint}</span>}
                </span>
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr
              key={row.id}
              className={[
                props.onRowClick ? 'clickable' : '',
                selectedSet.has(row.id) ? 'is-picked' : '',
                props.rowClass?.(row) ?? '',
              ].filter(Boolean).join(' ')}
              onClick={() => props.onRowClick?.(row)}
            >
              {selectable && (
                <td className="sel-cell" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Выбрать строку ${row.id}`}
                    checked={selectedSet.has(row.id)}
                    onChange={(e) => {
                      const next = new Set(selectedSet);
                      if (e.target.checked) next.add(row.id); else next.delete(row.id);
                      props.onSelectedChange!([...next]);
                    }}
                  />
                </td>
              )}
              {cols.map((c) => <td key={c.key}>{c.render ? c.render(row) : (row as any)[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================================
   Настройка колонок
   ========================================================================== */
export function ColumnsButton(props: {
  columns: Column<any>[];
  visible: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const optional = props.columns.filter((c) => c.optional);
  if (optional.length === 0) return null;
  return (
    <>
      <button className="btn secondary" onClick={() => setOpen(true)}>
        <Icon name="columns" size={14} /> Колонки
        <span className="num muted">{props.visible.length}</span>
      </button>
      {open && (
        <Modal
          title="Колонки таблицы"
          subtitle="Выбор сохраняется в этом браузере"
          onClose={() => setOpen(false)}
          footer={<button className="btn" onClick={() => setOpen(false)}>Готово</button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {optional.map((c) => (
              <div key={c.key} className="checkbox-row">
                <input
                  type="checkbox"
                  id={`col-${c.key}`}
                  checked={props.visible.includes(c.key)}
                  onChange={(e) => props.onChange(e.target.checked
                    ? [...props.visible, c.key]
                    : props.visible.filter((k) => k !== c.key))}
                />
                <label htmlFor={`col-${c.key}`}>{c.title}</label>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

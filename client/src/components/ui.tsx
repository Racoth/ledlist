import React, { useEffect, useMemo, useState } from 'react';

// ---------- Modal ----------
export function Modal(props: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={'modal' + (props.wide ? ' wide' : '')}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="modal-close" onClick={props.onClose}>✕</button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ---------- Поля формы ----------
export function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );
}

export function TextInput(props: {
  label: string; value: any; onChange: (v: string) => void;
  type?: string; hint?: string; required?: boolean; placeholder?: string; step?: string;
}) {
  return (
    <Field label={props.label + (props.required ? ' *' : '')} hint={props.hint}>
      <input
        type={props.type ?? 'text'}
        value={props.value ?? ''}
        step={props.step}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectInput(props: {
  label: string; value: any; onChange: (v: string) => void;
  options: { value: any; label: string }[]; allowEmpty?: boolean; required?: boolean;
}) {
  return (
    <Field label={props.label + (props.required ? ' *' : '')}>
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)}>
        {props.allowEmpty !== false && <option value="">—</option>}
        {props.options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// ---------- Бейдж статуса ----------
import { STATUS_LABELS, STATUS_COLORS } from '../api';
export function StatusBadge({ status }: { status: string }) {
  return <span className="badge" style={{ background: STATUS_COLORS[status] ?? '#888' }}>{STATUS_LABELS[status] ?? status}</span>;
}

// ---------- Индикатор загрузки петли ----------
export function LoadBar({ pct }: { pct: number }) {
  const color = pct >= 95 ? '#d05555' : pct >= 70 ? '#e8a13c' : '#3ca55c';
  return (
    <span className="loadbar">
      <span className="track"><span className="fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} /></span>
      <span className="pct">{pct}%</span>
    </span>
  );
}

// ---------- DataTable ----------
export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  optional?: boolean;   // можно скрыть в настройке колонок
}

export function DataTable<T extends { id: number }>(props: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  visibleKeys?: string[];       // null = все
  emptyText?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

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
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} onClick={() => {
                if (sortKey === c.key) setSortDir((d) => (d === 1 ? -1 : 1));
                else { setSortKey(c.key); setSortDir(1); }
              }}>
                {c.title}
                {sortKey === c.key && <span className="sort">{sortDir === 1 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td className="empty-row" colSpan={cols.length}>{props.emptyText ?? 'Нет данных'}</td></tr>
          )}
          {sorted.map((row) => (
            <tr key={row.id} className={props.onRowClick ? 'clickable' : ''} onClick={() => props.onRowClick?.(row)}>
              {cols.map((c) => <td key={c.key}>{c.render ? c.render(row) : (row as any)[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Настройка колонок ----------
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
      <button className="btn secondary" onClick={() => setOpen(true)}>Колонки</button>
      {open && (
        <Modal title="Отображаемые колонки" onClose={() => setOpen(false)}
          footer={<button className="btn" onClick={() => setOpen(false)}>Готово</button>}>
          {optional.map((c) => (
            <div key={c.key} className="checkbox-row" style={{ marginBottom: 8 }}>
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
        </Modal>
      )}
    </>
  );
}

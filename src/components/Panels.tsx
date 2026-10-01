import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Panels.module.css';
import ui from './ui.module.css';
import { cx } from '../utils/format';

export function BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className={styles['sheetBackdrop']} onClick={onClose} aria-hidden="true" />
      <div className={styles['sheet']} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles['sheetHandle']} />
        <div className={styles['sheetHead']}>
          <h2 style={{ fontSize: 16 }}>{title}</h2>
          <button className={ui['iconBtn']} onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className={styles['sheetBody']}>{children}</div>
      </div>
    </>
  );
}

export function Collapsible({ title, defaultOpen = true, right, children }: { title: string; defaultOpen?: boolean; right?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={styles['collapsible']}>
      <button className={styles['collapsibleHead']} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className={ui['row']} style={{ gap: 6 }}>
          {right}
          <Icon name="down" />
        </span>
      </button>
      {open && (
        <div id={id} className={styles['collapsibleBody']}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange(v: T): void; label: string }) {
  return (
    <div className={styles['segmented']} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  onChange(v: number): void;
}) {
  const id = useId();
  return (
    <div className={styles['slider']}>
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{format ? format(value) : value.toFixed(2)}</output>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export { cx };

"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode, SelectHTMLAttributes } from "react";
import "../app/select.css";

type Option = { value: string; label: string; disabled: boolean; group?: string };
type SelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name" | "disabled" | "required" | "className" | "style" | "aria-label" | "aria-labelledby" | "aria-describedby"> & {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  placeholder?: string;
  searchThreshold?: number;
  children?: ReactNode;
};

const text = (node: ReactNode): string => Children.toArray(node).map(c => typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? text(c.props.children) : "").join("");
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

function collect(children: ReactNode, group: string | undefined, out: Option[]) {
  Children.forEach(children, child => {
    if (!isValidElement<{ value?: string | number; label?: string; disabled?: boolean; children?: ReactNode }>(child)) return;
    if (child.type === Fragment) collect(child.props.children, group, out);
    else if (child.type === "optgroup") collect(child.props.children, child.props.label, out);
    else if (child.type === "option") {
      const label = text(child.props.children);
      out.push({ value: child.props.value === undefined ? label : String(child.props.value), label, disabled: Boolean(child.props.disabled), group });
    }
  });
}

export function Select({ value, defaultValue, onChange, name, id, disabled, required, className, style, placeholder = "Selecione", searchThreshold = 7, children, ...aria }: SelectProps) {
  const options = useMemo(() => { const out: Option[] = []; collect(children, undefined, out); return out; }, [children]);
  const [inner, setInner] = useState(defaultValue === undefined ? "" : String(defaultValue));
  const current = value === undefined ? inner : String(value);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchable = options.length > searchThreshold;
  const selected = options.find(o => o.value === current && !(o.disabled && o.value === "")) ?? (options.find(o => o.value === current));
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return options.filter(o => q ? !o.disabled && fold(o.label).includes(q) : true);
  }, [options, query]);
  const enabled = shown.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);

  function show() {
    if (disabled) return;
    const rect = trigger.current!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom, above = rect.top;
    const up = below < 280 && above > below;
    const width = Math.max(rect.width, 220);
    setPlace({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight: Math.min(360, (up ? above : below) - 12), ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
    const idx = shown.findIndex(o => o.value === current && !o.disabled);
    setActive(idx >= 0 ? idx : (enabled[0] ?? 0));
    setQuery("");
    setOpen(true);
  }
  function close(refocus = true) { setOpen(false); if (refocus) trigger.current?.focus(); }
  function pick(o: Option) {
    if (o.disabled) return;
    if (value === undefined) setInner(o.value);
    if (o.value !== current) onChange?.({ target: { value: o.value, name: name ?? "" }, currentTarget: { value: o.value, name: name ?? "" } } as unknown as ChangeEvent<HTMLSelectElement>);
    close();
  }

  useEffect(() => {
    if (!open) return;
    (searchable ? search.current : panel.current)?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) close(false); };
    const resize = () => close(false);
    document.addEventListener("pointerdown", down);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [open, active]);

  function move(step: number) {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[at < 0 ? 0 : Math.min(enabled.length - 1, Math.max(0, at + step))]);
  }
  function keys(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(enabled[0] ?? 0); }
    else if (e.key === "End") { e.preventDefault(); setActive(enabled[enabled.length - 1] ?? 0); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === "Tab") close(false);
  }

  const label = selected && !(selected.disabled && selected.value === "") ? selected.label : "";
  return <div className={`ui-select ${className ?? ""}`} style={style} ref={root}>
    <button type="button" id={id} ref={trigger} className="ui-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} {...aria}
      onClick={() => open ? close() : show()}
      onKeyDown={e => { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); if (!open) show(); } }}>
      <span className={label ? "" : "ui-select-placeholder"}>{label || (selected?.label ?? placeholder)}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {(name || required) && <input className="ui-select-native" tabIndex={-1} aria-hidden="true" name={name} value={current} required={required} disabled={disabled} onChange={() => undefined} onFocus={() => trigger.current?.focus()} />}
    {open && <div className="ui-select-panel" style={place} ref={panel} tabIndex={-1} onKeyDown={keys}>
      {searchable && <div className="ui-select-search"><Search size={15} aria-hidden="true" /><input ref={search} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} placeholder="Buscar…" aria-label="Buscar na lista" aria-controls={listId} autoComplete="off" /></div>}
      <div className="ui-select-list" role="listbox" id={listId} aria-label={aria["aria-label"]}>
        {shown.length === 0 ? <p className="ui-select-empty">Nada encontrado para “{query}”.</p> : shown.map((o, i) => <Fragment key={`${o.value}-${i}`}>
          {o.group && o.group !== shown[i - 1]?.group && <div className="ui-select-group">{o.group}</div>}
          <div role="option" data-index={i} data-value={o.value} aria-selected={o.value === current} aria-disabled={o.disabled || undefined} className={`ui-select-option${i === active ? " active" : ""}${o.value === current ? " selected" : ""}`} onPointerEnter={() => !o.disabled && setActive(i)} onClick={() => pick(o)}>
            <span>{o.label}</span>{o.value === current && !o.disabled && <Check size={15} aria-hidden="true" />}
          </div>
        </Fragment>)}
      </div>
      {searchable && <div className="ui-select-count" aria-live="polite">{shown.length} de {options.length}</div>}
    </div>}
  </div>;
}

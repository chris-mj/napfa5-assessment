import React, { createContext, useContext, useMemo, useRef, useState, useEffect } from "react";

const SelectCtx = createContext(null);

export function Select({ value, onValueChange, children }) {
  const [open, setOpen] = useState(false);
  const ctx = useMemo(() => ({ open, setOpen, value, onValueChange }), [open, value, onValueChange]);
  return <SelectCtx.Provider value={ctx}>{children}</SelectCtx.Provider>;
}

export function SelectTrigger({ className = "", children, ...rest }) {
  const { setOpen } = useRequiredCtx();
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      data-select-trigger
      className={"flex items-center justify-between border-2 rounded-md px-3 py-2 bg-white " + className}
      {...rest}
    >
      {children}
      <svg className="ml-2 h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.18l3.71-3.95a.75.75 0 011.08 1.04l-4.25 4.53a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
      </svg>
    </button>
  );
}

export function SelectValue({ placeholder }) {
  const { value } = useRequiredCtx();
  return <span className={value ? "text-gray-900" : "text-gray-500"}>{value || placeholder}</span>;
}

export function SelectContent({ className = "", children }) {
  const { open, setOpen } = useRequiredCtx();
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const timeout = setTimeout(() => setRender(false), 120);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Element && e.target.closest('[data-select-trigger]')) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc, { passive: true });
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  if (!render) return null;
  return (
    <div
      ref={ref}
      className={
        "absolute left-0 mt-1 border-2 rounded-xl bg-white shadow-sm p-2 z-50 w-full transition-all duration-150 ease-out origin-top " +
        (entered ? "opacity-100 scale-100" : "opacity-0 scale-95") + " " +
        className
      }
      role="listbox"
    >
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function SelectItem({ value, children, className = "" }) {
  const { onValueChange, setOpen, value: selectedValue } = useRequiredCtx();
  const isSelected = selectedValue === value;
  return (
    <button
      type="button"
      role="option"
      onClick={() => {
        onValueChange?.(value);
        setOpen(false);
      }}
      className={
        "w-full text-left px-3 py-2.5 rounded-full ring-2 flex items-center gap-2 " +
        (isSelected
          ? "bg-blue-600 text-white ring-blue-600"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50") +
        " " + className
      }
    >
      {children}
    </button>
  );
}

export function SelectGroup({ children }) {
  return <div className="py-1">{children}</div>;
}

export function SelectLabel({ children }) {
  return <div className="text-xs text-gray-500 px-2 py-1">{children}</div>;
}

function useRequiredCtx() {
  const ctx = useContext(SelectCtx);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

import React, { createContext, useContext, useMemo, useRef, useState } from "react";

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
      className={"flex items-center justify-between border rounded-md px-3 py-2 bg-white " + className}
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
  const { open } = useRequiredCtx();
  if (!open) return null;
  return (
    <div className={"mt-1 border rounded-md bg-white shadow-sm p-1 z-50 " + className} role="listbox">
      {children}
    </div>
  );
}

export function SelectItem({ value, children }) {
  const { onValueChange, setOpen } = useRequiredCtx();
  return (
    <button
      type="button"
      role="option"
      onClick={() => {
        onValueChange?.(value);
        setOpen(false);
      }}
      className="w-full text-left px-3 py-2 rounded hover:bg-gray-50"
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


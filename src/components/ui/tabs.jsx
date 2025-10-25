import React, { createContext, useContext, useMemo } from "react";

const TabsCtx = createContext(null);

export function Tabs({ value, onValueChange, children }) {
  const ctx = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return <TabsCtx.Provider value={ctx}>{children}</TabsCtx.Provider>;
}

export function TabsList({ className = "", children, ...rest }) {
  return (
    <div role="tablist" className={className} {...rest}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className = "", children, ...rest }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabsTrigger must be used within Tabs");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.onValueChange?.(value)}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className = "", children, ...rest }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabsContent must be used within Tabs");
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={className} {...rest}>
      {children}
    </div>
  );
}


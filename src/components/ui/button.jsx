import React from "react";

export function Button({ variant = "default", className = "", children, ...props }) {
  const base = "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
  const variants = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border bg-white hover:bg-gray-50",
    ghost: "hover:bg-gray-100",
  };
  const cls = `${base} ${variants[variant] || variants.default} ${className}`;
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  );
}


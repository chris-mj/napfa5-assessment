import React from "react";

export function Input({ className = "", ...props }) {
  return (
    <input
      className={
        "bg-white border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 " +
        className
      }
      {...props}
    />
  );
}


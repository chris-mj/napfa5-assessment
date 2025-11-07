import React, { forwardRef } from "react";

export const Input = forwardRef(function Input(
  { className = "", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={
        "bg-white border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 " +
        className
      }
      {...props}
    />
  );
});


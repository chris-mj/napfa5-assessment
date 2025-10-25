import React from "react";

export function Card({ className = "", children, ...rest }) {
  return (
    <div className={"bg-white border rounded-lg shadow-sm " + className} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...rest }) {
  return (
    <div className={"p-4 border-b " + className} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...rest }) {
  return (
    <div className={"text-lg font-semibold text-gray-800 flex items-center gap-2 " + className} {...rest}>
      {children}
    </div>
  );
}

export function CardDescription({ className = "", children, ...rest }) {
  return (
    <p className={"text-sm text-gray-600 mt-1 " + className} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({ className = "", children, ...rest }) {
  return (
    <div className={"p-4 " + className} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className = "", children, ...rest }) {
  return (
    <div className={"px-4 py-3 border-t " + className} {...rest}>
      {children}
    </div>
  );
}


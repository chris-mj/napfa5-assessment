import { useEffect } from "react";

export default function PlatformOwner() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-slate-900">Platform Owner</h1>
        <p className="text-slate-600 mt-2">
          Owner-only controls and diagnostics will live here.
        </p>
      </div>
    </div>
  );
}

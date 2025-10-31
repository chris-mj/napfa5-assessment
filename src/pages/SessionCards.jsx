import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { drawBarcode } from "../utils/barcode";
import { drawQr } from "../utils/qrcode";
import { normalizeStudentId } from "../utils/ids";

export default function SessionCards() {
  const { id } = useParams();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      // roster with student + class (active enrollment)
      const { data, error: err } = await supabase
        .from('session_roster')
        .select('students!inner(id, student_identifier, name, enrollments!left(class, is_active))')
        .eq('session_id', id)
        .order('student_id', { ascending: true });
      if (err) { setError(err.message); setLoading(false); return; }
      const list = (data||[]).map(r => {
        const enr = r.students?.enrollments;
        const activeClass = Array.isArray(enr) ? (enr.find(e => e?.is_active)?.class) : (enr?.class);
        return {
          id: r.students.id,
          student_identifier: r.students.student_identifier,
          name: r.students.name,
          class: activeClass || ''
        };
      }).sort((a, b) => (String(a.class||'').localeCompare(String(b.class||''), undefined, { numeric: true, sensitivity: 'base' })
        || String(a.name||'').localeCompare(String(b.name||''), undefined, { sensitivity: 'base' })));
      setRoster(list);
      setLoading(false);
    };
    load();
  }, [id]);

  useEffect(() => {
    // After first paint, draw barcodes/QRs
    if (!loading) {
      setTimeout(() => {
        roster.forEach((s, idx) => {
          const bc = document.getElementById(`bc_${idx}`);
          const qc = document.getElementById(`qr_${idx}`);
          if (bc) drawBarcode(bc, normalizeStudentId(s.student_identifier), { format: 'CODE128', width: 2, height: 64, margin: 16 });
          if (qc) drawQr(qc, normalizeStudentId(s.student_identifier), 192);
        });
      }, 0);
    }
  }, [loading, roster]);

  useEffect(() => {
    // Auto-open print dialog once content is ready
    if (!loading && roster.length) {
      setTimeout(() => window.print(), 500);
    }
  }, [loading, roster.length]);

  const pageStyle = useMemo(() => `
    @page { size: A4; margin: 10mm; }
    @media print {
      .no-print { display: none !important; }
    }
  `, []);

  return (
    <div className="p-4">
      <style>{pageStyle}</style>
      <div className="no-print flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold">Profile Cards</h1>
        <button className="px-3 py-1.5 border rounded hover:bg-gray-50" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2">
          {roster.map((s, idx) => (
            <div key={s.id} className="border rounded-lg p-3 h-[360px] flex flex-col justify-between break-inside-avoid">
              <div>
                <div className="text-sm text-gray-500">ID</div>
                <div className="text-xl font-semibold tracking-wide">{normalizeStudentId(s.student_identifier)}</div>
                <div className="mt-1 text-sm text-gray-500">Name</div>
                <div className="text-lg">{s.name}</div>
                <div className="mt-1 text-sm text-gray-500">Class</div>
                <div className="text-lg">{s.class}</div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3">
                <canvas id={`bc_${idx}`} className="flex-1 bg-white border rounded" height="40"></canvas>
                <canvas id={`qr_${idx}`} className="w-[96px] h-[96px] border rounded"></canvas>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


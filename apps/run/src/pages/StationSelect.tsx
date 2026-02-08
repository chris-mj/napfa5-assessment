import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getSession } from '../db/repo';

const STATIONS_BY_TEMPLATE: Record<string, string[]> = {
  A: ['LAP_END'],
  B: ['LAP_END', 'A'],
  C: ['LAP_END', 'A', 'B'],
  D: ['START', 'LAP_END'],
  E: ['LAP_END', 'FINISH']
};

function stationStorageKey(sessionId: string) {
  return `napfa5-run:station:${sessionId}`;
}

export default function StationSelect() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const navigate = useNavigate();
  const [stationId, setStationId] = useState('');
  const [templateKey, setTemplateKey] = useState<string>('A');
  const [tokenMissing, setTokenMissing] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((session) => {
      if (!session) return;
      const template = session.templateKey;
      setTemplateKey(template);
      setTokenMissing(template !== 'A' && !session.pairingToken);
      const storage = stationStorageKey(sessionId);
      const stored = localStorage.getItem(storage);
      if (stored) {
        setStationId(stored);
      } else {
        const stations = STATIONS_BY_TEMPLATE[template] ?? [];
        setStationId(stations[0] ?? '');
      }
    });
  }, [sessionId]);

  const stationOptions = (STATIONS_BY_TEMPLATE[templateKey] ?? []).map((station) => ({
    id: station,
    label:
      station === 'LAP_END'
        ? 'Lap Start / End Scan'
        : templateKey === 'B' && station === 'A'
          ? 'Checkpoint A Scan'
          : templateKey === 'C' && station === 'A'
            ? 'Checkpoint A Scan'
            : templateKey === 'C' && station === 'B'
              ? 'Checkpoint B Scan'
              : station
  }));

  function handleSelectStation(value: string) {
    setStationId(value);
    localStorage.setItem(stationStorageKey(sessionId), value);
  }

  function handleContinue() {
    if (!sessionId || !stationId) return;
    navigate(`/capture?sessionId=${encodeURIComponent(sessionId)}`);
  }

  if (!sessionId) {
    return (
      <main>
        <h1>Select Station</h1>
        <p className="note">Missing session ID. Start from Session Setup.</p>
      </main>
    );
  }

  if (tokenMissing) {
    return (
      <main>
        <h1>Select Station</h1>
        <p className="note">
          This setup requires a valid Napfa5 token. Start from Session Setup.
        </p>
        <Link className="btn-link" to="/">
          Back to Setup
        </Link>
      </main>
    );
  }

  return (
    <main>
      <div className="page-actions">
        <Link className="btn-link" to="/">
          Back to Setup
        </Link>
      </div>
      <h1>Select Station</h1>
      <p className="note">Choose which station this device will capture.</p>

      <section className="card">
        <div className="grid">
          <div>
            <div className="note">Selected: {stationId || '-'}</div>
            <div className="station-grid">
              {stationOptions.map((station) => (
                <button
                  key={station.id}
                  type="button"
                  className={`station-btn ${stationId === station.id ? 'selected' : ''}`}
                  onClick={() => handleSelectStation(station.id)}
                >
                  {station.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleContinue} disabled={!stationId || !sessionId} className="btn-lg">
            Continue
          </button>
        </div>
      </section>
    </main>
  );
}

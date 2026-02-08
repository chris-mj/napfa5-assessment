import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

function shortSessionId(sessionId?: string | null) {
  if (!sessionId) return '-';
  return sessionId.length > 8 ? `${sessionId.slice(0, 8)}?` : sessionId;
}

function stationStorageKey(sessionId: string) {
  return `napfa5-run:station:${sessionId}`;
}

export default function Layout() {
  const location = useLocation();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [devServerUp, setDevServerUp] = useState<boolean | null>(null);
  const [lastDevCheckAt, setLastDevCheckAt] = useState<number | null>(null);
  const sessionId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('sessionId');
  }, [location.search]);
  const [stationId, setStationId] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setStationId(null);
      return;
    }
    const key = stationStorageKey(sessionId);
    setStationId(localStorage.getItem(key));
  }, [sessionId, location.pathname]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/@vite/client', { cache: 'no-store' });
        if (!active) return;
        setDevServerUp(response.ok);
        setLastDevCheckAt(Date.now());
      } catch {
        if (!active) return;
        setDevServerUp(false);
        setLastDevCheckAt(Date.now());
      }
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-brand">
          <img src="/napfa5runicon.png" alt="napfa5-run" className="app-logo" />
          <div className="app-title">napfa5-run</div>
        </Link>
        <div className="app-meta">
          <span>Session: {shortSessionId(sessionId)}</span>
          <span>Station: {stationId ?? '-'}</span>
          <span className={online ? 'status online' : 'status offline'}>
            {online ? 'Online' : 'Offline'}
          </span>
          {import.meta.env.DEV && (
            <button
              type="button"
              className={`status status-button ${devServerUp === false ? 'dev-down' : 'dev-up'}`}
              title="Click to reconnect"
              onClick={() => window.location.reload()}
            >
              {devServerUp === false ? 'Dev: Down' : 'Dev: Up'}
              {lastDevCheckAt ? ` - ${new Date(lastDevCheckAt).toLocaleTimeString()}` : ''}
            </button>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}

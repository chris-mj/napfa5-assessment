import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { getSession } from '../db/repo';

function shortSessionId(sessionId?: string | null) {
  if (!sessionId) return '-';
  return sessionId.length > 8 ? `${sessionId.slice(0, 8)}?` : sessionId;
}

function stationStorageKey(sessionId: string) {
  return `napfa5-run:station:${sessionId}`;
}

function connectionStatusStorageKey(sessionId: string) {
  return `napfa5-run:connection:${sessionId}`;
}

type ConnectionBadge = {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  hint: string;
  show?: boolean;
  atMs?: number;
};

export default function Layout() {
  const location = useLocation();
  const sessionId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('sessionId');
  }, [location.search]);
  const [stationId, setStationId] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState('-');
  const [connectionBadge, setConnectionBadge] = useState<ConnectionBadge>({
    label: 'Offline (not linked)',
    tone: 'warn',
    hint: 'Offline (not linked): no run token linked for this session. Do not use for official recording until linked.',
    show: false
  });

  useEffect(() => {
    if (!sessionId) {
      setStationId(null);
      setSessionLabel('-');
      setConnectionBadge({
        label: 'Offline (not linked)',
        tone: 'warn',
        hint: 'Offline (not linked): no run token linked for this session. Do not use for official recording until linked.',
        show: false
      });
      return;
    }
    const key = stationStorageKey(sessionId);
    setStationId(localStorage.getItem(key));
  }, [sessionId, location.pathname]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const read = () => {
      if (!active) return;
      const raw = localStorage.getItem(connectionStatusStorageKey(sessionId));
      if (!raw) {
        setConnectionBadge({
          label: 'Offline (not linked)',
          tone: 'warn',
          hint: 'Offline (not linked): no run token linked for this session. Do not use for official recording until linked.',
          show: false
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw) as ConnectionBadge;
        if (!parsed?.label || !parsed?.tone) return;
        const isUnlinked = String(parsed.label || '').toLowerCase().includes('offline (not linked)');
        setConnectionBadge({
          ...parsed,
          show: !isUnlinked
        });
      } catch {
        // ignore bad local payload
      }
    };
    read();
    const timer = window.setInterval(read, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    const loadSessionLabel = async () => {
      if (!sessionId) {
        if (active) setSessionLabel('-');
        return;
      }
      const localSession = await getSession(sessionId);
      if (!active) return;
      const preferred = String(localSession?.name || '').trim();
      setSessionLabel(preferred || shortSessionId(sessionId));
    };
    loadSessionLabel();
    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-brand">
          <img src="/napfa5runicon.png" alt="napfa5-run" className="app-logo" />
          <div className="app-title">napfa5-run</div>
        </Link>
        <div className="app-meta">
          <span>Session: {sessionLabel}</span>
          <span>Station: {stationId ?? '-'}</span>
          {connectionBadge.show && (
            <span
              className={`status ${
                connectionBadge.tone === 'ok'
                  ? 'online'
                  : connectionBadge.tone === 'danger'
                    ? 'offline'
                    : 'warn'
              }`}
              title={connectionBadge.hint}
            >
              {connectionBadge.label}
            </span>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}

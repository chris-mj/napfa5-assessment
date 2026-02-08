import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SessionSetupPage from './pages/SessionSetup';
import StationSelectPage from './pages/StationSelect';
import CapturePage from './pages/Capture';
import DisplayPage from './pages/Display';
import StationProgressPage from './pages/StationProgress';
import SyncPage from './pages/SyncPage';

export default function App() {
  return (
    <Routes>
      <Route path="/station-progress" element={<StationProgressPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<SessionSetupPage />} />
        <Route path="/station" element={<StationSelectPage />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

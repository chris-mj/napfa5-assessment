import { Link } from 'react-router-dom';

export default function SyncPage() {
  return (
    <main>
      <div className="page-actions">
        <Link className="btn-link" to="/">
          Back to Setup
        </Link>
      </div>
      <h1>Sync</h1>
      <p className="note">Not linked.</p>
    </main>
  );
}

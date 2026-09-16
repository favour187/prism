import { useState } from 'react';
import { api } from '../api.js';

export default function SettingsModal({ theme, onToggleTheme, cfg, onClose, onWiped }) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await api.wipeData();
      setConfirmWipe(false);
      onWiped();
      onClose();
    } catch {
      alert('Could not wipe data — see server logs.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Settings and privacy" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Settings &amp; privacy</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>

        <section className="modal-section">
          <h3>Appearance</h3>
          <label className="row">
            <span>Theme</span>
            <button className="btn ghost" onClick={onToggleTheme}>
              {theme === 'dark' ? '☀︎ Switch to light' : '☾ Switch to dark'}
            </button>
          </label>
        </section>

        <section className="modal-section">
          <h3>Model provider</h3>
          <div className="kv"><span>Provider</span><code>{cfg?.provider?.id ?? '…'}</code></div>
          <div className="kv"><span>Status</span>
            <code className={cfg?.provider?.ready ? 'ok' : 'bad'}>
              {cfg?.provider?.ready ? 'ready' : (cfg?.provider?.reason ?? 'not configured')}
            </code>
          </div>
          <div className="kv"><span>Default chat model</span><code>{cfg?.defaults?.chatModel}</code></div>
          <div className="kv"><span>Default vision model</span><code>{cfg?.defaults?.visionModel}</code></div>
          <p className="note">
            API keys live only on the server. Swap providers by changing the provider implementation
            server-side — the client never sees credentials.
          </p>
        </section>

        <section className="modal-section">
          <h3>Privacy controls</h3>
          <ul className="privacy-list">
            <li>🖥 <strong>Screen capture is opt-in, per capture.</strong> Prism never records your screen continuously.</li>
            <li>🔑 <strong>Secrets stay server-side.</strong> The browser only talks to the Prism backend.</li>
            <li>🛡 <strong>Uploads are validated</strong> and blocked file types include <code>.env</code>, keys &amp; certificates.</li>
            <li>💾 Conversations are stored locally on your server, in SQLite.</li>
          </ul>
          <div className="row gap">
            <a className="btn ghost" href="/api/privacy/export" download>⬇ Export all my data</a>
            {confirmWipe ? (
              <>
                <button className="btn danger" onClick={wipe} disabled={busy}>
                  {busy ? 'Wiping…' : 'Confirm: delete everything'}
                </button>
                <button className="btn ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn ghost danger" onClick={() => setConfirmWipe(true)}>🗑 Delete all data…</button>
            )}
          </div>
        </section>

        <section className="modal-section">
          <h3>About</h3>
          <p className="note">
            Prism {cfg?.app?.version ?? ''} — an AI screen &amp; code assistant powered by Featherless AI.
            Inspired by Arc's screen assistant, built for developers.
          </p>
        </section>
      </div>
    </div>
  );
}

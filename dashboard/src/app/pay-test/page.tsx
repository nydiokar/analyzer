'use client';

import { useState } from 'react';
import { fetcher } from '@/lib/fetcher';

interface Pack {
  id: string;
  name: string;
  priceUsdc: number;
  credits: number;
}

interface Checkout {
  id: string;
  solanaPayUrl: string;
  qrCodeDataUrl: string;
  expiresAt: string;
  amountUsdc: number;
  credits: number;
}

interface Status {
  status: string;
  credits?: number;
}

interface Credits {
  balance: number;
  transactions: Array<{ id: string; amount: number; type: string; createdAt: string }>;
}

export default function PayTestPage() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const append = (msg: string) => setLog((l) => [...l, `${new Date().toISOString().slice(11, 19)} ${msg}`]);

  const loadPacks = async () => {
    try {
      const data = await fetcher('/payments/packs');
      setPacks(data);
      append(`Packs loaded: ${data.map((p: Pack) => `${p.name} ($${p.priceUsdc} / ${p.credits} credits) id=${p.id}`).join(' | ')}`);
    } catch (e: any) {
      append(`ERROR loading packs: ${e.message}`);
    }
  };

  const createCheckout = async (packId: string) => {
    try {
      const data = await fetcher('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ packId }),
      });
      setCheckout(data);
      append(`Checkout created — intent id=${data.id} amount=$${data.amountUsdc} credits=${data.credits}`);
    } catch (e: any) {
      append(`ERROR creating checkout: ${e.message}`);
    }
  };

  const pollStatus = async () => {
    if (!checkout) return;
    try {
      const data = await fetcher(`/payments/${checkout.id}/status`);
      setStatus(data);
      append(`Status: ${data.status}`);
    } catch (e: any) {
      append(`ERROR polling status: ${e.message}`);
    }
  };

  const loadCredits = async () => {
    try {
      const data = await fetcher('/users/me/credits');
      setCredits(data);
      append(`Credits balance: ${data.balance}`);
    } catch (e: any) {
      append(`ERROR loading credits: ${e.message}`);
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 800, margin: '0 auto', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>PAY-2c Test Page</h1>

      {/* Step 1 */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ color: '#94a3b8', marginBottom: 8 }}>Step 1 — Load packs</h2>
        <button onClick={loadPacks} style={btn}>GET /payments/packs</button>
        {packs.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {packs.map((p) => (
              <button key={p.id} onClick={() => createCheckout(p.id)} style={{ ...btn, background: '#1e3a5f' }}>
                {p.name} — ${p.priceUsdc} / {p.credits} credits
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Step 2 */}
      {checkout && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ color: '#94a3b8', marginBottom: 8 }}>Step 2 — Scan QR in Phantom</h2>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Intent ID: {checkout.id}</p>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Amount: ${checkout.amountUsdc} USDC → {checkout.credits} credits</p>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8, wordBreak: 'break-all' }}>URL: {checkout.solanaPayUrl}</p>
          {checkout.qrCodeDataUrl && (
            <img src={checkout.qrCodeDataUrl} alt="Solana Pay QR" style={{ width: 200, height: 200, background: 'white', padding: 8 }} />
          )}
        </section>
      )}

      {/* Step 3 */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ color: '#94a3b8', marginBottom: 8 }}>Step 3 — Check status &amp; credits</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={pollStatus} disabled={!checkout} style={btn}>Poll payment status</button>
          <button onClick={loadCredits} style={btn}>Get my credits</button>
        </div>
        {status && (
          <p style={{ marginTop: 8, color: status.status === 'confirmed' ? '#4ade80' : '#facc15' }}>
            Payment status: <strong>{status.status}</strong>
          </p>
        )}
        {credits && (
          <p style={{ marginTop: 4, color: '#4ade80' }}>
            Credit balance: <strong>{credits.balance}</strong>
          </p>
        )}
      </section>

      {/* Log */}
      <section>
        <h2 style={{ color: '#94a3b8', marginBottom: 8 }}>Log</h2>
        <div style={{ background: '#1e293b', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 200, overflowY: 'auto' }}>
          {log.length === 0 ? <span style={{ color: '#475569' }}>Nothing yet</span> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </section>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#1e40af',
  color: '#e2e8f0',
  border: 'none',
  borderRadius: 4,
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 13,
};

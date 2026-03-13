'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { useCredits } from '@/hooks/useCredits';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Key, Copy, Check, Trash2, Coins, AlertTriangle, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

interface ApiKeyInfo {
  id: string;
  prefix: string;
  description: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function DeveloperPage() {
  const { isAuthenticated, isInitialized, getAuthHeader } = useAuth();
  const { balance } = useCredits();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revoking, setRevoking] = useState<string | null>(null);

  const buildHeaders = useCallback((withBody = false): Record<string, string> => {
    const headers: Record<string, string> = {};
    const auth = getAuthHeader();
    if (auth) headers['Authorization'] = auth;
    if (withBody) headers['Content-Type'] = 'application/json';
    return headers;
  }, [getAuthHeader]);

  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/api-keys`, { headers: buildHeaders() });
      if (!res.ok) throw new Error('Failed to fetch API keys');
      const data = await res.json();
      setKeys(data);
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setKeysLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (isAuthenticated) fetchKeys();
  }, [isAuthenticated, fetchKeys]);

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error('Please enter a description for your key');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/api-keys`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
      const data = await res.json();
      setNewKey(data.apiKey);
      setDescription('');
      await fetchKeys();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate API key');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId);
    try {
      const res = await fetch(`${API_BASE_URL}/users/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      if (!res.ok && res.status !== 204) throw new Error('Failed to revoke key');
      toast.success('API key revoked');
      await fetchKeys();
    } catch {
      toast.error('Failed to revoke API key');
    } finally {
      setRevoking(null);
    }
  };

  if (!isInitialized) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-10 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-10 text-center text-muted-foreground">
          Sign in to manage your API keys.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Use these keys to authenticate requests to the Sova Intel API.
          </p>
        </div>

        {/* Credit balance */}
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <Coins className="h-5 w-5 text-blue-400 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {balance !== null ? balance.toLocaleString() : '—'} credits remaining
              </p>
              <p className="text-xs text-muted-foreground">
                Each API call costs credits.{' '}
                <a href="/dashboard/credits" className="underline hover:text-foreground">Top up</a>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Generate new key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Generate API Key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {newKey ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                  <p className="text-sm text-yellow-300">
                    Copy this key now — it will not be shown again.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                    {newKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(newKey)}
                    title="Copy key"
                  >
                    {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
                  Done — I saved my key
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="key-description">Description</Label>
                  <Input
                    id="key-description"
                    placeholder="e.g. my-script, pft-bot, sdk-test"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    maxLength={100}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleGenerate} disabled={generating}>
                    {generating ? 'Generating…' : 'Generate'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Existing keys */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              Your Keys
            </CardTitle>
          </CardHeader>
          <CardContent>
            {keysLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No API keys yet. Generate one above.
              </p>
            ) : (
              <div className="space-y-2">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-muted-foreground">{key.prefix}…</code>
                        <Badge variant={key.isActive ? 'default' : 'secondary'} className="text-xs">
                          {key.isActive ? 'active' : 'revoked'}
                        </Badge>
                      </div>
                      <p className="text-sm truncate">{key.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {format(new Date(key.createdAt), 'MMM d, yyyy')}
                        {key.lastUsedAt && ` · Last used ${format(new Date(key.lastUsedAt), 'MMM d, yyyy')}`}
                      </p>
                    </div>
                    {key.isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-red-400"
                        title="Revoke key"
                        disabled={revoking === key.id}
                        onClick={() => handleRevoke(key.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick start */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Pass your key in the <code className="text-xs bg-muted px-1 py-0.5 rounded">x-api-key</code> header:</p>
            <pre className="rounded bg-muted px-3 py-2 text-xs font-mono overflow-x-auto">
{`curl -H "x-api-key: YOUR_KEY" \\
  https://api.sova-intel/api/v1/intel/wallet/ADDRESS/hud`}
            </pre>
            <p>
              Or use the{' '}
              <a
                href="https://nydiokar.github.io/sova-intel/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                @sova-intel/sdk
              </a>{' '}
              for typed access.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Copy, Key, Shield, Clock, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ApiKeyInfo {
  id: string;
  prefix: string;
  userId: string;
  userEmail?: string | null;
  userDescription?: string | null;
  description: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export default function AdminApiKeysPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized, getAuthHeader } = useAuth();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [userId, setUserId] = useState('');
  const [description, setDescription] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(undefined);

  // New API key display (only shown once after creation)
  const [newApiKey, setNewApiKey] = useState<string | null>(null);

  const availableScopes = ['read', 'report', 'analysis', 'admin', 'full'];

  // Check admin access and redirect silently if not admin
  useEffect(() => {
    if (isInitialized && (!isAuthenticated || !user?.isAdmin)) {
      // Silent redirect to home - no error message, no toast, completely invisible
      router.replace('/');
    }
  }, [isInitialized, isAuthenticated, user, router]);

  // If not admin, render nothing (prevent flash of content)
  if (!isInitialized || !isAuthenticated || !user?.isAdmin) {
    return null;
  }

  const fetchApiKeys = useCallback(async () => {
    setLoading(true);
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      const headers: Record<string, string> = {};
      const authHeader = getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const response = await fetch(`${API_BASE_URL}/admin/api-keys`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch API keys');
      }

      const data = await response.json();
      setApiKeys(data);
    } catch (error) {
      console.error('Error fetching API keys:', error);
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader]);

  // Fetch API keys whenever auth context changes
  useEffect(() => {
    if (isAuthenticated && user?.isAdmin) {
      fetchApiKeys();
    }
  }, [fetchApiKeys, isAuthenticated, user]);

  const handleCreateApiKey = async () => {
    if (!userId || !description || selectedScopes.length === 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCreating(true);
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const authHeader = getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const response = await fetch(`${API_BASE_URL}/admin/api-keys`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId,
          description,
          scopes: selectedScopes,
          expiresInDays,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create API key');
      }

      const data = await response.json();
      setNewApiKey(data.apiKey);

      // Clear form
      setUserId('');
      setDescription('');
      setSelectedScopes(['read']);
      setExpiresInDays(undefined);
      setShowCreateForm(false);

      // Refresh list
      await fetchApiKeys();

      toast.success('API key created successfully! Copy it now - you won\'t see it again.');
    } catch (error: any) {
      console.error('Error creating API key:', error);
      toast.error(error.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      const headers: Record<string, string> = {};
      const authHeader = getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const response = await fetch(`${API_BASE_URL}/admin/api-keys/${keyId}/revoke`, {
        method: 'PATCH',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to revoke API key');
      }

      toast.success('API key revoked successfully');
      await fetchApiKeys();
    } catch (error) {
      console.error('Error revoking API key:', error);
      toast.error('Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const toggleScope = (scope: string) => {
    if (selectedScopes.includes(scope)) {
      setSelectedScopes(selectedScopes.filter(s => s !== scope));
    } else {
      setSelectedScopes([...selectedScopes, scope]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Shield className="w-8 h-8" />
              Admin Panel - API Keys
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage API keys for services and integrations
            </p>
          </div>
          <Button onClick={() => setShowCreateForm(!showCreateForm)} disabled={creating}>
            <Key className="w-4 h-4 mr-2" />
            Create API Key
          </Button>
        </div>

        {/* New API Key Display */}
        {newApiKey && (
          <Card className="mb-6 border-green-500 bg-green-50 dark:bg-green-900/20">
            <CardHeader>
              <CardTitle className="text-green-700 dark:text-green-400 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                New API Key Created!
              </CardTitle>
              <CardDescription>
                Copy this key now - you won&apos;t be able to see it again!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-3 rounded-md border">
                <code className="flex-1 text-sm font-mono break-all">{newApiKey}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(newApiKey)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => setNewApiKey(null)}
              >
                I&apos;ve copied the key
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Create Form */}
        {showCreateForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Create New API Key</CardTitle>
              <CardDescription>
                Generate a new API key for a user
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="userId">User ID *</Label>
                  <Input
                    id="userId"
                    placeholder="Enter user ID"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description *</Label>
                  <Input
                    id="description"
                    placeholder="e.g., Prometheus Scraper, CI/CD Pipeline"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div>
                  <Label>Scopes * (Select at least one)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableScopes.map(scope => (
                      <Badge
                        key={scope}
                        variant={selectedScopes.includes(scope) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleScope(scope)}
                      >
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="expiresInDays">Expires in Days (Optional)</Label>
                  <Input
                    id="expiresInDays"
                    type="number"
                    min="1"
                    placeholder="Leave empty for no expiration"
                    value={expiresInDays || ''}
                    onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleCreateApiKey} disabled={creating}>
                    {creating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Key className="w-4 h-4 mr-2" />
                        Create
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateForm(false)} disabled={creating}>
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API Keys List */}
        <Card>
          <CardHeader>
            <CardTitle>Existing API Keys</CardTitle>
            <CardDescription>
              {apiKeys.length} API key{apiKeys.length !== 1 ? 's' : ''} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : apiKeys.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No API keys found</p>
            ) : (
              <div className="space-y-4">
                {apiKeys.map(key => (
                  <div
                    key={key.id}
                    className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <code className="text-sm font-mono bg-white dark:bg-gray-700 px-2 py-1 rounded">
                            {key.prefix}***
                          </code>
                          <Badge variant={key.isActive ? "default" : "secondary"}>
                            {key.isActive ? "Active" : "Revoked"}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium">{key.description}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          User: {key.userEmail || key.userId}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {key.scopes.map(scope => (
                            <Badge key={scope} variant="outline" className="text-xs">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Created: {new Date(key.createdAt).toLocaleDateString()}
                          </span>
                          {key.expiresAt && (
                            <span className="text-orange-600 dark:text-orange-400">
                              Expires: {new Date(key.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                          {key.lastUsedAt && (
                            <span>
                              Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ml-4">
                        {key.isActive && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRevokeApiKey(key.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

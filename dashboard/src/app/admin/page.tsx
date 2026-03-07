'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Loader2, Copy, Shield, AlertTriangle, Users, Ticket,
  Power, Lock, Unlock, Search, Filter, Ban,
  CheckCircle2, XCircle, Clock, Calendar, Hash, Key, AlertCircle
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

// Types
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

interface RegistrationCode {
  code: string;
  status: 'active' | 'used' | 'revoked';
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
}

interface CodeStats {
  total: number;
  active: number;
  used: number;
  revoked: number;
}

interface KillSwitchStatus {
  enabled: boolean;
  lastModifiedAt: string | null;
  lastModifiedBy: string | null;
}

interface CodeRequirementStatus {
  required: boolean;
  lastModifiedAt: string | null;
  lastModifiedBy: string | null;
}

interface UserListItem {
  id: string;
  email: string | null;
  displayName: string | null;
  description: string | null;
  isAdmin: boolean;
  isActive: boolean;
  isDemo: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  credits: number | null;
}

interface UsersListResponse {
  users: UserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized, getAuthHeader } = useAuth();

  // Admin verification state
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(true);
  const [isAdminVerified, setIsAdminVerified] = useState(false);

  // API Keys State
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [loadingApiKeys, setLoadingApiKeys] = useState(true);
  const [showCreateApiKeyForm, setShowCreateApiKeyForm] = useState(false);
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [apiKeyUserId, setApiKeyUserId] = useState('');
  const [apiKeyDescription, setApiKeyDescription] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
  const [apiKeyExpiresInDays, setApiKeyExpiresInDays] = useState<number | undefined>(undefined);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const availableScopes = ['read', 'report', 'analysis', 'admin', 'full'];

  // Registration Codes State
  const [codes, setCodes] = useState<RegistrationCode[]>([]);
  const [codeStats, setCodeStats] = useState<CodeStats | null>(null);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [showCreateCodeForm, setShowCreateCodeForm] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [bulkCount, setBulkCount] = useState<number>(1);
  const [codeFilter, setCodeFilter] = useState<'all' | 'active' | 'used' | 'revoked'>('all');

  // Kill Switch State
  const [killSwitch, setKillSwitch] = useState<KillSwitchStatus | null>(null);
  const [loadingKillSwitch, setLoadingKillSwitch] = useState(true);
  const [togglingKillSwitch, setTogglingKillSwitch] = useState(false);

  // Code Requirement State
  const [codeRequirement, setCodeRequirement] = useState<CodeRequirementStatus | null>(null);
  const [loadingCodeRequirement, setLoadingCodeRequirement] = useState(true);
  const [togglingCodeRequirement, setTogglingCodeRequirement] = useState(false);

  // Users State
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersFilter, setUsersFilter] = useState<{
    isActive?: boolean;
    isAdmin?: boolean;
    isDemo?: boolean;
  }>({});
  const [usersSortBy, setUsersSortBy] = useState<'createdAt' | 'lastLoginAt' | 'lastSeenAt' | 'email'>('createdAt');
  const PAGE_SIZE = 20;

  // API Base URL - defined outside hooks to avoid dependency issues
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

  // ==================== ALL CALLBACKS MUST BE DEFINED BEFORE EARLY RETURNS ====================

  // Helper to build auth headers
  const buildHeaders = useCallback((withContentType = false): Record<string, string> => {
    const headers: Record<string, string> = {};
    const authHeader = getAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    if (withContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }, [getAuthHeader]);

  // ==================== API KEYS ====================

  const fetchApiKeys = useCallback(async () => {
    setLoadingApiKeys(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/api-keys`, {
        headers: buildHeaders(),
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
      setLoadingApiKeys(false);
    }
  }, [API_BASE_URL, buildHeaders]);

  const handleCreateApiKey = async () => {
    if (!apiKeyUserId || !apiKeyDescription || selectedScopes.length === 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCreatingApiKey(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/api-keys`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          userId: apiKeyUserId,
          description: apiKeyDescription,
          scopes: selectedScopes,
          expiresInDays: apiKeyExpiresInDays,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create API key');
      }

      const data = await response.json();
      setNewApiKey(data.apiKey);

      // Clear form
      setApiKeyUserId('');
      setApiKeyDescription('');
      setSelectedScopes(['read']);
      setApiKeyExpiresInDays(undefined);
      setShowCreateApiKeyForm(false);

      // Refresh list
      await fetchApiKeys();

      toast.success('API key created successfully! Copy it now - you won\'t see it again.');
    } catch (error: any) {
      console.error('Error creating API key:', error);
      toast.error(error.message || 'Failed to create API key');
    } finally {
      setCreatingApiKey(false);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/api-keys/${keyId}/revoke`, {
        method: 'PATCH',
        headers: buildHeaders(),
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

  const toggleScope = (scope: string) => {
    if (selectedScopes.includes(scope)) {
      setSelectedScopes(selectedScopes.filter(s => s !== scope));
    } else {
      setSelectedScopes([...selectedScopes, scope]);
    }
  };

  // ==================== REGISTRATION CODES ====================

  const fetchRegistrationCodes = useCallback(async () => {
    setLoadingCodes(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration-codes`, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch registration codes');
      }

      const data = await response.json();
      setCodes(data);
    } catch (error) {
      console.error('Error fetching registration codes:', error);
      toast.error('Failed to load registration codes');
    } finally {
      setLoadingCodes(false);
    }
  }, [API_BASE_URL, buildHeaders]);

  const fetchCodeStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration-codes/stats`, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch code stats');
      }

      const data = await response.json();
      setCodeStats(data);
    } catch (error) {
      console.error('Error fetching code stats:', error);
    }
  }, [API_BASE_URL, buildHeaders]);

  const handleCreateCodes = async () => {
    if (bulkCount < 1 || bulkCount > 100) {
      toast.error('Bulk count must be between 1 and 100');
      return;
    }

    setCreatingCode(true);
    try {
      const endpoint = bulkCount === 1
        ? `${API_BASE_URL}/admin/registration-codes`
        : `${API_BASE_URL}/admin/registration-codes/bulk`;

      const body = bulkCount === 1 ? {} : { count: bulkCount };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create registration code(s)');
      }

      const data = await response.json();

      if (bulkCount === 1) {
        // Single code - copy to clipboard
        await navigator.clipboard.writeText(data.code);
        toast.success(`Code created and copied to clipboard!`);
      } else {
        // Multiple codes - show success message
        toast.success(`${data.codes.length} codes created successfully!`);
      }

      setBulkCount(1);
      setShowCreateCodeForm(false);
      await Promise.all([fetchRegistrationCodes(), fetchCodeStats()]);
    } catch (error: any) {
      console.error('Error creating registration code(s):', error);
      toast.error(error.message || 'Failed to create registration code(s)');
    } finally {
      setCreatingCode(false);
    }
  };

  const handleRevokeCode = async (code: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration-codes/${code}/revoke`, {
        method: 'PATCH',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to revoke code');
      }

      toast.success('Code revoked successfully');
      await Promise.all([fetchRegistrationCodes(), fetchCodeStats()]);
    } catch (error) {
      console.error('Error revoking code:', error);
      toast.error('Failed to revoke code');
    }
  };

  const handleDeleteCode = async (code: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration-codes/${code}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to delete code');
      }

      toast.success('Code deleted successfully');
      await Promise.all([fetchRegistrationCodes(), fetchCodeStats()]);
    } catch (error) {
      console.error('Error deleting code:', error);
      toast.error('Failed to delete code');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const filteredCodes = codes.filter(code => {
    if (codeFilter === 'all') return true;
    if (codeFilter === 'active') return code.status === 'active';
    if (codeFilter === 'used') return code.status === 'used';
    if (codeFilter === 'revoked') return code.status === 'revoked';
    return true;
  });

  // ==================== KILL SWITCH ====================

  const fetchKillSwitch = useCallback(async () => {
    setLoadingKillSwitch(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration/kill-switch`, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch kill switch status');
      }

      const data = await response.json();
      setKillSwitch(data);
    } catch (error) {
      console.error('Error fetching kill switch:', error);
      toast.error('Failed to load kill switch status');
    } finally {
      setLoadingKillSwitch(false);
    }
  }, [API_BASE_URL, buildHeaders]);

  const handleToggleKillSwitch = async (enable: boolean) => {
    setTogglingKillSwitch(true);
    try {
      const endpoint = enable
        ? `${API_BASE_URL}/admin/registration/kill-switch/enable`
        : `${API_BASE_URL}/admin/registration/kill-switch/disable`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${enable ? 'enable' : 'disable'} kill switch`);
      }

      toast.success(`Registration kill switch ${enable ? 'enabled' : 'disabled'}`);
      await fetchKillSwitch();
    } catch (error) {
      console.error('Error toggling kill switch:', error);
      toast.error(`Failed to ${enable ? 'enable' : 'disable'} kill switch`);
    } finally {
      setTogglingKillSwitch(false);
    }
  };

  // ==================== CODE REQUIREMENT ====================

  const fetchCodeRequirement = useCallback(async () => {
    setLoadingCodeRequirement(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/registration/code-requirement`, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch code requirement status');
      }

      const data = await response.json();
      setCodeRequirement(data);
    } catch (error) {
      console.error('Error fetching code requirement:', error);
      toast.error('Failed to load code requirement status');
    } finally {
      setLoadingCodeRequirement(false);
    }
  }, [API_BASE_URL, buildHeaders]);

  const handleToggleCodeRequirement = async (require: boolean) => {
    setTogglingCodeRequirement(true);
    try {
      const endpoint = require
        ? `${API_BASE_URL}/admin/registration/code-requirement/enable`
        : `${API_BASE_URL}/admin/registration/code-requirement/disable`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${require ? 'enable' : 'disable'} code requirement`);
      }

      toast.success(`Registration code requirement ${require ? 'enabled' : 'disabled'}`);
      await fetchCodeRequirement();
    } catch (error) {
      console.error('Error toggling code requirement:', error);
      toast.error(`Failed to ${require ? 'enable' : 'disable'} code requirement`);
    } finally {
      setTogglingCodeRequirement(false);
    }
  };

  // ==================== USERS ====================

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((usersPage - 1) * PAGE_SIZE),
        sortBy: usersSortBy,
      });

      if (usersSearch) params.set('search', usersSearch);
      if (usersFilter.isActive !== undefined) params.set('isActive', String(usersFilter.isActive));
      if (usersFilter.isAdmin !== undefined) params.set('isAdmin', String(usersFilter.isAdmin));
      if (usersFilter.isDemo !== undefined) params.set('isDemo', String(usersFilter.isDemo));

      const response = await fetch(`${API_BASE_URL}/admin/users?${params.toString()}`, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

      const data: UsersListResponse = await response.json();
      setUsers(data.users);
      setUsersTotal(data.total);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }, [API_BASE_URL, buildHeaders, usersPage, usersSearch, usersFilter, usersSortBy]);

  // Debounced effect for fetching users when search/filter/sort changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (isAdminVerified) {
        fetchUsers();
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [usersPage, usersSearch, usersFilter, usersSortBy, isAdminVerified, fetchUsers]);

  const handleToggleUserActive = async (userId: string, isActive: boolean) => {
    try {
      const endpoint = isActive
        ? `${API_BASE_URL}/admin/users/${userId}/disable`
        : `${API_BASE_URL}/admin/users/${userId}/enable`;

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isActive ? 'disable' : 'enable'} user`);
      }

      toast.success(`User ${isActive ? 'disabled' : 'enabled'} successfully`);
      await fetchUsers();
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast.error(`Failed to ${isActive ? 'disable' : 'enable'} user`);
    }
  };

  // Verify admin access by calling backend (SECURITY: Don't trust frontend state)
  // This MUST be after all other hooks to avoid "hooks called in different order" error
  useEffect(() => {
    const verifyAdminAccess = async () => {
      // Wait for auth to initialize before doing anything
      if (!isInitialized) {
        return;
      }

      // If initialized but not authenticated, redirect
      if (!isAuthenticated) {
        router.replace('/');
        return;
      }

      // Prevent re-running if already verified
      if (isAdminVerified) {
        return;
      }

      try {
        // Verify admin status by checking user profile
        // This is cleaner than calling admin endpoints and getting 403 errors
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: buildHeaders(),
        });

        if (!response.ok) {
          router.replace('/');
          return;
        }

        const userData = await response.json();

        // Check if user is actually admin
        if (!userData.isAdmin) {
          // Not admin - redirect silently without triggering admin endpoints
          router.replace('/');
          return;
        }

        // Success - user is verified admin, load data
        setIsAdminVerified(true);
        fetchApiKeys();
        fetchRegistrationCodes();
        fetchCodeStats();
        fetchKillSwitch();
        fetchCodeRequirement();
        fetchUsers(); // Initial load - don't wait for debounced effect
      } catch (error) {
        console.error('Admin verification failed:', error);
        router.replace('/');
      } finally {
        setIsVerifyingAdmin(false);
      }
    };

    verifyAdminAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, isAuthenticated]);

  const totalPages = Math.ceil(usersTotal / PAGE_SIZE);

  // Show nothing while verifying admin status (AFTER all hooks)
  if (!isInitialized || !isAuthenticated || isVerifyingAdmin || !isAdminVerified) {
    return null;
  }

  return (
    <div className="p-3 sm:p-4 lg:p-5">
      <div className="mx-auto max-w-[1500px]">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage registration access controls and user accounts
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid h-10 w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="codes">Registration Codes</TabsTrigger>
            <TabsTrigger value="controls">Access Controls</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Ticket className="w-4 h-4" />
                    Total Codes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {codeStats?.total ?? <Loader2 className="w-5 h-5 animate-spin" />}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Active Codes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {codeStats?.active ?? <Loader2 className="w-5 h-5 animate-spin" />}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Total Users
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {usersTotal ?? <Loader2 className="w-5 h-5 animate-spin" />}
                  </div>
                </CardContent>
              </Card>

              <Card className={killSwitch?.enabled ? "border-red-500" : ""}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Power className="w-4 h-4" />
                    Kill Switch
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loadingKillSwitch ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Badge variant={killSwitch?.enabled ? "destructive" : "default"}>
                        {killSwitch?.enabled ? "ENABLED" : "Disabled"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Kill Switch Status */}
              <Card className={killSwitch?.enabled ? "border-red-500 bg-red-900/10" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Power className="w-5 h-5" />
                    Emergency Kill Switch
                  </CardTitle>
                  <CardDescription>
                    {killSwitch?.enabled
                      ? "ALL registration is currently BLOCKED"
                      : "Registration is allowed (subject to code requirement)"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingKillSwitch ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Status:</span>
                        <Badge variant={killSwitch?.enabled ? "destructive" : "default"} className="text-sm">
                          {killSwitch?.enabled ? "ENABLED - All Registration Blocked" : "Disabled - Registration Allowed"}
                        </Badge>
                      </div>
                      {killSwitch?.lastModifiedAt && (
                        <div className="text-xs text-muted-foreground">
                          Last modified: {new Date(killSwitch.lastModifiedAt).toLocaleString()}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant={killSwitch?.enabled ? "default" : "destructive"}
                              className="flex-1"
                              disabled={togglingKillSwitch}
                            >
                              {togglingKillSwitch ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : killSwitch?.enabled ? (
                                <Unlock className="w-4 h-4 mr-2" />
                              ) : (
                                <Lock className="w-4 h-4 mr-2" />
                              )}
                              {killSwitch?.enabled ? "Disable Kill Switch" : "Enable Kill Switch"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-orange-500" />
                                {killSwitch?.enabled ? "Disable Kill Switch?" : "Enable Kill Switch?"}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {killSwitch?.enabled
                                  ? "This will re-enable registration (subject to code requirement setting). Existing users will be able to login normally."
                                  : "This will IMMEDIATELY block ALL new registrations. No one will be able to sign up until you disable the kill switch. Existing users can still login."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleToggleKillSwitch(!killSwitch?.enabled)}
                                className={killSwitch?.enabled ? "" : "bg-red-600 hover:bg-red-700"}
                              >
                                {killSwitch?.enabled ? "Disable Kill Switch" : "Enable Kill Switch"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Code Requirement Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="w-5 h-5" />
                    Code Requirement
                  </CardTitle>
                  <CardDescription>
                    {codeRequirement?.required
                      ? "Registration codes are REQUIRED"
                      : "Registration is OPEN to anyone"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingCodeRequirement ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Status:</span>
                        <Badge variant={codeRequirement?.required ? "default" : "secondary"} className="text-sm">
                          {codeRequirement?.required ? "Codes Required" : "Open Registration"}
                        </Badge>
                      </div>
                      {codeRequirement?.lastModifiedAt && (
                        <div className="text-xs text-muted-foreground">
                          Last modified: {new Date(codeRequirement.lastModifiedAt).toLocaleString()}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant={codeRequirement?.required ? "secondary" : "default"}
                          className="flex-1"
                          disabled={togglingCodeRequirement}
                          onClick={() => handleToggleCodeRequirement(!codeRequirement?.required)}
                        >
                          {togglingCodeRequirement ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : codeRequirement?.required ? (
                            <Unlock className="w-4 h-4 mr-2" />
                          ) : (
                            <Lock className="w-4 h-4 mr-2" />
                          )}
                          {codeRequirement?.required ? "Disable Code Requirement" : "Enable Code Requirement"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Registration Codes Tab */}
          <TabsContent value="codes" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Select value={codeFilter} onValueChange={(v: any) => setCodeFilter(v)}>
                  <SelectTrigger className="w-[180px]">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Codes</SelectItem>
                    <SelectItem value="active">Active Only</SelectItem>
                    <SelectItem value="used">Fully Used</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => setShowCreateCodeForm(!showCreateCodeForm)} disabled={creatingCode}>
                <Ticket className="w-4 h-4 mr-2" />
                Create Code(s)
              </Button>
            </div>

            {/* Create Form */}
            {showCreateCodeForm && (
              <Card className="border-blue-500 bg-blue-900/10">
                <CardHeader>
                  <CardTitle>Create Registration Code(s)</CardTitle>
                  <CardDescription>
                    Create single or multiple registration codes (max 100 at once)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="bulkCount">Number of Codes</Label>
                      <Input
                        id="bulkCount"
                        type="number"
                        min="1"
                        max="100"
                        placeholder="1-100"
                        value={bulkCount}
                        onChange={(e) => setBulkCount(parseInt(e.target.value) || 1)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        All codes will be single-use by default
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleCreateCodes} disabled={creatingCode}>
                        {creatingCode ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Ticket className="w-4 h-4 mr-2" />
                            Create {bulkCount > 1 ? `${bulkCount} Codes` : 'Code'}
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={() => setShowCreateCodeForm(false)} disabled={creatingCode}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Codes List */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle>Registration Codes</CardTitle>
                <CardDescription>
                  {filteredCodes.length} code{filteredCodes.length !== 1 ? 's' : ''}
                  {codeFilter !== 'all' && ` (${codeFilter})`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingCodes ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCodes.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No codes found</p>
                ) : (
                  <div className="rounded-md border">
                    <div className="hidden md:grid grid-cols-[minmax(220px,1.7fr)_120px_150px_170px_120px] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <span>Code</span>
                      <span>Status</span>
                      <span>Usage</span>
                      <span>Created / Expires</span>
                      <span className="text-right">Actions</span>
                    </div>
                    <ScrollArea className="h-[62vh] min-h-[420px]">
                      <div className="divide-y">
                        {filteredCodes.map(code => {
                          const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date();

                          return (
                            <div
                              key={code.code}
                              className={`p-3 ${
                                code.status === 'revoked' ? 'bg-muted/50 opacity-60' :
                                code.status === 'used' || isExpired ? 'bg-muted/30' :
                                'bg-card'
                              }`}
                            >
                              <div className="grid gap-3 md:grid-cols-[minmax(220px,1.7fr)_120px_150px_170px_120px] md:items-center">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded truncate">
                                      {code.code}
                                    </code>
                                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(code.code)} className="h-7 px-2">
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {code.status === 'revoked' && <Badge variant="secondary">Revoked</Badge>}
                                  {code.status === 'used' && <Badge variant="secondary">Fully Used</Badge>}
                                  {isExpired && <Badge variant="destructive">Expired</Badge>}
                                  {code.status === 'active' && !isExpired && <Badge variant="default">Active</Badge>}
                                </div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Hash className="w-3 h-3" />
                                  {code.usedCount} / {code.maxUses}
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(code.createdAt).toLocaleDateString()}
                                  </div>
                                  <div className={`flex items-center gap-1 ${isExpired ? 'text-red-600 dark:text-red-400' : ''}`}>
                                    <Clock className="w-3 h-3" />
                                    {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : 'No expiry'}
                                  </div>
                                </div>
                                <div className="flex md:justify-end gap-2">
                                  {code.status === 'active' && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" className="h-8 px-2">
                                          <Ban className="w-4 h-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Revoke Code?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            This will prevent the code from being used for new registrations. This action cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleRevokeCode(code.code)}>
                                            Revoke
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="destructive" size="sm" className="h-8 px-2">
                                        <XCircle className="w-4 h-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Delete Code?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This will permanently delete the code from the database. This action cannot be undone.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => handleDeleteCode(code.code)}
                                          className="bg-red-600 hover:bg-red-700"
                                        >
                                          Delete
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Access Controls Tab */}
          <TabsContent value="controls" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Kill Switch */}
              <Card className={killSwitch?.enabled ? "border-red-500 bg-red-900/10" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Power className="w-5 h-5" />
                    Emergency Kill Switch
                  </CardTitle>
                  <CardDescription>
                    Immediately halt ALL registration (existing users can still login)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingKillSwitch ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Current Status:</span>
                          <Badge variant={killSwitch?.enabled ? "destructive" : "default"} className="text-sm">
                            {killSwitch?.enabled ? "ENABLED - All Registration Blocked" : "Disabled - Registration Allowed"}
                          </Badge>
                        </div>
                        {killSwitch?.lastModifiedAt && (
                          <div className="text-xs text-muted-foreground">
                            Last modified: {new Date(killSwitch.lastModifiedAt).toLocaleString()}
                            {killSwitch.lastModifiedBy && ` by ${killSwitch.lastModifiedBy}`}
                          </div>
                        )}
                      </div>

                      <div className="bg-muted/50 p-3 rounded-lg text-sm">
                        <p className="font-medium mb-2">What happens when enabled:</p>
                        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                          <li>ALL new registrations are blocked</li>
                          <li>Returns 503 Service Unavailable</li>
                          <li>Existing users can still login</li>
                          <li>Overrides code requirement setting</li>
                        </ul>
                      </div>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant={killSwitch?.enabled ? "default" : "destructive"}
                            className="w-full"
                            disabled={togglingKillSwitch}
                          >
                            {togglingKillSwitch ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : killSwitch?.enabled ? (
                              <Unlock className="w-4 h-4 mr-2" />
                            ) : (
                              <Lock className="w-4 h-4 mr-2" />
                            )}
                            {killSwitch?.enabled ? "Disable Kill Switch" : "Enable Kill Switch"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                              <AlertTriangle className="w-5 h-5 text-orange-500" />
                              {killSwitch?.enabled ? "Disable Kill Switch?" : "Enable Kill Switch?"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {killSwitch?.enabled
                                ? "This will re-enable registration (subject to code requirement setting). Existing users will be able to login normally."
                                : "This will IMMEDIATELY block ALL new registrations. No one will be able to sign up until you disable the kill switch. Existing users can still login."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleToggleKillSwitch(!killSwitch?.enabled)}
                              className={killSwitch?.enabled ? "" : "bg-red-600 hover:bg-red-700"}
                            >
                              {killSwitch?.enabled ? "Disable Kill Switch" : "Enable Kill Switch"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Code Requirement */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="w-5 h-5" />
                    Registration Code Requirement
                  </CardTitle>
                  <CardDescription>
                    Require valid registration codes for signup
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingCodeRequirement ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Current Status:</span>
                          <Badge variant={codeRequirement?.required ? "default" : "secondary"} className="text-sm">
                            {codeRequirement?.required ? "Codes Required" : "Open Registration"}
                          </Badge>
                        </div>
                        {codeRequirement?.lastModifiedAt && (
                          <div className="text-xs text-muted-foreground">
                            Last modified: {new Date(codeRequirement.lastModifiedAt).toLocaleString()}
                            {codeRequirement.lastModifiedBy && ` by ${codeRequirement.lastModifiedBy}`}
                          </div>
                        )}
                      </div>

                      <div className="bg-muted/50 p-3 rounded-lg text-sm">
                        <p className="font-medium mb-2">Registration modes:</p>
                        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                          <li><strong>Codes Required:</strong> Users must provide a valid code</li>
                          <li><strong>Open:</strong> Anyone can register without a code</li>
                          <li><strong>Note:</strong> Kill switch overrides this setting</li>
                        </ul>
                      </div>

                      <Button
                        variant={codeRequirement?.required ? "secondary" : "default"}
                        className="w-full"
                        disabled={togglingCodeRequirement}
                        onClick={() => handleToggleCodeRequirement(!codeRequirement?.required)}
                      >
                        {togglingCodeRequirement ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : codeRequirement?.required ? (
                          <Unlock className="w-4 h-4 mr-2" />
                        ) : (
                          <Lock className="w-4 h-4 mr-2" />
                        )}
                        {codeRequirement?.required ? "Disable Code Requirement" : "Enable Code Requirement"}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by email or display name..."
                    value={usersSearch}
                    onChange={(e) => {
                      setUsersSearch(e.target.value);
                      setUsersPage(1);
                    }}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Select
                  value={usersFilter.isActive === undefined ? 'all' : usersFilter.isActive ? 'active' : 'inactive'}
                  onValueChange={(v) => {
                    setUsersFilter({
                      ...usersFilter,
                      isActive: v === 'all' ? undefined : v === 'active'
                    });
                    setUsersPage(1);
                  }}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={usersFilter.isAdmin === undefined ? 'all' : usersFilter.isAdmin ? 'admin' : 'regular'}
                  onValueChange={(v) => {
                    setUsersFilter({
                      ...usersFilter,
                      isAdmin: v === 'all' ? undefined : v === 'admin'
                    });
                    setUsersPage(1);
                  }}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={usersFilter.isDemo === undefined ? 'all' : usersFilter.isDemo ? 'demo' : 'real'}
                  onValueChange={(v) => {
                    setUsersFilter({
                      ...usersFilter,
                      isDemo: v === 'all' ? undefined : v === 'demo'
                    });
                    setUsersPage(1);
                  }}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="demo">Demo</SelectItem>
                    <SelectItem value="real">Real</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={usersSortBy} onValueChange={(v: any) => setUsersSortBy(v)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="createdAt">Newest First</SelectItem>
                    <SelectItem value="lastLoginAt">Recent Login</SelectItem>
                    <SelectItem value="lastSeenAt">Recent Activity</SelectItem>
                    <SelectItem value="email">Email A-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card>
              <CardHeader className="py-4">
                <CardTitle>User Accounts</CardTitle>
                <CardDescription>
                  {usersTotal} user{usersTotal !== 1 ? 's' : ''} total
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No users found</p>
                ) : (
                  <>
                    <div className="rounded-md border">
                      <div className="hidden md:grid grid-cols-[minmax(260px,1.5fr)_minmax(220px,1.3fr)_130px_80px_240px_110px] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <span>User</span>
                        <span>Email</span>
                        <span>Flags</span>
                        <span>Credits</span>
                        <span>Created / Last Login / Last Active</span>
                        <span className="text-right">Actions</span>
                      </div>
                      <ScrollArea className="h-[62vh] min-h-[420px]">
                        <div className="divide-y">
                          {users.map(u => (
                            <div
                              key={u.id}
                              className={`p-3 ${
                                !u.isActive ? 'bg-muted/50 opacity-60' : 'bg-card'
                              }`}
                            >
                              <div className="grid gap-3 md:grid-cols-[minmax(260px,1.5fr)_minmax(220px,1.3fr)_130px_80px_240px_110px] md:items-center">
                                <div className="min-w-0">
                                  <div className="font-medium truncate">
                                    {u.displayName || u.email || 'Unknown User'}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground truncate">
                                    ID: {u.id}
                                  </div>
                                  {u.displayName && u.email && (
                                    <div className="text-[11px] text-muted-foreground truncate">{u.displayName}</div>
                                  )}
                                </div>
                                <div className="min-w-0 text-sm text-muted-foreground">
                                  <div className="truncate">{u.email || 'No email'}</div>
                                  {u.description && (
                                    <div className="text-[11px] truncate">{u.description}</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {u.isAdmin && <Badge variant="default">Admin</Badge>}
                                  {u.isDemo && <Badge variant="secondary">Demo</Badge>}
                                  {!u.isActive && <Badge variant="destructive">Disabled</Badge>}
                                  {!u.emailVerified && <Badge variant="outline">Unverified</Badge>}
                                </div>
                                <div className="text-sm font-medium">
                                  {u.credits !== null ? u.credits.toLocaleString() : <span className="text-muted-foreground text-xs">—</span>}
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <div>Created: {new Date(u.createdAt).toLocaleDateString()}</div>
                                  <div>Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</div>
                                  <div>Last active: {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : 'Never'}</div>
                                </div>
                                <div className="flex md:justify-end gap-2">
                                  {u.id !== user?.id && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant={u.isActive ? "outline" : "default"}
                                          size="sm"
                                        >
                                          {u.isActive ? (
                                            <>
                                              <Ban className="w-4 h-4 mr-1" />
                                              Disable
                                            </>
                                          ) : (
                                            <>
                                              <CheckCircle2 className="w-4 h-4 mr-1" />
                                              Enable
                                            </>
                                          )}
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            {u.isActive ? 'Disable' : 'Enable'} User Account?
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            {u.isActive
                                              ? 'This will prevent the user from logging in. Their existing tokens will be invalidated.'
                                              : 'This will allow the user to login again.'}
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleToggleUserActive(u.id, u.isActive)}>
                                            {u.isActive ? 'Disable' : 'Enable'}
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <div className="text-sm text-muted-foreground">
                          Page {usersPage} of {totalPages} - {usersTotal} total users
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                            disabled={usersPage <= 1}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setUsersPage(p => Math.min(totalPages, p + 1))}
                            disabled={usersPage >= totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">API Keys Management</h2>
                <p className="text-muted-foreground">Manage API keys for services and integrations</p>
              </div>
              <Button onClick={() => setShowCreateApiKeyForm(!showCreateApiKeyForm)} disabled={creatingApiKey}>
                <Key className="w-4 h-4 mr-2" />
                Create API Key
              </Button>
            </div>

            {/* New API Key Display */}
            {newApiKey && (
              <Card className="border-green-500 bg-green-900/20">
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
                  <div className="flex items-center gap-2 bg-card p-3 rounded-md border">
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
            {showCreateApiKeyForm && (
              <Card className="border-blue-500 bg-blue-900/10">
                <CardHeader>
                  <CardTitle>Create New API Key</CardTitle>
                  <CardDescription>
                    Generate a new API key for a user
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="apiKeyUserId">User ID *</Label>
                      <Input
                        id="apiKeyUserId"
                        placeholder="Enter user ID"
                        value={apiKeyUserId}
                        onChange={(e) => setApiKeyUserId(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="apiKeyDescription">Description *</Label>
                      <Input
                        id="apiKeyDescription"
                        placeholder="e.g., Prometheus Scraper, CI/CD Pipeline"
                        value={apiKeyDescription}
                        onChange={(e) => setApiKeyDescription(e.target.value)}
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
                      <Label htmlFor="apiKeyExpiresInDays">Expires in Days (Optional)</Label>
                      <Input
                        id="apiKeyExpiresInDays"
                        type="number"
                        min="1"
                        placeholder="Leave empty for no expiration"
                        value={apiKeyExpiresInDays || ''}
                        onChange={(e) => setApiKeyExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleCreateApiKey} disabled={creatingApiKey}>
                        {creatingApiKey ? (
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
                      <Button variant="outline" onClick={() => setShowCreateApiKeyForm(false)} disabled={creatingApiKey}>
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
                {loadingApiKeys ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : apiKeys.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No API keys found</p>
                ) : (
                  <div className="space-y-4">
                    {apiKeys.map(key => (
                      <div
                        key={key.id}
                        className="border rounded-lg p-4 bg-muted/30"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                                {key.prefix}***
                              </code>
                              <Badge variant={key.isActive ? "default" : "secondary"}>
                                {key.isActive ? "Active" : "Revoked"}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium">{key.description}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              User: {key.userEmail || key.userId}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {key.scopes.map(scope => (
                                <Badge key={scope} variant="outline" className="text-xs">
                                  {scope}
                                </Badge>
                              ))}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

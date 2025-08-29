'use client';

import { useState, useEffect } from 'react';
import { useApiKeyStore } from '@/store/api-key-store';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { KeyRoundIcon, UserIcon, Crown, Sparkles, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { apiKey, setApiKey, isInitialized, isDemo, setDemoMode, clearApiKey } = useApiKeyStore();
  const { user, isAuthenticated, isDemoMode, logout, setApiKey: setJwtApiKey, setDemoMode: setJwtDemoMode } = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const router = useRouter();

  useEffect(() => {
    // This will now correctly populate the key from the store, whether it's a demo key or user's key.
    if (isInitialized && apiKey) {
      setKeyInput(apiKey);
    } else {
      setKeyInput('');
    }
  }, [isInitialized, apiKey]);

  const handleSaveKey = async () => {
    const trimmedKey = keyInput.trim();
    setKeyInput(trimmedKey);
    
    // If JWT authenticated, use JWT store, otherwise use legacy store
    if (isAuthenticated) {
      await setJwtApiKey(trimmedKey);
    } else {
      await setApiKey(trimmedKey);
    }
    
    toast.success('API Key saved successfully!', {
        description: 'The application will now use this key for all requests.',
    });
  };

  const handleClearKey = () => {
    if (isAuthenticated) {
      setJwtApiKey(null);
    } else {
      clearApiKey();
    }
    setKeyInput('');
    toast.info('API Key cleared.', {
        description: 'You will need to set a new key for full access.',
    });
  };

  const handleSwitchToDemo = async () => {
    try {
      if (isAuthenticated) {
        await setJwtDemoMode();
      } else {
        await setDemoMode();
      }
      router.push('/');
      toast.info('Switched to Demo Mode.');
    } catch {
      toast.error('Failed to switch to demo mode.');
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  // Determine current authentication state
  const currentIsDemo = isDemoMode || isDemo;

  if (!isAuthenticated && !isInitialized) {
    return <div>Loading settings...</div>; // Or a skeleton loader
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your authentication and preferences.</p>
      </header>

      <div className="grid gap-6">
        {/* Account Information - JWT Users Only */}
        {isAuthenticated && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="h-5 w-5" />
                Account Information
                <Badge 
                  className={`ml-2 ${currentIsDemo 
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' 
                    : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                  }`}
                >
                  {currentIsDemo ? (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Demo Mode
                    </>
                  ) : (
                    <>
                      <Crown className="w-3 h-3 mr-1" />
                      Full Access
                    </>
                  )}
                </Badge>
              </CardTitle>
              <CardDescription>
                Your account details and authentication status.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Email</label>
                  <p className="text-sm">{user?.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Account Type</label>
                  <p className="text-sm">{currentIsDemo ? 'Demo Account' : 'Full Account'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Email Verified</label>
                  <p className="text-sm">{user?.emailVerified ? 'Yes' : 'No'}</p>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSwitchToDemo}
                  variant="outline" 
                  size="sm"
                  disabled={currentIsDemo}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Switch to Demo
                </Button>
                <Button 
                  onClick={handleLogout}
                  variant="destructive" 
                  size="sm"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API Key Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <KeyRoundIcon className="h-5 w-5 mr-2" />
              API Key Management
              {!isAuthenticated && (
                <Badge className="ml-2 bg-orange-500/20 text-orange-400 border-orange-500/30">
                  Legacy Mode
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {isAuthenticated 
                ? "Configure an API key for enhanced features. JWT authentication is preferred for security."
                : "Your API key is used to authenticate all requests. It's stored securely in your browser's local storage."
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentIsDemo ? (
              <div className="space-y-4">
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-blue-400">Demo Mode Active</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    You're using demo mode with limited access to curated wallets. 
                    {isAuthenticated ? ' Upgrade to add your own API key.' : ' Add your own API key for full access.'}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label htmlFor="demo-api-key-input" className="text-sm font-medium">Demo API Key</label>
                  <Input
                    id="demo-api-key-input"
                    name="demo-api-key-input"
                    type="password"
                    value="demo_key_active"
                    disabled
                    className="w-full max-w-lg"
                  />
                </div>
                
                <div className="flex gap-2">
                  <Button onClick={() => { setKeyInput(''); handleClearKey(); }}>
                    {isAuthenticated ? 'Add API Key' : 'Use My Own Key'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="user-api-key-input" className="text-sm font-medium">Your API Key</label>
                  <Input
                    id="user-api-key-input"
                    name="user-api-key-input"
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="Enter your API key..."
                    className="w-full max-w-lg"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Button 
                    onClick={handleSaveKey} 
                    disabled={!keyInput.trim() || keyInput.trim() === apiKey}
                  >
                    {(apiKey || (isAuthenticated && user)) ? 'Update Key' : 'Save Key'}
                  </Button>
                  {(apiKey || (isAuthenticated && user)) && (
                    <Button variant="outline" onClick={handleClearKey}>
                      Clear Key
                    </Button>
                  )}
                </div>
                
                <Separator />
                
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-blue-400 hover:text-blue-300"
                    onClick={handleSwitchToDemo}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Switch to Demo Mode
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Authentication Mode Information */}
        <Card>
          <CardHeader>
            <CardTitle>Authentication Mode</CardTitle>
            <CardDescription>
              Current authentication method and available options.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isAuthenticated ? (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="font-medium">JWT Authentication</p>
                    <p className="text-sm text-muted-foreground">
                      Secure token-based authentication with account management features.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                  <div>
                    <p className="font-medium">API Key Authentication (Legacy)</p>
                    <p className="text-sm text-muted-foreground">
                      Using API key for authentication. Consider creating an account for enhanced features.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
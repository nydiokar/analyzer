'use client';

import { useState, useEffect } from 'react';
import { useApiKeyStore } from '@/store/api-key-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { KeyRoundIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { apiKey, setApiKey, isInitialized, isDemo, setDemoMode, clearApiKey } = useApiKeyStore();
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
    // Update the input field visually with the trimmed key
    setKeyInput(trimmedKey);
    await setApiKey(trimmedKey);
    toast.success('Key saved successfully!', {
        description: 'The application will now use this key for all requests.',
    });
  };

  const handleClearKey = () => {
    clearApiKey();
    setKeyInput('');
    toast.info('Key cleared.', {
        description: 'You will need to set a new key for full access.',
    });
  };

  const handleClearAndSwitchToFullAccess = () => {
    clearApiKey();
    setKeyInput('');
    toast.info('Switched to Full Access mode.', {
        description: 'Please enter your own API key.',
    });
  };

  const handleSwitchToDemo = async () => {
    await setDemoMode();
    router.push('/');
    toast.info('Switched to Demo Mode.');
  };

  if (!isInitialized) {
    return <div>Loading settings...</div>; // Or a skeleton loader
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your settings and preferences.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <KeyRoundIcon className="h-5 w-5 mr-2" />
            Key Management
          </CardTitle>
          <CardDescription>
            Your key is used to authenticate all requests to the application.
            It is stored securely in your browser&apos;s local storage and never sent anywhere else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           {isDemo ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">You are currently using the Demo API Key. You can explore curated wallets with limited access.</p>
              <div className="space-y-2">
                <label htmlFor="demo-api-key-input" className="text-sm font-medium">Demo Key</label>
                <Input
                  id="demo-api-key-input"
                  name="demo-api-key-input"
                  type="password"
                  value={keyInput}
                  disabled
                  className="w-full max-w-lg"
                />
              </div>
              <Button onClick={handleClearAndSwitchToFullAccess}>
                Use My Own Key
              </Button>
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
                    placeholder="Enter your key..."
                    className="w-full max-w-lg"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Button onClick={handleSaveKey} disabled={!keyInput.trim() || keyInput.trim() === apiKey}>
                    {apiKey ? 'Update Key' : 'Save Key'}
                  </Button>
                  {apiKey && (
                    <Button variant="outline" onClick={handleClearKey}>
                      Clear Key
                    </Button>
                  )}
                </div>
                <div className="pt-4 border-t border-slate-700">
                 <Button
                  variant="ghost"
                  className="text-xs text-blue-400 hover:text-blue-300 p-0 h-auto"
                  onClick={handleSwitchToDemo}
                 >
                   Switch to Demo Mode
                 </Button>
               </div>
            </div>
           )}
        </CardContent>
      </Card>
    </div>
  );
} 
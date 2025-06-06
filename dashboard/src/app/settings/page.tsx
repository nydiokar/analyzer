'use client';

import { useState, useEffect } from 'react';
import { useApiKeyStore } from '@/store/api-key-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { KeyRoundIcon } from 'lucide-react';

export default function SettingsPage() {
  const { apiKey, setApiKey, isInitialized } = useApiKeyStore();
  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    // When the component mounts, initialize the input with the stored key
    if (isInitialized && apiKey) {
      setKeyInput(apiKey);
    }
  }, [isInitialized, apiKey]);

  const handleSaveKey = () => {
    setApiKey(keyInput);
    toast.success('API Key saved successfully!', {
        description: 'The application will now use this key for all requests.',
    });
  };

  const handleClearKey = () => {
    setApiKey(null);
    setKeyInput('');
    toast.info('API Key cleared.', {
        description: 'You will need to set a new key for full access.',
    });
  };

  if (!isInitialized) {
    return <div>Loading settings...</div>; // Or a skeleton loader
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your application settings and preferences.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <KeyRoundIcon className="h-5 w-5 mr-2" />
            API Key Management
          </CardTitle>
          <CardDescription>
            Your API key is used to authenticate all requests to the analysis backend.
            It is stored securely in your browser&apos;s local storage and never sent anywhere else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="api-key-input" className="text-sm font-medium">Your API Key</label>
            <Input
              id="api-key-input"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Enter your API key..."
              className="w-full max-w-lg"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Button onClick={handleSaveKey} disabled={!keyInput || keyInput === apiKey}>
              Save Key
            </Button>
            {apiKey && (
              <Button variant="outline" onClick={handleClearKey}>
                Clear Key
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();

  const themes = [
    { value: 'light', label: 'Light', icon: Sun, description: 'Bright and clear' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes' },
    { value: 'system', label: 'System', icon: Monitor, description: 'Matches your OS' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Settings</DialogTitle>
          <DialogDescription>
            Customize your experience
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Label className="text-base font-semibold">Theme</Label>
          <div className="grid grid-cols-3 gap-3">
            {themes.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                  theme === value
                    ? 'border-blue-600 bg-blue-500/10'
                    : 'border-border hover:border-muted-foreground/30 hover:bg-accent/50'
                )}
              >
                <Icon className={cn(
                  'h-6 w-6',
                  theme === value ? 'text-blue-600' : 'text-muted-foreground'
                )} />
                <div className="text-center">
                  <p className={cn(
                    'text-sm font-medium',
                    theme === value ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

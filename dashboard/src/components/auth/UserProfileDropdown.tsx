'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Settings, HelpCircle, LogOut, User, Shield } from 'lucide-react';

export function UserProfileDropdown() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const displayName = user?.displayName || user?.email || 'User';
  const initials = getInitials(displayName);

  const handleLogout = async () => {
    await logout();
    setIsOpen(false);
    router.push('/home');
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-3 h-auto py-2 px-3 hover:bg-slate-800/50 transition-all"
        >
          <Avatar className="h-9 w-9 border-2 border-blue-500/30">
            <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start">
            <span className="text-sm font-semibold text-white leading-tight">
              {displayName}
            </span>
            {user?.email && user.email !== displayName && (
              <span className="text-xs text-slate-400 leading-tight">
                {user.email}
              </span>
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 bg-slate-900/95 backdrop-blur-xl border-slate-800 p-2"
      >
        <DropdownMenuLabel className="px-3 py-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border-2 border-blue-500/30">
              <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">
                {displayName}
              </span>
              {user?.email && (
                <span className="text-xs text-slate-400">
                  {user.email}
                </span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="bg-slate-800 my-2" />

        <DropdownMenuItem
          onClick={() => {
            setIsOpen(false);
            router.push('/profile');
          }}
          className="px-3 py-2.5 cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
        >
          <User className="mr-3 h-4 w-4" />
          <span>Profile</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setIsOpen(false);
            router.push('/settings');
          }}
          className="px-3 py-2.5 cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
        >
          <Settings className="mr-3 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>

        {user?.isAdmin && (
          <DropdownMenuItem
            onClick={() => {
              setIsOpen(false);
              router.push('/admin/api-keys');
            }}
            className="px-3 py-2.5 cursor-pointer text-purple-300 hover:text-purple-200 hover:bg-purple-900/20 rounded-md transition-colors"
          >
            <Shield className="mr-3 h-4 w-4" />
            <span>Admin Panel</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onClick={() => {
            setIsOpen(false);
            router.push('/help');
          }}
          className="px-3 py-2.5 cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
        >
          <HelpCircle className="mr-3 h-4 w-4" />
          <span>Help & Docs</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-slate-800 my-2" />

        <DropdownMenuItem
          onClick={handleLogout}
          className="px-3 py-2.5 cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors"
        >
          <LogOut className="mr-3 h-4 w-4" />
          <span>Log Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(name: string): string {
  if (!name) return 'U';

  // If email, use first letter
  if (name.includes('@')) {
    return name.charAt(0).toUpperCase();
  }

  // If display name like "BravePhoenix47", extract first letters
  const words = name.match(/[A-Z][a-z]*/g);
  if (words && words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  // Fallback to first two characters
  return name.slice(0, 2).toUpperCase();
}

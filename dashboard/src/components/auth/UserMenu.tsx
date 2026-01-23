'use client';

import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { User, Settings, LogOut, Sparkles, HelpCircle } from 'lucide-react';
import { AccountModal } from './AccountModal';
import { SettingsModal } from './SettingsModal';
import Link from 'next/link';

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  if (!isAuthenticated || !user) {
    return null;
  }

  const getInitials = (email: string | null) => {
    if (!email) return 'U';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className={`h-9 w-9 rounded-full p-0 ${className}`}>
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-blue-600 text-white text-sm font-medium">
                {getInitials(user.email)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">
                {user.email ? user.email.split('@')[0] : 'User'}
              </p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setShowAccountModal(true)} className="cursor-pointer">
            <User className="w-4 h-4 mr-2" />
            Account
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => setShowSettingsModal(true)} className="cursor-pointer">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href="/help">
              <HelpCircle className="w-4 h-4 mr-2" />
              Help & About
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem disabled className="cursor-not-allowed opacity-50">
            <Sparkles className="w-4 h-4 mr-2" />
            What&apos;s New
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleLogout}
            className="cursor-pointer text-red-400 hover:text-red-300 focus:text-red-300"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Modals */}
      <AccountModal open={showAccountModal} onOpenChange={setShowAccountModal} />
      <SettingsModal open={showSettingsModal} onOpenChange={setShowSettingsModal} />
    </>
  );
}

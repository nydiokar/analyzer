'use client';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { Settings, LogOut, Key, Crown, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface UserMenuProps {
  className?: string;
  isCollapsed?: boolean;
}

export function UserMenu({ className, isCollapsed = false }: UserMenuProps) {
  const { user, isAuthenticated, isDemoMode, logout, isUsingApiKey } = useAuth();

  if (!isAuthenticated || !user) {
    return null;
  }

  const getInitials = (email: string | null) => {
    if (!email) return 'U';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const getStatusInfo = () => {
    if (isDemoMode) {
      return {
        label: 'Demo Mode',
        icon: <Sparkles className="w-3 h-3" />,
        variant: 'secondary' as const,
        className: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      };
    }
    
    if (isUsingApiKey) {
      return {
        label: 'API Key',
        icon: <Key className="w-3 h-3" />,
        variant: 'secondary' as const,
        className: 'bg-green-500/20 text-green-400 border-green-500/30'
      };
    }

    return {
      label: 'Full Access',
      icon: <Crown className="w-3 h-3" />,
      variant: 'default' as const,
      className: 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    };
  };

  const statusInfo = getStatusInfo();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={`h-auto p-2 ${className}`}>
          {isCollapsed ? (
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-slate-700 text-slate-200 text-sm font-medium">
                {getInitials(user.email)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="flex items-center gap-3">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-slate-700 text-slate-200 text-sm font-medium">
                  {getInitials(user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200 truncate max-w-24">
                    {user.email ? user.email.split('@')[0] : 'User'}
                  </span>
                  <Badge 
                    variant={statusInfo.variant} 
                    className={`text-xs px-2 py-0.5 flex items-center gap-1 ${statusInfo.className}`}
                  >
                    {statusInfo.icon}
                    {statusInfo.label}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-2">
            <p className="text-sm font-medium leading-none">
              {user.email ? user.email.split('@')[0] : 'User'}
            </p>
            <p className="text-xs leading-none text-muted-foreground truncate">
              {user.email}
            </p>
            <Badge 
              variant={statusInfo.variant} 
              className={`w-fit text-xs px-2 py-1 flex items-center gap-1 ${statusInfo.className}`}
            >
              {statusInfo.icon}
              {statusInfo.label}
            </Badge>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
            <Settings className="w-4 h-4" />
            Account Settings
          </Link>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onClick={handleLogout}
          className="flex items-center gap-2 cursor-pointer text-red-400 hover:text-red-300 focus:text-red-300"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
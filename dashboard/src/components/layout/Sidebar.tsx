'use client';

import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon, SettingsIcon, HelpCircleIcon, SearchIcon, FlaskConical } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FavoriteWalletsList } from '../sidebar/FavoriteWalletsList';
import { WalletSearch } from '../sidebar/WalletSearch';

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export default function Sidebar({ isCollapsed, toggleSidebar }: SidebarProps) {
  return (
    <aside 
      className={`h-screen p-3 border-r bg-gray-50 dark:bg-gray-800 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'w-18' : 'w-56'}`}
    >
      <TooltipProvider delayDuration={100}>
        {/* Header - Always visible */}
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          {!isCollapsed && (
            <Link href="/" className="text-xl font-semibold hover:text-primary transition-colors">
              Sova Intel
            </Link>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={toggleSidebar} 
                className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isCollapsed ? <ChevronRightIcon size={20} /> : <ChevronLeftIcon size={20} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side={isCollapsed? "right" : "bottom"} align="center">
              <p>{isCollapsed ? "Expand sidebar" : "Collapse sidebar"}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Search - Always visible */}
        <div className="flex-shrink-0 mb-4">
          {isCollapsed ? (
            <div className="px-0 flex justify-center">
              <Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button 
                        className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                        aria-label="Open search"
                      >
                        <SearchIcon size={20} />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center">
                    <p>Search Wallets</p>
                  </TooltipContent>
                </Tooltip>
                <PopoverContent side="right" align="start" className="w-64 p-3">
                  <WalletSearch />
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <div className="px-0">
              <WalletSearch />
            </div>
          )}
        </div>

        {/* Main Navigation - Always visible */}
        <div className="flex-shrink-0 mb-4">
          <ul>
            <li className="mb-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/similarity-lab" className={`flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}>
                    <FlaskConical size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1 font-semibold">Similarity LAB</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Similarity LAB</p></TooltipContent>}
              </Tooltip>
            </li>
          </ul>
        </div>
        
        {/* Separator */}
        <hr className="my-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />

        {/* Favorites Section - Now uses popover */}
        <div className="flex-shrink-0">
          <FavoriteWalletsList isCollapsed={isCollapsed} />
        </div>

        {/* Footer Navigation - Always visible */}
        <div className="flex-shrink-0 mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
          <ul className="space-y-2">
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/settings" className={`flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}>
                    <SettingsIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1 font-semibold">Settings</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Settings</p></TooltipContent>}
              </Tooltip>
            </li>
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/help" className={`flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}>
                    <HelpCircleIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1 font-semibold">Help/Doc</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Help/Documentation</p></TooltipContent>}
              </Tooltip>
            </li>
          </ul>
        </div>
      </TooltipProvider>
    </aside>
  );
} 
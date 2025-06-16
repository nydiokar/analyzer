import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, SettingsIcon, HelpCircleIcon, BriefcaseIcon, SearchIcon, FlaskConical } from 'lucide-react';
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
  const commonLinkClasses = "flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors";

  return (
    <aside 
      className={`h-screen p-4 border-r bg-gray-50 dark:bg-gray-800 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'}`}
    >
      <TooltipProvider delayDuration={100}>
        <div className="flex items-center justify-between mb-6">
          {!isCollapsed && <span className="text-xl font-semibold">Sova Intel</span>}
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

        {isCollapsed ? (
          <div className="mb-4 px-0 flex justify-center">
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
          <div className="mb-4 px-0">
            <WalletSearch />
          </div>
        )}

        <nav className="flex-grow space-y-4 overflow-y-auto pt-2">
          <div>
            <ul>
              <li className="mb-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/" className={`flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}>
                      <HomeIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                      {!isCollapsed && <span className="flex-1 font-semibold">Dashboard Home</span>}
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && <TooltipContent side="right" align="center"><p>Dashboard Home</p></TooltipContent>}
                </Tooltip>
              </li>
              <li className="mb-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/analysis-lab" className={`flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}>
                      <FlaskConical size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                      {!isCollapsed && <span className="flex-1 font-semibold">Analysis Lab</span>}
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && <TooltipContent side="right" align="center"><p>Analysis Lab</p></TooltipContent>}
                </Tooltip>
              </li>
            </ul>
          </div>
          
          {/* Separator before favorites if sidebar is collapsed and search is not shown */} 
          {isCollapsed && <hr className="my-2 border-gray-300 dark:border-gray-600" />}

          <div className={isCollapsed ? 'px-0' : 'px-0'}> 
            <FavoriteWalletsList isCollapsed={isCollapsed} />
          </div>
        </nav>

        {!isCollapsed && <hr className="my-4 border-gray-200 dark:border-gray-700" />}

        <div className="mt-auto pt-4">
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
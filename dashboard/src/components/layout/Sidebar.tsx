import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, SettingsIcon, HelpCircleIcon, BriefcaseIcon } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } from "@/components/ui/tooltip";

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export default function Sidebar({ isCollapsed, toggleSidebar }: SidebarProps) {
  const commonLinkClasses = "flex items-center py-2 px-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors";
  const activeLinkClasses = "bg-gray-200 dark:bg-gray-700";

  return (
    <aside 
      className={`h-screen p-4 border-r bg-gray-50 dark:bg-gray-800 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-48'}`}
    >
      <TooltipProvider delayDuration={100}>
        <div className="flex items-center justify-between mb-6">
          {!isCollapsed && <span className="text-xl font-semibold">Analyzer</span>}
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
        <nav className="flex-grow">
          <ul>
            <li className="mb-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/" className={`${commonLinkClasses}`}>
                    <HomeIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1">Dashboard Home</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Dashboard Home</p></TooltipContent>}
              </Tooltip>
            </li>
            <li className="mb-2">
              {!isCollapsed && <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-4 mb-1 px-3">Wallets</p>}
              {isCollapsed && <hr className="my-3 border-gray-300 dark:border-gray-600" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/wallets/DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm" className={`${commonLinkClasses} group`}>
                    <BriefcaseIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1 truncate group-hover:text-clip">Gake</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Wallet: Gake</p></TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/wallets/EaVboaPxFCYanjoNWdkxTbPvt57nhXGu5i6m9m6ZS2kK" className={`${commonLinkClasses} group`}>
                    <BriefcaseIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1 truncate group-hover:text-clip">EaVb...S2kK (real-loaded)</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Wallet: EaVb...S2kK</p></TooltipContent>}
              </Tooltip>
            </li>
          </ul>
        </nav>
        <div className="mt-auto pt-2 border-t border-gray-300 dark:border-gray-600">
          <ul className="space-y-2">
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/settings" className={`${commonLinkClasses}`}>
                    <SettingsIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1">Settings</span>}
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" align="center"><p>Settings</p></TooltipContent>}
              </Tooltip>
            </li>
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/help" className={`${commonLinkClasses}`}>
                    <HelpCircleIcon size={20} className={`${isCollapsed ? 'm-auto' : 'mr-3'} flex-shrink-0`} />
                    {!isCollapsed && <span className="flex-1">Help/Documentation</span>}
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
import React, { useState, useEffect, useCallback, memo } from 'react';
import { cn } from '@/lib/utils';

interface LazyTabContentProps {
  value: string;
  activeTab: string;
  className?: string;
  children: React.ReactNode;
  // Delay rendering until tab becomes active
  defer?: boolean;
  // Preload when tab is about to become active (on hover)
  preloadOnHover?: boolean;
}

// Simplified lazy tab content component
const LazyTabContent = memo(({ 
  value, 
  activeTab, 
  className = "mt-0 p-0", 
  children, 
  defer = true,
  preloadOnHover = true 
}: LazyTabContentProps) => {
  const [hasBeenActive, setHasBeenActive] = useState(false);
  const [shouldRender, setShouldRender] = useState(!defer);
  
  const isActive = activeTab === value;
  
  // Track if this tab has ever been active
  useEffect(() => {
    if (isActive) {
      setHasBeenActive(true);
      setShouldRender(true);
    }
  }, [isActive]);
  
  // Preload on hover for better UX
  const handleMouseEnter = useCallback(() => {
    if (preloadOnHover && !hasBeenActive && !isActive) {
      setShouldRender(true);
    }
  }, [preloadOnHover, hasBeenActive, isActive]);
  
  // Don't render anything if tab has never been active and not currently active
  if (!isActive && !hasBeenActive && !shouldRender) {
    return null;
  }
  
  // Show loading state only if we're active but not ready to render
  if (defer && !shouldRender && isActive) {
    return (
      <div 
        className={cn(className)}
        data-state="active"
        role="tabpanel"
        onMouseEnter={handleMouseEnter}
      >
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      className={cn(className, !isActive && "hidden")}
      data-state={isActive ? "active" : "inactive"}
      role="tabpanel"
      onMouseEnter={handleMouseEnter}
    >
      {children}
    </div>
  );
});

LazyTabContent.displayName = 'LazyTabContent';

export default LazyTabContent; 
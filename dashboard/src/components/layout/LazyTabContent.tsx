import React, { useState, useEffect, memo } from 'react';
import { cn } from '@/lib/utils';

interface LazyTabContentProps {
  value: string;
  activeTab: string;
  className?: string;
  children: React.ReactNode;
  // Delay rendering until tab becomes active
  defer?: boolean;
}

// Ultra-simplified lazy tab content component - optimized for performance
const LazyTabContent = memo(({ 
  value, 
  activeTab, 
  className = "mt-0 p-0", 
  children, 
  defer = true
}: LazyTabContentProps) => {
  const [hasBeenActive, setHasBeenActive] = useState(false);
  
  const isActive = activeTab === value;
  
  // Track if this tab has ever been active - use useEffect to prevent infinite re-renders
  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true);
    }
  }, [isActive, hasBeenActive]);
  
  // Don't render anything if tab has never been active and not currently active
  if (!isActive && !hasBeenActive) {
    return null;
  }
  
  // Show minimal loading state only if we're active but not ready to render
  if (defer && !hasBeenActive && isActive) {
    return (
      <div 
        className={cn(className)}
        data-state="active"
        role="tabpanel"
      >
        <div className="flex items-center justify-center h-16">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      className={cn(className, !isActive && "hidden")}
      data-state={isActive ? "active" : "inactive"}
      role="tabpanel"
    >
      {children}
    </div>
  );
});

LazyTabContent.displayName = 'LazyTabContent';

export default LazyTabContent; 
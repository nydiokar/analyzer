import React from 'react';
import { Button } from '@/components/ui/button'; // Assuming shadcn/ui Button
import { LucideIcon, AlertTriangle, Info, SearchX, FileQuestion, ServerCrash, PlayCircle, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils'; // Import cn for merging classNames

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionText?: string;
  onActionClick?: () => void;
  isActionLoading?: boolean;
  actionIcon?: LucideIcon;
  variant?: 'default' | 'error' | 'info' | 'playful';
  className?: string; // Added className prop
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: IconComponent = Info,
  title,
  description,
  actionText,
  onActionClick,
  isActionLoading = false,
  actionIcon: ActionIconComponent,
  variant = 'default',
  className, // Destructure className
}) => {
  let iconColorClass = 'text-muted-foreground';
  if (variant === 'error') iconColorClass = 'text-red-500';
  else if (variant === 'info') iconColorClass = 'text-blue-500';
  else if (variant === 'playful') iconColorClass = 'text-indigo-500'; // Example playful color

  // Playful icons - we can extend this
  const playfulIcons = [SearchX, FileQuestion, ServerCrash]; // Add more as needed

  let FinalIconComponent = IconComponent;
  if (variant === 'playful') {
    FinalIconComponent = playfulIcons[Math.floor(Math.random() * playfulIcons.length)];
  }

  // Determine if the main icon should spin
  const shouldSpin = FinalIconComponent === Loader2;

  return (
    <div 
      className={cn(
        "flex flex-col items-center justify-center text-center p-6 md:p-10 border bg-card rounded-lg shadow-sm min-h-[200px]",
        className // Apply the passed className
      )}
    >
      <FinalIconComponent 
        className={cn(
          "h-12 w-12 mb-4",
          iconColorClass,
          shouldSpin && "animate-spin" // Conditionally add animate-spin
        )} 
        strokeWidth={1.5} 
      />
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-md">{description}</p>
      )}
      {actionText && onActionClick && (
        <Button onClick={onActionClick} disabled={isActionLoading} variant="default" size="sm">
          {isActionLoading && ActionIconComponent === RefreshCw ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : ActionIconComponent ? (
            <ActionIconComponent className="h-4 w-4 mr-2" />
          ) : null}
          {isActionLoading ? 'Processing...' : actionText}
        </Button>
      )}
    </div>
  );
};

export const PlayfulErrorState: React.FC<Omit<EmptyStateProps, 'variant' | 'icon'>> = (props) => (
  <EmptyState
    {...props}
    variant="playful"
    // Icon will be chosen randomly by EmptyState when variant is playful
  />
);

export const ErrorState: React.FC<Omit<EmptyStateProps, 'variant' | 'icon'>> = (props) => (
  <EmptyState
    {...props}
    variant="error"
    icon={AlertTriangle}
  />
);

export const InfoState: React.FC<Omit<EmptyStateProps, 'variant' | 'icon'>> = (props) => (
  <EmptyState
    {...props}
    variant="info"
    icon={Info}
  />
);


export default EmptyState; 
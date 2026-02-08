import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type PageTitleProps = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  titleExtra?: ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  iconClassName?: string;
  iconWrapClassName?: string;
};

export function PageTitle({
  title,
  subtitle,
  icon: Icon,
  titleExtra,
  className,
  titleClassName,
  subtitleClassName,
  iconClassName,
  iconWrapClassName,
}: PageTitleProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {Icon ? (
        <div
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20',
            'dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20',
            iconWrapClassName,
          )}
        >
          <Icon className={cn('h-5 w-5', iconClassName)} />
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className={cn('text-2xl font-semibold tracking-tight', titleClassName)}>{title}</h1>
          {titleExtra}
        </div>
        {subtitle ? (
          <p className={cn('text-sm text-muted-foreground', subtitleClassName)}>{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

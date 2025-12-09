import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const metricVariants = cva(
  "font-bold tracking-tight",
  {
    variants: {
      variant: {
        default: "text-foreground",
        success: "text-green-600 dark:text-green-400",
        error: "text-red-600 dark:text-red-400",
        warning: "text-amber-600 dark:text-amber-400",
        info: "text-blue-600 dark:text-blue-400",
      },
      size: {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-5xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface MetricProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof metricVariants> {
  suffix?: string
  prefix?: string
}

const Metric = React.forwardRef<HTMLParagraphElement, MetricProps>(
  ({ className, variant, size, children, prefix, suffix, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(metricVariants({ variant, size, className }))}
        {...props}
      >
        {prefix && <span className="mr-1">{prefix}</span>}
        {children}
        {suffix && (
          <span className="text-base text-muted-foreground ml-2 font-normal">
            {suffix}
          </span>
        )}
      </p>
    )
  }
)
Metric.displayName = "Metric"

export { Metric, metricVariants }

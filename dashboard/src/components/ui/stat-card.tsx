import * as React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface StatCardProps {
  label: string
  value: React.ReactNode
  subValue?: React.ReactNode
  variant?: "default" | "success" | "error" | "warning"
  icon?: React.ReactNode
  className?: string
  size?: "default" | "compact"
}

export function StatCard({
  label,
  value,
  subValue,
  variant = "default",
  icon,
  className,
  size = "default",
}: StatCardProps) {
  const variantClasses: Record<NonNullable<StatCardProps["variant"]>, string> = {
    default: "border-border",
    success: "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/20",
    error: "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20",
    warning:
      "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20",
  }

  const sizeClasses =
    size === "compact"
      ? {
          container: "p-3",
          label: "text-[11px]",
          value: "text-lg",
          subValue: "text-[11px]",
        }
      : {
          container: "p-4",
          label: "text-xs",
          value: "text-xl",
          subValue: "text-xs",
        }

  return (
    <Card
      className={cn(
        "rounded-lg border shadow-base transition-shadow hover:shadow-hover",
        sizeClasses.container,
        variantClasses[variant],
        className
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <p
          className={cn(
            "font-medium text-muted-foreground uppercase tracking-wide",
            sizeClasses.label
          )}
        >
          {label}
        </p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <p className={cn("font-bold tracking-tight", sizeClasses.value)}>{value}</p>
      {subValue && (
        <p className={cn("text-muted-foreground mt-0.5", sizeClasses.subValue)}>
          {subValue}
        </p>
      )}
    </Card>
  )
}

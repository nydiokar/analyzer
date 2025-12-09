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
}

export function StatCard({
  label,
  value,
  subValue,
  variant = "default",
  icon,
  className,
}: StatCardProps) {
  const variantClasses: Record<NonNullable<StatCardProps["variant"]>, string> = {
    default: "border-border",
    success: "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/20",
    error: "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20",
    warning:
      "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20",
  }

  return (
    <Card
      className={cn(
        "p-4 rounded-lg border shadow-base transition-shadow hover:shadow-hover",
        variantClasses[variant],
        className
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
      {subValue && (
        <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>
      )}
    </Card>
  )
}

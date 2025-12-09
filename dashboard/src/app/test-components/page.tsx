"use client"

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Info,
  ShieldCheck,
  Zap,
} from "lucide-react"

import { ThemeToggleButton } from "@/components/theme-toggle-button"
import { Metric, type MetricProps } from "@/components/ui/metric"
import { StatCard, type StatCardProps } from "@/components/ui/stat-card"

type MetricVariant = NonNullable<MetricProps["variant"]>
type MetricSize = NonNullable<MetricProps["size"]>

const metricVariants: MetricVariant[] = [
  "default",
  "success",
  "error",
  "warning",
  "info",
]

const metricSizes: MetricSize[] = ["sm", "md", "lg", "xl"]

const metricSamples: Record<
  MetricVariant,
  { value: string; prefix?: string; suffix?: string }
> = {
  default: { value: "1,234", suffix: "SOL" },
  success: { value: "12.45", prefix: "+", suffix: "SOL" },
  error: { value: "3.21", prefix: "-", suffix: "SOL" },
  warning: { value: "48.2", suffix: "%" },
  info: { value: "128", suffix: "txns" },
}

const statCards: Array<
  Pick<StatCardProps, "label" | "value" | "subValue" | "variant" | "icon">
> = [
  {
    label: "Win Rate",
    value: "62.5%",
    subValue: "15/24 trades",
    variant: "success",
    icon: <ArrowUpRight className="h-4 w-4" />,
  },
  {
    label: "Drawdown",
    value: "-8.2%",
    subValue: "Last 30 days",
    variant: "error",
    icon: <ArrowDownRight className="h-4 w-4" />,
  },
  {
    label: "Signal Quality",
    value: "B+",
    subValue: "Stable risk profile",
    variant: "default",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    label: "Volatility Alert",
    value: "Elevated",
    subValue: "Watch order flow",
    variant: "warning",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
]

export default function TestComponentsPage() {
  return (
    <div className="space-y-10 p-6 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Design system tests
          </p>
          <h1 className="text-3xl font-bold">Metric + StatCard Showcase</h1>
          <p className="text-sm text-muted-foreground">
            Verify variants, sizes, and dark mode behavior. Resize to test
            responsive grids.
          </p>
        </div>
        <ThemeToggleButton />
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-6 text-card-foreground shadow-base">
        <div>
          <h2 className="text-xl font-semibold">Metric</h2>
          <p className="text-sm text-muted-foreground">
            All variants across sizes with prefix/suffix support.
          </p>
        </div>

        <div className="space-y-6">
          {metricSizes.map((size) => (
            <div key={size} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Size: {size}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {metricVariants.map((variant) => {
                  const sample = metricSamples[variant]
                  return (
                    <div
                      key={`${size}-${variant}`}
                      className="rounded-lg border bg-background/60 p-3 shadow-sm"
                    >
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {variant}
                      </p>
                      <Metric
                        size={size}
                        variant={variant}
                        prefix={sample.prefix}
                        suffix={sample.suffix}
                      >
                        {sample.value}
                      </Metric>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-6 text-card-foreground shadow-base">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Stat cards</h2>
            <p className="text-sm text-muted-foreground">
              Variants with optional icons and sublabels.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="h-4 w-4" />
            <span>Hover to see shadow transitions</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              subValue={card.subValue}
              variant={card.variant}
              icon={card.icon}
            />
          ))}
        </div>

        <div className="grid gap-4 rounded-lg border bg-background/60 p-4 shadow-sm sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Info variant note
            </p>
            <p className="text-sm text-muted-foreground">
              StatCard variants cover default, success, error, and warning. Use
              the neutral default style for informational states.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-card/80 p-3">
            <Info className="mt-0.5 h-4 w-4 text-blue-500" />
            <p className="text-sm text-muted-foreground">
              Combine StatCards with Metrics to build richer dashboards without
              Tremor components.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, startOfMonth, subMonths } from "date-fns";
import useSWR from "swr";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Dot } from "lucide-react";

import EChartComponent, { ECOption } from "@/components/charts/EChartComponent";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { useTimeRangeStore } from "@/store/time-range-store";
import { WalletDailyPnlResponse, WalletDailyPnlRow } from "@/types/api";

interface PnlCurvePanelProps {
  walletAddress: string;
}

interface CalendarMonthState {
  year: number;
  month: number;
}

interface CalendarCell {
  date: Date;
  isoDate: string;
}

const MONTH_NAMES: string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${parseInt(day, 10)} ${MONTH_NAMES[parseInt(month, 10) - 1]}`;
}

function formatSignedSol(value: number, decimals = 3): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)} SOL`;
}

function formatCompactSigned(value: number, decimals = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function formatPercent(winRate: number | null | undefined): string {
  if (winRate === null || winRate === undefined) return "N/A";
  return `${(winRate * 100).toFixed(0)}%`;
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function getMonthDate(month: CalendarMonthState): Date {
  return new Date(month.year, month.month, 1);
}

function toMonthState(date: Date): CalendarMonthState {
  return { year: date.getFullYear(), month: date.getMonth() };
}

function getMonthCells(month: CalendarMonthState): CalendarCell[] {
  const firstDay = startOfMonth(getMonthDate(month));
  const lastDay = endOfMonth(firstDay);
  const offset = (getDay(firstDay) + 6) % 7;
  const totalDays = lastDay.getDate();
  const cells: CalendarCell[] = [];

  for (let i = 0; i < offset; i += 1) {
    const fillerDate = new Date(firstDay);
    fillerDate.setDate(firstDay.getDate() - (offset - i));
    cells.push({ date: fillerDate, isoDate: format(fillerDate, "yyyy-MM-dd") });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const current = new Date(month.year, month.month, day);
    cells.push({ date: current, isoDate: format(current, "yyyy-MM-dd") });
  }

  while (cells.length % 7 !== 0) {
    const overflowOffset = cells.length - (offset + totalDays) + 1;
    const nextDate = new Date(month.year, month.month, totalDays + overflowOffset);
    cells.push({ date: nextDate, isoDate: format(nextDate, "yyyy-MM-dd") });
  }

  return cells;
}

function getCellTone(row: WalletDailyPnlRow | undefined): string {
  if (!row) return "bg-[#0a1324]";

  const magnitude = Math.abs(row.realizedPnlSol);
  if (row.realizedPnlSol > 0) {
    if (magnitude > 1) return "bg-emerald-500/28";
    if (magnitude >= 0.1) return "bg-emerald-500/18";
    return "bg-emerald-500/10";
  }
  if (row.realizedPnlSol < 0) {
    if (magnitude > 1) return "bg-rose-500/28";
    if (magnitude >= 0.1) return "bg-rose-500/18";
    return "bg-rose-500/10";
  }
  return "bg-[#10192b]";
}

function getCellRing(row: WalletDailyPnlRow | undefined): string {
  if (!row) return "border-slate-800/90";
  if (row.realizedPnlSol > 0) return "border-emerald-500/18";
  if (row.realizedPnlSol < 0) return "border-rose-500/18";
  return "border-slate-800/90";
}

function getPnlTone(value: number): string {
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-rose-300";
  return "text-slate-300";
}

function createEmptyRow(date: string): WalletDailyPnlRow {
  return {
    date,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    volumeSol: 0,
    feesSol: 0,
    realizedPnlSol: 0,
    profitableSellsCount: 0,
    totalSellsCount: 0,
    winRate: 0,
    uniqueMintsTradedCount: 0,
    volumeUsd: null,
    realizedPnlUsd: null,
    hasIncompleteEnrichment: false,
    hasIncompleteHistory: false,
  };
}

export default function PnlCurvePanel({ walletAddress }: PnlCurvePanelProps) {
  const { startDate, endDate } = useTimeRangeStore();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<CalendarMonthState>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const swrKey = useMemo(() => {
    if (!walletAddress || !startDate || !endDate) return null;
    const start = format(startDate, "yyyy-MM-dd");
    const end = format(endDate, "yyyy-MM-dd");
    return `/wallets/${walletAddress}/pnl-daily?startDate=${start}&endDate=${end}`;
  }, [walletAddress, startDate, endDate]);

  const { data, error, isLoading } = useSWR<WalletDailyPnlResponse, Error & { status?: number }>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const apiRows = useMemo(() => data?.data ?? [], [data?.data]);
  const rows = useMemo(() => {
    if (!startDate || !endDate) return apiRows;

    const rowMap = new Map(apiRows.map((row) => [row.date, row]));
    return eachDayOfInterval({
      start: startDate,
      end: endDate,
    }).map((day) => {
      const isoDate = format(day, "yyyy-MM-dd");
      return rowMap.get(isoDate) ?? createEmptyRow(isoDate);
    });
  }, [apiRows, endDate, startDate]);

  const cumulativeRows = useMemo(() => {
    let runningTotal = 0;
    return rows.map((row) => {
      runningTotal += row.realizedPnlSol;
      return {
        ...row,
        shortLabel: formatShortDate(row.date),
        cumulative: runningTotal,
      };
    });
  }, [rows]);

  const chartStats = useMemo(() => {
    if (!cumulativeRows.length) return null;

    const activeDays = cumulativeRows.filter((row) => row.tradeCount > 0).length;
    const totalVolume = cumulativeRows.reduce((sum, row) => sum + row.volumeSol, 0);
    const profitableSells = cumulativeRows.reduce((sum, row) => sum + row.profitableSellsCount, 0);
    const totalSells = cumulativeRows.reduce((sum, row) => sum + row.totalSellsCount, 0);

    return {
      activeDays,
      totalVolume,
      profitableSells,
      totalSells,
      losingSells: Math.max(totalSells - profitableSells, 0),
      finalCumulative: cumulativeRows[cumulativeRows.length - 1].cumulative,
    };
  }, [cumulativeRows]);

  const dayMap = useMemo(() => new Map(rows.map((row) => [row.date, row])), [rows]);

  const dataMonths = useMemo(() => {
    return rows.map((row) => {
      const [year, month] = row.date.split("-").map(Number);
      return new Date(year, month - 1, 1);
    });
  }, [rows]);

  const latestDataMonth = useMemo(() => {
    if (!dataMonths.length) return null;
    return dataMonths.reduce((latest, current) => (current > latest ? current : latest), dataMonths[0]);
  }, [dataMonths]);

  const monthKeys = useMemo(() => new Set(dataMonths.map((month) => getMonthKey(month))), [dataMonths]);

  useEffect(() => {
    if (latestDataMonth) {
      setCalendarMonth(toMonthState(latestDataMonth));
    }
  }, [latestDataMonth]);

  const chartOption = useMemo<ECOption | null>(() => {
    if (!cumulativeRows.length || !chartStats) return null;

    const tone = chartStats.finalCumulative >= 0 ? "#22c55e" : "#ef4444";
    const fillTone = chartStats.finalCumulative >= 0 ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.18)";

    return {
      backgroundColor: "transparent",
      grid: { top: 18, right: 10, bottom: 24, left: 8, containLabel: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(5, 10, 23, 0.96)",
        borderColor: "rgba(148, 163, 184, 0.18)",
        borderWidth: 1,
        textStyle: { color: "#f8fafc", fontSize: 12 },
        extraCssText: "backdrop-filter: blur(10px); border-radius: 14px; box-shadow: 0 24px 60px rgba(2,6,23,.42);",
        axisPointer: {
          type: "line",
          snap: true,
          lineStyle: { color: "rgba(148, 163, 184, 0.26)", type: "dashed" },
        },
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? params[0] : params;
          const dataIndex = typeof point === "object" && point !== null && "dataIndex" in point
            ? Number(point.dataIndex)
            : 0;
          const row = cumulativeRows[dataIndex];
          if (!row) return "";

          const dayColor = row.realizedPnlSol >= 0 ? "#4ade80" : "#fb7185";

          return [
            `<div style="font-weight:600;font-size:13px;margin-bottom:8px">${row.date}</div>`,
            `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#94a3b8">Day</span><span style="color:${dayColor};font-weight:600">${formatSignedSol(row.realizedPnlSol)}</span></div>`,
            `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#94a3b8">Running</span><span style="color:${tone};font-weight:600">${formatSignedSol(row.cumulative)}</span></div>`,
            `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#94a3b8">Trades</span><span>${row.tradeCount} (${row.buyCount}/${row.sellCount})</span></div>`,
            `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#94a3b8">Volume</span><span>${row.volumeSol.toFixed(2)} SOL</span></div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: cumulativeRows.map((row) => row.shortLabel),
        boundaryGap: false,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            color: "rgba(148,163,184,0.11)",
            type: "dashed",
          },
        },
      },
      series: [
        {
          type: "line",
          data: cumulativeRows.map((row) => row.cumulative),
          smooth: 0.28,
          symbol: "circle",
          symbolSize: 7,
          showSymbol: false,
          triggerLineEvent: true,
          lineStyle: {
            color: tone,
            width: 2.7,
          },
          areaStyle: {
            color: fillTone,
          },
          emphasis: {
            scale: true,
            itemStyle: {
              color: tone,
              borderColor: "#020617",
              borderWidth: 2,
            },
          },
          markLine: {
            symbol: "none",
            label: { show: false },
            lineStyle: {
              type: "dashed",
              color: "rgba(148,163,184,0.22)",
            },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [chartStats, cumulativeRows]);

  const summary = data?.summary;
  const realizedPnl = summary?.totalRealizedPnlSol ?? 0;
  const pnlTone = realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const borderTone = realizedPnl >= 0 ? "border-emerald-500/18" : "border-rose-500/18";
  const glowTone = realizedPnl >= 0
    ? "bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_50%)]"
    : "bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.18),transparent_50%)]";

  const calendarCells = useMemo(() => {
    return getMonthCells(calendarMonth).map((cell) => ({
      ...cell,
      row: dayMap.get(cell.isoDate),
      isCurrentMonth: cell.date.getMonth() === calendarMonth.month,
    }));
  }, [calendarMonth, dayMap]);

  const currentMonthRows = useMemo(() => {
    return rows.filter((row) => {
      const [year, month] = row.date.split("-").map(Number);
      return year === calendarMonth.year && month - 1 === calendarMonth.month;
    });
  }, [calendarMonth.month, calendarMonth.year, rows]);

  const currentMonthSummary = useMemo(() => {
    const realized = currentMonthRows.reduce((sum, row) => sum + row.realizedPnlSol, 0);
    const trades = currentMonthRows.reduce((sum, row) => sum + row.tradeCount, 0);
    const activeDays = currentMonthRows.filter((row) => row.tradeCount > 0).length;
    return { realized, trades, activeDays };
  }, [currentMonthRows]);

  const canGoPrev = useMemo(() => {
    const previous = subMonths(getMonthDate(calendarMonth), 1);
    return monthKeys.has(getMonthKey(previous));
  }, [calendarMonth, monthKeys]);

  const canGoNext = useMemo(() => {
    const next = addMonths(getMonthDate(calendarMonth), 1);
    return monthKeys.has(getMonthKey(next));
  }, [calendarMonth, monthKeys]);

  if (isLoading) {
    return <Skeleton className="h-full w-full rounded-[22px]" />;
  }

  if (error?.status === 404 || error || !rows.length || !chartOption || !chartStats) {
    return null;
  }

  return (
    <>
      <div className="grid h-full min-h-[154px] grid-cols-[minmax(0,1fr)_190px] gap-3">
        <div className={cn("relative min-w-0 overflow-hidden rounded-[18px] border bg-[#071120] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]", borderTone)}>
          <div className={cn("pointer-events-none absolute inset-0 opacity-100", glowTone)} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(2,6,23,.55))]" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.32em] text-cyan-300/80">PnL Curve</p>
              <p className="text-base font-medium text-slate-100">Cumulative realized PnL by sell date</p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full border border-slate-700/80 bg-slate-950/45 text-slate-300 hover:border-slate-600 hover:bg-slate-900 hover:text-white"
              onClick={() => setCalendarOpen(true)}
            >
              <CalendarDays className="h-4 w-4" />
              <span className="sr-only">Open PnL calendar</span>
            </Button>
          </div>

          <div className="relative mt-4">
            <EChartComponent option={chartOption} style={{ width: "100%", height: "196px" }} />
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-[18px] border border-slate-800/90 bg-[#091223] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Performance</p>
          </div>

          <div className="space-y-3 py-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">TXNS</span>
              <span className="text-lg font-semibold text-slate-100">{summary?.totalTradeCount ?? 0}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">Wins</span>
              <span className="text-lg font-semibold text-emerald-300">{chartStats.profitableSells}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">Losses</span>
              <span className="text-lg font-semibold text-rose-300">{chartStats.losingSells}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">Win rate</span>
              <span className="text-lg font-semibold text-slate-100">{formatPercent(summary?.winRate)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">Volume</span>
              <span className={cn("text-lg font-semibold", pnlTone)}>{chartStats.totalVolume.toFixed(1)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-400">Active days</span>
              <span className="text-lg font-semibold text-slate-100">{chartStats.activeDays}</span>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="h-[min(760px,calc(100vh-2rem))] w-[min(960px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden border-slate-800/90 bg-[#060d19] p-0 text-slate-100 shadow-[0_28px_120px_rgba(2,6,23,.72)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,.12),transparent_32%),radial-gradient(circle_at_top_right,rgba(14,165,233,.08),transparent_30%)]" />

          <DialogHeader className="relative border-b border-slate-800/90 px-6 py-5 text-left">
            <div className="flex items-start justify-between gap-6">
              <div>
                <DialogTitle className="text-[24px] font-semibold tracking-tight text-slate-50">PnL Calendar</DialogTitle>
                <p className="mt-1 text-sm text-slate-400">{format(getMonthDate(calendarMonth), "MMMM yyyy")}</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden rounded-full border border-slate-800/90 bg-slate-950/55 p-1 sm:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white"
                    disabled={!canGoPrev}
                    onClick={() => setCalendarMonth(toMonthState(subMonths(getMonthDate(calendarMonth), 1)))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Previous month</span>
                  </Button>
                  <div className="flex min-w-[120px] items-center justify-center px-2 text-sm font-medium text-slate-200">
                    {format(getMonthDate(calendarMonth), "MMM yyyy")}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white"
                    disabled={!canGoNext}
                    onClick={() => setCalendarMonth(toMonthState(addMonths(getMonthDate(calendarMonth), 1)))}
                  >
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Next month</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-slate-800/90 bg-slate-950/50 px-3 py-1.5 text-sm">
                <span className="text-slate-500">Month PnL</span>
                <span className={cn("ml-2 font-semibold", currentMonthSummary.realized >= 0 ? "text-emerald-300" : "text-rose-300")}>
                  {formatSignedSol(currentMonthSummary.realized, 2)}
                </span>
              </div>
              <div className="rounded-full border border-slate-800/90 bg-slate-950/50 px-3 py-1.5 text-sm">
                <span className="text-slate-500">Trades</span>
                <span className="ml-2 font-semibold text-slate-100">{currentMonthSummary.trades}</span>
              </div>
              <div className="rounded-full border border-slate-800/90 bg-slate-950/50 px-3 py-1.5 text-sm">
                <span className="text-slate-500">Active Days</span>
                <span className="ml-2 font-semibold text-slate-100">{currentMonthSummary.activeDays}</span>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="inline-flex items-center rounded-full border border-slate-800/90 bg-slate-950/50 px-2 py-1">
                  <Dot className="h-4 w-4 text-emerald-400" />
                  positive
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-800/90 bg-slate-950/50 px-2 py-1">
                  <Dot className="h-4 w-4 text-rose-400" />
                  negative
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-800/90 bg-slate-950/50 px-2 py-1">
                  <Dot className="h-4 w-4 text-slate-500" />
                  flat
                </span>
              </div>
            </div>
          </DialogHeader>

          <div className="relative flex-1 overflow-auto px-6 pb-6 pt-5">
            <div className="mb-3 grid grid-cols-7 gap-2">
              {WEEKDAY_LABELS.map((day) => (
                <div key={day} className="px-1 text-center text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {day}
                </div>
              ))}
            </div>

            <TooltipProvider delayDuration={40}>
              <div className="grid grid-cols-7 gap-2">
                {calendarCells.map((cell) => {
                  const row = dayMap.get(cell.isoDate);
                  const hasData = Boolean(row);
                  const isCurrentMonth = cell.date.getMonth() === calendarMonth.month;

                  return (
                    <Tooltip key={cell.isoDate}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "relative min-h-[88px] overflow-hidden rounded-[16px] border px-2.5 py-2.5 transition-all duration-150",
                            getCellTone(row),
                            getCellRing(row),
                            isCurrentMonth ? "opacity-100" : "opacity-28",
                            hasData ? "cursor-default shadow-[inset_0_1px_0_rgba(255,255,255,.02)]" : "",
                          )}
                        >
                          <div className="absolute inset-x-0 top-0 h-px bg-white/5" />
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-slate-400">{cell.date.getDate()}</span>
                            {row ? (
                              <span className={cn("text-sm font-semibold tabular-nums", getPnlTone(row.realizedPnlSol))}>
                                {formatCompactSigned(row.realizedPnlSol)}
                              </span>
                            ) : null}
                          </div>

                          {row ? (
                            <div className="mt-4 space-y-1.5">
                              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                {row.realizedPnlSol >= 0 ? (
                                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
                                )}
                                <span>{row.tradeCount} trades</span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {row.buyCount} buys / {row.sellCount} sells
                              </div>
                            </div>
                          ) : (
                            <div className="mt-6 text-[11px] text-slate-600">No activity</div>
                          )}
                        </div>
                      </TooltipTrigger>

                      {row && (
                        <TooltipContent
                          side="top"
                          align="start"
                          className="w-[260px] rounded-2xl border-slate-800/90 bg-[#0b1220]/98 px-4 py-3 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,.58)]"
                        >
                          <div className="space-y-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-50">
                                {format(new Date(`${row.date}T00:00:00`), "EEE, MMM d, yyyy")}
                              </div>
                              <div className={cn("mt-1 text-sm font-medium", getPnlTone(row.realizedPnlSol))}>
                                {formatSignedSol(row.realizedPnlSol, 2)}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <div className="text-slate-500">Trades</div>
                                <div className="mt-1 font-medium text-slate-100">{row.tradeCount}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Win Rate</div>
                                <div className="mt-1 font-medium text-slate-100">
                                  {row.totalSellsCount > 0
                                    ? `${((row.profitableSellsCount / row.totalSellsCount) * 100).toFixed(0)}%`
                                    : "N/A"}
                                </div>
                              </div>
                              <div>
                                <div className="text-slate-500">Buys / Sells</div>
                                <div className="mt-1 font-medium text-slate-100">{row.buyCount} / {row.sellCount}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Volume</div>
                                <div className="mt-1 font-medium text-slate-100">{row.volumeSol.toFixed(2)} SOL</div>
                              </div>
                            </div>
                          </div>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

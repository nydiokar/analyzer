"use client";

import React, { useMemo } from 'react';
import useSWR from 'swr';
import { useTimeRangeStore } from '@/store/time-range-store';
import { fetcher } from '@/lib/fetcher';
import { WalletDailyPnlResponse } from '@/types/api';
import EChartComponent from '@/components/charts/EChartComponent';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface DailyPnlChartProps {
  walletAddress: string;
  className?: string;
}

function formatSol(val: number, decimals = 3): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(decimals)} SOL`;
}

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${monthNames[parseInt(month) - 1]}`;
}

export default function DailyPnlChart({ walletAddress, className }: DailyPnlChartProps) {
  const { startDate, endDate } = useTimeRangeStore();

  const swrKey = useMemo(() => {
    if (!walletAddress || !startDate || !endDate) return null;
    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);
    return `/wallets/${walletAddress}/pnl-daily?startDate=${start}&endDate=${end}`;
  }, [walletAddress, startDate, endDate]);

  const { data, error, isLoading } = useSWR<WalletDailyPnlResponse>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const chartOption = useMemo(() => {
    if (!data?.data?.length) return null;

    const rows = data.data;
    const dates = rows.map(r => formatDate(r.date));
    const values = rows.map(r => r.realizedPnlSol);

    return {
      backgroundColor: 'transparent',
      grid: { top: 8, right: 12, bottom: 40, left: 52, containLabel: false },
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'hsl(222 47% 11%)',
        borderColor: 'hsl(215 27.9% 16.9%)',
        textStyle: { color: 'hsl(210 40% 98%)', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const row = rows[p.dataIndex];
          const pnl = row.realizedPnlSol;
          const pnlStr = formatSol(pnl);
          const color = pnl >= 0 ? '#22c55e' : '#ef4444';
          const winRate = row.totalSellsCount > 0
            ? `${((row.profitableSellsCount / row.totalSellsCount) * 100).toFixed(0)}%`
            : 'N/A';
          return [
            `<div style="font-weight:600;margin-bottom:4px">${row.date}</div>`,
            `<div>PnL: <span style="color:${color};font-weight:600">${pnlStr}</span></div>`,
            `<div>Trades: ${row.tradeCount} (${row.buyCount}B / ${row.sellCount}S)</div>`,
            `<div>Win rate: ${winRate}</div>`,
            `<div>Volume: ${row.volumeSol.toFixed(3)} SOL</div>`,
            row.hasIncompleteHistory ? `<div style="color:#f59e0b;font-size:11px;margin-top:4px">⚠ Incomplete history</div>` : '',
          ].join('');
        },
      },
      xAxis: {
        type: 'category' as const,
        data: dates,
        axisLabel: {
          color: 'hsl(215 16.3% 46.9%)',
          fontSize: 11,
          rotate: dates.length > 14 ? 35 : 0,
        },
        axisLine: { lineStyle: { color: 'hsl(215 27.9% 16.9%)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: 'hsl(215 16.3% 46.9%)',
          fontSize: 11,
          formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
        },
        splitLine: { lineStyle: { color: 'hsl(215 27.9% 16.9%)', type: 'dashed' as const } },
        axisLine: { show: false },
      },
      series: [
        {
          type: 'bar' as const,
          data: values.map(v => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#22c55e' : '#ef4444', borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] },
          })),
          barMaxWidth: 32,
          emphasis: { itemStyle: { opacity: 0.8 } },
        },
      ],
    };
  }, [data]);

  // Summary strip
  const summary = data?.summary;

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <Skeleton className="h-[180px] w-full" />
        <div className="flex gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}
        </div>
      </div>
    );
  }

  if (error) {
    // 404 = no daily rows yet for this wallet/period — show nothing, not an error
    if (error?.status === 404) return null;
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground py-2', className)}>
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
        Could not load daily PnL chart.
      </div>
    );
  }

  if (!data?.data?.length || !chartOption) return null;

  const totalPnl = summary?.totalRealizedPnlSol ?? 0;
  const winRate = summary?.winRate ?? 0;
  const totalTrades = summary?.totalTradeCount ?? 0;
  const pnlColor = totalPnl >= 0 ? 'text-green-500' : 'text-red-500';

  return (
    <div className={cn('space-y-2', className)}>
      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
        <span>
          Realized PnL:{' '}
          <span className={cn('font-semibold', pnlColor)}>{formatSol(totalPnl)}</span>
        </span>
        <span>
          Trades: <span className="text-foreground font-medium">{totalTrades}</span>
        </span>
        <span>
          Sell Win Rate:{' '}
          <span className="text-foreground font-medium">
            {winRate > 0 ? `${(winRate * 100).toFixed(0)}%` : 'N/A'}
          </span>
        </span>
        <span className="text-[10px] opacity-60 ml-auto">sell-date attribution</span>
      </div>

      {/* Chart */}
      <EChartComponent
        option={chartOption}
        style={{ width: '100%', height: '160px' }}
      />
    </div>
  );
}

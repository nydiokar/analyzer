'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { TopHolderItem } from '@/types/api';

// Lazy-load ECharts only on the client
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface Props {
  holders: TopHolderItem[];
  selected: Record<string, boolean>;
  onToggle: (address: string) => void;
  className?: string;
}

// Transform holders to ECharts graph nodes with force layout.
// The result is a bubble cloud: nodes sized by token amount, colored by rank bucket.
export function TopHoldersBubbleMap({ holders, selected, onToggle, className }: Props) {
  const { option } = useMemo(() => {
    const values = holders.map(h => {
      const ui = typeof h.uiAmountString === 'string' ? parseFloat(h.uiAmountString) : (h.uiAmount ?? 0);
      return Math.max(ui || 0, 0);
    });
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);

    const scale = (v: number) => {
      const t = max === min ? 1 : (v - min) / (max - min);
      // Size range: 16px..72px
      return 16 + t * 56;
    };

    // Categories: 0=Top 5, 1=Top 10 (6-10), 2=Top 20 (11-20), 3=Others
    const buckets = (rank: number) => {
      if (rank <= 5) return 0;
      if (rank <= 10) return 1;
      if (rank <= 20) return 2;
      return 3;
    };

    // Ring and glow colors (distinct per bucket)
    const ringColors = ['#60a5fa', '#34d399', '#f59e0b', '#94a3b8']; // blue, green, amber, slate
    const glowColors = [
      'rgba(59,130,246,0.45)', // blue glow
      'rgba(16,185,129,0.40)', // emerald glow
      'rgba(245,158,11,0.40)', // amber glow
      'rgba(148,163,184,0.30)', // slate glow for others
    ];

    // Use the same display value as the list (uiAmountString parsed)
    const nodes = holders.map(h => {
      const ui = typeof h.uiAmountString === 'string' ? parseFloat(h.uiAmountString.replace(/,/g, '')) : (h.uiAmount ?? 0);
      const key = h.ownerAccount || h.tokenAccount;
      const cat = buckets(h.rank);
      return {
        id: key,
        name: `${h.rank}. ${(h.ownerAccount || h.tokenAccount).slice(0, 4)}…${(h.ownerAccount || h.tokenAccount).slice(-4)}`,
        value: ui || 0,
        symbolSize: scale(ui || 0),
        category: cat,
        itemStyle: {
          color: 'rgba(0,0,0,0)',
          borderColor: ringColors[cat],
          borderWidth: selected[key] ? 3 : 2,
          shadowBlur: selected[key] ? 22 : 16,
          shadowColor: glowColors[cat],
          opacity: 1,
        },
      };
    });

    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(17, 24, 39, 0.9)',
        borderColor: 'rgba(255,255,255,0.12)',
        textStyle: { color: '#f3f4f6', fontSize: 12 },
        extraCssText: 'backdrop-filter: blur(1px); padding:6px 8px; border-radius:8px; box-shadow:0 2px 14px rgba(0,0,0,0.35);',
        formatter: (p: any) => {
          const node = holders.find(h => (h.ownerAccount || h.tokenAccount) === p.data?.id);
          if (!node) return p.name;
          const uiNum = typeof node.uiAmount === 'number' ? node.uiAmount : (typeof node.uiAmountString === 'string' ? parseFloat(node.uiAmountString.replace(/,/g, '')) : undefined);
          const uiStr = uiNum !== undefined ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(uiNum) : (node.uiAmountString ?? '');
          const addr = node.ownerAccount || node.tokenAccount;
          const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
          return `
            <div style="line-height:1.25">
              <div><span style="opacity:.7">Rank:</span> #${node.rank}</div>
              <div><span style="opacity:.7">Address:</span> ${shortAddr}</div>
              <div><span style="opacity:.7">Amount:</span> ${uiStr}</div>
            </div>
          `;
        },
      },
       legend: {
         top: 8,
         textStyle: { color: 'var(--foreground)' },
        data: ['Top 5', 'Top 10', 'Top 20', 'Others'],
         tooltip: { show: true },
       },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          data: nodes,
          categories: [
            { name: 'Top 5' },
            { name: 'Top 10' },
            { name: 'Top 20' },
            { name: 'Others' },
          ],
          label: { show: false },
          edgeLabel: { show: false },
          force: {
            // Start as a circle so all nodes are visible, then gently relax
            initLayout: 'circular',
            repulsion: 110,  // slightly tighter to stay in focus
            gravity: 0.05,   // a bit more pull toward center
            edgeLength: 8,
            friction: 0.05,
          },
          emphasis: {
            scale: 1.12,
            itemStyle: {
              shadowBlur: 26,
            },
            label: { show: false },
          },
          select: { label: { show: false } },
          animationDurationUpdate: 300,
          animationEasingUpdate: 'quarticOut',
          // Allow zooming out to see hundreds of nodes
          scaleLimit: { min: 0.2, max: 3 },
        },
      ],
      textStyle: {
        color: 'var(--foreground)'
      }
    } as any;

    return { option };
  }, [holders, selected]);

  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const suppressClickRef = useRef(false);

  const onEvents = {
    mousedown: (params: any) => {
      const e = params?.event;
      downRef.current = { x: e?.offsetX ?? 0, y: e?.offsetY ?? 0, t: Date.now() };
    },
    mouseup: async (params: any) => {
      const id: string | undefined = params?.data?.id;
      const e = params?.event;
      const down = downRef.current;
      downRef.current = null;
      if (!id || !down) return;

      // Skip if this was part of a dblclick
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const dx = (e?.offsetX ?? 0) - down.x;
      const dy = (e?.offsetY ?? 0) - down.y;
      const dist2 = dx * dx + dy * dy;
      const dt = Date.now() - down.t;
      // Treat as a genuine click only if short and not moved much
      if (dist2 < 16 && dt < 300) {
        try {
          await navigator.clipboard.writeText(id);
          toast.success('Wallet copied', { description: id });
        } catch {
          toast.info('Wallet selected');
        }
        // Do NOT toggle selection here to avoid re-layout flicker
      }
    },
    dblclick: (params: any) => {
      const id: string | undefined = params?.data?.id;
      suppressClickRef.current = true;
      if (id) {
        const url = `https://solscan.io/account/${id}`;
        window.open(url, '_blank');
      }
    },
  } as any;

  return (
    <div className={className}>
      <div className="px-2 py-1 text-xs text-muted-foreground flex items-center gap-3">
        <span>Tip: Click to copy and select • Double‑click to open on Solscan</span>
        <span className="ml-auto opacity-70">{holders.length} holders</span>
      </div>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} onEvents={onEvents} opts={{ renderer: 'canvas' }} />
    </div>
  );
}



"use client";

import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import {
  GridComponent,
  GridComponentOption,
  TooltipComponent,
  TooltipComponentOption,
  LegendComponent,
  LegendComponentOption,
} from 'echarts/components';
import { BarChart, BarSeriesOption, HeatmapChart, HeatmapSeriesOption, LineChart, LineSeriesOption, CustomChart, CustomSeriesOption } from 'echarts/charts';
import { UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { EChartsOption } from 'echarts';

// Register the necessary ECharts components
echarts.use([
  GridComponent,
  TooltipComponent,
  LegendComponent,
  BarChart,
  LineChart,
  HeatmapChart,
  CanvasRenderer,
  UniversalTransition,
  CustomChart,
]);

export type ECOption = EChartsOption;

interface EChartComponentProps {
  option: ECOption;
  style?: React.CSSProperties;
  className?: string;
  onEvents?: Record<string, (params: any) => void>;
  showLoading?: boolean;
}

const EChartComponent: React.FC<EChartComponentProps> = ({
  option,
  style = { width: '100%', height: '400px' }, // Default style
  className,
  onEvents,
  showLoading,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (chartRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);

      // Attach event listeners if any
      if (onEvents && chartInstanceRef.current) {
        Object.keys(onEvents).forEach((eventName) => {
          chartInstanceRef.current?.on(eventName, onEvents[eventName]);
        });
      }

      // Initial chart rendering
      chartInstanceRef.current.setOption(option);

      // Resize listener
      const handleResize = () => {
        chartInstanceRef.current?.resize();
      };
      window.addEventListener('resize', handleResize);

      // Cleanup on unmount
      return () => {
        window.removeEventListener('resize', handleResize);
        chartInstanceRef.current?.dispose();
      };
    }
  }, []); // Empty dependency array to run only once on mount and unmount

  useEffect(() => {
    // Update chart when option changes
    if (chartInstanceRef.current) {
      chartInstanceRef.current.setOption(option, true); // true for notMerge, re-renders the chart
    }
  }, [option]); // Rerun when option object changes

  useEffect(() => {
    // Handle loading state
    if (chartInstanceRef.current) {
      if (showLoading) {
        chartInstanceRef.current.showLoading();
      } else {
        chartInstanceRef.current.hideLoading();
      }
    }
  }, [showLoading]);

  return <div ref={chartRef} style={style} className={className} />;
};

export default EChartComponent; 
import React from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export default function Sparkline({ values, width = 120, height = 28, stroke = 'currentColor', strokeWidth = 1.5, fill = 'none' }: SparklineProps) {
  if (!values || values.length === 0) {
    return <svg width={width} height={height} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const path = `M ${points.join(' L ')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} stroke={stroke} strokeWidth={strokeWidth} fill={fill} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

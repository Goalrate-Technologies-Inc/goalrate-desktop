import * as React from 'react';
import { cn } from '../utils';

export interface VelocityTrendChartProps {
  data: number[];
  labels?: string[];
  height?: number;
  showAverage?: boolean;
  averageLabel?: string;
  barColor?: string;
  aboveAverageColor?: string;
  belowAverageColor?: string;
  className?: string;
}

/**
 * Simple SVG bar chart for velocity trend visualization
 * Displays points per day with color coding relative to average
 */
export function VelocityTrendChart({
  data,
  labels,
  height = 80,
  showAverage = true,
  averageLabel = 'avg',
  barColor = '#9ca3af', // gray-400
  aboveAverageColor = '#22c55e', // green-500
  belowAverageColor = '#f59e0b', // amber-500
  className,
}: VelocityTrendChartProps): React.ReactElement {
  // Calculate metrics
  const maxValue = Math.max(...data, 1); // Avoid division by zero
  const average = data.length > 0 ? data.reduce((sum, v) => sum + v, 0) / data.length : 0;

  // Chart dimensions
  const barCount = data.length;
  const barWidth = 100 / barCount;
  const barGap = barWidth * 0.15;
  const actualBarWidth = barWidth - barGap;

  // Generate default day labels if not provided
  const dayLabels = labels ?? generateDayLabels(barCount);

  return (
    <div className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Velocity trend chart showing ${barCount} days of data`}
      >
        {/* Average line */}
        {showAverage && average > 0 && (
          <line
            x1="0"
            y1={height - (average / maxValue) * (height - 20)}
            x2="100"
            y2={height - (average / maxValue) * (height - 20)}
            stroke="#e5e7eb"
            strokeWidth="1"
            strokeDasharray="2,2"
          />
        )}

        {/* Bars */}
        {data.map((value, index) => {
          const barHeight = maxValue > 0 ? (value / maxValue) * (height - 20) : 0;
          const x = index * barWidth + barGap / 2;
          const y = height - barHeight;

          let fillColor = barColor;
          if (showAverage && average > 0) {
            fillColor = value >= average ? aboveAverageColor : belowAverageColor;
          }

          return (
            <g key={index}>
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={actualBarWidth}
                height={Math.max(barHeight, 1)}
                fill={fillColor}
                rx="1"
                className="transition-all duration-200"
              />
              {/* Value label on top of bar */}
              {value > 0 && barHeight > 15 && (
                <text
                  x={x + actualBarWidth / 2}
                  y={y - 2}
                  textAnchor="middle"
                  fontSize="6"
                  fill="#6b7280"
                >
                  {value}
                </text>
              )}
            </g>
          );
        })}

        {/* Average label */}
        {showAverage && average > 0 && (
          <text
            x="98"
            y={height - (average / maxValue) * (height - 20) - 2}
            textAnchor="end"
            fontSize="6"
            fill="#9ca3af"
          >
            {averageLabel}: {average.toFixed(1)}
          </text>
        )}
      </svg>

      {/* Day labels */}
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
        {dayLabels.map((label, index) => (
          <span key={index} className="text-center" style={{ width: `${barWidth}%` }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Generate day labels for the chart
 * For 7 days: M, T, W, T, F, S, S
 * For other lengths: show abbreviated dates
 */
function generateDayLabels(count: number): string[] {
  if (count === 7) {
    // Weekly view - show day abbreviations
    const today = new Date();
    const labels: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-US', { weekday: 'narrow' }));
    }
    return labels;
  }

  // For other lengths, show every few days
  const today = new Date();
  const labels: string[] = [];
  const step = Math.max(1, Math.floor(count / 6));

  for (let i = 0; i < count; i++) {
    if (i === 0 || i === count - 1 || i % step === 0) {
      const date = new Date(today);
      date.setDate(date.getDate() - (count - 1 - i));
      labels.push(date.getDate().toString());
    } else {
      labels.push('');
    }
  }

  return labels;
}

export default VelocityTrendChart;

import { useTranslation } from 'react-i18next';

import { formatNumber } from '../money/money-format';
import { axisMax, type ChartDay } from './dashboard-utils';

const WIDTH = 720;
const HEIGHT = 240;
const BASE = 206;
const AXIS = 44;
const SERIES = [
  { key: 'completed', className: 'rides-chart__bar--completed' },
  { key: 'cancelled', className: 'rides-chart__bar--cancelled' },
  { key: 'other', className: 'rides-chart__bar--other' },
] as const;

/**
 * Stacked rides-per-day bars (approved board "Admin · Dashboard"): completed
 * (accent), cancelled (accent tint), the rest (no driver found or still in
 * progress, grey). Time runs with the reading direction — oldest day at the
 * inline start, so on the right in Arabic.
 */
export function RidesPerDayChart({ days }: { days: ChartDay[] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rtl = i18n.dir() === 'rtl';
  const top = axisMax(Math.max(0, ...days.map((day) => day.total)));
  const step = (WIDTH - AXIS - 10) / Math.max(1, days.length);
  const barWidth = Math.max(2, step * 0.56);
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));
  const scale = (value: number) => (value / top) * (BASE - 20);
  const ticks = [0, top / 2, top];

  return (
    <figure className="rides-chart">
      <figcaption className="rides-chart__legend">
        {SERIES.map((series) => (
          <span key={series.key} className="rides-chart__legend-item">
            <span className={`rides-chart__swatch ${series.className}`} />
            {t(`dashboard.chart.${series.key}`)}
          </span>
        ))}
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t('dashboard.chart.label')}
        className="rides-chart__svg"
      >
        {ticks.map((tick) => {
          const y = BASE - scale(tick);
          return (
            <g key={tick}>
              <line
                className="rides-chart__grid"
                x1={rtl ? 0 : AXIS}
                x2={rtl ? WIDTH - AXIS : WIDTH}
                y1={y}
                y2={y}
              />
              <text
                className="rides-chart__tick"
                x={rtl ? WIDTH - AXIS + 8 : AXIS - 8}
                y={y + 4}
                textAnchor={rtl ? 'start' : 'end'}
              >
                {formatNumber(tick, language)}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const slot = rtl ? WIDTH - AXIS - (index + 1) * step : AXIS + index * step;
          const x = slot + (step - barWidth) / 2;
          let y = BASE;
          const values = { completed: day.completed, cancelled: day.cancelled, other: day.other };
          return (
            <g key={day.date} data-testid={`chart-day-${day.date}`}>
              <title>
                {t('dashboard.chart.dayTitle', {
                  day: day.label,
                  total: formatNumber(day.total, language),
                  completed: formatNumber(day.completed, language),
                  cancelled: formatNumber(day.cancelled, language),
                })}
              </title>
              {SERIES.map((series) => {
                const height = scale(values[series.key]);
                y -= height;
                return height > 0 ? (
                  <rect
                    key={series.key}
                    className={series.className}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={2}
                  />
                ) : null;
              })}
              {days.length <= 14 && day.total > 0 ? (
                <text
                  className="rides-chart__value"
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                >
                  {formatNumber(day.total, language)}
                </text>
              ) : null}
              {index % labelEvery === 0 ? (
                <text
                  className="rides-chart__tick"
                  x={x + barWidth / 2}
                  y={BASE + 20}
                  textAnchor="middle"
                >
                  {day.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

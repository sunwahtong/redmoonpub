import React, {useMemo} from 'react';

export interface ActivityDay {
  /** `YYYY-MM-DD`. */
  date: string;
  [metric: string]: string | number;
}

interface Props {
  days: ActivityDay[];
  /** Which field decides a cell's intensity. */
  metric: string;
  /** How many weeks back to draw. */
  weeks?: number;
  /** Renders the tooltip for one day. */
  describe?: (day: ActivityDay | null, date: string) => string;
  className?: string;
}

const WEEKDAY_LABELS = ['H', '', 'SZ', '', 'P', '', 'V'];
const MONTH_LABELS = [
  'JAN', 'FEB', 'MÁR', 'ÁPR', 'MÁJ', 'JÚN',
  'JÚL', 'AUG', 'SZE', 'OKT', 'NOV', 'DEC'
];

const key = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * A year of activity as a grid of days, one column per week.
 *
 * Intensity is bucketed against the busiest day in the window rather than a
 * fixed scale: a bartender ringing up forty sales a night and a doorman running
 * two supply orders a week both need a readable chart, and one absolute scale
 * cannot serve both.
 *
 * Weeks start on Monday, which is how a Hungarian calendar reads.
 */
export const ActivityCalendar: React.FC<Props> = ({
  days,
  metric,
  weeks = 26,
  describe,
  className = ''
}) => {
  const {columns, max, months} = useMemo(() => {
    const byDate = new Map(days.map((day) => [day.date, day]));

    // Walk back to the Monday that starts the window.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - weeks * 7);
    const offsetToMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offsetToMonday);

    const built: {date: string; day: ActivityDay | null; future: boolean}[][] = [];
    const monthMarks: {column: number; label: string}[] = [];
    let highest = 0;
    let lastMonth = -1;

    const cursor = new Date(start);
    while (cursor <= end) {
      const column: {date: string; day: ActivityDay | null; future: boolean}[] = [];
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const date = key(cursor);
        const day = byDate.get(date) || null;
        const value = day ? Number(day[metric]) || 0 : 0;
        if (value > highest) highest = value;
        column.push({date, day, future: cursor > end});

        if (cursor.getMonth() !== lastMonth && cursor.getDate() <= 7) {
          lastMonth = cursor.getMonth();
          monthMarks.push({column: built.length, label: MONTH_LABELS[lastMonth]});
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      built.push(column);
    }

    return {columns: built, max: highest, months: monthMarks};
  }, [days, metric, weeks]);

  /** Five steps, so a quiet day still reads as different from no day at all. */
  const level = (value: number): number => {
    if (!value || max <= 0) return 0;
    return Math.min(4, Math.ceil((value / max) * 4));
  };

  const tooltip = (day: ActivityDay | null, date: string): string =>
    describe ? describe(day, date) : `${date}: ${day ? day[metric] : 0}`;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="inline-flex min-w-full flex-col gap-1.5">
        {/* Month ruler */}
        <div className="flex gap-[3px] pl-6">
          {columns.map((_, index) => {
            const mark = months.find((entry) => entry.column === index);
            return (
              <span key={index} className="w-[11px] text-[7px] tracking-[0.1em] text-[#6f6968]">
                {mark ? mark.label : ''}
              </span>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          {/* Weekday ruler */}
          <div className="flex w-6 shrink-0 flex-col gap-[3px] pr-1.5 text-right">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index} className="h-[11px] text-[7px] leading-[11px] text-[#6f6968]">
                {label}
              </span>
            ))}
          </div>

          {columns.map((column, columnIndex) => (
            <div key={columnIndex} className="flex flex-col gap-[3px]">
              {column.map((cell) => (
                <span
                  key={cell.date}
                  title={cell.future ? '' : tooltip(cell.day, cell.date)}
                  data-level={cell.future ? 'future' : level(cell.day ? Number(cell.day[metric]) || 0 : 0)}
                  className="rm-cal-cell"
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 pl-6 pt-1.5 text-[7px] tracking-[0.18em] text-[#6f6968]">
          <span>KEVESEBB</span>
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} data-level={step} className="rm-cal-cell"/>
          ))}
          <span>TÖBB</span>
        </div>
      </div>
    </div>
  );
};

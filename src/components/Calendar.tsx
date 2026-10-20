import { useEffect, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "../lib/icons";
import "./Calendar.css";

type CalendarProps = {
  value?: Date;
  defaultMonth?: Date;
  minDate?: Date;
  maxDate?: Date;
  disabledDate?: (date: Date) => boolean;
  dayLabel?: (date: Date) => string;
  "aria-label"?: string;
  footer?: ReactNode;
  onChange: (date: Date) => void;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const stripTime = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const sameDay = (first?: Date, second?: Date) => !!first && !!second
  && first.getFullYear() === second.getFullYear()
  && first.getMonth() === second.getMonth()
  && first.getDate() === second.getDate();

export function Calendar({ value, defaultMonth, minDate, maxDate, disabledDate, dayLabel, footer, onChange, "aria-label": ariaLabel }: CalendarProps) {
  const [view, setView] = useState(() => monthStart(defaultMonth ?? value ?? new Date()));
  const selectedYear = value?.getFullYear();
  const selectedMonth = value?.getMonth();

  useEffect(() => {
    if (!value) return;
    if (view.getFullYear() !== value.getFullYear() || view.getMonth() !== value.getMonth()) setView(monthStart(value));
  }, [selectedYear, selectedMonth]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const firstCell = new Date(year, month, 1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + index));
  const today = new Date();

  function isDisabled(date: Date) {
    const day = stripTime(date);
    return (minDate !== undefined && day < stripTime(minDate))
      || (maxDate !== undefined && day > stripTime(maxDate))
      || (disabledDate?.(day) ?? false);
  }

  return <div className="app-calendar" role="group" aria-label={ariaLabel}>
    <div className="app-calendar-header">
      <button type="button" aria-label="上个月" onClick={() => setView(new Date(year, month - 1, 1))}><ChevronRightIcon aria-hidden="true" /></button>
      <strong>{view.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</strong>
      <button type="button" aria-label="下个月" onClick={() => setView(new Date(year, month + 1, 1))}><ChevronRightIcon aria-hidden="true" /></button>
    </div>
    <div className="app-calendar-weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
    <div className="app-calendar-grid">
      {days.map((day, index) => {
        const disabled = isDisabled(day);
        const selected = sameDay(day, value);
        const isToday = sameDay(day, today);
        const outside = day.getMonth() !== month;
        const stateClass = disabled ? "is-disabled" : selected ? "is-selected" : outside ? "is-outside" : isToday ? "is-today" : "";
        return <button
          key={index}
          type="button"
          className={`app-calendar-day ${stateClass}`}
          disabled={disabled}
          aria-current={isToday ? "date" : undefined}
          aria-pressed={selected}
          aria-label={dayLabel?.(day) ?? day.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
          onClick={() => onChange(day)}
        >{day.getDate()}</button>;
      })}
    </div>
    {footer}
  </div>;
}

import { useEffect, useId, useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { ChevronDownIcon, ClockIcon } from "../lib/icons";
import "./DateTimePicker.css";

type DateTimePickerProps = {
  id: string;
  value: string;
  min: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

const pad = (value: number) => String(value).padStart(2, "0");

function parseLocalDateTime(value: string) {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function formatLocalDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

export function DateTimePicker({ id, value, min, disabled = false, onChange }: DateTimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const selected = parseLocalDateTime(value);
  const minimum = parseLocalDateTime(min);
  const [open, setOpen] = useState(false);
  const displayValue = `${selected.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} ${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
  const minimumTime = sameDay(selected, minimum) ? `${pad(minimum.getHours())}:${pad(minimum.getMinutes())}` : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function chooseDay(day: Date) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), selected.getHours(), selected.getMinutes());
    onChange(formatLocalDateTime(next < minimum ? minimum : next));
  }

  function chooseTime(time: string) {
    if (!time) return;
    const next = parseLocalDateTime(`${value.slice(0, 10)}T${time}`);
    onChange(formatLocalDateTime(next < minimum ? minimum : next));
  }

  return <div className="shutdown-datetime-picker" ref={rootRef}>
    <button
      id={id}
      type="button"
      className="shutdown-datetime-trigger"
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={popoverId}
      onClick={() => setOpen(current => !current)}
    >
      <ClockIcon aria-hidden="true" />
      <span>{displayValue}</span>
      <ChevronDownIcon aria-hidden="true" />
    </button>
    {open && <div id={popoverId} className="shutdown-calendar-popover" role="dialog" aria-label="选择日期和时间">
      <Calendar
        aria-label="选择日期"
        value={selected}
        minDate={new Date(minimum.getFullYear(), minimum.getMonth(), minimum.getDate())}
        onChange={chooseDay}
        footer={<>
          <div className="shutdown-calendar-time-row">
            <label htmlFor={`${popoverId}-time`}>时间</label>
            <input id={`${popoverId}-time`} type="time" value={`${pad(selected.getHours())}:${pad(selected.getMinutes())}`} min={minimumTime} onChange={event => chooseTime(event.target.value)} />
          </div>
          <button type="button" className="halo-button secondary compact shutdown-calendar-done" onClick={() => setOpen(false)}>完成</button>
        </>}
      />
    </div>}
  </div>;
}

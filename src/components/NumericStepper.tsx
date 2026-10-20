import { useEffect, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "../lib/icons";
import "./NumericStepper.css";

type NumericStepperProps = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  min: number;
  max: number;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
};

function RollingValue({ value }: { value: number }) {
  const lastValue = useRef(value);
  const [outgoing, setOutgoing] = useState<{ value: number; direction: "up" | "down" } | null>(null);

  if (value !== lastValue.current) {
    setOutgoing({ value: lastValue.current, direction: value > lastValue.current ? "up" : "down" });
    lastValue.current = value;
  }

  useEffect(() => {
    if (!outgoing) return;
    const timeout = window.setTimeout(() => setOutgoing(null), 260);
    return () => window.clearTimeout(timeout);
  }, [outgoing]);

  return <span className="numeric-stepper-roll">
    {outgoing && <span key={`out-${outgoing.value}`} className={`numeric-stepper-roll-number ${outgoing.direction === "up" ? "roll-out-up" : "roll-out-down"}`} aria-hidden="true">{outgoing.value}</span>}
    <span key={`in-${value}`} className={`numeric-stepper-roll-number${outgoing ? ` ${outgoing.direction === "up" ? "roll-in-up" : "roll-in-down"}` : ""}`} onAnimationEnd={() => setOutgoing(null)}>{value}</span>
  </span>;
}

export function NumericStepper({ id, label, value, unit = "秒", min, max, disabled = false, describedBy, onChange }: NumericStepperProps) {
  const [editing, setEditing] = useState(false);
  const valueBeforeEdit = useRef(value);
  const cancelEdit = useRef(false);
  const parsed = Number(value);
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed >= min && parsed <= max;
  const [rollingValue, setRollingValue] = useState(valid ? parsed : min);

  function commit() {
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : min;
    onChange(String(next));
    setRollingValue(next);
    setEditing(false);
  }

  function step(amount: number) {
    const next = Math.min(max, Math.max(min, parsed + amount));
    onChange(String(next));
    setRollingValue(next);
  }

  return <div className="numeric-stepper-control">
    <div className="numeric-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`减少 1 ${unit}`} disabled={disabled || !valid || parsed <= min} onClick={() => step(-1)}><MinusIcon aria-hidden="true" /></button>
      <span className="numeric-stepper-divider" aria-hidden="true" />
      <span className="numeric-stepper-value">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          aria-invalid={!valid}
          aria-label={label}
          aria-describedby={describedBy}
          className={`numeric-stepper-input${editing ? "" : " numeric-stepper-input-resting"}`}
          onFocus={event => { valueBeforeEdit.current = value; setEditing(true); event.currentTarget.select(); }}
          onChange={event => onChange(event.target.value.replace(/\D/g, ""))}
          onBlur={() => {
            if (cancelEdit.current) { cancelEdit.current = false; setEditing(false); return; }
            commit();
          }}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit.current = true;
              const restored = valueBeforeEdit.current;
              onChange(restored);
              setRollingValue(Number(restored));
              event.currentTarget.blur();
            }
          }}
        />
        <span className={`numeric-stepper-overlay${editing ? " numeric-stepper-overlay-hidden" : ""}`} aria-hidden="true"><RollingValue value={rollingValue} /></span>
      </span>
      <span className="numeric-stepper-divider" aria-hidden="true" />
      <button type="button" aria-label={`增加 1 ${unit}`} disabled={disabled || !valid || parsed >= max} onClick={() => step(1)}><PlusIcon aria-hidden="true" /></button>
    </div><span className="numeric-stepper-unit" aria-hidden="true">{unit}</span>
  </div>;
}

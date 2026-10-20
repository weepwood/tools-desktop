import { ChevronDownIcon } from "../../lib/icons";
import "./controls.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
}

/** Native <select> styled to match the app's dropdown buttons. */
export function Select<T extends string>({ value, options, onChange, ...aria }: SelectProps<T>) {
  return (
    <div className="control-select">
      <select value={value} onChange={(e) => onChange(e.target.value as T)} {...aria}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="control-select-chevron" />
    </div>
  );
}

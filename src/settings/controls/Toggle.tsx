import "./controls.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/** iOS-style switch, as used across the settings. */
export function Toggle({ checked, onChange, disabled, ...aria }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="control-toggle"
      data-checked={checked}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span className="control-toggle-thumb" />
    </button>
  );
}

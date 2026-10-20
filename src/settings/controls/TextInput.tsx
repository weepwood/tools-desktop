import "./controls.css";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "password" | "number";
  "aria-label"?: string;
}

export function TextInput({ value, onChange, placeholder, type = "text", ...aria }: TextInputProps) {
  return (
    <input
      type={type}
      className="control-text-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      {...aria}
    />
  );
}

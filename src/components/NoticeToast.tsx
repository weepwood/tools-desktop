import { useEffect, useRef } from "react";
import { CloseIcon } from "../lib/icons";

type NoticeTone = "info" | "success" | "error";

/** Routine updates clear themselves; errors stay until the user dismisses them. */
export function NoticeToast({
  type,
  message,
  onDismiss,
}: {
  type: NoticeTone;
  message: string;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (type === "error") return;
    const timeout = window.setTimeout(() => onDismissRef.current(), type === "success" ? 5000 : 7000);
    return () => window.clearTimeout(timeout);
  }, [type, message]);

  return (
    <div className={`halo-notice ${type}`} role={type === "error" ? "alert" : "status"}>
      <span>{message}</span>
      <button aria-label="关闭提示" onClick={onDismiss}>
        <CloseIcon aria-hidden="true" />
      </button>
    </div>
  );
}

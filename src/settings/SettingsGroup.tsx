import "./SettingsView.css";

/*
 * Row + group scaffolding shared by every settings pane. Kept outside
 * SettingsView so panes in their own files (邮件通知) can reuse the exact
 * same card metrics without importing the view and creating a cycle.
 */

interface RowProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Lets a field breathe when the control is wider or taller than a switch. */
  stacked?: boolean;
}

export function Row({ title, description, children, stacked }: RowProps) {
  return (
    <div className="settings-row" data-stacked={stacked || undefined}>
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      {label && <div className="settings-group-label">{label}</div>}
      <div className="settings-group-card">{children}</div>
    </section>
  );
}

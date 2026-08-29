import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}

export function Panel({ title, icon, action, children, className = "", dense = false }: PanelProps) {
  return (
    <section
      className={`bg-panel border border-hairline rounded-lg overflow-hidden flex flex-col ${className}`}
    >
      <header className="flex items-center justify-between px-3.5 py-2.5 border-b border-hairline-soft shrink-0">
        <div className="flex items-center gap-2 text-text-muted">
          {icon}
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-wider">{title}</h2>
        </div>
        {action}
      </header>
      <div className={dense ? "p-2.5" : "p-3.5"}>{children}</div>
    </section>
  );
}

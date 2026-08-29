import { Loader2, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export function InlineLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-text-faint text-xs py-4 justify-center">
      <Loader2 size={14} className="animate-spin" />
      {label}
    </div>
  );
}

export function InlineEmpty({ children }: { children: ReactNode }) {
  return <div className="text-text-faint text-xs py-3 text-center">{children}</div>;
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-risk-high text-xs py-2 px-2.5 bg-risk-high-soft rounded-md border border-risk-high/30">
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

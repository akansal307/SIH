import type { RiskLevel } from "../../types/flood";
import { RISK_COLORS, RISK_LABELS } from "../../utils/riskUtils";

interface RiskBadgeProps {
  risk: RiskLevel;
  size?: "sm" | "md" | "lg";
  showDot?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<RiskBadgeProps["size"]>, string> = {
  sm: "text-[10px] px-1.5 py-0.5 gap-1",
  md: "text-xs px-2 py-1 gap-1.5",
  lg: "text-sm px-3 py-1.5 gap-2",
};

export function RiskBadge({ risk, size = "md", showDot = true }: RiskBadgeProps) {
  const color = RISK_COLORS[risk];
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold uppercase tracking-wide ${SIZE_CLASSES[size]}`}
      style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}
    >
      {showDot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {RISK_LABELS[risk]}
    </span>
  );
}

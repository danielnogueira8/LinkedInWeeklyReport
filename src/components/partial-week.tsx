import { pill } from "@/components/ui";
import { weeklyRunLabel } from "@/lib/period";

/** Marks a report built before its week was over, so its numbers are only "so far". */
export function PartialWeek({ className = "" }: { className?: string }) {
  return (
    <span
      className={`${pill} bg-amber-50 text-amber-700 ${className}`}
      title={`Numbers so far. The full week's report builds ${weeklyRunLabel()}.`}
    >
      Partial week
    </span>
  );
}

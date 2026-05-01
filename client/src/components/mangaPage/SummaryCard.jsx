import Skeleton from "../ui/Skeleton.jsx";

export default function SummaryCard({ label, value, hint, loading, skeletonWidth }) {
  return (
    <div className="rounded-2xl border border-border bg-ink-1/50 p-5 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-washi">
        {loading ? <Skeleton.Stat width={skeletonWidth} /> : value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-washi-muted">
          {loading ? <Skeleton className="h-3 w-32 align-middle" /> : hint}
        </p>
      )}
    </div>
  );
}

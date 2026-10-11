import { Link } from "react-router-dom";

/**
 * 戻 · The way back, the same on every page: at the top, before the
 * title, an arrow and the words — "Back to library", "Back to profile",
 * "Back" for a step back in history — in the house's mono label.
 *
 * Eleven pages had grown five wordings for two destinations ("Back",
 * "Back to dashboard", "Back to my library", "Back to library", "Back
 * home") in two styles (a sans-serif chevron, a mono arrow). A link
 * when it goes somewhere (`to`), a button when it steps back
 * (`onClick`); 44 px under a finger.
 */
export default function BackLink({ to, onClick, children, className = "" }) {
  const cls = `group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi pointer-coarse:min-h-11 ${className}`;
  const arrow = (
    <span
      aria-hidden="true"
      className="transition-transform group-hover:-translate-x-0.5"
    >
      ←
    </span>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {arrow}
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {arrow}
      {children}
    </button>
  );
}

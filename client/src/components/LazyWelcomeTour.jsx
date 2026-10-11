import { lazy, Suspense, useState } from "react";

const WelcomeTour = lazy(() => import("./WelcomeTour.jsx"));

/**
 * 始 · The welcome tour, fetched the first time it opens.
 *
 * It was imported by the dashboard and by the settings, so its 18 kB
 * came down with the library on every visit — to be shown once, to a
 * newcomer, and never again unless replayed from the settings. Once it
 * has opened it stays mounted, so the modal still plays its closing
 * transition.
 */
export default function LazyWelcomeTour({ open, onClose }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <WelcomeTour open={open} onClose={onClose} />
    </Suspense>
  );
}

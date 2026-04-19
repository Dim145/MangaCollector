import { useEffect, useState } from "react";
import { onPendingChanged, pendingCount } from "@/lib/sync.js";

export function usePendingCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const n = await pendingCount();
      if (!cancelled) setCount(n);
    };
    refresh();
    const off = onPendingChanged(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return count;
}

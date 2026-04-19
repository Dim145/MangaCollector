import { useEffect, useState } from "react";
import {
  getServerReachable,
  isFullyOnline,
  onConnectivityChange,
} from "@/lib/connectivity.js";

/**
 * Returns `true` only when both:
 *   - the browser reports a network connection, AND
 *   - the backend has recently answered a request.
 *
 * This way the UI goes "offline" both on Wi-Fi drops and on server outages
 * (deploys, crashes, firewall blocks).
 */
export function useOnline() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? isFullyOnline() : true
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine && getServerReachable());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const off = onConnectivityChange(update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      off();
    };
  }, []);

  return online;
}

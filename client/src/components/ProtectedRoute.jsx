import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkAuthStatus } from "../utils/auth";
import DefaultBackground from "./DefaultBackground";

export default function ProtectedRoute({ children, setGoogleUser }) {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const user = await checkAuthStatus();
      if (user) {
        setIsAuthenticated(true);
        setGoogleUser(user);
      } else {
        setIsAuthenticated(false);
        navigate("/log-in");
      }
    })();
  }, [navigate, setGoogleUser]);

  if (isAuthenticated === null) {
    return (
      <DefaultBackground>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-hanko/30" />
            <span className="hanko-seal relative grid h-14 w-14 place-items-center rounded-lg font-display text-base font-bold">
              MC
            </span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim animate-pulse">
            Loading archive…
          </p>
        </div>
      </DefaultBackground>
    );
  }

  return isAuthenticated ? children : null;
}

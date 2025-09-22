import { useState, useEffect } from "react";
import { checkAuthStatus } from "../utils/auth";
import { useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
export default function ProtectedRoute({ children, setGoogleUser }) {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const verifyAuth = async () => {
      const user = await checkAuthStatus();
      if (user) {
        setIsAuthenticated(true);
        setGoogleUser(user);
      } else {
        setIsAuthenticated(false);
        navigate("/log-in");
      }
    };

    verifyAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <DefaultBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </DefaultBackground>
    );
  }

  return isAuthenticated ? children : null;
}

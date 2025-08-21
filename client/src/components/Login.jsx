import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { checkAuthStatus, initiateOAuth } from "../utils/auth";

export default function Login() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      const user = await checkAuthStatus();
      if (user) {
        navigate("/dashboard");
        setUser(user);
      }
    };

    checkAuth();

    // Check for error in URL params
    const urlParams = new URLSearchParams(window.location.search);
    const authError = urlParams.get("error");
    if (authError === "auth_failed") {
      setError("Authentication failed. Please try again.");
    }
  }, []);

  console.log(user);

  const handleGoogleLogin = () => {
    setIsLoading(true);
    setError("");
    initiateOAuth();
  };

  return (
  
    <div className="bg-gradient-to-br from-black via-gray-900 to-black min-h-screen flex items-center justify-center p-4">
      <div className="relative bg-gray-800/90 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome to MangaCollector
          </h1>
          <p className="text-gray-400">
            Sign in with your Google account to get started
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-white hover:bg-gray-50 text-gray-900 font-medium py-4 px-6 rounded-xl border border-gray-300 flex items-center justify-center gap-3 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none mb-6"
        >
          {isLoading ? (
            <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          )}
          <span className="text-lg">
            {isLoading ? "Redirecting..." : "Continue with Google"}
          </span>
        </button>

        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3 text-gray-300">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="text-sm">Track your manga collection</span>
          </div>
          <div className="flex items-center gap-3 text-gray-300">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            <span className="text-sm">Discover new series</span>
          </div>
          <div className="flex items-center gap-3 text-gray-300">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm">Sync across all devices</span>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            By signing in, you agree to our{" "}
            <a href="#" className="text-blue-400 hover:text-blue-300">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-blue-400 hover:text-blue-300">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

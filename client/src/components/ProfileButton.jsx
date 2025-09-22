import { useState, useEffect, useRef } from "react";
import { checkAuthStatus } from "../utils/auth";
import { useNavigate } from "react-router-dom";
import { logout } from "../utils/auth";

export default function ProfileButton() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [username, setUsername] = useState("U");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const verifyAuth = async () => {
      const user = await checkAuthStatus();
      if (user) {
        setIsAuthenticated(true);
        setUsername(user.name[0]);
      } else {
        setIsAuthenticated(false);
      }
    };
    verifyAuth();
  }, []);

  // close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      setIsAuthenticated(false);
      navigate("/log-in");
    } catch (error) {
      console.error("Logout failed: ", error);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Profile button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-full bg-amber-400 h-9 w-9 text-black font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {username}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-4 w-40 rounded-lg bg-gray-900 border border-gray-700 shadow-lg overflow-hidden z-50">
          <ul className="flex flex-col py-2">
            {isAuthenticated ? (
              <>
                <li>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-800"
                  >
                    Dashboard
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => navigate("/wishlist")}
                    className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-800"
                  >
                    Wishlist
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => navigate("/profile")}
                    className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-800"
                  >
                    Profile
                  </button>
                </li>
                <li>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800"
                  >
                    Sign Out
                  </button>
                </li>
              </>
            ) : (
              <li>
                <button
                  onClick={() => navigate("/log-in")}
                  className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-800"
                >
                  Log in
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

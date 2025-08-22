import { useState } from "react";
import Logo from "../assets/logo.svg";

import ProfileButton from "./ProfileButton";

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="bg-black border-b border-gray-800">
      <div className="flex items justify-between px-6 py-4 mx-auto ">
        {/* Brand */}
        <a href="/" className="text-xl font-bold text-white no-underline">
          <div className="flex gap-4">
            <img src={Logo} className="max-w-8"></img>
            MangaCollector
          </div>
        </a>

        {/* Hamburger (mobile only) */}
        <button
          className="md:hidden text-white p-2 hover:bg-gray-800 rounded-md transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? (
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>

        {/* Desktop Nav */}
        <ul className="hidden md:flex items-center gap-4 text-base">
          <li>
            <ProfileButton />
          </li>
        </ul>
      </div>

      {/* Mobile Dropdown */}
      {isOpen && (
        <div className="md:hidden bg-gray-800 border-t border-gray-700">
          <ul className="flex flex-col px-6 py-4 space-y-3">
            <li>
              <a
                href="/log-in"
                className="block text-white hover:text-gray-300 transition-colors no-underline"
              >
                Profile
              </a>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

import { useState } from "react";
import Logo from "../assets/logo.svg";

import ProfileButton from "./ProfileButton";

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="bg-black border-b border-gray-800">
      <div className="flex justify-between px-6 py-4 mx-auto ">
        {/* Brand */}
        <a href="/" className="text-xl font-bold text-white no-underline">
          <div className="flex items-end gap-4">
            <img src={Logo} className="max-w-8"></img>
            MangaCollector
          </div>
        </a>

        {/* Nav */}
        <ul className=" flex items-center gap-4 text-base">
          <li>
            <ProfileButton />
          </li>
        </ul>
      </div>
    </nav>
  );
}

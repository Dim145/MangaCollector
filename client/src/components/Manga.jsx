import { useNavigate } from "react-router-dom";
import {hasToBlurImage} from "@/utils/library.js";

export default function Manga({ manga, showAdultContent }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={(e) => navigate("/mangapage", { state: {manga, showAdultContent} })}
      className="bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-4 flex flex-col shadow-xl hover:shadow-2xl hover:scale-105 transform transition-all duration-300 cursor-pointer group justify-between"
    >
      <div className="relative overflow-hidden rounded-lg mb-3">
        <img
          src={manga.image_url_jpg}
          alt={manga.name}
          className={`w-full h-auto rounded-lg shadow-md group-hover:scale-110 transition-transform duration-300 ${hasToBlurImage(manga, showAdultContent) ? "blur-sm" : ""}`}
        />
        {/* Subtle overlay on hover */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg" />
      </div>

      <div>
        <h3 className="font-semibold text-white mb-1 group-hover:text-gray-100 transition-colors">
          {manga.name}
        </h3>
        <p className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
          Volumes: {manga.volumes_owned ?? "?"} / {manga.volumes ?? "?"}
        </p>
      </div>
    </div>
  );
}

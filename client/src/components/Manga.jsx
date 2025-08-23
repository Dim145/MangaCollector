import { useNavigate } from "react-router-dom";

export default function Manga({ manga }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={(e) => navigate("/mangapage", { state: manga })}
      className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 rounded-2xl p-4 flex flex-col shadow-lg backdrop-blur-sm hover:scale-105 transform transition justify-between"
    >
      <img
        src={manga.image_url_jpg}
        alt={manga.name}
        className="rounded-lg mb-3 shadow-md"
      />
      <div>
        <h3 className="font-semibold mb-1">{manga.name}</h3>
        <p className="text-xs text-gray-400">Volumes: {manga.volumes ?? "?"}</p>
        <p className="text-xs text-gray-400">
          Volumes owned: {manga.volumes_owned}
        </p>
      </div>
    </div>
  );
}

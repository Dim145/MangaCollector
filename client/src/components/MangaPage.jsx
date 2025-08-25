import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  deleteMangaFromUserLibraryByID,
  getUserManga,
  updateMangaByID,
} from "../utils/user";

import Volume from "./Volume";
import { getAllVolumes } from "../utils/volume";

export default function MangaPage() {
  const navigate = useNavigate();
  const { state: manga } = useLocation();

  const [isEditing, setIsEditing] = useState(false);

  const [volumesOwned, setVolumesOwned] = useState(manga.volumes_owned ?? 0);
  const [totalVolumes, setTotalVolumes] = useState(manga.volumes ?? 0);
  const [additonalNotes, setAdditonalNotes] = useState("");
  const [volumes, setVolumes] = useState([]);

  useEffect(() => {
    async function getMangaInfo() {
      try {
        const response = await getUserManga(manga.mal_id);
        setTotalVolumes(response.volumes);
      } catch (error) {
        console.error(error);
      }
    }

    getMangaInfo();
  }, []);

  useEffect(() => {
    async function getVolumeInfo() {
      try {
        const response = await getAllVolumes(manga.mal_id);
        setVolumes(response);
      } catch (error) {
        console.error(error);
      }
    }

    if (totalVolumes > 0) {
      getVolumeInfo();
    }
  }, [isEditing]);

  const handleSave = async () => {
    try {
      console.log("Updated manga:");
      await updateMangaByID(manga.mal_id, totalVolumes);
    } catch (err) {
      console.error("Failed to update manga:", err);
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <div className="bg-gradient-to-b from-black via-gray-900 to-black min-h-screen text-white p-4 md:p-8">
      {/* Manga data */}
      <div className="flex flex-col md:flex-row gap-8 h-full items-stretch">
        <div className="w-full md:max-w-xs">
          <img
            src={manga.image_url_jpg}
            alt={manga.name}
            className="w-full h-full object-contain rounded-lg shadow-lg"
          />
        </div>

        {/* Right column: details + form */}
        <div className="flex-1 space-y-6">
          {/* Title + MAL ID */}
          <div>
            <h1 className="text-3xl font-bold">{manga.name}</h1>
            <p className="text-sm text-gray-400">MAL ID: {manga.mal_id}</p>
          </div>

          {/* Editable Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 mb-1">
                Total Volumes (Edit if there is discrepancy with the data)
              </label>
              <input
                type="number"
                value={totalVolumes}
                disabled={!isEditing}
                onChange={(e) => setTotalVolumes(Number(e.target.value))}
                className={`w-full px-3 py-2 rounded-lg border focus:outline-none ${
                  isEditing
                    ? "bg-gray-800 border-gray-700"
                    : "bg-gray-900 border-gray-800 text-gray-400 cursor-not-allowed"
                }`}
              />
            </div>

            <div>
              <label className="block text-gray-300 mb-1">Volumes Owned</label>
              <input
                type="number"
                value={volumesOwned}
                disabled={!isEditing}
                onChange={(e) => setVolumesOwned(Number(e.target.value))}
                className={`w-full px-3 py-2 rounded-lg border focus:outline-none ${
                  isEditing
                    ? "bg-gray-800 border-gray-700"
                    : "bg-gray-900 border-gray-800 text-gray-400 cursor-not-allowed"
                }`}
              />
            </div>

            <div>
              <label className="block text-gray-300 mb-1">
                Additional Notes:
              </label>
              <input
                type="text"
                value={additonalNotes}
                disabled={!isEditing}
                onChange={(e) => setAdditonalNotes(e.target.value)}
                placeholder="..."
                className={`w-full px-3 py-2 rounded-lg border focus:outline-none ${
                  isEditing
                    ? "bg-gray-800 border-gray-700"
                    : "bg-gray-900 border-gray-800 text-gray-400 cursor-not-allowed"
                }`}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-4">
            {!isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition"
                >
                  Edit
                </button>
                <button
                  onClick={async () => {
                    try {
                      console.log(`deleting : ${manga.mal_id}`);
                      await deleteMangaFromUserLibraryByID(manga.mal_id);
                      navigate("/dashboard");
                    } catch (error) {
                      console.error(error);
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-black font-semibold transition"
                >
                  Delete
                </button>
                <button
                  onClick={() => navigate("/dashboard")}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold transition"
                >
                  Save
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Volumes Section */}
      <div className="mt-10">
        <h2 className="text-2xl font-bold mb-4">Volumes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {volumes.map((vol) => (
            <Volume
              key={vol.id}
              owned={vol.owned}
              volNum={vol.vol_num}
              paid={vol.price}
              store={vol.store}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

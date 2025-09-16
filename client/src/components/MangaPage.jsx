import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  deleteMangaFromUserLibraryByID,
  getUserManga,
  updateMangaByID,
} from "../utils/user";

import Volume from "./Volume";
import { getAllVolumesByID, updateVolumeByID } from "../utils/volume";

export default function MangaPage() {
  const navigate = useNavigate();
  const { state: manga } = useLocation();

  const [isEditing, setIsEditing] = useState(false);
  const [totalVolumes, setTotalVolumes] = useState(manga.volumes ?? 0);
  const [volumesOwned, setVolumesOwned] = useState(manga.volumes_owned ?? 0);
  const [volumes, setVolumes] = useState([]);

  const [totalPrice, setTotalPrice] = useState(0);
  const [avgPrice, setAvgPrice] = useState(0);

  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addAvgPrice, setAddAvgPrice] = useState("");
  const [addStore, setAddStore] = useState("");

  useEffect(() => {
    async function getMangaInfo() {
      try {
        const response = await getUserManga(manga.mal_id);
        console.log(response);
        setTotalVolumes(response.volumes);
      } catch (error) {
        console.error(error);
      }
    }

    getMangaInfo();
  }, [isEditing, showAddDropdown]);

  useEffect(() => {
    async function getVolumeInfo() {
      try {
        const response = await getAllVolumesByID(manga.mal_id);
        const sortedVolumes = response.sort((a, b) => a.vol_num - b.vol_num);
        setVolumes(sortedVolumes);

        let counter = 0;
        let priceSum = 0;
        for (let vol of sortedVolumes) {
          if (vol.owned) {
            counter += 1;
            priceSum += Number(vol.price);
          }
        }
        setVolumesOwned(counter);
        setTotalPrice(priceSum.toFixed(2));
        setAvgPrice(counter > 0 ? priceSum / counter : 0);
      } catch (error) {
        console.error(error);
      }
    }

    if (totalVolumes > 0) {
      getVolumeInfo();
    }
    console.log(1);
  }, [isEditing, showAddDropdown]);

  const handleSave = async () => {
    try {
      console.log(`Updated manga: ${manga.mal_id}`);
      await updateMangaByID(manga.mal_id, totalVolumes);
    } catch (err) {
      console.error("Failed to update manga:", err);
    } finally {
      setIsEditing(false);
    }
  };
  const handleAddAllVolumes = async () => {
    if (addAvgPrice >= 0 && addStore.trim() !== "") {
      try {
        // Update manga first
        await updateMangaByID(manga.mal_id, totalVolumes);

        // Update all unowned volumes
        const updatedVolumes = await Promise.all(
          volumes.map(async (vol) => {
            if (!vol.owned) {
              await updateVolumeByID(vol.id, true, addAvgPrice, addStore);
              return {
                ...vol,
                owned: true,
                price: addAvgPrice,
                store: addStore,
              };
            }
            return vol;
          }),
        );

        // Update local state so React re-renders
        setVolumes(updatedVolumes);

        // Recalculate totals
        const counter = updatedVolumes.filter((v) => v.owned).length;
        const priceSum = updatedVolumes.reduce(
          (sum, v) => sum + Number(v.price || 0),
          0,
        );
        setVolumesOwned(counter);
        setTotalPrice(priceSum.toFixed(2));
        setAvgPrice(counter > 0 ? priceSum / counter : 0);
      } catch (error) {
        console.error(error);
      }

      setShowAddDropdown(false);
      setAddAvgPrice("");
      setAddStore("");
    } else {
      alert("Please enter valid average price and store.");
    }
  };

  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* BACKDROP LAYERS */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black via-gray-900 to-black" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.08),transparent_60%)]" />
      <div className="absolute inset-0 -z-10 backdrop-blur-3xl" />

      <div className="p-8 max-w-5xl mx-auto space-y-12">
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
                <label className="block text-gray-300 mb-1">
                  Volumes Owned
                </label>
                <input
                  type="number"
                  value={volumesOwned}
                  disabled={true}
                  onChange={(e) => setVolumesOwned(Number(e.target.value))}
                  className={`w-full px-3 py-2 rounded-lg border focus:outline-none bg-gray-900 border-gray-800 text-gray-400 cursor-not-allowed`}
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

        {/* Price Summary Section */}
        <div className="mt-10 p-4 rounded-lg bg-gray-900 border border-gray-700 shadow-md">
          <h2 className="text-xl font-semibold mb-2">Collection Summary</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="flex gap-4">
              <div>
                <p className="text-gray-400">Total Price Paid</p>
                <p className="text-lg font-bold">${totalPrice}</p>
              </div>
              <div>
                <p className="text-gray-400">Average Price per Owned Volume</p>
                <p className="text-lg font-bold">
                  {volumesOwned > 0 ? `$${avgPrice}` : "N/A"}
                </p>
              </div>
            </div>
            <div>
              {!showAddDropdown ? (
                <button
                  onClick={() => setShowAddDropdown(true)}
                  className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition"
                >
                  Add all volumes to collection
                </button>
              ) : (
                <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 space-y-3">
                  <div>
                    <label className="block text-gray-300 mb-1">
                      Average Price
                    </label>
                    <input
                      type="number"
                      value={addAvgPrice}
                      onChange={(e) => setAddAvgPrice(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">Store</label>
                    <input
                      type="text"
                      value={addStore}
                      onChange={(e) => setAddStore(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddAllVolumes}
                      className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold transition"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => {
                        setShowAddDropdown(false);
                        setAddAvgPrice("");
                        setAddStore("");
                      }}
                      className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-black font-semibold transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
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
                id={vol.id}
                volNum={vol.vol_num}
                owned={vol.owned}
                paid={vol.price}
                store={vol.store}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

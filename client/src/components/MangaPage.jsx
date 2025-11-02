import { useNavigate } from "react-router-dom";
import {Fragment, useContext, useEffect, useState} from "react";
import {
  deleteMangaFromUserLibraryByID,
  getUserManga, removePoster,
  updateMangaByID, uploadPoster,
} from "../utils/user";
import { updateLibFromMal, updateVolumeOwned } from "../utils/library.js";

import Volume from "./Volume";
import { getAllVolumesByID, updateVolumeByID } from "../utils/volume";
import DefaultBackground from "./DefaultBackground";
import { hasToBlurImage } from "@/utils/library.js";
import {formatCurrency} from "@/utils/price.js";
import SettingsContext from "@/SettingsContext.js";
import Modal from "@/components/utils/Modal.jsx";

export default function MangaPage({ manga, adult_content_level }) {
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [posterPopUp, setPosterPopUp] = useState(false);

  const [totalVolumes, setTotalVolumes] = useState(manga.volumes ?? 0);
  const [volumesOwned, setVolumesOwned] = useState(manga.volumes_owned ?? 0);
  const [poster, setPoster] = useState(manga.image_url_jpg);

  const [volumes, setVolumes] = useState([]);
  const {currency: currencySetting} = useContext(SettingsContext);

  const [totalPrice, setTotalPrice] = useState(0);
  const [avgPrice, setAvgPrice] = useState(0);
  const [genres, setGenres] = useState(manga.genres ?? []);

  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addAvgPrice, setAddAvgPrice] = useState("");
  const [addStore, setAddStore] = useState("");

  const [selectedImage, setSelectedImage] = useState(undefined);
  const [name, setName] = useState(manga.name || "Unknown Title");

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
  }, [manga.mal_id]);

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
      setTotalPrice(priceSum);
      setAvgPrice(counter > 0 ? priceSum / counter : 0);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    if (totalVolumes > 0) {
      getVolumeInfo();
    }
  }, [totalVolumes, isEditing]);

  const handleSave = async () => {
    try {
      setTotalVolumes(parseInt(totalVolumes));
      await updateMangaByID(manga.mal_id, totalVolumes);

      await getVolumeInfo();
      await updateVolumeOwned(manga.mal_id, volumesOwned);

      if(selectedImage)
      {
        await uploadPoster(manga.mal_id, selectedImage);

        const newPoster = `/api/user/storage/poster/${manga.mal_id}`;
        if(poster !== newPoster)
          setPoster(`/api/user/storage/poster/${manga.mal_id}`);
        else
          location.reload();
      }
      else if (selectedImage === null)
      {
        setPoster(await removePoster(manga.mal_id));
      }
    } catch (err) {
      console.error("Failed to update manga:", err);
    } finally {
      setIsEditing(false);
    }
  };

  const volumeUpdateCallback = async ({ owned }) => {
    let newOwned;

    if (!owned) {
      newOwned = Math.max(0, volumesOwned - 1);
    } else {
      newOwned = Math.min(totalVolumes, volumesOwned + 1);
    }

    setVolumesOwned(newOwned);
    await updateVolumeOwned(manga.mal_id, newOwned);
  };

  const handleAddAllVolumes = async () => {
    if (addAvgPrice >= 0 && addStore.trim() !== "") {
      try {
        // Update manga first
        await updateMangaByID(manga.mal_id, totalVolumes);

        // Update all unowned volumes
        const unownedVolumes = volumes.filter((vol) => !vol.owned);
        // Update all unowned volumes
        await Promise.all(
          unownedVolumes?.map((vol) =>
            updateVolumeByID(vol.id, true, addAvgPrice, addStore),
          ),
        );
        await getVolumeInfo();
        await updateVolumeOwned(manga.mal_id, volumesOwned);
      } catch (error) {
        console.error(error);
      } finally {
        setShowAddDropdown(false);
        setAddAvgPrice("");
        setAddStore("");
      }
    } else {
      alert("Please enter valid average price and store.");
    }
  };

  const updateFromMal = async (e) => {
    const target = e.target;

    // start rotation animation
    target.classList.add("animate-spin");

    const { new_genres, new_name } = await updateLibFromMal(manga.mal_id);

    if (new_genres)
      setGenres(new_genres);

    if (new_name)
      setName(new_name);

    // stop rotation animation
    target.classList.remove("animate-spin");
  };

  const handleSelectFile = (e) => {
    setSelectedImage(e.currentTarget.files[0]);
  };

  const removeImage = () => {
    setSelectedImage(null);
  }

  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      <DefaultBackground>
        <div className="p-8 max-w-6xl mx-auto space-y-12">
          {/* Manga data */}
          <div className="flex flex-col md:flex-row gap-8 h-full items-stretch">
            <div className="w-full md:max-w-xs text-right">
              {poster ? <Fragment>
                {!hasToBlurImage(manga, adult_content_level) ? <Modal
                  popupOpen={posterPopUp}
                  handleClose={() => setPosterPopUp(false)}
                  additionalClasses="m-2"
                >
                  <img
                    src={`${poster}`}
                    alt={name}
                    style={{
                      maxHeight: 'calc(100vh - 150px)',
                      height: '100vh'
                    }}
                    className="max-w-full object-contain rounded-lg shadow-lg"
                  />
                </Modal> : ""}
                <img
                  src={`${poster}`}
                  alt={name}
                  onClick={() => setPosterPopUp(true)}
                  className={`max-w-full max-h-full object-contain rounded-lg shadow-lg ${hasToBlurImage(manga, adult_content_level) ? "blur-sm" : "cursor-pointer"}`}
                />
              </Fragment>: ""}
              {isEditing && !`${poster}`.startsWith("http") ? <>
                <button
                  onClick={removeImage}
                  className="mt-2 w-full px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-black font-semibold absolute mt-O active:scale-95 transform transition-all duration-200 hover:scale-105"
                  style={{
                    top: "30px",
                    marginLeft: "-60px",
                    width: "55px",
                    height: "40px",

                  }}
                >
                  <svg className="w-6 h-6 text-gray-800 dark:text-white inline" aria-hidden="true"
                       xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M6 18 17.94 6M18 18 6.06 6"/>
                  </svg>
                </button>
              </> : null}
            </div>

            {/* Right column: details + form */}
            <div className="flex-1 space-y-6">
              {/* Title + MAL ID */}
              <div>
                <h1 className="text-3xl font-bold">{name}</h1>
                {manga.mal_id > 0 ? <p className="text-sm text-gray-400">
                  MAL ID: &nbsp;
                  <a
                    href={`https://myanimelist.net/manga/${manga.mal_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-white transition"
                  >
                    {manga.mal_id}
                  </a>
                  &nbsp;
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="transform size-6 inline cursor-pointer duration-1000 "
                    onClick={updateFromMal}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                </p> : ""}
              </div>

              <div>
                {(genres || []).map((genre) => (
                  <span
                    key={`genre-${genre}`}
                    className="inline-block bg-white/10 text-white text-xs font-medium mr-2 mb-2 px-3 py-1 rounded-full hover:bg-white/20 transition-colors duration-200"
                  >
                    {genre}
                  </span>
                ))}
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
                    className={`w-full px-3 py-2 rounded-lg border focus:outline-none ${isEditing ? "bg-gray-800 border-gray-700" : "bg-gray-900 border-gray-800 text-gray-400 cursor-not-allowed"}`}
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
                      className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition active:scale-95 transform duration-200 hover:scale-105"
                    >
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await deleteMangaFromUserLibraryByID(manga.mal_id);
                          navigate("/dashboard");
                        } catch (error) {
                          console.error(error);
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-black font-semibold transition active:scale-95 transform duration-200 hover:scale-105"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => navigate("/dashboard")}
                      className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition active:scale-95 transform duration-200 hover:scale-105"
                    >
                      Back
                    </button>
                  </>
                ) : (
                  <>
                    <label
                      className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition active:scale-95 transform duration-200 hover:scale-105"
                      htmlFor="poster"
                    >
                      <svg className="w-6 h-6 text-gray-800 dark:text-white inline" aria-hidden="true"
                           xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 5v9m-5 0H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2M8 9l4-5 4 5m1 8h.01"/>
                      </svg>
                      {selectedImage?.name ?? ""}
                      <input
                        id="poster"
                        type="file"
                        onChange={handleSelectFile}
                        accept="image/jpeg"
                        multiple={false}
                        hidden={true}
                        style={{display: 'none'}}
                      />
                    </label>
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold transition active:scale-95 transform duration-200 hover:scale-105"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Price Summary Section */}
          <div className="mt-10 p-6 rounded-lg bg-black/40 backdrop-blur-sm border border-white/20 hover:border-white/30 shadow-xl hover:shadow-2xl transition-all duration-200">
            <h2 className="text-xl font-semibold mb-4 text-white">
              Collection Summary
            </h2>
            <div className="flex flex-col lg:flex-row gap-6 justify-between">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="text-center sm:text-left">
                  <p className="text-gray-300 text-sm mb-1">Total Price Paid</p>
                  <p className="text-2xl font-bold text-white">
                    {formatCurrency(totalPrice, currencySetting)}
                  </p>
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-gray-300 text-sm mb-1">
                    Average Price per Owned Volume
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {volumesOwned > 0 ? `${formatCurrency(avgPrice, currencySetting)}` : "N/A"}
                  </p>
                </div>
              </div>
              <div className="flex-shrink-0">
                {!showAddDropdown ? (
                  <button
                    onClick={() => setShowAddDropdown(true)}
                    className="w-full lg:w-auto px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 active:bg-gray-300 hover:scale-105 active:scale-95 transform transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
                    Add All Volumes to Collection
                  </button>
                ) : (
                  <div className="p-4 bg-black/60 backdrop-blur-sm rounded-lg border border-white/30 space-y-4 min-w-[280px]">
                    <div>
                      <label className="block text-gray-200 text-sm font-medium mb-2">
                        Average Price per Volume ({currencySetting?.symbol || '$'})
                      </label>
                      <input
                        type="number"
                        value={addAvgPrice}
                        onChange={(e) => setAddAvgPrice(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/30 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/20 focus:bg-black/70 hover:bg-black/60 transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-200 text-sm font-medium mb-2">
                        Store/Location
                      </label>
                      <input
                        type="text"
                        value={addStore}
                        onChange={(e) => setAddStore(e.target.value)}
                        placeholder="Amazon, Bookstore, etc."
                        maxLength={50}
                        className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/30 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/20 focus:bg-black/70 hover:bg-black/60 transition-all duration-200"
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleAddAllVolumes}
                        className="flex-1 px-4 py-2 rounded-lg font-semibold bg-white text-black hover:bg-gray-200 active:bg-gray-300 hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => {
                          setShowAddDropdown(false);
                          setAddAvgPrice("");
                          setAddStore("");
                        }}
                        className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl"
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
              {(volumes || []).map((vol) => (
                <Volume
                  key={vol.id}
                  id={vol.id}
                  volNum={vol.vol_num}
                  owned={vol.owned}
                  paid={vol.price}
                  store={vol.store}
                  onUpdate={volumeUpdateCallback}
                  currencySetting={currencySetting}
                />
              ))}
            </div>
          </div>
        </div>
      </DefaultBackground>
    </div>
  );
}

import {useLocation, useNavigate} from "react-router-dom";
import {useEffect, useState} from "react";
import {
    deleteMangaFromUserLibraryByID, getUserManga, updateMangaByID,
} from "../utils/user";

import Volume from "./Volume";
import {getAllVolumesByID, updateVolumeByID} from "../utils/volume";
import DefaultBackground from "./DefaultBackground";
import {hasToBlurImage} from "@/utils/library.js";

export default function MangaPage({manga, showAdultContent}) {
    const navigate = useNavigate();

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
                const unownedVolumes = volumes.filter((vol) => !vol.owned);
                // Update all unowned volumes
                await Promise.all(unownedVolumes.map((vol) => updateVolumeByID(vol.id, true, addAvgPrice, addStore),),);
                await getVolumeInfo();
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

    return <div className="relative min-h-screen text-white overflow-hidden">
        <DefaultBackground>
            <div className="p-8 max-w-6xl mx-auto space-y-12">
                {/* Manga data */}
                <div className="flex flex-col md:flex-row gap-8 h-full items-stretch">
                    <div className="w-full md:max-w-xs">
                        <img
                            src={manga.image_url_jpg}
                            alt={manga.name}
                            className={`w-full h-full object-contain rounded-lg shadow-lg ${hasToBlurImage(manga, showAdultContent) ? "blur-sm" : ""}`}
                        />
                    </div>

                    {/* Right column: details + form */}
                    <div className="flex-1 space-y-6">
                        {/* Title + MAL ID */}
                        <div>
                            <h1 className="text-3xl font-bold">{manga.name}</h1>
                            <p className="text-sm text-gray-400">MAL ID: <a href={`https://myanimelist.net/manga/${manga.mal_id}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition">{manga.mal_id}</a></p>
                        </div>

                        <div>
                            {manga.genres?.map((genre) =>
                                <span
                                    key={`genre-${genre}`}
                                    className="inline-block bg-white/10 text-white text-xs font-medium mr-2 mb-2 px-3 py-1 rounded-full hover:bg-white/20 transition-colors duration-200"
                                >
                                {genre}
                            </span>)}
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
                            {!isEditing ? (<>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition"
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
                            </>) : (<>
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold transition"
                                >
                                    Save
                                </button>
                            </>)}
                        </div>
                    </div>
                </div>

                {/* Price Summary Section */}
                <div
                    className="mt-10 p-6 rounded-lg bg-black/40 backdrop-blur-sm border border-white/20 hover:border-white/30 shadow-xl hover:shadow-2xl transition-all duration-200">
                    <h2 className="text-xl font-semibold mb-4 text-white">
                        Collection Summary
                    </h2>
                    <div className="flex flex-col lg:flex-row gap-6 justify-between">
                        <div className="flex flex-col sm:flex-row gap-6">
                            <div className="text-center sm:text-left">
                                <p className="text-gray-300 text-sm mb-1">Total Price Paid</p>
                                <p className="text-2xl font-bold text-white">
                                    ${totalPrice.toFixed(2)}
                                </p>
                            </div>
                            <div className="text-center sm:text-left">
                                <p className="text-gray-300 text-sm mb-1">
                                    Average Price per Owned Volume
                                </p>
                                <p className="text-2xl font-bold text-white">
                                    {volumesOwned > 0 ? `$${avgPrice.toFixed(2)}` : "N/A"}
                                </p>
                            </div>
                        </div>
                        <div className="flex-shrink-0">
                            {!showAddDropdown ? (<button
                                onClick={() => setShowAddDropdown(true)}
                                className="w-full lg:w-auto px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 active:bg-gray-300 hover:scale-105 active:scale-95 transform transition-all duration-200 shadow-lg hover:shadow-xl"
                            >
                                Add All Volumes to Collection
                            </button>) : (<div
                                className="p-4 bg-black/60 backdrop-blur-sm rounded-lg border border-white/30 space-y-4 min-w-[280px]">
                                <div>
                                    <label className="block text-gray-200 text-sm font-medium mb-2">
                                        Average Price per Volume ($)
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
                            </div>)}
                        </div>
                    </div>
                </div>

                {/* Volumes Section */}
                <div className="mt-10">
                    <h2 className="text-2xl font-bold mb-4">Volumes</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {volumes.map((vol) => (<Volume
                            key={vol.id}
                            id={vol.id}
                            volNum={vol.vol_num}
                            owned={vol.owned}
                            paid={vol.price}
                            store={vol.store}
                        />))}
                    </div>
                </div>
            </div>
        </DefaultBackground>
    </div>
}

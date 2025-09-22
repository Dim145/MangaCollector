import { useState } from "react";

export default function MangaDetails({
  manga,
  totalVolumes,
  setTotalVolumes,
  volumesOwned,
  onSave,
  onDelete,
  onBack,
  isLoading,
}) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = async () => {
    try {
      await onSave();
    } catch (error) {
      console.error("Error saving:", error);
    } finally {
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    if (
      window.confirm(
        "Are you sure you want to delete this manga from your library?",
      )
    ) {
      try {
        await onDelete();
      } catch (error) {
        console.error("Error deleting:", error);
        alert("Failed to delete manga. Please try again.");
      }
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    // Reset to original value if needed
    setTotalVolumes(manga.volumes ?? 0);
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 items-stretch">
      {/* Manga Image */}
      <div className="w-full md:max-w-xs">
        <div className="relative group">
          <img
            src={manga.image_url_jpg}
            alt={manga.name}
            className="w-full h-full object-contain rounded-lg shadow-xl group-hover:shadow-2xl transition-shadow duration-300"
          />
          <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg" />
        </div>
      </div>

      {/* Manga Information */}
      <div className="flex-1 space-y-6">
        {/* Title Section */}
        <div className="bg-black/30 backdrop-blur-sm border border-white/20 hover:border-white/30 rounded-lg p-4 transition-all duration-200">
          <h1 className="text-3xl font-bold text-white mb-2 group-hover:text-gray-100 transition-colors">
            {manga.name}
          </h1>
          <p className="text-sm text-gray-400">MAL ID: {manga.mal_id}</p>
        </div>

        {/* Editable Form */}
        <div className="bg-black/30 backdrop-blur-sm border border-white/20 hover:border-white/30 rounded-lg p-4 space-y-4 transition-all duration-200">
          <h3 className="text-lg font-semibold text-white mb-2">
            Manga Details
          </h3>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              Total Volumes{" "}
              {isEditing && "(Edit if there is discrepancy with the data)"}
            </label>
            <input
              type="number"
              value={totalVolumes}
              disabled={!isEditing || isLoading}
              onChange={(e) => setTotalVolumes(Number(e.target.value))}
              min="0"
              className={`w-full px-3 py-2 rounded-lg border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/20 ${
                isEditing && !isLoading
                  ? "bg-black/50 border-white/30 text-white hover:bg-black/60 focus:bg-black/70"
                  : "bg-black/20 border-white/10 text-gray-400 cursor-not-allowed"
              }`}
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              Volumes Owned (Auto-calculated)
            </label>
            <input
              type="number"
              value={volumesOwned}
              disabled={true}
              className="w-full px-3 py-2 rounded-lg border bg-black/20 border-white/10 text-gray-400 cursor-not-allowed transition-all duration-200"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {!isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(true)}
                disabled={isLoading}
                className="px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 active:bg-gray-300 hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                Edit Details
              </button>

              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-semibold hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isLoading ? "Deleting..." : "Delete from Library"}
              </button>

              <button
                onClick={onBack}
                disabled={isLoading}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 font-semibold hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                Back to Dashboard
              </button>
            </>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={isLoading}
                className={`px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 active:bg-gray-300 hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                  isLoading ? "animate-pulse" : ""
                }`}
              >
                {isLoading ? "Saving..." : "Save Changes"}
              </button>

              <button
                onClick={handleCancel}
                disabled={isLoading}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 font-semibold hover:scale-105 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Status Indicators */}
        <div className="bg-black/20 backdrop-blur-sm border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${volumesOwned > 0 ? "bg-white" : "bg-gray-500"}`}
              />
              <span className="text-gray-300">
                Collection Status: {volumesOwned > 0 ? "Active" : "Empty"}
              </span>
            </div>
            <span className="text-gray-400">
              {volumesOwned}/{totalVolumes} volumes owned
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

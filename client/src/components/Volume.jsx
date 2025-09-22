import { useState, useEffect } from "react";
import { updateVolumeByID } from "../utils/volume";

export default function Volume({ id, owned, volNum, paid, store, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(owned);
  const [price, setPrice] = useState(paid);
  const [purchaseLocation, setPurchaseLocation] = useState(store);
  const [isLoading, setIsLoading] = useState(false);

  async function updateVolume() {
    try {
      setIsLoading(true);
      await updateVolumeByID(id, ownedStatus, price, purchaseLocation);
      if (onUpdate) {
        onUpdate({
          id,
          owned: ownedStatus,
          paid: price,
          store: purchaseLocation,
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSave = () => {
    setIsEditing(false);
    updateVolume();
  };

  const handleCancel = () => {
    setIsEditing(false);
    // Reset to original values
    setOwnedStatus(owned);
    setPrice(paid);
    setPurchaseLocation(store);
  };

  useEffect(() => {
    // Update local state when props change
    setOwnedStatus(owned);
    setPrice(paid);
    setPurchaseLocation(store);
  }, [owned, paid, store]);

  return (
    <div className="bg-black/40 hover:bg-black/50 backdrop-blur-sm border border-white/20 hover:border-white/30 rounded-lg p-4 flex flex-col gap-4 shadow-lg hover:shadow-xl transition-all duration-200 group">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-white group-hover:text-gray-100 transition-colors">
          Volume {volNum}
        </h2>

        {isEditing ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200
                bg-white text-black hover:bg-gray-200 active:bg-gray-300
                hover:scale-105 active:scale-95 shadow-md hover:shadow-lg
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                ${isLoading ? "animate-pulse" : ""}
              `}
            >
              {isLoading ? "Saving..." : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 hover:scale-105 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 hover:scale-105 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg"
          >
            Edit
          </button>
        )}
      </div>

      {/* Form Fields */}
      <div className="space-y-3">
        {/* Owned Selector */}
        <div>
          <label className="block text-sm text-gray-300 mb-1.5 font-medium">
            Owned Status
          </label>
          <select
            value={ownedStatus ? "yes" : "no"}
            disabled={!isEditing}
            onChange={(e) => setOwnedStatus(e.target.value === "yes")}
            className={`
              w-full px-3 py-2 rounded-lg border transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-white/20
              ${
                isEditing
                  ? "bg-black/50 border-white/30 text-white hover:bg-black/60 focus:bg-black/70"
                  : "bg-black/20 border-white/10 text-gray-400 cursor-not-allowed"
              }
            `}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        {/* Price Input */}
        <div>
          <label className="block text-sm text-gray-300 mb-1.5 font-medium">
            Price ($)
          </label>
          <input
            type="number"
            value={price}
            disabled={!isEditing}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            className={`
              w-full px-3 py-2 rounded-lg border transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-white/20
              ${
                isEditing
                  ? "bg-black/50 border-white/30 text-white placeholder-gray-400 hover:bg-black/60 focus:bg-black/70"
                  : "bg-black/20 border-white/10 text-gray-400 cursor-not-allowed"
              }
            `}
          />
        </div>

        {/* Store Input */}
        <div>
          <label className="block text-sm text-gray-300 mb-1.5 font-medium">
            Store/Location
          </label>
          <input
            type="text"
            maxLength={30}
            value={purchaseLocation}
            disabled={!isEditing}
            onChange={(e) => setPurchaseLocation(e.target.value)}
            placeholder="Amazon, Bookstore, etc."
            className={`
              w-full px-3 py-2 rounded-lg border transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-white/20
              ${
                isEditing
                  ? "bg-black/50 border-white/30 text-white placeholder-gray-400 hover:bg-black/60 focus:bg-black/70"
                  : "bg-black/20 border-white/10 text-gray-400 cursor-not-allowed"
              }
            `}
          />
        </div>
      </div>
    </div>
  );
}

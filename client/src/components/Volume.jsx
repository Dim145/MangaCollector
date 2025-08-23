import { useState, useEffect, use } from "react";

export default function Volume({ volNum }) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(false);
  const [price, setPrice] = useState(0);
  const [purchaseLocation, setPurchaseLocation] = useState("");

  return (
    <div className="border border-gray-700 rounded-lg p-4 flex flex-col gap-3 bg-gray-900 shadow-sm">
      <div className="flex justify-between">
        <h2 className="text-lg font-semibold">Volume {volNum}</h2>
        {isEditing ? (
          <div className="flex gap-3">
            <button
              onClick={(e) => setIsEditing(false)}
              className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold transition"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-black font-semibold transition"
          >
            Edit
          </button>
        )}
      </div>
      {/* Owned Selector */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Owned</label>
        <select
          value={ownedStatus ? "yes" : "no"}
          disabled={!isEditing}
          onChange={(e) => {
            if (e.target.value === "yes") {
              setOwnedStatus(true);
            } else {
              setOwnedStatus(false);
            }
          }}
          className={`w-full px-2 py-1 rounded border ${
            isEditing
              ? "bg-gray-800 border-gray-700"
              : "bg-gray-900 border-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>

      {/* Price Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Price</label>
        <input
          type="number"
          value={price}
          disabled={!isEditing}
          onChange={(e) => {
            setPrice(e.target.value);
          }}
          placeholder="0.00"
          className={`w-full px-2 py-1 rounded border focus:outline-none ${
            isEditing
              ? "bg-gray-800 border-gray-700"
              : "bg-gray-900 border-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        />
      </div>

      {/* Store Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Store</label>
        <input
          type="text"
          maxLength={30}
          value={purchaseLocation}
          disabled={!isEditing}
          onChange={(e) => setPurchaseLocation(e.target.value)}
          placeholder="Amazon, Bookstore..."
          className={`w-full px-2 py-1 rounded border focus:outline-none ${
            isEditing
              ? "bg-gray-800 border-gray-700"
              : "bg-gray-900 border-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        />
      </div>
    </div>
  );
}

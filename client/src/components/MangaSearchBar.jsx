import React from "react";

export default function MangaSearchBar({
  query,
  setQuery,
  searchManga,
  clearResults,
  loading,
  hasResults,
}) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      searchManga();
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search manga..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-4 py-3 rounded-2xl bg-black/50 hover:bg-black/60 focus:bg-black/70 text-white placeholder-gray-400 border border-white/20 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 backdrop-blur-sm transition-all duration-200"
          />
          {/* Search Icon */}
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 sm:gap-3">
          {/* Search Button */}
          <button
            onClick={searchManga}
            className={`
              flex-1 sm:flex-none px-5 py-3 rounded-2xl font-semibold text-black
              bg-white hover:bg-gray-200 active:bg-gray-300
              hover:scale-105 active:scale-95 transform transition-all duration-200
              shadow-lg hover:shadow-xl
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
              ${loading ? "animate-pulse" : ""}
            `}
            disabled={loading}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Searching...
              </div>
            ) : (
              "Search"
            )}
          </button>

          {/* Clear Button */}
          {hasResults && (
            <button
              onClick={clearResults}
              className="flex-1 sm:flex-none px-5 py-3 rounded-2xl font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 hover:scale-105 active:scale-95 transform transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

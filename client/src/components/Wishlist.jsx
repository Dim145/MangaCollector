export default function Wishlist() {
  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* BACKDROP LAYERS */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black via-gray-900 to-black" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.08),transparent_60%)]" />
      <div className="absolute inset-0 -z-10 backdrop-blur-3xl" />

      <div className="p-8 max-w-5xl mx-auto space-y-12">
        <p>Coming Soon</p>
      </div>
    </div>
  );
}

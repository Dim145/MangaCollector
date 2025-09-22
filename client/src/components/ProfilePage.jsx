import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { getAllVolumes } from "../utils/volume";
import { getUserLibrary } from "../utils/user";
import DefaultBackground from "./DefaultBackground";

export default function ProfilePage({ googleUser }) {
  const defaultSeriesData = [
    {
      title: "None",
      totalCost: 0,
    },
  ];
  const [volumes, setVolumes] = useState([]);
  const [totalSeries, setTotalSeries] = useState(0);
  const [totalVolumes, setTotalVolumes] = useState(0);
  const [totalVolumesOwned, setTotalVolumesOwned] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);
  const [seriesByCost, setSeriesByCost] = useState(defaultSeriesData);

  const stats = [
    { label: "Series Owned", value: totalSeries },
    { label: "Volumes Owned", value: `${totalVolumesOwned} / ${totalVolumes}` },
    { label: "Library Cost", value: `$${totalCost.toLocaleString()}` },
    { label: "Completion Rate", value: `${completionRate}%` },
  ];

  // Donut chart for completion
  const completionData = [
    { name: "Owned", value: completionRate },
    { name: "Missing", value: 100 - completionRate },
  ];
  const COLORS = ["#60a5fa", "#374151"]; // blue + gray

  useEffect(() => {
    async function loadData() {
      try {
        const [library, volumeData] = await Promise.all([
          getUserLibrary(),
          getAllVolumes(),
        ]);

        setTotalSeries(library.length);
        setVolumes(volumeData);
        setTotalVolumes(volumeData.length);

        let totalOwnedCounter = 0;
        let totalCostCounter = 0;
        let costMap = {}; // Title : Cost

        // build quick lookup from mal_id → title
        const titleMap = {}; // mal_id : title
        for (let series of library) {
          titleMap[series.mal_id] = series.name;
        }

        for (let vol of volumeData) {
          if (vol.owned) {
            totalOwnedCounter += 1;
            totalCostCounter += Number(vol.price);

            const title = titleMap[vol.mal_id] || "Unknown";
            if (!costMap[title]) {
              costMap[title] = 0;
            }
            costMap[title] += Number(vol.price);
          }
        }

        setTotalVolumesOwned(totalOwnedCounter);
        setTotalCost(totalCostCounter);
        setCompletionRate(
          Number(((totalOwnedCounter / volumeData.length) * 100).toFixed(2)) ||
            100,
        );

        // top 4 series by cost
        const sortedSeries = Object.entries(costMap)
          .map(([title, totalCost]) => {
            // Take the first word and truncate to 8 characters
            const truncatedTitle = title.split(" ")[0].slice(0, 8);
            return { title: truncatedTitle, totalCost };
          })
          .sort((a, b) => b.totalCost - a.totalCost)
          .slice(0, 4);

        if (sortedSeries.length == 0) {
          setSeriesByCost(defaultSeriesData);
        } else {
          setSeriesByCost(sortedSeries);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadData();
  }, []);

  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      <DefaultBackground>

      {/* CONTENT */}
      <div className="p-8 max-w-6xl mx-auto space-y-12">
        {/* Header */}
        <header className="text-center space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight drop-shadow-md">
            {googleUser.name}’s Library
          </h1>
          <p className="text-gray-400">Your manga collection at a glance</p>
        </header>

        {/* Analytics Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 p-6 shadow-lg backdrop-blur-sm hover:scale-[1.02] transform transition"
            >
              <p className="text-gray-400 text-sm">{stat.label}</p>
              <p className="text-2xl font-bold mt-2">{stat.value}</p>
            </div>
          ))}
        </section>

        {/* Charts Section */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Donut Chart */}
          <div className="rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 p-6 shadow-lg backdrop-blur-sm">
            <h2 className="text-xl font-semibold mb-4">Completion Rate</h2>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={completionData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                >
                  {completionData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <p className="text-center text-lg font-bold mt-2">
              {completionRate}% Complete
            </p>
          </div>

          {/* Series Price Distribution */}
          <div className="rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 p-6 shadow-lg backdrop-blur-sm">
            <h2 className="text-xl font-semibold mb-4">
              Top 4 Series Price Distribution
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={seriesByCost}>
                <XAxis dataKey="title" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip />
                <Bar dataKey="totalCost" fill="#60a5fa" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Future Activity Feed */}
        <section className="rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 p-6 shadow-lg backdrop-blur-sm">
          <h2 className="text-xl font-semibold mb-4">Activity Feed</h2>
          <p className="text-gray-400 text-sm">
            Coming soon: your latest manga additions, updates, and more.
          </p>
        </section>
      </div>
      </DefaultBackground>
    </div>
  );
}

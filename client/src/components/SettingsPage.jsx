import { Fragment, useEffect, useRef, useState } from "react";
import { getUserSettings, updateSettings } from "@/utils/user.js";
import {formatCurrency} from "@/utils/price.js";

export default function SettingsPage({settingsUpdateCallback}) {
  const [showAdultContent, setShowAdultContent] = useState(false);
  const [currencyObject, setCurrencyObject] = useState(null);

  let fetching = useRef(true);

  useEffect(() => {
    async function fetchData() {
      const settings = await getUserSettings(true);

      setShowAdultContent(settings["show-adult-content"] || false);
      setCurrencyObject(settings["currency"]);
    }

    fetchData().then(() => setTimeout(() => (fetching.current = false), 100));
  }, []);

  useEffect(() => {
    async function updateSetting() {
      try {
        const newSettings = {
          showAdultContent,
          currency: currencyObject,
        }

        await updateSettings(newSettings);

        if (settingsUpdateCallback) {
          settingsUpdateCallback(newSettings);
        }
      } catch (error) {
        console.error("Error updating setting:", error);
      }
    }

    if (!fetching.current) {
      updateSetting();
    }
  }, [fetching, showAdultContent]);

  const handleCurrencyChange = async (e) => {
    const selectedCurrency = e.target.value;

    const res = await updateSettings({
      showAdultContent,
      currency: { code: selectedCurrency },
    });

    if (settingsUpdateCallback) {
      settingsUpdateCallback(res);
    }

    setCurrencyObject(res.currency);
  };

  return (
    <Fragment>
      <div className="max-w-3xl mx-auto p-6 bg-opacity-80 mt-10 rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 shadow-lg backdrop-blur-sm hover:scale-[1.02] transform transition text-white">
        <h1 className="text-3xl font-bold mb-6">Settings</h1>
        <div className="mb-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={showAdultContent}
              onChange={() => setShowAdultContent(!showAdultContent)}
              className="form-checkbox h-5 w-5 text-blue-600"
            />
            <span className="ml-2">Show Adult Content</span>
          </label>
        </div>
        {/* Additional settings can be added here */}

        <div className="mb-4">
          <label className="flex items-center">
            <span className="ml-2">Display currency: </span>
            <select
              className="form-select h-10 w-48 ml-2 rounded border-2 border-solid border-gray-300 focus:border-blue-500 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              value={currencyObject?.code}
              onChange={handleCurrencyChange}
            >
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
            </select>
          </label>

          <span className="ml-2 pl-2">
              Exemple: {formatCurrency(165.182, currencyObject)}
            </span>
        </div>
      </div>
    </Fragment>
  );
}

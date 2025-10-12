import DefaultBackground from "@/components/DefaultBackground.jsx";
import {Fragment, useEffect, useRef, useState} from "react";
import {getShowAdultContent, updateShowAdultContent} from "@/utils/user.js";

export default function SettingsPage() {
    const [showAdultContent, setShowAdultContent] = useState(false);

    let fetching = useRef(true)

    useEffect(() => {
        async function fetchData() {
            setShowAdultContent(await getShowAdultContent())
        }

        fetchData().then(() => setTimeout(
            () => fetching.current = false, 100
        ));
    }, []);

    useEffect(() => {
        async function updateSetting() {
            try {
                await updateShowAdultContent(showAdultContent)
            } catch (error) {
                console.error('Error updating setting:', error);
            }
        }

        if (!fetching.current) {
            updateSetting();
        }
    }, [fetching, showAdultContent]);

    return <Fragment>
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
        </div>
    </Fragment>
}

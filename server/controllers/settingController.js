const settings = require("../services/settings");

async function getUserSettings(req, res) {
    try {
        const user_id = req.user.id;
        const response = await settings.getUserSettings(user_id);
        return res.json(response);
    } catch (err) {
        return res.json({
                success: false,
                error: err.message || "Error fetching user's settings",
            }
        );
    }
}

async function updateUserSettings(req, res) {
    try {
        const user_id = req.user.id;
        const newSettings = req.body;

        const response = await settings.updateUserSettings(user_id, newSettings);
        return res.json(response);
    }
    catch (err) {
        return res.json({
            success: false,
            error: err.message || "Error updating user's settings",
        });
    }
}

module.exports = {
    getUserSettings,
    updateUserSettings
}

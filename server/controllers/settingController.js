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

module.exports = {
    getUserSettings
}

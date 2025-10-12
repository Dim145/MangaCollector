const userModel = require('../db/models/user');

module.exports = {
    getUserSettings: async (userId) => {
        const user = await userModel
            .query()
            .findById(userId);

        return {
            "show-adult-content": !!user["show-adult-content"]
        }
    },
    updateUserSettings: async (userId, newSettings) => {
        const updatedRows = await userModel
            .query()
            .patchAndFetchById(userId, {
                "show-adult-content": newSettings["show-adult-content"]
            });

        return {
            "show-adult-content": !!updatedRows["show-adult-content"]
        }
    }
}

const userModel = require('../db/models/user');

module.exports = {
    getUserSettings: async (userId) => {
        const user = await userModel
            .query()
            .findById(userId);

        return {
            "show-adult-content": !!user["show-adult-content"]
        }
    }
}

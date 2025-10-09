const userModel = require('../db/models/user');


module.exports = {
    create: (userData) => {
        return userModel
            .query()
            .insertAndFetch(userData)
    },

    update: (id, userData) => {
        return userModel
            .query()
            .patchAndFetchById(id, userData)
    },
    get: id => userModel
        .query()
        .findById(id),

    delete: id => userModel
        .query()
        .deleteById(id)
}

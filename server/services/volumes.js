const volumeModel = require('../db/models/user_volume');

module.exports = {
    getAllVolumesForUser: (user_id) => volumeModel
        .query()
        .where('user_id', user_id),

    getAllVolumesForUserById: (user_id, mal_id) => volumeModel
        .query()
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id),

    updateVolumeById: (id, owned, price, store) => volumeModel
        .query()
        .patchAndFetchById(id, { owned, price, store })
}

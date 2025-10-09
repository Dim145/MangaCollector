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
        .patchAndFetchById(id, { owned, price, store }),

    addVolumeToUser: (user_id, mal_id, vol_num) => volumeModel
        .query()
        .insertAndFetch({ user_id, mal_id, vol_num, owned: false, price: 0, store: "" }),

    deleteAllByIdForUser: (user_id, mal_id) => volumeModel
        .query()
        .delete()
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id),

    removeVolumeByID: (mal_id, user_id, vol_num) => volumeModel
        .query()
        .delete()
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id)
        .andWhere('vol_num', vol_num),
}

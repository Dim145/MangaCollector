const libraryModel = require('../db/models/user_librarie')

const volumes = require('./volumes');

const libraryService = {
    getUserLibrary: user_id => libraryModel
        .query()
        .where('user_id', user_id),

    getUserManga: (mal_id, user_id) => libraryModel
        .query()
        .where('mal_id', mal_id)
        .andWhere('user_id', user_id),

    addToUserLibrary: async (user_id, mangaData) => {
        const { name, mal_id, volumes, volumes_owned, image_url_jpg } = mangaData;

        const lib = await libraryModel
            .query()
            .insertAndFetch({ user_id, mal_id, name, volumes, volumes_owned, image_url_jpg });

        for(let i = 1; i <= volumes; i++) {
            await volumes.addVolumeToUser(user_id, mal_id, i);
        }

        return lib;
    },

    deleteMangaFromUserLibraryByID: async (mal_id, user_id) => {
        await libraryModel
            .query()
            .delete()
            .where('user_id', user_id)
            .andWhere('mal_id', mal_id);

        await volumes.deleteAllByIdForUser(user_id, mal_id);
    },

    getTotalVolumesById: (mal_id, user_id) => libraryModel
        .query()
        .select('volumes')
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id)
        .first(),

    updateMangaById: async (mal_id, user_id, volumes) => {
        const oldTotal = await libraryService.getTotalVolumesById(mal_id, user_id);

        if(oldTotal === volumes)
        {
            return;
        }
        else if (oldTotal > volumes)
        {
            for (let i = oldTotal; i > volumes; i--) {
                await volumes.removeVolumeByID(mal_id, user_id, i);
            }
        }
        else if (volumes < volumes)
        {
            for (let i = oldTotal + 1; i <= volumes; i++) {
                await volumes.addVolumeToUser(user_id, mal_id, i);
            }
        }

        await libraryModel
            .query()
            .where('user_id', user_id)
            .andWhere('mal_id', mal_id)
            .patch({ volumes });
    },

    updateMangaOwned: (user_id, mal_id, volumes_owned) => libraryModel
        .query()
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id)
        .patch({ volumes_owned }),
}

module.exports = libraryService;

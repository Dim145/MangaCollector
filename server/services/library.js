const libraryModel = require('../db/models/user_librarie')

const volumesService = require('./volumes');

const libraryService = {
    getUserLibrary: user_id => libraryModel
        .query()
        .where('user_id', user_id)
        .runAfter((result, query) => {
            return result.map(manga => ({
                ...manga,
                genres: manga.genres ? manga.genres.split(',') : [],
            }));
        }),

    getUserManga: (mal_id, user_id) => libraryModel
        .query()
        .where('mal_id', mal_id)
        .andWhere('user_id', user_id)
        .runAfter((result, query) => {
            return result.map(manga => ({
                ...manga,
                genres: manga.genres ? manga.genres.split(',') : [],
            }));
        }),

    addToUserLibrary: async (user_id, mangaData) => {
        const { name, mal_id, volumes, volumes_owned, image_url_jpg, genres } = mangaData;

        const lib = await libraryModel
            .query()
            .insertAndFetch({
                user_id,
                mal_id,
                name,
                volumes,
                volumes_owned,
                image_url_jpg,
                genres: (genres || []).join(',')
            });

        for(let i = 1; i <= volumes; i++) {
            await volumesService.addVolumeToUser(user_id, mal_id, i);
        }

        return lib;
    },

    deleteMangaFromUserLibraryByID: async (mal_id, user_id) => {
        await libraryModel
            .query()
            .delete()
            .where('user_id', user_id)
            .andWhere('mal_id', mal_id);

        await volumesService.deleteAllByIdForUser(user_id, mal_id);
    },

    getTotalVolumesById: (mal_id, user_id) => libraryModel
        .query()
        .select('volumes')
        .where('user_id', user_id)
        .andWhere('mal_id', mal_id)
        .first(),

    updateMangaById: async (mal_id, user_id, volumes) => {
        const oldTotal = (await libraryService.getTotalVolumesById(mal_id, user_id))?.volumes;

        if(oldTotal === volumes)
        {
            return;
        }
        else if (oldTotal > volumes)
        {
            for (let i = oldTotal; i > volumes; i--) {
                await volumesService.removeVolumeByID(mal_id, user_id, i);
            }
        }
        else if (oldTotal < volumes)
        {
            for (let i = oldTotal + 1; i <= volumes; i++) {
                await volumesService.addVolumeToUser(user_id, mal_id, i);
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

    updateInfosFromMal: async mal_id => {
        const libraries = await libraryModel
            .query()
            .where('mal_id', mal_id);

        const malInfoResponse = await fetch(`https://api.jikan.moe/v4/manga/${mal_id}/full`);
        const malInfoData = await malInfoResponse.json();
        const malInfo = malInfoData.data;

        if (!malInfo) {
            throw new Error('MAL info not found');
        }

        const genres = (malInfo.genres || []).filter(g => g.type === "manga").map(g => g.name);
        const volumes = malInfo.volumes;

        for (const lib of libraries) {
            if (volumes && lib.volumes !== volumes) {
                await libraryService.updateMangaById(lib.mal_id, lib.user_id, volumes)
            }

            await libraryModel
                .query()
                .where('id', lib.id)
                .patch({
                    genres: genres.join(',')
                });
        }

        return genres;
    }
}

module.exports = libraryService;

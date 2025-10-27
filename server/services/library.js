const libraryModel = require('../db/models/user_librarie')

const volumesService = require('./volumes');
const settingsService = require('./settings');

const {getMangaFromMal} = require("../lib/mal-api");

const libraryService = {
    getUserLibrary: user_id => libraryModel
        .query()
        .where('user_id', user_id)
        .runAfter((result, _) => {
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
            })
            .runAfter((result, query) => {
              return {
                ...result,
                genres: result.genres ? result.genres.split(',') : [],
              };
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

    updateInfosFromMal: async (user_id, mal_id) => {
        const malInfo = await getMangaFromMal(mal_id);

        if (!malInfo) {
            throw new Error('MAL info not found');
        }

        const libraries = await libraryModel
          .query()
          .where('mal_id', mal_id)
          .andWhere('user_id', user_id);

        const genres = (malInfo.genres || [])
          .concat(malInfo.demographics)
          .concat(malInfo.explicit_genres)
          .filter(g => g.type === "manga")
          .map(g => g.name);

        const volumes = malInfo.volumes;

        const settings = await settingsService.getUserSettings(user_id);

        const titleFromMal = malInfo.titles.find(t => t.type === settings.titleType)?.title || malInfo.title;

        for (const lib of libraries) {
            if (volumes && lib.volumes !== volumes) {
                await libraryService.updateMangaById(lib.mal_id, lib.user_id, volumes)
            }

            const patchObj = {
              genres: genres.join(','),
              name: titleFromMal,
            };

            if(!lib.image_url_jpg)
            {
              patchObj.image_url_jpg = malInfo.images?.jpg?.image_url;
            }

            await libraryModel
                .query()
                .where('id', lib.id)
                .patch(patchObj);
        }

        return {
          genres,
          name: titleFromMal
        };
    },

    changePoster: async (user_id, mal_id, newPosterPath) => {
        await libraryModel
            .query()
            .where('user_id', user_id)
            .andWhere('mal_id', mal_id)
            .patch({
              image_url_jpg: newPosterPath
            });
    },

    search: (user_id, query) => {
        return libraryModel
          .query()
          .where('user_id', user_id)
          .andWhereILike('name', `%${`${query}`.toLowerCase()}%`)
          .runAfter((result, _) => {
            return result.map(manga => ({
              ...manga,
              genres: manga.genres ? manga.genres.split(',') : [],
            }));
          });
    },

    addCustomEntryToLib: async (user_id, mangaData) => {
      const { name, volumes, volumes_owned, genres } = mangaData;

      const customEntryCount = await libraryModel
        .query()
        .where('user_id', user_id)
        .andWhere('mal_id', '<', 0)
        .min('mal_id')
        .first()
        .then(res => res.min || 0);

      const mal_id = customEntryCount - 1;

      return await libraryService.addToUserLibrary(user_id, {
        name,
        mal_id,
        volumes,
        volumes_owned,
        image_url_jpg: null,
        genres
      });
    }
}

module.exports = libraryService;

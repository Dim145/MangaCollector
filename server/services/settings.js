const settingModel = require('../db/models/setting');
const {getCurrencyByCode} = require("../lib/price");
const {TITLE_TYPE} = require("../lib/titleType");

module.exports = {
    getUserSettings: async (userId) => {
        const settings = await settingModel
            .query()
            .where('user_id', userId)
            .first();

        return {
            "currency": getCurrencyByCode(settings.currency),
            "titleType": settings?.titleType || TITLE_TYPE.Default,
            "adult_content_level": settings?.adult_content_level || 0
        }
    },
    updateUserSettings: async (userId, newSettings) => {
      let res;

      if (await settingModel.query().where('user_id', userId).first() === undefined) {
          res = await settingModel.query().insert({
              user_id: userId,
              currency: getCurrencyByCode(newSettings.currency)?.code || 'USD',
              titleType: newSettings.titleType || TITLE_TYPE.Default,
            adult_content_level: newSettings.adult_content_level
          })
      }
      else {
        res = await settingModel
          .query()
          .where('user_id', userId)
          .patch({
            "currency": getCurrencyByCode(newSettings.currency)?.code || 'USD',
            "titleType": newSettings.titleType || TITLE_TYPE.Default,
            "adult_content_level": newSettings.adult_content_level
          });

        if(res > 0) {
          res = await settingModel
            .query()
            .where('user_id', userId)
            .first();
        }
      }

        return {
            "currency": getCurrencyByCode(res.currency),
            "titleType": res.titleType || TITLE_TYPE.Default,
            "adult_content_level": res.adult_content_level || 0
        }
    }
}

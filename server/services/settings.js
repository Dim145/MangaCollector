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
            "show-adult-content": !!settings["show-adult-content"],
            "currency": getCurrencyByCode(settings.currency),
            "titleType": settings.titleType || TITLE_TYPE.Default
        }
    },
    updateUserSettings: async (userId, newSettings) => {
      let res;

      if (await settingModel.query().where('user_id', userId).first() === undefined) {
          res = await settingModel.query().insert({
              user_id: userId,
              "show-adult-content": newSettings["show-adult-content"],
              currency: getCurrencyByCode(newSettings.currency)?.code || 'USD',
              titleType: newSettings.titleType || TITLE_TYPE.Default
          })
      }
      else {
        res = await settingModel
          .query()
          .where('user_id', userId)
          .patch({
            "show-adult-content": newSettings["show-adult-content"],
            "currency": getCurrencyByCode(newSettings.currency)?.code || 'USD',
            "titleType": newSettings.titleType || TITLE_TYPE.Default
          });

        if(res > 0) {
          res = await settingModel
            .query()
            .where('user_id', userId)
            .first();
        }
      }

        return {
            "show-adult-content": !!res["show-adult-content"],
            "currency": getCurrencyByCode(res.currency),
            "titleType": res.titleType || TITLE_TYPE.Default
        }
    }
}

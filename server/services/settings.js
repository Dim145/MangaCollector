const settingModel = require('../db/models/setting');
const {getCurrencyByCode} = require("../lib/price");

module.exports = {
    getUserSettings: async (userId) => {
        const settings = await settingModel
            .query()
            .where('user_id', userId)
            .first();

        return {
            "show-adult-content": !!settings["show-adult-content"],
            "currency": getCurrencyByCode(settings.currency)
        }
    },
    updateUserSettings: async (userId, newSettings) => {
      let res;

      if (await settingModel.query().where('user_id', userId).first() === undefined) {
          res = await settingModel.query().insert({
              user_id: userId,
              "show-adult-content": newSettings["show-adult-content"],
              currency: getCurrencyByCode(newSettings.currency)?.code || 'USD'
          })
      }
      else {
        res = await settingModel
          .query()
          .where('user_id', userId)
          .patch({
            "show-adult-content": newSettings["show-adult-content"],
            "currency": getCurrencyByCode(newSettings.currency)?.code || 'USD'
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
            "currency": getCurrencyByCode(res.currency)
        }
    }
}

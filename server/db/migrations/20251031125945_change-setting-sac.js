const settingModel = require("../models/setting");
const migrate_name = 'identifier_for_migrate';

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param {Object} knex
 * @param {Promise} Promise
 * @returns {Promise}
 */
exports.up = function (knex) {

	console.info('[' + migrate_name + '] Migrating Up...');

	return knex.schema.table(settingModel.tableName, (table) => {
    table.integer('adult_content_level').notNullable().defaultTo(0).checkBetween([0, 2]);

    // migrate existing data from show-adult-content to adult_content_level
    // 0 = none, 1 = partial, 2 = all
    return knex(settingModel.tableName)
      .select('user_id', 'show-adult-content')
      .then((settings) => {
        const updates = settings.map((setting) => {
          let level = 0;
          if (setting['show-adult-content'] === true) {
            level = 2; // assuming true means show all adult content
          }
          return knex(settingModel.tableName)
            .where('user_id', setting.user_id)
            .update({ adult_content_level: level });
        });
        return Promise.all(updates);
      });
  })
    .then(() => {
      return knex.schema.table(settingModel.tableName, (table) => {
        table.dropColumn('show-adult-content');
      })
    })
    .then(() => console.log("Migration complete: show-adult-content to adult_content_level"));
};

/**
 * Undo Migrate
 *
 * @param {Object} knex
 * @param {Promise} Promise
 * @returns {Promise}
 */
exports.down = function (knex, Promise) {
    console.info('[' + migrate_name + '] Migrating Down...');

	    return knex.schema.table(settingModel.tableName, table => {
        table.boolean('show-adult-content').notNullable().defaultTo(false);

        // migrate existing data from adult_content_level to show-adult-content
        return knex(settingModel.tableName)
          .select('id', 'adult_content_level')
          .then((users) => {
            const updates = users.map((user) => {
              const showAdultContent = user.adult_content_level > 0; // show if level is partial or all
              return knex(settingModel.tableName)
                .where('id', user.id)
                .update({ 'show-adult-content': showAdultContent });
            });
            return Promise.all(updates);
          })
          .then(() => table.dropColumn("adult_content_level"));
      });
};

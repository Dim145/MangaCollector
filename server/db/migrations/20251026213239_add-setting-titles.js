const migrate_name = 'add-title-to-settings';

const settingModel = require('../models/setting');
const {getTitleTypes, TITLE_TYPE} = require("../../lib/titleType");

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param {Object} knex
 * @param {Promise} Promise
 * @returns {Promise}
 */
exports.up = function (knex, Promise) {

	console.info('[' + migrate_name + '] Migrating Up...');

	return knex.schema.table(settingModel.tableName, (table) => {
    table.enum('titleType', getTitleTypes()).nullable().defaultTo(TITLE_TYPE.Default);
  })
    .then(() => {
      console.info('[' + migrate_name + '] settings Table altered');
      console.info('[' + migrate_name + '] Migrating Up Complete');
    });
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
        table.dropColumn('titleType');
    })
    .then(() => {
        console.info('[' + migrate_name + '] settings Table altered');
        console.info('[' + migrate_name + '] Migrating Down Complete');
    });
};

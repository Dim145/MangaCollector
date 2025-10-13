const migrate_name = 'create-settings';

const settingModel = require('../models/setting');
const userModel = require('../models/user');
const {getCurrenciesCodes} = require("../../lib/price");

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param {Object} knex
 * @returns {Promise}
 */
exports.up = function (knex) {

	console.info('[' + migrate_name + '] Migrating Up...');

  return  knex.schema.createTableIfNotExists(settingModel.tableName, table => {
      table.increments().primary();

      table.dateTime('created_on').notNullable();
      table.dateTime('modified_on').notNullable();

      table.integer('user_id').unsigned().notNullable().references('id').inTable(userModel.tableName).onDelete('CASCADE');
      table.boolean('show-adult-content').defaultTo(false);
      table.enum('currency', getCurrenciesCodes()).defaultTo('USD');
  })
    .then(() => console.info('[' + migrate_name + '] Settings Table created'))
    .then(() => {
      console.info('[' + migrate_name + '] removing show-adult-content column from users table...');
      return knex.schema.table(userModel.tableName, table => {
        table.dropColumn('show-adult-content');
      });
    });
};

/**
 * Undo Migrate
 *
 * @param {Object} knex
 * @returns {Promise}
 */
exports.down = function (knex) {
    console.info('[' + migrate_name + '] Migrating Down...');


      return knex.schema.dropTableIfExists(settingModel.tableName)
        .then(() => knex.schema.table(userModel.tableName, table => {
          table.boolean('show-adult-content').defaultTo(false);
        }))
      .then(() => console.info('[' + migrate_name + '] Settings Table dropped'));
};

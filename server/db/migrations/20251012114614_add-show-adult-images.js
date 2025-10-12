const migrate_name = 'add-show-adult-images';

const userModel = require('../models/user');
const userLibraryModel = require("../models/user_librarie");

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

    return knex.schema.table(userModel.tableName, function (access_list) {
        access_list.boolean('show-adult-images').defaultTo(false);
    })
        .then(() => {
            console.info('[' + migrate_name + '] show-adult-images Table altered');
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

    return knex.schema.table(userLibraryModel.tableName, table => {
        table.dropColumn('show-adult-images');
    })
        .then(() => {
            console.info('[' + migrate_name + '] show-adult-images Table altered');
        });
};

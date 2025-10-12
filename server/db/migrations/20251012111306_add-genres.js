const migrate_name = 'add-genres';

const userLibraryModel = require('../models/user_librarie');

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

    return knex.schema.table(userLibraryModel.tableName, function (access_list) {
        access_list.string('genres').nullable();
    })
        .then(() => {
            console.info('[' + migrate_name + '] access_list Table altered');
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
        table.dropColumn('genres');
    })
    .then(() => {
        console.info('[' + migrate_name + '] access_list Table altered');
    });
};

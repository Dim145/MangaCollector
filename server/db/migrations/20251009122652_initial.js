const migrate_name = 'initial';

const userModel = require('../models/user');
const userLibraryModel = require('../models/user_librarie');
const userVolumeModel = require('../models/user_volume');

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

	// Create Table example:

	return knex.schema.createTable(userModel.tableName, (table) => {
		 table.increments().primary();
		 table.dateTime('created_on').notNullable()
		 table.dateTime('modified_on').notNullable();

         table.string('name').nullable();
        table.string('email').unique();
        table.string('google_id').unique();
	 })
     .then(() => {
         console.info('[' + migrate_name + '] user Table created');

         return knex.schema.createTable(userLibraryModel.tableName, table => {
             table.increments().primary();

            table.dateTime('created_on').notNullable()
            table.dateTime('modified_on').notNullable();

            table.integer('user_id').unsigned().notNullable().references('id').inTable(userModel.tableName).onDelete('CASCADE');
            table.integer('mal_id').nullable();
            table.string('name').notNullable();
            table.integer('volumes').defaultTo(0);
            table.integer('volumes_owned').defaultTo(0);
            table.string('image_url_jpg').nullable();
         })
     })
     .then(() => {
            console.info('[' + migrate_name + '] user_libraries Table created');

            return knex.schema.createTable(userVolumeModel.tableName, table => {
                table.increments().primary();

                table.dateTime('created_on').notNullable()
                table.dateTime('modified_on').notNullable();

                table.integer('user_id').unsigned().notNullable().references('id').inTable(userModel.tableName).onDelete('CASCADE');
                table.integer('mal_id').nullable();
                table.integer('vol_num').notNullable();
                table.boolean('owned').defaultTo(false);
                table.decimal('price', 12, 2).nullable();
                table.string('store').nullable();
            });
     })
	 .then( () => {
		console.info('[' + migrate_name + '] user_volumes Table created');
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

	// Drop table example:

	/*return knex.schema.dropTable('notification')
	 .then(() => {
		logger.info('[' + migrate_name + '] Notification Table dropped');
	 });*/

    console.info('[' + migrate_name + '] Migrating Down Complete');

	return Promise.resolve(true);
};

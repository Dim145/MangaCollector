const db = require("../db");
const Model = require("objection").Model;
const now = require('../now-helper');
const UserLibrarie = require('./user_librarie');

Model.knex(db);

class User extends Model {
    $beforeInsert () {
        this.created_on  = now();
        this.modified_on = now();
    }

    $beforeUpdate () {
        this.modified_on = now();
    }

    static get name () {
        return 'Users';
    }

    static get tableName () {
        return 'users';
    }

    static  get relationMappings() {
        return {
            libraries: {
                relation: Model.HasOneRelation,
                modelClass: UserLibrarie,
                join: {
                    from: 'users.id',
                    to: 'user_libraries.user_id'
                }
            },
            volumes: {
                relation: Model.HasOneRelation,
                modelClass: require('./user_volume'),
                join: {
                    from: 'users.id',
                    to: 'user_volumes.user_id'
                }
            }
        }
    }
}

module.exports = User;

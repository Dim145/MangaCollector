const db = require("../db");
const Model = require("objection").Model;
const now = require('../now-helper');

Model.knex(db);

class UserVolume extends Model {
    $beforeInsert () {
        this.created_on  = now();
        this.modified_on = now();

        // Default for meta
        if (typeof this.meta === 'undefined') {
            this.meta = {};
        }
    }

    $beforeUpdate () {
        this.modified_on = now();
    }

    static get name () {
        return 'UserLibraries';
    }

    static get tableName () {
        return 'user_libraries';
    }
}

module.exports = UserVolume;

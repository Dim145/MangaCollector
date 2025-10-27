const db = require("../db");
const Model = require("objection").Model;
const now = require('../now-helper');

Model.knex(db);

class UserVolume extends Model {
    $beforeInsert () {
        this.created_on  = now();
        this.modified_on = now();
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

    get isCustomEntry() {
      return this.mal_id < 0;
    }
}

module.exports = UserVolume;

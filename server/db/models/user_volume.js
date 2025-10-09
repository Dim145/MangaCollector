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
        return 'UserVolumes';
    }

    static get tableName () {
        return 'user_volumes';
    }
}

module.exports = UserVolume;

const db = require("../db");
const Model = require("objection").Model;
const now = require('../now-helper');

Model.knex(db);

class Setting extends Model {
  $beforeInsert () {
    this.created_on  = now();
    this.modified_on = now();
  }

  $beforeUpdate () {
    this.modified_on = now();
  }

  static get name () {
    return 'Settings';
  }

  static get tableName () {
    return 'settings';
  }
}

module.exports = Setting;

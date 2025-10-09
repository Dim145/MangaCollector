const db     = require('./db');
const Model  = require('objection').Model;

Model.knex(db);

module.exports = function () {
    return Model.raw('NOW()');
};

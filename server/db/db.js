const generateDbConfig = () =>
{
    return {
        client: "pg",
        connection: process.env.POSTGRES_URL || process.env.SUPABASE_URL,
        migrations: {
            tableName: "migrations"
        }
    };
}

module.exports = require('knex')(generateDbConfig())

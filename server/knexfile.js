module.exports = {
	development: {
		client:     'pg',
		migrations: {
			tableName: 'migrations',
			stub:      'lib/migrate_template.js',
			directory: 'db/migrations'
		}
	},

	production: {
		client:     'pg',
		migrations: {
			tableName: 'migrations',
			stub:      'lib/migrate_template.js',
			directory: 'db/migrations'
		}
	}
};

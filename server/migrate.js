const db     = require('./db/db');

module.exports = {
	latest: function () {
		return db.migrate.currentVersion()
			.then((version) => {
				console.info('Current database version:', version);
				return db.migrate.latest({
					tableName: 'migrations',
					directory: 'db/migrations'
				});
			});
	}
};

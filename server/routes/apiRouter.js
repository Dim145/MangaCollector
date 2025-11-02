const { Router } = require("express");
const apiRouter = new Router();
const userRouter = require("./userRouter");
const knex = require("../db/db");

apiRouter.use("/user", userRouter);

apiRouter.get("/health", async (_req, res, _next) => {
  if (process.env.APP_UNSECURE_HEALTHCHECK !== "true" && _req.ip !== '::ffff:127.0.0.1') {
    return res.status(404).send('404 page not found');
  }


  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    database: await knex.raw('SELECT 1')
      .then(() => 'OK')
      .catch(() => 'ERROR'),
  };

  try {
    res.send(healthcheck);
  } catch (e) {
    healthcheck.message = e;
    res.status(503).send();
  }
});

module.exports = apiRouter;

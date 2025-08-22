// server.js
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const passport = require("./config/passport");
const pgSession = require("connect-pg-simple");
const pool = require("./db/pool.js");

require("dotenv").config();

const app = express();
const PgSession = pgSession(session);
// Routers
const authRouter = require("./routes/authRouter");
const apiRouter = require("./routes/apiRouter");

// Session configuration
app.use(
  cors({
    origin: "http://localhost:5173", // frontend URL
    credentials: true, // allow cookies
  }),
);

// JSON parsing
app.use(express.json());

app.use(
  session({
    store: new PgSession({
      pool, // re-use your existing pg pool
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: "lax",
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/auth", authRouter);
app.use("/api", apiRouter);

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

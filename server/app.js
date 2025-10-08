// server.js
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const pgSession = require("connect-pg-simple");
const pool = require("./db/pool.js");
const cookieParser = require('cookie-parser');

require("dotenv").config();

const app = express();
const PgSession = pgSession(session);
// Routers
const authRouter = require("./routes/authRouter");
const apiRouter = require("./routes/apiRouter");

const corsWhitelist = [process.env.CORS_WHITELIST, process.env.AUTH_ISSUER];

// Session configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true, // allow cookies
  }),
);
app.use(cookieParser());

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
      secure: false, // true for HTTPS production
      httpOnly: false,
      sameSite: "lax", // none for cross-origin production
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.set("trust proxy", 1); // Set to 1 for single proxy, or true for multiple

const passport = require("./config/passport");
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/auth", authRouter);
app.use("/api", apiRouter);

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

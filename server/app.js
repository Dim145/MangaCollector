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
    origin: process.env.FRONTEND_URL,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true, // allow cookies
  }),
);

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
      secure: process.env.NODE_ENV === "production", // true for HTTPS production
      httpOnly: !process.env.NODE_ENV,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // none for cross-origin production
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

app.set("trust proxy", 1); // Set to 1 for single proxy, or true for multiple

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

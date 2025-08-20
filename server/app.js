// server.js
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const passport = require("./config/passport");
require("dotenv").config();

const app = express();

// Routers
const authRouter = require("./routes/authRouter");

// Session configuration
app.use(
  cors({
    origin: "http://localhost:5173", // frontend URL
    credentials: true, // allow cookies
  }),
);

app.use(
  session({
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

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
require("dotenv").config();

const pool = require("../db/pool");
// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `https://mangacollector.onrender.com/auth/oauth2/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Save user to DB if they don't exist
        const result = await pool.query(
          "SELECT * FROM users WHERE google_id = $1",
          [profile.id],
        );

        let user;
        if (result.rows.length === 0) {
          const insert = await pool.query(
            `INSERT INTO users (google_id, email, name) 
                 VALUES ($1, $2, $3) RETURNING *`,
            [profile.id, profile.emails[0].value, profile.displayName],
          );
          user = insert.rows[0];
        } else {
          user = result.rows[0];
        }

        return done(null, user);
      } catch (err) {
        done(err, null);
      }
    },
  ),
);

// Serialize user to session
passport.serializeUser((user, done) => done(null, user.id));

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;

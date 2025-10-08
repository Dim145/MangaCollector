const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const OpenIDConnectStrategy = require('passport-openidconnect');
require("dotenv").config();

const pool = require("../db/pool");
const path = require("path");

const verifyFunc = async (profile, done) => {
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
}

let authStrategy;

if (process.env.AUTH_MODE === "google")
{
    authStrategy = new GoogleStrategy(
        {
            clientID: process.env.AUTH_CLIENT_ID,
            clientSecret: process.env.AUTH_CLIENT_SECRET,
            callbackURL: `${process.env.FRONTEND_URL}/auth/oauth2/callback`,
        },
        async (accessToken, refreshToken, profile, done) => {
            return await verifyFunc(profile, done);
        },
    );
}
else // generic oidc auth
{
    const path = require('path');
    const baseApiUri = path.join(process.env.AUTH_ISSUER, process.env.AUTH_ISSUER_BASE_PATH);

    const urlJoin = (...parts) => {
        return new URL(path.join(...parts)).toString();
    }

    authStrategy = new OpenIDConnectStrategy({
        issuer: process.env.AUTH_ISSUER,
        authorizationURL: urlJoin(baseApiUri, 'authorize'),
        tokenURL: urlJoin(baseApiUri, 'token'),
        userInfoURL: urlJoin(baseApiUri, 'userinfo'),
        clientID: process.env.AUTH_CLIENT_ID,
        clientSecret: process.env.AUTH_CLIENT_SECRET,
        callbackURL: urlJoin(process.env.FRONTEND_URL, '/auth/oauth2/callback'),
        scope: ['openid', 'profile', 'email'],

    }, async (issuer, profile, done) => {
        return await verifyFunc(profile, done);
    })
}

// Google OAuth Strategy
passport.use(
  authStrategy
);

// Serialize user to session
passport.serializeUser((user, done) => done(null, user.id));
passport.serializeUser(function(user, cb) {
    process.nextTick(function() {
        console.log("sel-user", user);
        cb(null, { id: user.id, username: user.username, name: user.displayName });
    });
});

// Deserialize user from session
passport.deserializeUser(async (user, done) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [user.id]);
    done(null, result.rows[0]);
  } catch (err) {
      console.error(err);
    done(err, null);
  }
});

module.exports = passport;

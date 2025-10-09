const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const OpenIDConnectStrategy = require('passport-openidconnect');
require("dotenv").config();

const path = require("path");
const users = require("../services/users")

const verifyFunc = async (profile, done) => {
    try {
        let user = await users.findByGoogleId(profile.id);

        if(!user) {
            user = await users.create({
                google_id: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName
            });
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

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const result = await users.get(id);
    done(null, result);
  } catch (err) {
      console.error(err);
    done(err, null);
  }
});

module.exports = passport;

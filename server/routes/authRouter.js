const { Router } = require("express");
const authRouter = new Router();
const passport = require("../config/passport");

authRouter.get(
  "/oauth2",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);
authRouter.get(
  "/oauth2/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // Successful authentication
    res.redirect("http://localhost:5173/");
  },
);
authRouter.get("/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});

module.exports = authRouter;

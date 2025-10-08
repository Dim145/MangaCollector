const { Router } = require("express");
const authRouter = new Router();
const passport = require("../config/passport");

authRouter.get(
  "/oauth2",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

authRouter.post("/oauth2/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        return res.status(500).json({ error: "Failed to log out" });
      }

      res.clearCookie("connect.sid", { path: "/" });
      res.json({ message: "Logged out successfully" });
    });
  });
});

authRouter.get(
  "/oauth2/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // Successful authentication
    res.redirect(process.env.FRONTEND_URL);
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

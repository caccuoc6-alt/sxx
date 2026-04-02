/**
 * Auth backend with MongoDB Atlas.
 *
 * Features:
 * - POST /register  { email, username, password }
 * - POST /login     { identity, password }  // identity = email OR username
 * - JWT issuance on login/register
 * - bcrypt password hashing
 * - Rate limiting + CORS
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();

// ---- Config ----
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "2h";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const USER_FOUND_MODE = process.env.USER_FOUND_MODE || "demo"; // demo | secure
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://username:password@cluster0.abcd.mongodb.net/mydb?retryWrites=true&w=majority";

// ---- Connect MongoDB ----
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch((err) => console.error("MongoDB connection error:", err));

// ---- Define User Schema ----
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// ---- Middleware ----
app.use(express.json({ limit: "64kb" }));
app.use(cors({ origin: ALLOWED_ORIGIN }));

// ---- Helpers ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function normalizeUsername(username) { return String(username || "").trim().toLowerCase(); }
function safeMessage(msg) { return msg || "Invalid credentials."; }

function getClientIp(req) {
  return (
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const cur = hits.get(key);
    if (!cur || now > cur.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    cur.count += 1;
    if (cur.count > max) {
      const retryAfterSec = Math.ceil((cur.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ ok: false, message: "Too many attempts. Please try again soon." });
    }
    return next();
  };
}

function issueToken(user) {
  return jwt.sign(
    { sub: user._id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  return { id: user._id, email: user.email, username: user.username, createdAt: user.createdAt };
}

function userPreview(user) { return { email: user.email, username: user.username }; }

function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok: false, message: "Missing token." });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid token." });
  }
}

// ---- Routes ----
app.get("/", (_req, res) => res.send("Auth API is running 🚀"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const identifyLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "identify" });
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "login" });

// POST /login/identify
app.post("/login/identify", identifyLimiter, async (req, res) => {
  try {
    const identityRaw = String(req.body?.identity || "").trim();
    if (!identityRaw) return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { identity: "Required" } });

    const user = identityRaw.includes("@")
      ? await User.findOne({ email: normalizeEmail(identityRaw) })
      : await User.findOne({ username: normalizeUsername(identityRaw) });

    console.warn(`[identify] ip=${getClientIp(req)} identity=${identityRaw} found=${Boolean(user)}`);

    if (USER_FOUND_MODE === "secure") {
      return res.json({ ok: true, exists: null, message: "If an account exists, please enter your password." });
    }

    if (!user) return res.status(404).json({ ok: false, exists: false, message: "No account found." });

    return res.json({ ok: true, exists: true, message: "User found.", preview: userPreview(user) });
  } catch { return res.status(500).json({ ok: false, message: "Server error." }); }
});

// POST /register
app.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    const fieldErrors = {};
    if (!email || !EMAIL_RE.test(email)) fieldErrors.email = "Email invalid.";
    if (!username || !USERNAME_RE.test(username)) fieldErrors.username = "Username invalid.";
    if (!password || password.length < 6) fieldErrors.password = "Password min 6 chars.";
    if (Object.keys(fieldErrors).length) return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors });

    const emailTaken = await User.findOne({ email });
    const usernameTaken = await User.findOne({ username });
    if (emailTaken || usernameTaken) {
      return res.status(409).json({
        ok: false,
        message: "User already exists.",
        fieldErrors: { ...(emailTaken ? { email: "Email taken." } : {}), ...(usernameTaken ? { username: "Username taken." } : {}) },
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = new User({ email, username, passwordHash });
    await user.save();

    const token = issueToken(user);
    return res.status(201).json({ ok: true, message: "Registered successfully.", token, user: publicUser(user) });
  } catch { return res.status(500).json({ ok: false, message: "Server error." }); }
});

// POST /login
app.post("/login", loginLimiter, async (req, res) => {
  try {
    const identityRaw = String(req.body?.identity || "").trim();
    const password = String(req.body?.password || "");

    if (!identityRaw || !password.trim()) return res.status(400).json({ ok: false, message: "Validation error." });

    const user = identityRaw.includes("@")
      ? await User.findOne({ email: normalizeEmail(identityRaw) })
      : await User.findOne({ username: normalizeUsername(identityRaw) });

    const dummyHash = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8i1o4lYtH7lZxwqE4tWl6PqJQm9k7G";
    const hashToCompare = user ? user.passwordHash : dummyHash;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) {
      console.warn(`[login] ip=${getClientIp(req)} identity=${identityRaw} success=false`);
      return res.status(401).json({ ok: false, message: safeMessage("Invalid email/username or password.") });
    }

    const token = issueToken(user);
    console.warn(`[login] ip=${getClientIp(req)} identity=${identityRaw} success=true`);
    return res.json({ ok: true, message: "Login successful.", token, user: publicUser(user) });
  } catch { return res.status(500).json({ ok: false, message: "Server error." }); }
});

// GET /users/search (JWT protected)
app.get("/users/search", requireAuth, async (req, res) => {
  try {
    const qRaw = String(req.query?.q || "").trim();
    if (!qRaw) return res.status(400).json({ ok: false, message: "Query required." });

    const user = qRaw.includes("@")
      ? await User.findOne({ email: normalizeEmail(qRaw) })
      : await User.findOne({ username: normalizeUsername(qRaw) });

    if (!user) return res.status(404).json({ ok: false, message: "No user found." });
    return res.json({ ok: true, user: publicUser(user) });
  } catch { return res.status(500).json({ ok: false, message: "Server error." }); }
});

// GET /users/lookup (public)
app.get("/users/lookup", async (req, res) => {
  try {
    const qRaw = String(req.query?.q || "").trim();
    if (!qRaw) return res.status(400).json({ ok: false, message: "Query required." });

    const user = qRaw.includes("@")
      ? await User.findOne({ email: normalizeEmail(qRaw) })
      : await User.findOne({ username: normalizeUsername(qRaw) });

    if (!user) return res.status(404).json({ ok: false, message: "No user found." });
    return res.json({ ok: true, user: publicUser(user) });
  } catch { return res.status(500).json({ ok: false, message: "Server error." }); }
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Auth server running on port ${PORT}`);
});

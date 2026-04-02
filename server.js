/**
 * Simple auth backend (JSON file store).
 *
 * Endpoints:
 * - POST /register  { email, username, password }
 * - POST /login     { identity, password }  // identity = email OR username
 *
 * Security:
 * - bcrypt password hashing
 * - JWT issuance on successful login/register
 * - Input validation + duplicate checks
 */

const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// ---- Config ----
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "2h";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// If you're serving the frontend from a different origin, set this:
//   set ALLOWED_ORIGIN=http://127.0.0.1:5500 (or your Live Server URL)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// "demo" reveals whether a user exists (for your UX requirement).
// "secure" avoids confirming existence (recommended for real sites).
const USER_FOUND_MODE = process.env.USER_FOUND_MODE || "demo"; // demo | secure

const DB_PATH = path.join(__dirname, "users.json");

app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
  })
);

// ---- Helpers ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function safeMessage(msg) {
  // Avoid leaking details in auth errors.
  return msg || "Invalid credentials.";
}

function getClientIp(req) {
  // Basic IP extraction (good enough for local/dev).
  return (
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
  const hits = new Map(); // key -> { count, resetAt }

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

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch (e) {
    if (e && e.code === "ENOENT") return { users: [] };
    throw e;
  }
}

async function writeDb(db) {
  const tmp = DB_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function userPreview(user) {
  // Non-sensitive preview for the "user found" UI.
  return {
    username: user.username,
    email: user.email,
  };
}

function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok: false, message: "Missing token." });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid token." });
  }
}

// ---- Routes ----
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const identifyLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "identify" });
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "login" });

// Step 1: identify user (for "user found" UX)
// POST /login/identify { identity }
app.post("/login/identify", identifyLimiter, async (req, res) => {
  try {
    const identityRaw = String(req.body?.identity || "").trim();
    if (!identityRaw) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { identity: "Email/username is required." } });
    }

    // Basic identity format validation
    if (identityRaw.includes("@")) {
      const email = normalizeEmail(identityRaw);
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { identity: "Email is not valid." } });
      }
    } else if (identityRaw.length < 3) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { identity: "Username should be at least 3 characters." } });
    }

    const db = await readDb();
    const identityEmail = normalizeEmail(identityRaw);
    const identityUsername = normalizeUsername(identityRaw);

    const user =
      identityRaw.includes("@")
        ? db.users.find((u) => u.email === identityEmail)
        : db.users.find((u) => u.username === identityUsername);

    // Logging (demo)
    // eslint-disable-next-line no-console
    console.warn(`[identify] ip=${getClientIp(req)} identity=${identityRaw} found=${Boolean(user)}`);

    if (USER_FOUND_MODE === "secure") {
      // Avoid confirming existence.
      return res.json({
        ok: true,
        exists: null,
        message: "If an account exists, please enter your password to continue.",
      });
    }

    if (!user) {
      return res.status(404).json({ ok: false, exists: false, message: "No account found with this email/username." });
    }

    return res.json({
      ok: true,
      exists: true,
      message: "User found, please enter your password.",
      preview: userPreview(user),
    });
  } catch {
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

app.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    const fieldErrors = {};
    if (!email) fieldErrors.email = "Email is required.";
    else if (!EMAIL_RE.test(email)) fieldErrors.email = "Email is not valid.";

    if (!username) fieldErrors.username = "Username is required.";
    else if (!USERNAME_RE.test(username)) {
      fieldErrors.username = "Username must be 3-24 chars (letters, numbers, . _ -).";
    }

    if (!password.trim()) fieldErrors.password = "Password is required.";
    else if (password.length < 6) fieldErrors.password = "Password must be at least 6 characters.";

    if (Object.keys(fieldErrors).length) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors });
    }

    const db = await readDb();
    const emailTaken = db.users.some((u) => u.email === email);
    const usernameTaken = db.users.some((u) => u.username === username);

    if (emailTaken || usernameTaken) {
      return res.status(409).json({
        ok: false,
        message: "User already exists.",
        fieldErrors: {
          ...(emailTaken ? { email: "Email is already registered." } : {}),
          ...(usernameTaken ? { username: "Username is already taken." } : {}),
        },
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = {
      id: crypto.randomUUID(),
      email,
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    db.users.push(user);
    await writeDb(db);

    const token = issueToken(user);
    return res.status(201).json({
      ok: true,
      message: "Registered successfully.",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

app.post("/login", loginLimiter, async (req, res) => {
  try {
    const identityRaw = String(req.body?.identity || "").trim();
    const password = String(req.body?.password || "");

    const fieldErrors = {};
    if (!identityRaw) fieldErrors.identity = "Email/username is required.";
    if (!password.trim()) fieldErrors.password = "Password is required.";
    if (Object.keys(fieldErrors).length) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors });
    }

    const db = await readDb();

    const identityEmail = normalizeEmail(identityRaw);
    const identityUsername = normalizeUsername(identityRaw);

    const user =
      identityRaw.includes("@")
        ? db.users.find((u) => u.email === identityEmail)
        : db.users.find((u) => u.username === identityUsername);

    // Safe incorrect-password handling:
    // - same message whether user doesn't exist or password mismatch
    // - still do a bcrypt compare against a dummy hash to reduce timing leakage
    const dummyHash =
      "$2b$12$CwTycUXWue0Thq9StjUM0uJ8i1o4lYtH7lZxwqE4tWl6PqJQm9k7G"; // bcrypt("dummy", 12)

    const hashToCompare = user ? user.passwordHash : dummyHash;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) {
      // eslint-disable-next-line no-console
      console.warn(`[login] ip=${getClientIp(req)} identity=${identityRaw} success=false`);
      return res.status(401).json({ ok: false, message: safeMessage("Invalid email/username or password.") });
    }

    const token = issueToken(user);
    // eslint-disable-next-line no-console
    console.warn(`[login] ip=${getClientIp(req)} identity=${identityRaw} success=true`);
    return res.json({ ok: true, message: "Login successful.", token, user: publicUser(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

// Search users (JWT-protected)
// GET /users/search?q=emailOrUsername
app.get("/users/search", requireAuth, async (req, res) => {
  try {
    const qRaw = String(req.query?.q || "").trim();
    if (!qRaw) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { q: "Query is required." } });
    }

    const db = await readDb();
    const qEmail = normalizeEmail(qRaw);
    const qUsername = normalizeUsername(qRaw);

    const found =
      qRaw.includes("@")
        ? db.users.find((u) => u.email === qEmail)
        : db.users.find((u) => u.username === qUsername);

    if (!found) {
      return res.status(404).json({ ok: false, message: "No user found." });
    }

    return res.json({ ok: true, user: publicUser(found) });
  } catch {
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

// Public lookup (no JWT) for the login page "Find account" UX.
// GET /users/lookup?q=emailOrUsername
// Note: In a real production app, you would usually avoid confirming if a user exists.
app.get("/users/lookup", async (req, res) => {
  try {
    const qRaw = String(req.query?.q || "").trim();
    if (!qRaw) {
      return res.status(400).json({ ok: false, message: "Validation error.", fieldErrors: { q: "Query is required." } });
    }

    const db = await readDb();
    const qEmail = normalizeEmail(qRaw);
    const qUsername = normalizeUsername(qRaw);

    const found =
      qRaw.includes("@")
        ? db.users.find((u) => u.email === qEmail)
        : db.users.find((u) => u.username === qUsername);

    if (!found) return res.status(404).json({ ok: false, message: "No user found." });
    return res.json({ ok: true, user: publicUser(found) });
  } catch {
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Auth server running on http://localhost:${PORT}`);
});


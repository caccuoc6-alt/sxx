/**
 * Register page behavior:
 * - Toggle show/hide password
 * - Basic validation + inline error messages
 * - POST /register and store JWT
 */

const form = document.getElementById("registerForm");
const emailInput = document.getElementById("email");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const togglePasswordBtn = document.getElementById("togglePassword");

const emailErrorEl = document.getElementById("emailError");
const usernameErrorEl = document.getElementById("usernameError");
const passwordErrorEl = document.getElementById("passwordError");
const formMessageEl = document.getElementById("formMessage");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;

function setError(inputEl, errorEl, message) {
  errorEl.textContent = message;
  if (message) inputEl.classList.add("is-invalid");
  else inputEl.classList.remove("is-invalid");
}

function setFormMessage(type, message) {
  if (!formMessageEl) return;
  formMessageEl.textContent = message;
  formMessageEl.classList.remove("is-error", "is-success");
  formMessageEl.classList.add(type === "success" ? "is-success" : "is-error");
  formMessageEl.style.display = "block";
}

function clearAll() {
  setError(emailInput, emailErrorEl, "");
  setError(usernameInput, usernameErrorEl, "");
  setError(passwordInput, passwordErrorEl, "");
  if (formMessageEl) {
    formMessageEl.textContent = "";
    formMessageEl.classList.remove("is-error", "is-success");
    formMessageEl.style.display = "none";
  }
}

function validate() {
  const email = emailInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  let ok = true;

  if (!email) {
    setError(emailInput, emailErrorEl, "Email is required.");
    ok = false;
  } else if (!EMAIL_RE.test(email)) {
    setError(emailInput, emailErrorEl, "Please enter a valid email address.");
    ok = false;
  } else {
    setError(emailInput, emailErrorEl, "");
  }

  if (!username) {
    setError(usernameInput, usernameErrorEl, "Username is required.");
    ok = false;
  } else if (!USERNAME_RE.test(username)) {
    setError(usernameInput, usernameErrorEl, "3-24 chars (letters, numbers, . _ -).");
    ok = false;
  } else {
    setError(usernameInput, usernameErrorEl, "");
  }

  if (!password.trim()) {
    setError(passwordInput, passwordErrorEl, "Password is required.");
    ok = false;
  } else if (password.length < 6) {
    setError(passwordInput, passwordErrorEl, "Password should be at least 6 characters.");
    ok = false;
  } else {
    setError(passwordInput, passwordErrorEl, "");
  }

  return ok;
}

function setPasswordVisibility(visible) {
  passwordInput.type = visible ? "text" : "password";
  togglePasswordBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  togglePasswordBtn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  togglePasswordBtn.title = visible ? "Hide password" : "Show password";

  const svg = togglePasswordBtn.querySelector("svg");
  if (!svg) return;

  svg.innerHTML = visible
    ? `<path d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.1-3.1c-1.6.8-3.4 1.2-5.4 1.2-5.5 0-9.7-4.1-11-7 1-2.2 3.6-5.2 7.2-6.5L2.1 3.5Zm6.6 6.6a2.8 2.8 0 0 0 3.9 3.9l-3.9-3.9ZM12 6.9c2 0 3.9.5 5.5 1.3l-2.1 2.1A2.8 2.8 0 0 0 11 9.8l-2.2-2.2c.9-.4 2-.7 3.2-.7Zm8.8 5.1c-1.3 2.9-5.5 7-10.8 7-.9 0-1.8-.1-2.6-.3l2.2-2.2c.1 0 .3 0 .4 0a2.8 2.8 0 0 0 2.8-2.8c0-.1 0-.3 0-.4l3.5-3.5c1.8 1.3 3.1 3 3.7 4.2Z"/>`
    : `<path d="M12 5c5.5 0 9.7 4.1 11 7-1.3 2.9-5.5 7-11 7S2.3 14.9 1 12c1.3-2.9 5.5-7 11-7Zm0 2C7.8 7 4.4 10 3.2 12 4.4 14 7.8 17 12 17s7.6-3 8.8-5C19.6 10 16.2 7 12 7Zm0 2.2A2.8 2.8 0 1 1 9.2 12 2.8 2.8 0 0 1 12 9.2Z"/>`;
}

togglePasswordBtn.addEventListener("click", () => {
  const visible = passwordInput.type === "password";
  setPasswordVisibility(visible);
  passwordInput.focus();
});

emailInput.addEventListener("input", () => {
  const v = emailInput.value.trim();
  if (!v) return setError(emailInput, emailErrorEl, "");
  setError(emailInput, emailErrorEl, EMAIL_RE.test(v) ? "" : "Please enter a valid email address.");
});

usernameInput.addEventListener("input", () => {
  const v = usernameInput.value.trim();
  if (!v) return setError(usernameInput, usernameErrorEl, "");
  setError(usernameInput, usernameErrorEl, USERNAME_RE.test(v) ? "" : "3-24 chars (letters, numbers, . _ -).");
});

passwordInput.addEventListener("input", () => {
  const v = passwordInput.value;
  if (!v) return setError(passwordInput, passwordErrorEl, "");
  setError(passwordInput, passwordErrorEl, v.length >= 6 ? "" : "Password should be at least 6 characters.");
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearAll();

  if (!validate()) {
    const firstInvalid = form.querySelector(".is-invalid");
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const API_BASE = "http://localhost:8080";

  const btn = form.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Creating…";

  fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: emailInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value,
    }),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    })
    .then(({ ok, data }) => {
      if (!ok) {
        if (data?.fieldErrors?.email) setError(emailInput, emailErrorEl, data.fieldErrors.email);
        if (data?.fieldErrors?.username) setError(usernameInput, usernameErrorEl, data.fieldErrors.username);
        if (data?.fieldErrors?.password) setError(passwordInput, passwordErrorEl, data.fieldErrors.password);
        setFormMessage("error", data?.message || "Registration failed.");
        return;
      }

      if (data?.token) localStorage.setItem("auth_token", data.token);
      setFormMessage("success", "Account created! Redirecting…");
      setTimeout(() => {
        window.location.href = "./dashboard.html";
      }, 700);
    })
    .catch(() => {
      setFormMessage("error", "Couldn’t reach the server. Is it running?");
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = original;
    });
});

setPasswordVisibility(false);


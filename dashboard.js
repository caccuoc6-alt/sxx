/**
 * Demo dashboard:
 * - Reads JWT from localStorage
 * - Redirects back to login if missing
 * - Provides logout button
 */

const token = localStorage.getItem("auth_token");
const tokenPreview = document.getElementById("tokenPreview");
const dashMessage = document.getElementById("dashMessage");
const logoutBtn = document.getElementById("logoutBtn");
const userQuery = document.getElementById("userQuery");
const searchBtn = document.getElementById("searchBtn");
const searchStatus = document.getElementById("searchStatus");
const userFoundCard = document.getElementById("userFoundCard");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");

function setMessage(type, message) {
  dashMessage.textContent = message;
  dashMessage.classList.remove("is-error", "is-success");
  dashMessage.classList.add(type === "success" ? "is-success" : "is-error");
}

if (!token) {
  setMessage("error", "No session found. Please log in.");
  setTimeout(() => {
    window.location.href = "./index.html";
  }, 650);
} else {
  setMessage("success", "Session OK. Welcome!");
  tokenPreview.value = token;
}

function setSearchStatus(kind, text) {
  // kind: "idle" | "loading" | "error" | "success"
  if (!searchStatus) return;
  searchStatus.classList.remove("shake");

  if (kind === "loading") {
    searchStatus.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${text}</span>`;
    return;
  }

  searchStatus.textContent = text || "";
  if (kind === "error") {
    // subtle animated error
    searchStatus.classList.add("shake");
  }
}

function hideUserCard() {
  if (!userFoundCard) return;
  userFoundCard.classList.remove("is-visible");
  userFoundCard.setAttribute("aria-hidden", "true");
}

function showUserCard(user) {
  if (!userFoundCard) return;
  const displayName = user.username || "User";
  userAvatar.textContent = String(displayName).slice(0, 1).toUpperCase();
  userName.textContent = user.username;
  userEmail.textContent = user.email;
  userFoundCard.setAttribute("aria-hidden", "false");
  userFoundCard.classList.add("is-visible");

  // Make sure the user notices the result.
  try {
    userFoundCard.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // ignore
  }
}

async function searchUser() {
  if (!token) return;
  const q = userQuery.value.trim();
  hideUserCard();

  if (!q) {
    setSearchStatus("error", "Type an email or username first.");
    userQuery.focus();
    return;
  }

  const API_BASE = "http://localhost:8080";
  setSearchStatus("loading", "Searching…");

  try {
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setSearchStatus("error", data?.message || "No user found.");
      return;
    }

    setSearchStatus("success", "Found!");
    showUserCard(data.user);
  } catch {
    setSearchStatus("error", "Server unreachable. Start the backend first.");
  }
}

searchBtn?.addEventListener("click", searchUser);
userQuery?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchUser();
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("auth_token");
  window.location.href = "./index.html";
});


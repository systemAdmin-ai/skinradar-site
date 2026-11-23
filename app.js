/* SkinRadar — фронтенд: сделки, регистрация, кабинет, вишлист.
   Токен хранится в localStorage. Пароль Steam и ключи площадок сайт не спрашивает. */

const API = location.hostname === "127.0.0.1" || location.hostname === "localhost"
  ? "http://127.0.0.1:8791"                       // локальный веб-интерфейс приложения
  : "https://skinradar-api.notchdeck.workers.dev";

const $ = (sel, root = document) => root.querySelector(sel);
const token = {
  get: () => localStorage.getItem("sr_token") || "",
  set: (v) => v ? localStorage.setItem("sr_token", v) : localStorage.removeItem("sr_token"),
  clear: () => localStorage.removeItem("sr_token"),
};

async function api(path, { method = "GET", data, auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth && token.get()) headers.authorization = `Bearer ${token.get()}`;
  const res = await fetch(API + path, {
    method, headers, body: data ? JSON.stringify(data) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `ошибка ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

/* ── сделки на лендинге ── */
async function loadDeals() {
  const body = $("#dealsTable tbody");
  try {
    const data = await api("/api/deals?limit=12", { auth: false });
    if (!data.deals?.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Сканер ещё не собрал цены — загляните через пару минут.</td></tr>';
      return;
    }
    body.innerHTML = data.deals.map((d) => `
      <tr>
        <td><a href="${esc(d.url || "#")}" target="_blank" rel="noopener">${esc(d.item_name)}</a></td>
        <td class="num"><b>${money(d.price)}</b></td>
        <td class="muted">${esc(d.provider)}</td>
        <td class="muted">${esc(d.updated_at || "")}</td>
      </tr>`).join("");
    $("#dealsAt").textContent = data.updated_at ? `обновлено ${data.updated_at} UTC` : "обновляется сканером";
  } catch {
    body.innerHTML = '<tr><td colspan="4" class="muted">Сервис цен временно недоступен.</td></tr>';
  }
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n < 100 ? n.toFixed(2).replace(/\.?0+$/, "") : Math.round(n).toLocaleString("ru-RU")} ₽`;
};

/* ── модальные окна ── */
const modal = $("#modal"), cabinet = $("#cabinet");
let authMode = "signup";

function openAuth(mode = "signup") {
  authMode = mode;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  $("#authSubmit").textContent = mode === "signup" ? "Создать аккаунт" : "Войти";
  $("#authErr").textContent = "";
  modal.hidden = false;
  setTimeout(() => $('input[name="email"]', modal)?.focus(), 30);
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => openAuth(tab.dataset.tab)));
["#loginBtn"].forEach((s) => $(s)?.addEventListener("click", () => openAuth("login")));
["#signupBtn", "#heroSignup", "#freeBtn", "#proBtn"].forEach((s) =>
  $(s)?.addEventListener("click", () => {
    if (token.get()) return openCabinet();
    openAuth("signup");
  }));
$("#closeModal").addEventListener("click", () => (modal.hidden = true));
$("#closeCabinet").addEventListener("click", () => (cabinet.hidden = true));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
cabinet.addEventListener("click", (e) => { if (e.target === cabinet) cabinet.hidden = true; });

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  const err = $("#authErr");
  err.textContent = "";
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return (err.textContent = "Похоже, в email опечатка.");
  if (password.length < 8) return (err.textContent = "Пароль короче 8 символов.");

  $("#authSubmit").disabled = true;
  try {
    const data = await api(`/api/${authMode === "signup" ? "register" : "login"}`, {
      method: "POST", data: { email, password }, auth: false,
    });
    token.set(data.token);
    form.reset();
    modal.hidden = true;
    await openCabinet();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $("#authSubmit").disabled = false;
  }
});

/* ── кабинет ── */
async function openCabinet() {
  cabinet.hidden = false;
  try {
    const me = await api("/api/me");
    $("#cabEmail").textContent = me.user.email;
    $("#cabPlan").textContent = me.user.pro
      ? `Pro до ${new Date(me.user.plan_until).toLocaleDateString("ru-RU")}`
      : "Бесплатный тариф";
    $("#proBox").classList.toggle("active", me.user.pro);
    $("#activatePro").hidden = me.user.pro;
    await Promise.all([loadWishlist(), loadAlerts()]);
  } catch (ex) {
    if (ex.status === 401) {
      token.clear();
      cabinet.hidden = true;
      openAuth("login");
    }
  }
}

$("#logoutBtn").addEventListener("click", () => {
  token.clear();
  cabinet.hidden = true;
});

$("#activatePro").addEventListener("click", async () => {
  try {
    await api("/api/billing/checkout", { method: "POST" });
    await openCabinet();
  } catch (ex) {
    alert(ex.message);
  }
});

$("#wishForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#wishErr");
  err.textContent = "";
  try {
    await api("/api/wishlist", {
      method: "POST",
      data: { item_name: e.target.item_name.value.trim(), max_price: Number(e.target.max_price.value) },
    });
    e.target.reset();
    await loadWishlist();
  } catch (ex) {
    err.textContent = ex.status === 402 ? "Вишлист доступен на Pro — включите демо-Pro выше." : ex.message;
  }
});

async function loadWishlist() {
  const body = $("#wishBody");
  const data = await api("/api/wishlist");
  if (!data.items?.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Пусто — добавьте скин и порог цены.</td></tr>';
    return;
  }
  body.innerHTML = data.items.map((w) => `
    <tr>
      <td>${esc(w.item_name)}</td>
      <td class="num">${money(w.max_price)}</td>
      <td class="num">${w.last_price ? money(w.last_price) : '<span class="muted">ждём сканер</span>'}</td>
      <td class="num">${w.hits ?? 0}</td>
      <td><button class="ghost" data-del="${w.id}">Удалить</button></td>
    </tr>`).join("");
  body.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/api/wishlist/${btn.dataset.del}`, { method: "DELETE" });
      await loadWishlist();
    }));
}

async function loadAlerts() {
  const list = $("#alertList");
  try {
    const data = await api("/api/alerts");
    if (!data.alerts?.length) {
      list.innerHTML = '<li class="muted">Пока пусто — сюда попадут срабатывания сканера.</li>';
      return;
    }
    list.innerHTML = data.alerts.map((a) => `
      <li>
        <span>${esc(a.item_name)}<br><span class="muted">${esc(a.seen_at)} UTC</span></span>
        <span class="hit">${money(a.price)} <span class="muted">при пороге ${money(a.threshold)}</span></span>
      </li>`).join("");
  } catch { /* не критично */ }
}

/* ── старт ── */
loadDeals();
setInterval(loadDeals, 60000);
if (token.get()) {
  api("/api/me").then(() => {}).catch((ex) => { if (ex.status === 401) token.clear(); });
}

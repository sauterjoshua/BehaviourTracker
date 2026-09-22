/* ===================================================================
   BehaviourTracker – statische Single-Page-App (Vanilla JS, ES-Module)
   -------------------------------------------------------------------
   Sicherheitsleitlinien in dieser Datei:
   - Benutzertexte werden ausschliesslich ueber textContent gesetzt.
     innerHTML wird nirgends mit Daten aus der Datenbank benutzt.
   - Eingaben werden getrimmt, von Steuerzeichen befreit und in der
     Laenge begrenzt (zusaetzlich zu den CHECK-Constraints in Postgres).
   - Im Frontend liegt nur der oeffentliche Anon-/Publishable-Key.
     Der eigentliche Zugriffsschutz kommt aus den RLS-Policies.
   =================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const appEl = document.getElementById("app");
const topbarEl = document.getElementById("topbar");
const topbarTitleEl = document.getElementById("topbarTitle");
const topbarUserEl = document.getElementById("topbarUser");
const backBtn = document.getElementById("backBtn");
const logoutBtn = document.getElementById("logoutBtn");
const toastEl = document.getElementById("toast");

/* -------------------------------------------------------------------
   Kleine DOM- und Formathilfen
   ------------------------------------------------------------------- */

/** Element-Factory. Strings/Zahlen in children werden als Text eingefuegt. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) el.dataset[dk] = String(dv);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Steuerzeichen, die aus Eingaben entfernt werden. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Eingabe normalisieren: Steuerzeichen raus, Whitespace normalisieren, kuerzen. */
function cleanName(value, max = 80) {
  return String(value ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function formatDurationLong(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const hh = Math.floor(s / 3600);
  const mm = Math.round((s % 3600) / 60);
  if (hh === 0) return `${mm} min`;
  return `${hh} h ${String(mm).padStart(2, "0")} min`;
}

function formatDate(value) {
  if (!value) return "";
  let d;
  if (value instanceof Date) {
    d = value;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    // Reines Datum ohne Zeitzone lokal interpretieren, nicht als UTC.
    const [y, m, day] = String(value).split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

let toastTimer = null;
function toast(message, kind = "info") {
  toastEl.textContent = message;
  toastEl.className = kind === "error" ? "toast toast--error" : "toast";
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === "error" ? 6000 : 3000);
}

function showError(error, fallback = "Es ist ein Fehler aufgetreten.") {
  const message = (error && (error.message || error.error_description)) || fallback;
  console.error(error);
  toast(message, "error");
}

function loadingView(text = "Wird geladen…") {
  return h("div", { class: "loading" }, text);
}

function emptyView(text) {
  return h("p", { class: "empty" }, text);
}

/* -------------------------------------------------------------------
   Konfiguration laden
   ------------------------------------------------------------------- */

function renderSetupHint() {
  topbarEl.hidden = true;
  appEl.replaceChildren(
    h("div", { class: "card stack" },
      h("h2", {}, "Konfiguration fehlt"),
      h("p", { class: "muted" },
        "Es wurde keine gueltige config.js gefunden. Lege sie auf Basis von " +
        "config.example.js an und trage SUPABASE_URL sowie SUPABASE_ANON_KEY ein."),
      h("pre", { class: "small" }, "cp config.example.js config.js\n# danach die Werte eintragen")
    )
  );
}

let CONFIG = null;
try {
  ({ CONFIG } = await import("./config.js"));
} catch {
  CONFIG = null;
}
if (!CONFIG || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY ||
    String(CONFIG.SUPABASE_URL).includes("DEIN-PROJEKT")) {
  CONFIG = null;
  renderSetupHint();
}

/* -------------------------------------------------------------------
   Spalten-Definition
   ------------------------------------------------------------------- */

const COLUMNS = [
  { key: "links",  title: "Da geht mehr" },
  { key: "mitte",  title: "Du arbeitest gut" },
  { key: "rechts", title: "Du arbeitest großartig" }
];
const COLUMN_TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title]));
const columnIndex = (key) => COLUMNS.findIndex((c) => c.key === key);
const isAdjacent = (from, to) => Math.abs(columnIndex(from) - columnIndex(to)) === 1;

/* -------------------------------------------------------------------
   Supabase-Client
   ------------------------------------------------------------------- */

const sb = CONFIG
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

/** Wirft bei Supabase-Fehlern, gibt sonst die Daten zurueck. */
function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/* -------------------------------------------------------------------
   Anwendungszustand
   ------------------------------------------------------------------- */

const state = {
  session: null,
  teacher: null,
  cleanup: []        // Aufraeumfunktionen der aktuellen Ansicht (Timer etc.)
};

function registerCleanup(fn) { state.cleanup.push(fn); }
function runCleanup() {
  for (const fn of state.cleanup.splice(0)) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/* -------------------------------------------------------------------
   hCaptcha (optional)
   ------------------------------------------------------------------- */

const captchaEnabled = () => Boolean(CONFIG && CONFIG.HCAPTCHA_SITE_KEY);

function waitForHcaptcha(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.hcaptcha && typeof window.hcaptcha.render === "function") {
        return resolve(window.hcaptcha);
      }
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("hCaptcha konnte nicht geladen werden."));
      }
      setTimeout(poll, 100);
    })();
  });
}

/* -------------------------------------------------------------------
   Authentifizierung
   ------------------------------------------------------------------- */

async function ensureTeacher() {
  const existing = unwrap(
    await sb.from("teachers").select("id, nickname").limit(1).maybeSingle()
  );
  if (existing) return existing;

  // Fallback, falls der Signup-Trigger (noch) nicht existiert.
  const user = state.session?.user;
  const nickname =
    cleanName(user?.user_metadata?.nickname || String(user?.email || "Lehrkraft").split("@")[0], 60) ||
    "Lehrkraft";

  return unwrap(
    await sb.from("teachers")
      .insert({ auth_user_id: user.id, nickname })
      .select("id, nickname")
      .single()
  );
}

function renderAuth() {
  runCleanup();
  topbarEl.hidden = true;
  appEl.className = "app";

  let mode = "signin";
  let captchaWidget = null;

  const errorBox = h("div", { class: "error-box", hidden: true });
  const emailInput = h("input", {
    class: "input", type: "email", required: true, autocomplete: "email",
    maxlength: "160", placeholder: "name@schule.de"
  });
  const passwordInput = h("input", {
    class: "input", type: "password", required: true, minlength: "8",
    maxlength: "72", autocomplete: "current-password", placeholder: "mindestens 8 Zeichen"
  });
  const nicknameInput = h("input", {
    class: "input", type: "text", maxlength: "60", autocomplete: "nickname",
    placeholder: "z. B. Frau Sauter"
  });
  const nicknameField = h("label", { class: "field", hidden: true },
    h("span", { class: "field__label" }, "Anzeigename"), nicknameInput);
  const captchaBox = h("div", { class: "captcha" });
  const submitBtn = h("button", { class: "btn btn--primary", type: "submit" }, "Anmelden");

  const tabSignin = h("button", { class: "btn", type: "button", "aria-pressed": "true" }, "Anmelden");
  const tabSignup = h("button", { class: "btn", type: "button", "aria-pressed": "false" }, "Registrieren");

  function setMode(next) {
    mode = next;
    const signup = next === "signup";
    tabSignin.setAttribute("aria-pressed", String(!signup));
    tabSignup.setAttribute("aria-pressed", String(signup));
    nicknameField.hidden = !signup;
    passwordInput.autocomplete = signup ? "new-password" : "current-password";
    submitBtn.textContent = signup ? "Konto erstellen" : "Anmelden";
    errorBox.hidden = true;
  }
  tabSignin.addEventListener("click", () => setMode("signin"));
  tabSignup.addEventListener("click", () => setMode("signup"));

  function fail(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  const form = h("form", { class: "card" },
    h("div", { class: "auth__tabs" }, tabSignin, tabSignup),
    errorBox,
    h("label", { class: "field" }, h("span", { class: "field__label" }, "E-Mail"), emailInput),
    h("label", { class: "field" }, h("span", { class: "field__label" }, "Passwort"), passwordInput),
    nicknameField,
    captchaBox,
    submitBtn
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const email = String(emailInput.value).trim().slice(0, 160);
    const password = String(passwordInput.value);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return fail("Bitte eine gueltige E-Mail-Adresse eingeben.");
    }
    if (password.length < 8) return fail("Das Passwort muss mindestens 8 Zeichen lang sein.");
    if (password.length > 72) return fail("Das Passwort darf hoechstens 72 Zeichen lang sein.");

    let captchaToken;
    if (captchaEnabled()) {
      captchaToken = captchaWidget !== null ? window.hcaptcha.getResponse(captchaWidget) : "";
      if (!captchaToken) return fail("Bitte zuerst das Captcha loesen.");
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Bitte warten…";
    try {
      if (mode === "signup") {
        const nickname = cleanName(nicknameInput.value, 60) || email.split("@")[0];
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { nickname }, captchaToken }
        });
        if (error) throw error;
        if (!data.session) {
          toast("Konto erstellt. Bitte E-Mail bestaetigen und danach anmelden.");
          setMode("signin");
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({
          email, password, options: { captchaToken }
        });
        if (error) throw error;
      }
    } catch (error) {
      fail(error?.message || "Anmeldung fehlgeschlagen.");
    } finally {
      if (captchaEnabled() && captchaWidget !== null) window.hcaptcha.reset(captchaWidget);
      submitBtn.disabled = false;
      submitBtn.textContent = mode === "signup" ? "Konto erstellen" : "Anmelden";
    }
  });

  appEl.replaceChildren(
    h("div", { class: "auth" },
      h("div", { class: "auth__brand" },
        h("h1", {}, "BehaviourTracker"),
        h("p", { class: "muted" }, "Verhalten im Unterricht sichtbar machen.")),
      form)
  );

  if (captchaEnabled()) {
    waitForHcaptcha()
      .then((hc) => { captchaWidget = hc.render(captchaBox, { sitekey: CONFIG.HCAPTCHA_SITE_KEY }); })
      .catch((error) => fail(error.message));
  }
}

/* -------------------------------------------------------------------
   Datenzugriff
   ------------------------------------------------------------------- */

const api = {
  async listClasses() {
    return unwrap(await sb.from("classes").select("id, name, students(count)").order("name"));
  },

  async createClass(name) {
    return unwrap(await sb.from("classes")
      .insert({ teacher_id: state.teacher.id, name })
      .select("id, name").single());
  },

  async deleteClass(id) {
    return unwrap(await sb.from("classes").delete().eq("id", id));
  },

  async getClass(id) {
    return unwrap(await sb.from("classes").select("id, name").eq("id", id).maybeSingle());
  },

  async listStudents(classId) {
    return unwrap(await sb.from("students").select("id, name").eq("class_id", classId).order("name"));
  },

  async createStudent(classId, name) {
    return unwrap(await sb.from("students")
      .insert({ class_id: classId, name })
      .select("id, name").single());
  },

  async deleteStudent(id) {
    return unwrap(await sb.from("students").delete().eq("id", id));
  },

  async getStudent(id) {
    return unwrap(await sb.from("students").select("id, name, class_id").eq("id", id).maybeSingle());
  },

  async listLessons() {
    return unwrap(await sb.from("lessons")
      .select("id, name, date, ended_at, created_at, class_id, classes(name)")
      .order("created_at", { ascending: false })
      .limit(200));
  },

  async getLesson(id) {
    return unwrap(await sb.from("lessons")
      .select("id, name, date, ended_at, class_id, classes(name)")
      .eq("id", id).maybeSingle());
  },

  // "column" ist in Postgres reserviert; PostgREST quotet den Bezeichner
  // korrekt, wir benennen ihn hier per Alias auf "col" um.
  async boardRows(lessonId) {
    return unwrap(await sb.from("lesson_students")
      .select("id, col:column, position, student_id, students(name)")
      .eq("lesson_id", lessonId)
      .order("position", { ascending: true }));
  },

  async openLogs(lessonId) {
    return unwrap(await sb.from("column_time_logs")
      .select("student_id, col:column, started_at")
      .eq("lesson_id", lessonId)
      .is("ended_at", null));
  },

  async studentTimes(studentId) {
    return unwrap(await sb.from("student_lesson_column_seconds")
      .select("lesson_id, lesson_name, lesson_date, col:column, seconds")
      .eq("student_id", studentId)
      .order("lesson_date", { ascending: false }));
  },

  async startLesson(classId) {
    return unwrap(await sb.rpc("start_lesson", { p_class_id: classId }));
  },

  async moveStudent(lessonId, studentId, column) {
    return unwrap(await sb.rpc("move_student", {
      p_lesson_id: lessonId, p_student_id: studentId, p_column: column
    }));
  },

  async endLesson(lessonId) {
    return unwrap(await sb.rpc("end_lesson", { p_lesson_id: lessonId }));
  },

  async reopenLesson(lessonId) {
    return unwrap(await sb.rpc("reopen_lesson", { p_lesson_id: lessonId }));
  }
};

/* -------------------------------------------------------------------
   Router
   ------------------------------------------------------------------- */

function navigate(hash) { window.location.hash = hash; }

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return raw.split("/").filter(Boolean).map(decodeURIComponent);
}

function setChrome({ title, back = null, showUser = true }) {
  topbarEl.hidden = false;
  topbarTitleEl.textContent = title;
  topbarUserEl.textContent = showUser && state.teacher ? state.teacher.nickname : "";
  if (back) {
    backBtn.hidden = false;
    backBtn.onclick = () => navigate(back);
  } else {
    backBtn.hidden = true;
    backBtn.onclick = null;
  }
}

const ROUTES = [
  { match: (p) => p.length === 0, view: (p) => renderMenu() },
  { match: (p) => p[0] === "classes" && p.length === 1, view: () => renderClassList() },
  { match: (p) => p[0] === "classes" && p[2] === "students" && p[3], view: (p) => renderStudentStats(p[1], p[3]) },
  { match: (p) => p[0] === "classes" && p.length === 2, view: (p) => renderClassDetail(p[1]) },
  { match: (p) => p[0] === "lessons" && p[1] === "new", view: () => renderNewLesson() },
  { match: (p) => p[0] === "lessons" && p.length === 2, view: (p) => renderBoard(p[1]) },
  { match: (p) => p[0] === "lessons" && p.length === 1, view: () => renderLessonList() }
];

async function router() {
  if (!sb) return;
  runCleanup();

  if (!state.session) { renderAuth(); return; }
  if (!state.teacher) {
    appEl.replaceChildren(loadingView());
    try {
      state.teacher = await ensureTeacher();
    } catch (error) {
      showError(error, "Lehrer-Profil konnte nicht geladen werden.");
      return;
    }
  }

  const parts = parseRoute();
  const route = ROUTES.find((r) => r.match(parts));
  if (!route) return navigate("/");

  try {
    await route.view(parts);
  } catch (error) {
    showError(error);
    appEl.replaceChildren(
      h("div", { class: "card" },
        h("p", {}, "Diese Ansicht konnte nicht geladen werden."),
        h("button", { class: "btn", onclick: () => router() }, "Erneut versuchen"))
    );
  }
}

/* -------------------------------------------------------------------
   Ansicht: Menue
   ------------------------------------------------------------------- */

function renderMenu() {
  appEl.className = "app";
  setChrome({ title: "BehaviourTracker" });
  appEl.replaceChildren(
    h("div", {},
      h("h2", {}, `Hallo ${state.teacher.nickname}`),
      h("p", { class: "muted" }, "Was moechtest du tun?"),
      h("div", { class: "menu" },
        h("button", { class: "menu__item", onclick: () => navigate("/classes") },
          h("h2", {}, "Klassen"),
          h("p", {}, "Klassen anlegen, Schuelerinnen und Schueler verwalten und Zeiten auswerten.")),
        h("button", { class: "menu__item", onclick: () => navigate("/lessons") },
          h("h2", {}, "Unterrichte"),
          h("p", {}, "Laufende und vergangene Unterrichte oeffnen oder einen neuen starten."))))
  );
}

/* -------------------------------------------------------------------
   Ansicht: Klassenliste
   ------------------------------------------------------------------- */

async function renderClassList() {
  appEl.className = "app";
  setChrome({ title: "Klassen", back: "/" });
  appEl.replaceChildren(loadingView());

  const classes = await api.listClasses();

  const nameInput = h("input", {
    class: "input", type: "text", maxlength: "80", placeholder: "Klassenname, z. B. 7b"
  });
  const addBtn = h("button", { class: "btn btn--primary", type: "submit" }, "Anlegen");

  const form = h("form", { class: "row row--form" }, nameInput, addBtn);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = cleanName(nameInput.value, 80);
    if (!name) return toast("Bitte einen Klassennamen eingeben.", "error");

    addBtn.disabled = true;
    try {
      await api.createClass(name);
      nameInput.value = "";
      await renderClassList();
      toast(`Klasse „${name}“ angelegt.`);
    } catch (error) {
      showError(error, "Klasse konnte nicht angelegt werden.");
    } finally {
      addBtn.disabled = false;
    }
  });

  const list = classes.length
    ? h("ul", { class: "list" }, classes.map((cls) => {
        const count = cls.students?.[0]?.count ?? 0;
        return h("li", { class: "list__item" },
          h("button", { class: "list__main", onclick: () => navigate(`/classes/${cls.id}`) },
            cls.name,
            h("span", { class: "list__sub" },
              count === 1 ? "1 Schuelerin/Schueler" : `${count} Schuelerinnen und Schueler`)),
          h("button", {
            class: "btn btn--sm btn--danger",
            onclick: () => confirmDelete(
              `Klasse „${cls.name}“ wirklich loeschen? Alle Schueler, Unterrichte und Zeiten dieser Klasse gehen verloren.`,
              async () => { await api.deleteClass(cls.id); await renderClassList(); toast("Klasse geloescht."); })
          }, "Loeschen"));
      }))
    : emptyView("Noch keine Klassen. Lege oben die erste an.");

  appEl.replaceChildren(
    h("div", { class: "stack" },
      h("div", { class: "card" }, h("h2", {}, "Neue Klasse"), form),
      h("div", { class: "card" }, list))
  );
}

/* -------------------------------------------------------------------
   Ansicht: Klassendetail (Schuelerliste)
   ------------------------------------------------------------------- */

async function renderClassDetail(classId) {
  appEl.className = "app";
  setChrome({ title: "Klasse", back: "/classes" });
  appEl.replaceChildren(loadingView());

  const cls = await api.getClass(classId);
  if (!cls) { toast("Klasse nicht gefunden.", "error"); return navigate("/classes"); }
  setChrome({ title: cls.name, back: "/classes" });

  const students = await api.listStudents(classId);

  // autofocus greift auch beim Neuaufbau nach dem Anlegen – so laesst sich
  // eine ganze Klassenliste ohne Mausklick eintippen.
  const nameInput = h("input", {
    class: "input", type: "text", maxlength: "80", autofocus: true,
    placeholder: "Name der Schuelerin / des Schuelers"
  });
  const addBtn = h("button", { class: "btn btn--primary", type: "submit" }, "Hinzufuegen");

  const form = h("form", { class: "row row--form" }, nameInput, addBtn);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = cleanName(nameInput.value, 80);
    if (!name) return toast("Bitte einen Namen eingeben.", "error");

    addBtn.disabled = true;
    try {
      await api.createStudent(classId, name);
      nameInput.value = "";
      await renderClassDetail(classId);
      toast(`„${name}“ hinzugefuegt.`);
    } catch (error) {
      showError(error, "Schueler konnte nicht angelegt werden.");
    } finally {
      addBtn.disabled = false;
    }
  });

  const list = students.length
    ? h("ul", { class: "list" }, students.map((student) =>
        h("li", { class: "list__item" },
          h("button", {
            class: "list__main",
            onclick: () => navigate(`/classes/${classId}/students/${student.id}`)
          }, student.name, h("span", { class: "list__sub" }, "Zeiten ansehen")),
          h("button", {
            class: "btn btn--sm btn--danger",
            onclick: () => confirmDelete(
              `„${student.name}“ wirklich aus der Klasse loeschen? Alle erfassten Zeiten gehen verloren.`,
              async () => { await api.deleteStudent(student.id); await renderClassDetail(classId); toast("Schueler geloescht."); })
          }, "Loeschen"))))
    : emptyView("Noch keine Schuelerinnen und Schueler in dieser Klasse.");

  appEl.replaceChildren(
    h("div", { class: "stack" },
      h("div", { class: "card" },
        h("h2", {}, "Schuelerin / Schueler hinzufuegen"), form),
      h("div", { class: "card" },
        h("h2", {}, "Klassenliste"),
        h("p", { class: "muted small" }, "Auf einen Namen tippen, um die Spaltenzeiten zu sehen."),
        list),
      h("div", { class: "card" },
        h("button", {
          class: "btn btn--primary",
          disabled: students.length === 0,
          onclick: () => startLessonFor(classId, cls.name)
        }, "Unterricht mit dieser Klasse starten")))
  );
}

/* -------------------------------------------------------------------
   Ansicht: Zeiten einer Schuelerin / eines Schuelers
   ------------------------------------------------------------------- */

async function renderStudentStats(classId, studentId) {
  appEl.className = "app";
  setChrome({ title: "Zeiten", back: `/classes/${classId}` });
  appEl.replaceChildren(loadingView());

  const student = await api.getStudent(studentId);
  if (!student) { toast("Schueler nicht gefunden.", "error"); return navigate(`/classes/${classId}`); }
  setChrome({ title: student.name, back: `/classes/${classId}` });

  const rows = await api.studentTimes(studentId);

  const totals = { links: 0, mitte: 0, rechts: 0 };
  const perLesson = new Map();
  for (const row of rows) {
    const seconds = Number(row.seconds) || 0;
    if (row.col in totals) totals[row.col] += seconds;
    if (!perLesson.has(row.lesson_id)) {
      perLesson.set(row.lesson_id, {
        name: row.lesson_name, date: row.lesson_date,
        links: 0, mitte: 0, rechts: 0
      });
    }
    const lesson = perLesson.get(row.lesson_id);
    if (row.col in lesson) lesson[row.col] += seconds;
  }

  const grandTotal = totals.links + totals.mitte + totals.rechts;
  const share = (value) => (grandTotal > 0 ? (value / grandTotal) * 100 : 0);

  const bar = h("div", { class: "stats__bar", role: "img",
    "aria-label": COLUMNS.map((c) => `${c.title}: ${Math.round(share(totals[c.key]))} Prozent`).join(", ") },
    COLUMNS.map((c) =>
      h("div", {
        class: `stats__seg stats__seg--${c.key}`,
        style: `width:${share(totals[c.key])}%`
      })));

  const tiles = h("div", { class: "stats__grid" },
    COLUMNS.map((c) =>
      h("div", { class: "stat" },
        h("div", { class: "stat__label" }, c.title),
        h("div", { class: "stat__value" }, formatDurationLong(totals[c.key])),
        h("div", { class: "stat__label" }, `${Math.round(share(totals[c.key]))} %`))));

  const lessons = [...perLesson.values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const table = lessons.length
    ? h("table", { class: "table" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Unterricht"),
          COLUMNS.map((c) => h("th", { class: "num" }, c.title)))),
        h("tbody", {}, lessons.map((lesson) =>
          h("tr", {},
            h("td", {}, lesson.name, h("span", { class: "list__sub" }, formatDate(lesson.date))),
            COLUMNS.map((c) => h("td", { class: "num" }, formatDurationLong(lesson[c.key])))))))
    : emptyView("Fuer diese Schuelerin / diesen Schueler wurden noch keine Zeiten erfasst.");

  appEl.replaceChildren(
    h("div", { class: "stack" },
      h("div", { class: "card" },
        h("h2", {}, "Gesamtzeiten"),
        h("p", { class: "muted small" },
          grandTotal > 0
            ? `Erfasst ueber ${lessons.length} ${lessons.length === 1 ? "Unterricht" : "Unterrichte"} – insgesamt ${formatDurationLong(grandTotal)}.`
            : "Noch keine Daten."),
        bar, tiles),
      h("div", { class: "card" },
        h("h2", {}, "Nach Unterricht"),
        table))
  );
}

/* -------------------------------------------------------------------
   Ansicht: Unterrichtsliste
   ------------------------------------------------------------------- */

async function renderLessonList() {
  appEl.className = "app";
  setChrome({ title: "Unterrichte", back: "/" });
  appEl.replaceChildren(loadingView());

  const lessons = await api.listLessons();

  const list = lessons.length
    ? h("ul", { class: "list" }, lessons.map((lesson) =>
        h("li", { class: "list__item" },
          h("button", { class: "list__main", onclick: () => navigate(`/lessons/${lesson.id}`) },
            lesson.name,
            h("span", { class: "list__sub" },
              `${lesson.classes?.name ?? "Klasse entfernt"} · ${formatDate(lesson.date)}`)),
          lesson.ended_at
            ? h("span", { class: "badge" }, "beendet")
            : h("span", { class: "badge badge--live" }, "laeuft"))))
    : emptyView("Noch keine Unterrichte. Starte oben den ersten.");

  appEl.replaceChildren(
    h("div", { class: "stack" },
      h("div", { class: "card" },
        h("h2", {}, "Neuer Unterricht"),
        h("p", { class: "muted small" },
          "Klasse auswaehlen – der Name wird automatisch aus Klasse und Datum gebildet."),
        h("button", { class: "btn btn--primary", onclick: () => navigate("/lessons/new") },
          "Unterricht starten")),
      h("div", { class: "card" },
        h("h2", {}, "Bisherige Unterrichte"),
        list))
  );
}

/* -------------------------------------------------------------------
   Ansicht: Neuen Unterricht starten
   ------------------------------------------------------------------- */

async function renderNewLesson() {
  appEl.className = "app";
  setChrome({ title: "Unterricht starten", back: "/lessons" });
  appEl.replaceChildren(loadingView());

  const classes = await api.listClasses();
  const usable = classes.filter((cls) => (cls.students?.[0]?.count ?? 0) > 0);

  if (!usable.length) {
    appEl.replaceChildren(
      h("div", { class: "card stack" },
        h("h2", {}, "Keine Klasse mit Schuelern"),
        h("p", { class: "muted" },
          "Lege zuerst eine Klasse an und trage Schuelerinnen und Schueler ein."),
        h("button", { class: "btn btn--primary", onclick: () => navigate("/classes") }, "Zu den Klassen"))
    );
    return;
  }

  const today = formatDate(new Date());

  appEl.replaceChildren(
    h("div", { class: "card" },
      h("h2", {}, "Klasse waehlen"),
      h("p", { class: "muted small" }, `Der Unterricht heisst dann „[Klasse] ${today}“.`),
      h("ul", { class: "list" }, usable.map((cls) =>
        h("li", { class: "list__item" },
          h("button", { class: "list__main", onclick: () => startLessonFor(cls.id, cls.name) },
            cls.name,
            h("span", { class: "list__sub" }, `${cls.name} ${today}`)),
          h("span", { class: "badge" }, `${cls.students?.[0]?.count ?? 0}`)))))
  );
}

async function startLessonFor(classId, className) {
  toast(`Unterricht fuer ${className} wird gestartet…`);
  try {
    const lessonId = await api.startLesson(classId);
    navigate(`/lessons/${lessonId}`);
  } catch (error) {
    showError(error, "Unterricht konnte nicht gestartet werden.");
  }
}

/* -------------------------------------------------------------------
   Ansicht: Board
   ------------------------------------------------------------------- */

async function renderBoard(lessonId) {
  // Board wird nach Beenden/Fortsetzen auch direkt neu aufgebaut – dabei
  // muss der Timer der vorherigen Instanz gestoppt werden.
  runCleanup();
  appEl.className = "app app--wide";
  setChrome({ title: "Unterricht", back: "/lessons" });
  appEl.replaceChildren(loadingView());

  const lesson = await api.getLesson(lessonId);
  if (!lesson) { toast("Unterricht nicht gefunden.", "error"); return navigate("/lessons"); }
  setChrome({ title: lesson.name, back: "/lessons" });

  const boardEl = h("div", { class: "board" });
  const headerEl = h("div", { class: "card row" });
  const timerNodes = new Map();   // student_id -> { el, startedAt }
  let busy = false;

  appEl.replaceChildren(h("div", { class: "stack" }, headerEl, boardEl));

  async function refresh() {
    const [rows, openLogs] = await Promise.all([
      api.boardRows(lessonId),
      api.openLogs(lessonId)
    ]);
    const startedAt = new Map(openLogs.map((log) => [log.student_id, new Date(log.started_at)]));
    draw(rows, startedAt);
  }

  function draw(rows, startedAt) {
    timerNodes.clear();
    const byColumn = { links: [], mitte: [], rechts: [] };
    for (const row of rows) {
      if (row.col in byColumn) byColumn[row.col].push(row);
    }
    for (const key of Object.keys(byColumn)) {
      byColumn[key].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }

    boardEl.replaceChildren(...COLUMNS.map((column) => {
      const body = h("div", { class: "column__body", dataset: { column: column.key } });

      for (const row of byColumn[column.key]) {
        body.append(studentCard(row, column.key, startedAt.get(row.student_id)));
      }
      if (!byColumn[column.key].length) {
        body.append(h("p", { class: "empty small" }, "–"));
      }

      // Drop-Ziel
      body.addEventListener("dragover", (event) => {
        // Nur direkt benachbarte Spalten sind gueltige Drop-Ziele.
        if (!dragFrom || !isAdjacent(dragFrom, column.key)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        body.parentElement.classList.add("column--dragover");
      });
      body.addEventListener("dragleave", () => body.parentElement.classList.remove("column--dragover"));
      body.addEventListener("drop", async (event) => {
        event.preventDefault();
        body.parentElement.classList.remove("column--dragover");
        const studentId = event.dataTransfer.getData("text/plain");
        if (studentId && dragFrom && isAdjacent(dragFrom, column.key)) {
          await move(studentId, column.key);
        }
      });

      return h("div", { class: `column column--${column.key}` },
        h("div", { class: "column__head" },
          column.title,
          h("span", { class: "column__count" }, String(byColumn[column.key].length))),
        body);
    }));
  }

  let dragFrom = null;

  function studentCard(row, columnKey, startedAtValue) {
    const index = columnIndex(columnKey);
    const left = COLUMNS[index - 1]?.key ?? null;
    const right = COLUMNS[index + 1]?.key ?? null;
    const name = row.students?.name ?? "Unbekannt";

    const timerEl = h("span", { class: "student__timer" }, "–");
    if (startedAtValue) timerNodes.set(row.student_id, { el: timerEl, startedAt: startedAtValue });

    const card = h("div", {
      class: "student",
      draggable: lesson.ended_at ? "false" : "true",
      dataset: { studentId: row.student_id, column: columnKey }
    },
      h("button", {
        class: "student__move", type: "button", disabled: !left || Boolean(lesson.ended_at),
        "aria-label": left ? `${name} nach „${COLUMN_TITLE[left]}“ verschieben` : "",
        onclick: () => left && move(row.student_id, left)
      }, "\u2190"),
      h("div", { class: "student__name" }, name, timerEl),
      h("button", {
        class: "student__move", type: "button", disabled: !right || Boolean(lesson.ended_at),
        "aria-label": right ? `${name} nach „${COLUMN_TITLE[right]}“ verschieben` : "",
        onclick: () => right && move(row.student_id, right)
      }, "\u2192"));

    card.addEventListener("dragstart", (event) => {
      if (lesson.ended_at) { event.preventDefault(); return; }
      dragFrom = columnKey;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.student_id);
      card.classList.add("student--dragging");
      // Nicht benachbarte Spalten optisch abblenden.
      boardEl.querySelectorAll(".column__body").forEach((el) => {
        if (!isAdjacent(columnKey, el.dataset.column)) {
          el.parentElement.classList.add("column--invalid");
        }
      });
    });
    card.addEventListener("dragend", () => {
      dragFrom = null;
      card.classList.remove("student--dragging");
      boardEl.querySelectorAll(".column--dragover, .column--invalid")
        .forEach((el) => el.classList.remove("column--dragover", "column--invalid"));
    });

    return card;
  }

  async function move(studentId, targetColumn) {
    if (busy || lesson.ended_at) return;
    busy = true;
    const card = boardEl.querySelector(`.student[data-student-id="${cssEscape(studentId)}"]`);
    card?.classList.add("student--busy");
    try {
      await api.moveStudent(lessonId, studentId, targetColumn);
      await refresh();
    } catch (error) {
      showError(error, "Verschieben fehlgeschlagen.");
      card?.classList.remove("student--busy");
    } finally {
      busy = false;
    }
  }

  function drawHeader() {
    const actions = lesson.ended_at
      ? h("button", { class: "btn", onclick: async () => {
          try { await api.reopenLesson(lessonId); await renderBoard(lessonId); toast("Unterricht fortgesetzt."); }
          catch (error) { showError(error); }
        } }, "Fortsetzen")
      : h("button", { class: "btn btn--primary", onclick: () => confirmDelete(
          "Unterricht jetzt beenden? Alle laufenden Zeiten werden gestoppt.",
          async () => { await api.endLesson(lessonId); await renderBoard(lessonId); toast("Unterricht beendet."); },
          "Beenden") }, "Unterricht beenden");

    headerEl.replaceChildren(
      h("div", { style: "flex:1 1 auto;min-width:0" },
        h("strong", {}, lesson.classes?.name ?? "Klasse"),
        h("span", { class: "list__sub" },
          `${formatDate(lesson.date)}${lesson.ended_at ? " · beendet" : " · laeuft"}`)),
      actions);
  }

  function tick() {
    const now = Date.now();
    for (const { el, startedAt } of timerNodes.values()) {
      el.textContent = formatClock((now - startedAt.getTime()) / 1000);
    }
  }

  drawHeader();
  await refresh();
  tick();

  if (!lesson.ended_at) {
    const interval = setInterval(tick, 1000);
    registerCleanup(() => clearInterval(interval));
  }
}

/** Minimaler CSS.escape-Ersatz fuer aeltere Browser. */
function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

/* -------------------------------------------------------------------
   Bestaetigungsdialog
   ------------------------------------------------------------------- */

function confirmDelete(message, onConfirm, confirmLabel = "Loeschen") {
  const panel = h("div", { class: "modal__panel" });
  const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, panel);

  const cancelBtn = h("button", { class: "btn", type: "button" }, "Abbrechen");
  const okBtn = h("button", { class: "btn btn--primary", type: "button" }, confirmLabel);

  const close = () => {
    modal.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => { if (event.key === "Escape") close(); };

  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.addEventListener("keydown", onKey);

  okBtn.addEventListener("click", async () => {
    okBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await onConfirm();
      close();
    } catch (error) {
      showError(error);
      close();
    }
  });

  panel.append(
    h("p", { style: "margin-top:0" }, message),
    h("div", { class: "row", style: "justify-content:flex-end" }, cancelBtn, okBtn)
  );
  document.body.append(modal);
  okBtn.focus();
}

/* -------------------------------------------------------------------
   Start
   ------------------------------------------------------------------- */

if (sb) {
  logoutBtn.addEventListener("click", async () => {
    await sb.auth.signOut();
    state.teacher = null;
    navigate("/");
  });

  window.addEventListener("hashchange", router);

  const { data: { session } } = await sb.auth.getSession();
  state.session = session;

  sb.auth.onAuthStateChange((event, nextSession) => {
    const changedUser = nextSession?.user?.id !== state.session?.user?.id;
    state.session = nextSession;
    if (changedUser) {
      state.teacher = null;
      router();
    }
  });

  await router();
}

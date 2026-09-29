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

/** Papierkorb-Icon als Inline-SVG. `document.createElement` erzeugt fuer
 * "svg" kein echtes SVGElement, deshalb per createElementNS statt ueber
 * h() gebaut. stroke="currentColor" macht es faerbbar (z. B. via
 * .btn--danger), anders als ein farbiges Emoji-Glyph. */
function trashIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "1.1em");
  svg.setAttribute("height", "1.1em");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of [
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6"
  ]) {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
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

/** Uhrzeit-Format fuer Countdowns: m:ss bzw. h:mm:ss. */
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
// Singular-/Pluralformen fuer die Live-Zaehlung in der sortierten Ansicht
// (z. B. "1 kann mehr | 5 arbeiten gut | 2 arbeiten großartig").
const STATE_LABELS = {
  links:  { one: "kann mehr",       many: "können mehr" },
  mitte:  { one: "arbeitet gut",    many: "arbeiten gut" },
  rechts: { one: "arbeitet großartig", many: "arbeiten großartig" }
};
const columnIndex = (key) => COLUMNS.findIndex((c) => c.key === key);
const isAdjacent = (from, to) => Math.abs(columnIndex(from) - columnIndex(to)) === 1;

/* -------------------------------------------------------------------
   Board-Layout: quadratische Schueler-Boxen, Groesse dynamisch berechnet
   ------------------------------------------------------------------- */

const BOARD_MIN_HEIGHT_PX = 320;
const BOARD_BOTTOM_MARGIN_PX = 16;
const BOX_GAP_PX = 10;
const BOX_MIN_FONT_REM = 1.1;
const BOX_FONT_RATIO = 0.22; // Schriftgroesse als Anteil der Boxgroesse

/** Groesste quadratische Boxgroesse, mit der `count` Kacheln ohne
 * Ueberlauf in width x height passen (Rasterberechnung wie bei
 * Videokonferenz-Kachel-Layouts: alle Spaltenzahlen durchprobieren). */
function bestSquareLayout(width, height, count, gap) {
  let best = { size: 0, cols: 1, rows: count };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const size = Math.min(
      (width - (cols - 1) * gap) / cols,
      (height - (rows - 1) * gap) / rows
    );
    if (size > best.size) best = { size, cols, rows };
  }
  return best;
}

/** Spaltenbreiten (flex-grow) und Boxgroessen im Board neu berechnen.
 * Muss nach jeder DOM-Aenderung des Boards sowie bei Groessenaenderungen
 * des Containers erneut aufgerufen werden. */
function layoutBoard(boardEl) {
  const availableHeight = Math.max(
    BOARD_MIN_HEIGHT_PX,
    window.innerHeight - boardEl.getBoundingClientRect().top - BOARD_BOTTOM_MARGIN_PX
  );
  boardEl.style.height = `${availableHeight}px`;

  const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const minFontPx = BOX_MIN_FONT_REM * rootFontPx;
  const minBoxPx = minFontPx / BOX_FONT_RATIO;

  const bodies = [...boardEl.querySelectorAll(".column__body")];

  // Phase 1: flex-grow fuer ALLE Spalten setzen, bevor irgendeine Breite
  // gelesen wird. Wuerden Setzen und Lesen pro Spalte verschachtelt
  // ablaufen, saehe eine fruehe Spalte noch die alten (bzw. bei frisch
  // gebauten Spalten die Default-) flex-grow-Werte ihrer Geschwister und
  // wuerde dadurch mit einer voruebergehend falschen Breite rechnen.
  const counts = bodies.map((body) => {
    const count = body.querySelectorAll(".student").length;
    body.parentElement.style.flexGrow = String(count);
    return count;
  });

  // Phase 2: erst jetzt, wo alle Spalten ihre endgueltige Breite haben,
  // die Boxgroessen berechnen.
  bodies.forEach((body, i) => {
    const count = counts[i];
    if (!count) {
      body.style.gridTemplateColumns = "";
      body.style.gridAutoRows = "";
      body.style.overflowY = "";
      return;
    }

    const cards = body.querySelectorAll(".student");
    const cs = getComputedStyle(body);
    const width = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const height = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (width <= 0 || height <= 0) return;

    // Zuerst die Boxgroesse ohne Untergrenze ausrechnen. Wuerde die
    // Schrift dabei die Mindestgroesse unterschreiten, Boxgroesse auf
    // das erzwungene Minimum einfrieren und stattdessen vertikal scrollen.
    let layout = bestSquareLayout(width, height, count, BOX_GAP_PX);
    let overflowY = "hidden";
    if (layout.size < minBoxPx) {
      const size = minBoxPx;
      const cols = Math.max(1, Math.min(count, Math.floor((width + BOX_GAP_PX) / (size + BOX_GAP_PX))));
      layout = { size, cols, rows: Math.ceil(count / cols) };
      overflowY = "auto";
    }

    const fontPx = Math.max(minFontPx, layout.size * BOX_FONT_RATIO);
    body.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.size}px)`;
    body.style.gridAutoRows = `${layout.size}px`;
    body.style.gap = `${BOX_GAP_PX}px`;
    body.style.overflowY = overflowY;
    cards.forEach((card) => { card.style.fontSize = `${fontPx}px`; });
  });
}

/** Wie layoutBoard(), aber fuer die "Sortierte Ansicht": ein einzelnes
 * Raster ueber ALLE Schueler statt drei Spalten. Anders als im Kanban-Board
 * gibt es hier keinen Scroll-Fallback: Prioritaet ist, dass alle Schueler
 * gleichzeitig sichtbar bleiben, notfalls auf Kosten der Mindestschriftgroesse. */
function layoutStudentGrid(gridEl) {
  const availableHeight = Math.max(
    BOARD_MIN_HEIGHT_PX,
    window.innerHeight - gridEl.getBoundingClientRect().top - BOARD_BOTTOM_MARGIN_PX
  );
  gridEl.style.height = `${availableHeight}px`;

  const cards = gridEl.querySelectorAll(".student");
  const count = cards.length;
  if (!count) return;

  const cs = getComputedStyle(gridEl);
  const width = gridEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const height = gridEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (width <= 0 || height <= 0) return;

  const layout = bestSquareLayout(width, height, count, BOX_GAP_PX);
  const fontPx = Math.max(1, layout.size * BOX_FONT_RATIO);

  gridEl.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.size}px)`;
  gridEl.style.gridAutoRows = `${layout.size}px`;
  gridEl.style.gap = `${BOX_GAP_PX}px`;
  cards.forEach((card) => { card.style.fontSize = `${fontPx}px`; });
}

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
      .select("id, name, date, ended_at, class_id, mode, classes(name)")
      .eq("id", id).maybeSingle());
  },

  async deleteLesson(id) {
    return unwrap(await sb.from("lessons").delete().eq("id", id));
  },

  // "column" ist in Postgres reserviert; PostgREST quotet den Bezeichner
  // korrekt, wir benennen ihn hier per Alias auf "col" um.
  async boardRows(lessonId) {
    return unwrap(await sb.from("lesson_students")
      .select("id, col:column, position, student_id, students(name)")
      .eq("lesson_id", lessonId)
      .order("position", { ascending: true }));
  },

  async studentTimes(studentId) {
    return unwrap(await sb.from("student_lesson_column_seconds")
      .select("lesson_id, lesson_name, lesson_date, col:column, seconds")
      .eq("student_id", studentId)
      .order("lesson_date", { ascending: false }));
  },

  async startLesson(classId, mode) {
    return unwrap(await sb.rpc("start_lesson", { p_class_id: classId, p_mode: mode }));
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
  },

  async listFocusClasses() {
    return unwrap(await sb.from("classes")
      .select("id, name, focus_reward, focus_reward_goal, focus_reward_offset, focus_trees(id, goal_seconds, created_at)")
      .order("name"));
  },

  async plantTree(classId, goalSeconds) {
    return unwrap(await sb.from("focus_trees")
      .insert({ class_id: classId, goal_seconds: goalSeconds })
      .select("id, goal_seconds, created_at").single());
  },

  async updateFocusReward(classId, fields) {
    return unwrap(await sb.from("classes").update(fields).eq("id", classId));
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
  { match: (p) => p[0] === "lessons" && p.length === 1, view: () => renderLessonList() },
  { match: (p) => p[0] === "focus" && p.length === 1, view: () => renderFocusHome() },
  { match: (p) => p[0] === "focus" && p.length === 2, view: (p) => renderFocusRoom(p[1]) }
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
          h("p", {}, "Laufende und vergangene Unterrichte oeffnen oder einen neuen starten.")),
        h("button", { class: "menu__item", onclick: () => navigate("/focus") },
          h("h2", {}, "Fokus-Wald"),
          h("p", {}, "Lautstaerke-Monitor fuer den Beamer: Ist die Klasse ruhig, waechst ein Baum im Klassenwald."))))
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

  const nameInput = h("input", {
    class: "input", type: "text", maxlength: "80",
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
  // `autofocus` greift beim dynamischen Neuaufbau nach dem Anlegen nicht
  // zuverlaessig – deshalb explizit fokussieren, damit sich eine ganze
  // Klassenliste ohne Mausklick eintippen laesst.
  nameInput.focus();
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
            : h("span", { class: "badge badge--live" }, "laeuft"),
          h("button", {
            class: "btn btn--sm btn--danger btn--icon", type: "button", "aria-label": "Unterricht löschen",
            onclick: () => confirmDelete(
              `Unterricht „${lesson.name}“ wirklich loeschen? Alle erfassten Zeiten dieses Unterrichts gehen unwiderruflich verloren.`,
              async () => { await api.deleteLesson(lesson.id); await renderLessonList(); toast("Unterricht geloescht."); })
          }, trashIcon()))))
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
  const mode = await pickLessonMode();
  if (!mode) return;

  toast(`Unterricht fuer ${className} wird gestartet…`);
  try {
    const lessonId = await api.startLesson(classId, mode);
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

  const sorted = lesson.mode === "sortiert";
  const boardEl = h("div", { class: sorted ? "sorted-grid" : "board" });
  const headerEl = h("div", { class: sorted ? "card board-header" : "card row" });
  const statsEl = h("div", { class: "board-stats" });
  let busy = false;

  appEl.replaceChildren(h("div", { class: "stack" }, headerEl, boardEl));

  const layout = () => (sorted ? layoutStudentGrid(boardEl) : layoutBoard(boardEl));

  // Groesse und Grid haengen von der verfuegbaren Flaeche ab – bei
  // Groessenaenderungen des Containers (Fenster, Zoom, Orientierung) neu
  // berechnen. Aenderungen durch Drag & Drop bzw. Klick loest draw() selbst aus.
  const boardResizeObserver = new ResizeObserver(layout);
  boardResizeObserver.observe(boardEl);
  registerCleanup(() => boardResizeObserver.disconnect());

  window.addEventListener("resize", layout);
  registerCleanup(() => window.removeEventListener("resize", layout));

  async function refresh() {
    const rows = await api.boardRows(lessonId);
    draw(rows);
  }

  function draw(rows) {
    if (sorted) drawSorted(rows); else drawKanban(rows);
  }

  function drawSorted(rows) {
    const items = [...rows].sort((a, b) =>
      (a.students?.name ?? "").localeCompare(b.students?.name ?? "", "de"));
    boardEl.replaceChildren(...items.map((row) => studentTile(row)));
    layoutStudentGrid(boardEl);
    updateStats(rows);
  }

  function updateStats(rows) {
    const counts = { links: 0, mitte: 0, rechts: 0 };
    for (const row of rows) {
      if (row.col in counts) counts[row.col]++;
    }
    statsEl.textContent = COLUMNS
      .map((c) => {
        const n = counts[c.key];
        return `${n} ${n === 1 ? STATE_LABELS[c.key].one : STATE_LABELS[c.key].many}`;
      })
      .join(" | ");
  }

  function drawKanban(rows) {
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
        body.append(studentCard(row, column.key));
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
    layoutBoard(boardEl);
  }

  let dragFrom = null;

  function studentCard(row, columnKey) {
    const name = row.students?.name ?? "Unbekannt";

    const card = h("div", {
      class: "student",
      draggable: lesson.ended_at ? "false" : "true",
      dataset: { studentId: row.student_id, column: columnKey }
    },
      h("div", { class: "student__name" }, name));

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

  function studentTile(row) {
    const name = row.students?.name ?? "Unbekannt";

    const tile = h("div", {
      class: "student",
      dataset: { studentId: row.student_id, column: row.col }
    },
      h("div", { class: "student__name" }, name));

    // Linke Haelfte der Box = einen Zustand zurueck, rechte Haelfte = vor.
    tile.addEventListener("click", (event) => {
      if (lesson.ended_at) return;
      const rect = tile.getBoundingClientRect();
      const forward = event.clientX - rect.left > rect.width / 2;
      const target = COLUMNS[columnIndex(row.col) + (forward ? 1 : -1)]?.key;
      if (target) move(row.student_id, target);
    });

    return tile;
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

    const info = h("div", { style: sorted ? "min-width:0" : "flex:1 1 auto;min-width:0" },
      h("strong", {}, lesson.classes?.name ?? "Klasse"),
      h("span", { class: "list__sub" },
        `${formatDate(lesson.date)}${lesson.ended_at ? " · beendet" : " · laeuft"}`));

    headerEl.replaceChildren(...(sorted ? [info, statsEl, actions] : [info, actions]));
  }

  drawHeader();
  await refresh();
}

/** Minimaler CSS.escape-Ersatz fuer aeltere Browser. */
function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

/* -------------------------------------------------------------------
   Fokus-Wald: Lautstaerke-Monitor mit Klassenwald
   -------------------------------------------------------------------
   Mechanik wie "Mio's Monster Meter": Solange es ruhig ist, laeuft der
   Timer; bei Unruhe pausiert er, bei anhaltendem Laerm geht es von vorn
   los. Statt eines Monsters waechst ein Baum, und jedes erreichte Ziel
   pflanzt ihn dauerhaft in den Wald der Klasse. Sammlung, Klassen-
   Ranking und eine selbst gewaehlte Belohnung ziehen auch bei aelteren
   Schuelern, bei denen ein Kuschelmonster nicht mehr wirkt.

   Audio wird nur im Browser ausgewertet (Pegel pro Frame), nichts wird
   aufgenommen oder uebertragen. Gespeichert wird nur der fertige Baum.
   ------------------------------------------------------------------- */

const FOCUS_PROBE = "probelauf";
const FOCUS_GOALS_MIN = [3, 5, 10, 15, 20, 30, 45];
const FOCUS_TICK_MS = 50;
/** Zonengrenzen auf der Pegelskala 0–100 (nach Empfindlichkeit), wie bei Mio. */
const FOCUS_ZONES = { unruhig: 25, laut: 50 };
/** So lange muss eine neue Zone anliegen, bevor sie gilt – filtert Einzelgeraeusche. */
const FOCUS_ZONE_DWELL_MS = { ruhig: 800, unruhig: 300, laut: 300 };
/** So lange darf es "laut" sein, bevor der Baum vertrocknet. */
const FOCUS_WITHER_MS = 1500;
/** Dauer der Vertrocknen-Animation, danach startet ein neuer Samen. */
const FOCUS_WITHER_ANIM_MS = 2300;
/** Unterhalb dieser Wachstumszeit wird ohne Animation zurueckgesetzt. */
const FOCUS_MIN_WITHER_SECONDS = 5;
const PREF_FOCUS_GOAL = "bt.focus.goal";
const PREF_FOCUS_SENSITIVITY = "bt.focus.sensitivity";

/** Browser-lokale Einstellungen; darf fehlschlagen (privater Modus etc.). */
function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* nur Komfort */ }
}

function isMissingFocusSchema(error) {
  return ["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error?.code);
}

const treesLabel = (n) => (n === 1 ? "1 Baum" : `${n} Baeume`);

/* ---------- Baeume (SVG) ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Wie h(), nur fuer SVG-Elemente. */
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Laengere Ziele lassen seltenere Baeume wachsen – ein Sammelanreiz. */
const TREE_SPECIES = {
  laub:   { name: "Laubbaum" },
  tanne:  { name: "Tanne" },
  kirsch: { name: "Kirschbaum" }
};

function speciesForGoal(seconds) {
  if (seconds >= 20 * 60) return "kirsch";
  if (seconds >= 10 * 60) return "tanne";
  return "laub";
}

const circles = (list) => list.map(([cx, cy, r]) => ({ cx, cy, r }));

// Koordinaten im viewBox 0 0 200 240, Stammfuss bei (100, 222).
// Blaetter stehen in der Reihenfolge, in der sie beim Wachsen erscheinen.
const TREE_SHAPES = {
  laub: {
    wood: "#7a5536",
    trunk: "M93 222 C95 190 96 160 97 118 L103 118 C104 160 105 190 107 222 Z",
    branches: ["M98 164 C90 154 82 144 74 130", "M102 152 C110 144 118 136 126 126"],
    leaves: circles([[100, 112, 26], [74, 120, 24], [126, 118, 24], [100, 86, 32], [70, 94, 24],
      [130, 92, 24], [86, 64, 24], [116, 62, 24], [100, 46, 20]]),
    colors: ["#2f9e57", "#3fb56a", "#27874a"],
    blossoms: []
  },
  tanne: {
    wood: "#6b4a2f",
    trunk: "M95 222 L96 190 L104 190 L105 222 Z",
    branches: [],
    leaves: [[198, 128, 52], [174, 110, 50], [150, 92, 46], [126, 74, 42], [102, 56, 38], [80, 38, 34]]
      .map(([y, w, hh]) => ({ points: `${100 - w / 2},${y} ${100 + w / 2},${y} 100,${y - hh}` })),
    colors: ["#166534", "#1d7a41"],
    blossoms: []
  },
  kirsch: {
    wood: "#5b3a29",
    trunk: "M93 222 C95 192 96 164 97 122 L103 122 C104 164 105 192 107 222 Z",
    branches: ["M98 170 C86 160 74 150 64 138", "M102 160 C114 150 126 142 136 132",
      "M99 140 C92 128 88 116 84 104", "M101 136 C108 124 112 114 116 104"],
    leaves: circles([[100, 112, 24], [66, 122, 20], [134, 120, 20], [84, 96, 26], [116, 96, 26],
      [56, 100, 18], [144, 98, 18], [100, 76, 26], [76, 72, 20], [124, 72, 20], [100, 54, 18]]),
    colors: ["#f9a8d4", "#f472b6", "#fbcfe8"],
    blossoms: [[80, 110], [118, 104], [96, 90], [64, 118], [136, 112], [108, 70],
      [86, 62], [124, 82], [70, 90], [132, 96], [100, 50], [92, 112]]
  }
};

const TREE_MOODS = ["calm", "uneasy", "loud", "withered", "done", "paused"];

/**
 * Baut einen Baum, der ueber setProgress(0..1) waechst.
 * still = statische Variante fuer Wald und Symbole (ohne Keimling/Animation).
 */
function buildTree(speciesKey, { still = false } = {}) {
  const shape = TREE_SHAPES[speciesKey] || TREE_SHAPES.laub;

  const leafEls = shape.leaves.map((leaf, i) => {
    const attrs = { class: "leaf", fill: shape.colors[i % shape.colors.length], style: `--i:${i}` };
    return leaf.points
      ? svg("polygon", { ...attrs, points: leaf.points })
      : svg("circle", { ...attrs, cx: leaf.cx, cy: leaf.cy, r: leaf.r });
  });
  const blossomEls = shape.blossoms.map(([cx, cy], i) =>
    svg("circle", { class: "leaf leaf--blossom", cx, cy, r: 3.2, fill: "#fff7fb", style: `--i:${i + leafEls.length}` }));

  const scaleEl = svg("g", { class: "tree__scale" },
    svg("g", { class: "tree__motion" },
      svg("path", { d: shape.trunk, fill: shape.wood }),
      shape.branches.map((d) => svg("path", {
        d, fill: "none", stroke: shape.wood, "stroke-width": 5, "stroke-linecap": "round"
      })),
      leafEls,
      blossomEls));

  const sproutEl = still ? null : svg("g", { class: "tree__sprout" },
    svg("path", { d: "M100 216 C100 210 100 206 101 200", fill: "none", stroke: "#4d9a45", "stroke-width": 3, "stroke-linecap": "round" }),
    svg("ellipse", { cx: 93, cy: 200, rx: 8, ry: 4, fill: "#5cb85c", transform: "rotate(-28 93 200)" }),
    svg("ellipse", { cx: 108, cy: 198, rx: 8, ry: 4, fill: "#6fcf6f", transform: "rotate(24 108 198)" }));

  const el = svg("svg", {
    class: `tree${still ? " tree--still" : ""}`, viewBox: "0 0 200 240",
    "aria-hidden": "true", focusable: "false"
  },
    still ? svg("ellipse", { class: "tree__shadow", cx: 100, cy: 223, rx: 46, ry: 5 }) : null,
    sproutEl,
    scaleEl,
    // Der Erdhuegel liegt vor dem Stammfuss.
    still ? null : svg("path", { class: "tree__soil", d: "M48 226 Q100 202 152 226 Z" }));

  function setProgress(value, { instant = false } = {}) {
    const p = Math.min(1, Math.max(0, value));
    if (instant) el.classList.add("tree--instant");

    // Erst Keimling, dann waechst der Baum; ease-out macht fruehen Fortschritt sichtbar.
    const grow = Math.min(1, Math.max(0, (p - 0.08) / 0.92));
    const scale = 0.22 + 0.78 * (1 - (1 - grow) ** 2);
    scaleEl.style.transform = `scale(${scale.toFixed(3)})`;
    scaleEl.style.opacity = p >= 0.08 ? "1" : "0";
    if (sproutEl) sproutEl.style.opacity = p < 0.08 ? "1" : "0";
    leafEls.forEach((leaf, i) => leaf.classList.toggle("is-on", p >= 0.18 + (0.72 * i) / leafEls.length));
    blossomEls.forEach((b, i) => b.classList.toggle("is-on", p >= 0.9 + (0.1 * i) / blossomEls.length));

    if (instant) {
      el.getBoundingClientRect();   // Styles ohne Transition uebernehmen
      requestAnimationFrame(() => el.classList.remove("tree--instant"));
    }
  }

  function setMood(mood) {
    for (const m of TREE_MOODS) el.classList.toggle(`tree--${m}`, m === mood);
  }

  return { el, setProgress, setMood };
}

function stillTree(speciesKey, heightRem, label) {
  const tree = buildTree(speciesKey, { still: true });
  tree.setProgress(1);
  tree.el.style.height = `${heightRem.toFixed(2)}rem`;
  tree.el.style.width = `${(heightRem * 200 / 240).toFixed(2)}rem`;
  if (label) tree.el.append(svg("title", {}, label));
  return tree.el;
}

/** Wald einer Klasse; groessere Ziele ergeben groessere Baeume. */
function forestView(trees, { limit = Infinity, scale = 1 } = {}) {
  const sorted = [...trees]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(-limit);
  return h("div", { class: "forest", role: "img", "aria-label": treesLabel(trees.length) },
    sorted.map((tree) => {
      const species = speciesForGoal(tree.goal_seconds);
      const minutes = Math.round(tree.goal_seconds / 60);
      const height = (2.4 + Math.min(1, tree.goal_seconds / 2700) * 2.2) * scale;
      return stillTree(species, height,
        `${TREE_SPECIES[species].name} · ${minutes} min · ${formatDate(tree.created_at)}`);
    }));
}

function progressBar(fraction) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
    h("div", { class: "progress__fill", style: `width:${pct}%` }));
}

/* ---------- Auswertung ---------- */

function forestStats(cls) {
  const trees = cls.focus_trees || [];
  const seconds = trees.reduce((sum, t) => sum + (Number(t.goal_seconds) || 0), 0);
  return { count: trees.length, minutes: Math.round(seconds / 60) };
}

/** Ranking nach Fokus-Minuten; gleiche Minuten teilen sich den Platz. */
function focusRanking(classes) {
  const entries = classes.map((cls) => ({ cls, ...forestStats(cls) }));
  for (const entry of entries) {
    entry.rank = 1 + entries.filter((other) => other.minutes > entry.minutes).length;
  }
  return entries.sort((a, b) =>
    a.rank - b.rank || b.count - a.count || a.cls.name.localeCompare(b.cls.name, "de"));
}

/** Fortschritt zur Belohnung; gezaehlt wird ab focus_reward_offset. */
function rewardProgress(cls) {
  if (!cls?.focus_reward || !cls.focus_reward_goal) return null;
  const earned = Math.max(0, (cls.focus_trees?.length ?? 0) - (cls.focus_reward_offset ?? 0));
  return {
    text: cls.focus_reward,
    goal: cls.focus_reward_goal,
    done: Math.min(earned, cls.focus_reward_goal),
    reached: earned >= cls.focus_reward_goal
  };
}

/* ---------- Mikrofon ---------- */

function micErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Der Mikrofonzugriff wurde verweigert. Bitte im Browser fuer diese Seite erlauben.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Es wurde kein Mikrofon gefunden.";
    case "NotReadableError":
      return "Das Mikrofon wird gerade von einem anderen Programm benutzt.";
    default:
      return error?.message || "Das Mikrofon konnte nicht gestartet werden.";
  }
}

/**
 * Pegelmessung per Web Audio. Kalibrierung wie bei Mio: RMS ueber das
 * Byte-Spektrum (fftSize 256), mal Empfindlichkeit, gekappt auf 0–100.
 */
function createNoiseMeter() {
  let ctx = null;
  let stream = null;
  let source = null;
  let analyser = null;
  let data = null;
  let smoothed = 0;
  let lastAt = 0;

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Mikrofonzugriff ist hier nicht moeglich (HTTPS erforderlich).");
    }
    // Noch synchron im Klick-Handler anlegen, sonst startet er "suspended".
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw new Error(micErrorMessage(error));
    }
    if (ctx.state === "suspended") await ctx.resume();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    // Wird pro Abruf angewandt; bei 20 Hz entspricht 0.85 etwa Mios 0.95 bei 60 fps.
    analyser.smoothingTimeConstant = 0.85;
    source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    data = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Aktueller, leicht geglaetteter Pegel 0–100. */
  function read(sensitivity) {
    if (!analyser) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = (Math.sqrt(sum / data.length) / 255) * 100;
    const gain = sensitivity < 1 ? sensitivity * sensitivity : sensitivity;
    const level = Math.min(100, rms * gain);

    const now = performance.now();
    const dt = lastAt ? (now - lastAt) / 1000 : FOCUS_TICK_MS / 1000;
    lastAt = now;
    smoothed += (level - smoothed) * (1 - Math.exp(-dt / 0.2));
    return smoothed;
  }

  function stop() {
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
    ctx = stream = source = analyser = null;
  }

  return { start, read, stop };
}

/* ---------- Ansicht: Fokus-Wald Uebersicht ---------- */

function renderFocusSchemaHint() {
  appEl.replaceChildren(
    h("div", { class: "card stack" },
      h("h2", {}, "Datenbank-Update fehlt"),
      h("p", { class: "muted" },
        "Fuer den Fokus-Wald muss einmalig die Migration supabase/migrations/0003_focus.sql " +
        "im Supabase SQL-Editor ausgefuehrt werden."),
      h("button", { class: "btn", onclick: () => navigate(`/focus/${FOCUS_PROBE}`) },
        "Probelauf ohne Speichern"))
  );
}

async function renderFocusHome() {
  appEl.className = "app";
  setChrome({ title: "Fokus-Wald", back: "/" });
  appEl.replaceChildren(loadingView());

  let classes;
  try {
    classes = await api.listFocusClasses();
  } catch (error) {
    if (isMissingFocusSchema(error)) return renderFocusSchemaHint();
    throw error;
  }

  const ranking = focusRanking(classes);
  const list = ranking.length
    ? h("ol", { class: "list" }, ranking.map((entry) =>
        h("li", { class: "list__item" },
          h("span", { class: "rank", "aria-label": `Platz ${entry.rank}` }, String(entry.rank)),
          h("button", { class: "list__main", onclick: () => navigate(`/focus/${entry.cls.id}`) },
            entry.cls.name,
            h("span", { class: "list__sub" },
              `${treesLabel(entry.count)} · ${entry.minutes} Fokus-Minuten`)))))
    : emptyView("Noch keine Klassen. Lege zuerst unter „Klassen“ eine an.");

  appEl.replaceChildren(
    h("div", { class: "stack" },
      h("div", { class: "card" },
        h("h2", {}, "Fokus-Wald"),
        h("p", { class: "muted small" },
          "Ein Lautstaerke-Monitor fuer Stillarbeit auf dem Beamer: Solange es ruhig ist, waechst ein Baum. " +
          "Wird es zu laut, vertrocknet er. Jeder fertige Baum wird im Wald der Klasse gepflanzt – " +
          "Klassen sammeln Baeume, vergleichen sich im Ranking und arbeiten auf eine selbst gewaehlte Belohnung hin."),
        h("button", { class: "btn", onclick: () => navigate(`/focus/${FOCUS_PROBE}`) },
          "Probelauf ohne Klasse")),
      h("div", { class: "card" },
        h("h2", {}, "Klassen-Ranking"),
        h("p", { class: "muted small" }, "Klasse antippen, um ihren Wald zu sehen und eine Fokus-Phase zu starten."),
        list))
  );
}

/* ---------- Ansicht: Fokus-Wald einer Klasse ---------- */

async function renderFocusRoom(classId) {
  appEl.className = "app";
  setChrome({ title: "Fokus-Wald", back: "/focus" });
  appEl.replaceChildren(loadingView());

  // Wird beim Verlassen der Ansicht gesetzt – z. B. waehrend der
  // Mikrofon-Abfrage des Browsers.
  let disposed = false;
  registerCleanup(() => { disposed = true; });

  const probe = classId === FOCUS_PROBE;
  let classes = [];
  let cls = null;
  if (!probe) {
    try {
      classes = await api.listFocusClasses();
    } catch (error) {
      if (isMissingFocusSchema(error)) return renderFocusSchemaHint();
      throw error;
    }
    cls = classes.find((c) => c.id === classId) ?? null;
    if (!cls) { toast("Klasse nicht gefunden.", "error"); return navigate("/focus"); }
    cls.focus_trees ??= [];
  }

  let goalMinutes = readPref(PREF_FOCUS_GOAL, 10);
  if (!FOCUS_GOALS_MIN.includes(goalMinutes)) goalMinutes = 10;

  showSetup();

  /* ----- Vorbereitung (Lehrkraft) ----- */

  function showSetup() {
    appEl.className = "app";
    setChrome({ title: probe ? "Fokus-Wald: Probelauf" : `Fokus-Wald: ${cls.name}`, back: "/focus" });

    const goalButtons = FOCUS_GOALS_MIN.map((minutes) => {
      const species = speciesForGoal(minutes * 60);
      const btn = h("button", { class: "goal", type: "button", "aria-pressed": String(minutes === goalMinutes) },
        stillTree(species, 3),
        h("span", { class: "goal__min" }, `${minutes} min`),
        h("span", { class: "goal__species" }, TREE_SPECIES[species].name));
      btn.addEventListener("click", () => {
        goalMinutes = minutes;
        writePref(PREF_FOCUS_GOAL, minutes);
        for (const other of goalButtons) other.setAttribute("aria-pressed", String(other === btn));
      });
      return btn;
    });

    const startBtn = h("button", { class: "btn btn--primary btn--lg", type: "button" }, "Mikrofon an und los");
    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      const noise = createNoiseMeter();
      try {
        await noise.start();
      } catch (error) {
        noise.stop();
        startBtn.disabled = false;
        return showError(error, "Das Mikrofon konnte nicht gestartet werden.");
      }
      if (disposed) { noise.stop(); return; }
      runSession(noise, goalMinutes * 60);
    });

    const startCard = h("div", { class: "card" },
      h("h2", {}, "Ziel waehlen"),
      h("p", { class: "muted small" },
        "So lange muss es insgesamt ruhig sein, bis der Baum ausgewachsen ist. " +
        "Laengere Ziele lassen seltenere Baeume wachsen."),
      h("div", { class: "goals" }, goalButtons),
      startBtn,
      h("p", { class: "muted small" },
        "Das Mikrofon misst nur die Lautstaerke – direkt im Browser. " +
        "Es wird nichts aufgenommen, gespeichert oder uebertragen." +
        (probe ? " Im Probelauf wird auch kein Baum gespeichert." : "")),
      h("details", { class: "small muted" },
        h("summary", {}, "So funktioniert es"),
        h("ul", { class: "rules" },
          h("li", {}, "Gruen (ruhig): Der Timer laeuft, der Baum waechst."),
          h("li", {}, "Gelb (unruhig): Der Timer pausiert."),
          h("li", {}, "Rot (laenger als ca. 1,5 s zu laut): Der Baum vertrocknet, es beginnt ein neuer Samen."),
          h("li", {}, "Beim Erklaeren auf „Pause“ tippen oder die Leertaste druecken – sonst zaehlt die eigene Stimme mit."),
          h("li", {}, "Mit dem Regler „Empfindlichkeit“ an Raum und Mikrofon anpassen; der Probelauf eignet sich zum Einstellen."))));

    if (probe) {
      appEl.replaceChildren(h("div", { class: "stack" }, startCard));
      return;
    }

    const stats = forestStats(cls);
    const rank = 1 + classes.filter((c) => c.id !== cls.id && forestStats(c).minutes > stats.minutes).length;
    const reward = rewardProgress(cls);

    const forestCard = h("div", { class: "card" },
      h("h2", {}, `Wald von ${cls.name}`),
      h("div", { class: "stats__grid" },
        h("div", { class: "stat" },
          h("div", { class: "stat__label" }, "Baeume"),
          h("div", { class: "stat__value" }, String(stats.count))),
        h("div", { class: "stat" },
          h("div", { class: "stat__label" }, "Fokus-Minuten"),
          h("div", { class: "stat__value" }, String(stats.minutes))),
        h("div", { class: "stat" },
          h("div", { class: "stat__label" }, "Ranking"),
          h("div", { class: "stat__value" }, `Platz ${rank}`),
          h("div", { class: "stat__label" }, `von ${classes.length} ${classes.length === 1 ? "Klasse" : "Klassen"}`))),
      reward ? rewardView(reward) : null,
      stats.count
        ? forestView(cls.focus_trees)
        : emptyView("Noch keine Baeume. Der erste waechst bei der naechsten ruhigen Arbeitsphase."));

    appEl.replaceChildren(h("div", { class: "stack" }, forestCard, startCard, rewardCard()));
  }

  function rewardView(reward) {
    return h("div", { class: "reward" },
      h("div", { class: "reward__head" },
        h("strong", {}, reward.reached ? "Belohnung erreicht!" : "Belohnung"),
        h("span", { class: "muted small" }, `${reward.done} / ${treesLabel(reward.goal)}`)),
      h("div", {}, reward.text),
      progressBar(reward.done / reward.goal),
      reward.reached
        ? h("button", {
            class: "btn btn--sm", type: "button",
            onclick: () => confirmDelete(
              "Belohnung als eingeloest markieren? Der Fortschritt beginnt dann wieder bei 0.",
              async () => {
                const offset = cls.focus_trees.length;
                await api.updateFocusReward(cls.id, { focus_reward_offset: offset });
                cls.focus_reward_offset = offset;
                showSetup();
                toast("Belohnung eingeloest.");
              },
              "Eingeloest")
          }, "Als eingeloest markieren")
        : null);
  }

  function rewardCard() {
    const textInput = h("input", {
      class: "input", type: "text", maxlength: "120",
      placeholder: "z. B. Musik in der Stillarbeit", value: cls.focus_reward ?? ""
    });
    const goalInput = h("input", {
      class: "input", type: "number", min: "1", max: "500", step: "1", inputmode: "numeric",
      value: String(cls.focus_reward_goal ?? 10)
    });
    const saveBtn = h("button", { class: "btn btn--primary", type: "submit" }, "Speichern");

    const form = h("form", { class: "reward-form" },
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Belohnung"), textInput),
      h("label", { class: "field field--num" }, h("span", { class: "field__label" }, "bei Baeumen"), goalInput),
      saveBtn);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = cleanName(textInput.value, 120);
      const goal = Math.round(Number(goalInput.value));
      if (text && !(goal >= 1 && goal <= 500)) {
        return toast("Bitte eine Anzahl zwischen 1 und 500 eingeben.", "error");
      }

      // Eine neue Belohnung zaehlt erst ab jetzt; Aendern behaelt den Fortschritt.
      const fields = text
        ? { focus_reward: text, focus_reward_goal: goal }
        : { focus_reward: null, focus_reward_goal: null };
      if (text && !cls.focus_reward) fields.focus_reward_offset = cls.focus_trees.length;

      saveBtn.disabled = true;
      try {
        await api.updateFocusReward(cls.id, fields);
        Object.assign(cls, fields);
        showSetup();
        toast(text ? "Belohnung gespeichert." : "Belohnung entfernt.");
      } catch (error) {
        showError(error, "Belohnung konnte nicht gespeichert werden.");
        saveBtn.disabled = false;
      }
    });

    return h("div", { class: "card" },
      h("h2", {}, "Belohnung"),
      h("p", { class: "muted small" },
        "Am besten mit der Klasse gemeinsam festlegen. Gezaehlt werden Baeume ab dem ersten Speichern. " +
        "Leeres Feld entfernt die Belohnung."),
      form);
  }

  /* ----- Laufende Fokus-Phase (Beamer) ----- */

  function runSession(noise, goalSeconds) {
    const species = speciesForGoal(goalSeconds);
    let sensitivity = Number(readPref(PREF_FOCUS_SENSITIVITY, 2.5));
    if (!(sensitivity >= 0.5 && sensitivity <= 8)) sensitivity = 2.5;

    let phase = "running";   // running | withering | done
    let paused = false;
    let elapsed = 0;          // ruhige Sekunden fuer den aktuellen Baum
    let zone = "ruhig";
    let candidate = "ruhig";
    let candidateSince = performance.now();
    let loudSince = null;
    let lastTick = performance.now();
    let witherTimer = null;
    let wakeLock = null;
    let stopped = false;
    let lastMood = "";
    let celebration = null;
    let round = 0;            // zaehlt Neustarts, damit spaete Antworten nichts ueberschreiben

    const STATUS = {
      calm: "Ruhig – der Baum wächst",
      uneasy: "Etwas leiser – der Baum wächst gerade nicht",
      loud: "Zu laut! Gleich vertrocknet der Baum",
      withered: "Vertrocknet – gleich startet ein neuer Samen",
      done: "Geschafft!",
      paused: "Pause – der Baum wartet"
    };

    const tree = buildTree(species);
    tree.setProgress(0, { instant: true });

    const timeEl = h("div", { class: "focus__time" }, formatClock(goalSeconds));
    const statusEl = h("div", { class: "focus__status", role: "status", "aria-live": "polite" });
    const progressFill = h("div", { class: "focus__progress-fill" });
    const meterFill = h("div", { class: "meter__fill" });
    const footerEl = h("div", { class: "focus__bottom" });

    const pauseBtn = h("button", { class: "btn", type: "button", onclick: togglePause }, "Pause");
    const slider = h("input", {
      class: "slider", type: "range", min: "0.5", max: "8", step: "0.25",
      value: String(sensitivity), "aria-label": "Empfindlichkeit"
    });
    slider.addEventListener("input", () => {
      sensitivity = Number(slider.value);
      writePref(PREF_FOCUS_SENSITIVITY, sensitivity);
    });

    const root = h("div", { class: "focus" },
      h("div", { class: "focus__progress" }, progressFill),
      h("div", { class: "focus__top" },
        h("div", {},
          timeEl,
          h("div", { class: "focus__goal" },
            `${TREE_SPECIES[species].name} · Ziel ${goalSeconds / 60} min`)),
        h("div", { class: "focus__panel" },
          h("div", { class: "focus__buttons" },
            pauseBtn,
            h("button", { class: "btn", type: "button", onclick: restart }, "Neu starten"),
            document.fullscreenEnabled
              ? h("button", { class: "btn", type: "button", onclick: toggleFullscreen }, "Vollbild")
              : null,
            h("button", { class: "btn", type: "button", onclick: requestExit }, "Beenden")),
          h("div", {},
            h("div", { class: "focus__label" }, "Lautstärke"),
            h("div", { class: "meter", "aria-hidden": "true" },
              meterFill,
              h("span", { class: "meter__mark", style: `left:${(FOCUS_ZONES.unruhig / 75) * 100}%` }),
              h("span", { class: "meter__mark", style: `left:${(FOCUS_ZONES.laut / 75) * 100}%` }))),
          h("label", {},
            h("span", { class: "focus__label" }, "Empfindlichkeit"),
            slider,
            h("span", { class: "focus__scale" }, h("span", {}, "weniger"), h("span", {}, "mehr"))))),
      h("div", { class: "focus__stage" }, statusEl, tree.el),
      footerEl);

    topbarEl.hidden = true;
    appEl.className = "app app--focus";
    appEl.replaceChildren(root);
    drawFooter();
    draw(0);

    const interval = setInterval(tick, FOCUS_TICK_MS);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    lockScreen();
    registerCleanup(stop);

    function tick() {
      const now = performance.now();
      // Spruenge nach Standby oder gedrosselten Hintergrund-Tabs begrenzen.
      const dt = Math.min(2, (now - lastTick) / 1000);
      lastTick = now;

      const level = noise.read(sensitivity);
      const raw = level >= FOCUS_ZONES.laut ? "laut" : level >= FOCUS_ZONES.unruhig ? "unruhig" : "ruhig";
      if (raw !== candidate) { candidate = raw; candidateSince = now; }
      if (candidate !== zone && now - candidateSince >= FOCUS_ZONE_DWELL_MS[candidate]) zone = candidate;

      if (phase === "running" && !paused) {
        if (zone === "ruhig") elapsed = Math.min(goalSeconds, elapsed + dt);
        if (zone === "laut") {
          loudSince ??= now;
          if (now - loudSince >= FOCUS_WITHER_MS) { loudSince = null; wither(); }
        } else {
          loudSince = null;
        }
        if (elapsed >= goalSeconds) complete();
      }
      draw(level);
    }

    function draw(level) {
      timeEl.textContent = formatClock(Math.ceil(goalSeconds - elapsed));
      progressFill.style.width = `${(elapsed / goalSeconds) * 100}%`;
      meterFill.style.width = `${Math.min(100, (level / 75) * 100)}%`;
      meterFill.className = `meter__fill meter__fill--${zone}`;
      if (phase !== "withering") tree.setProgress(elapsed / goalSeconds);

      const mood = phase === "done" ? "done"
        : phase === "withering" ? "withered"
        : paused ? "paused"
        : zone === "laut" ? "loud"
        : zone === "unruhig" ? "uneasy"
        : "calm";
      if (mood !== lastMood) {
        lastMood = mood;
        tree.setMood(mood);
        root.className = `focus focus--${mood}`;
        statusEl.textContent = STATUS[mood];
      }
    }

    function wither() {
      if (elapsed < FOCUS_MIN_WITHER_SECONDS) { elapsed = 0; return; }
      phase = "withering";
      witherTimer = setTimeout(() => {
        elapsed = 0;
        tree.setProgress(0, { instant: true });
        phase = "running";
      }, FOCUS_WITHER_ANIM_MS);
    }

    async function complete() {
      phase = "done";
      loudSince = null;
      const myRound = round;
      let number = null;
      if (!probe) {
        try {
          const planted = await api.plantTree(cls.id, goalSeconds);
          cls.focus_trees.push(planted);
          number = cls.focus_trees.length;
        } catch (error) {
          showError(error, "Der Baum konnte nicht gespeichert werden.");
        }
      }
      drawFooter();
      if (stopped || round !== myRound) return;
      showCelebration(number);
    }

    function showCelebration(number) {
      const minutes = goalSeconds / 60;
      const reward = probe ? null : rewardProgress(cls);
      const message = number
        ? `Baum Nr. ${number} steht jetzt im Wald von ${cls.name}.`
        : `${minutes} Minuten konzentriert gearbeitet.${probe ? " (Probelauf – nichts gespeichert)" : ""}`;
      const left = reward ? reward.goal - reward.done : 0;

      const nextBtn = h("button", { class: "btn btn--primary", type: "button", onclick: restart }, "Nächster Baum");
      celebration = h("div", { class: "celebrate", role: "dialog", "aria-modal": "true", "aria-label": "Baum gepflanzt" },
        confettiView(),
        h("div", { class: "celebrate__panel" },
          stillTree(species, 9),
          h("h2", {}, number ? "Baum gepflanzt!" : "Geschafft!"),
          h("p", {}, message),
          reward
            ? h("p", { class: "celebrate__reward" },
                reward.reached
                  ? `Belohnung freigeschaltet: ${reward.text}`
                  : `Noch ${left === 1 ? "1 Baum" : `${left} Bäume`} bis zur Belohnung: ${reward.text}`)
            : null,
          h("div", { class: "row", style: "justify-content:center" },
            h("button", { class: "btn", type: "button", onclick: exit }, "Beenden"),
            nextBtn)));
      root.append(celebration);
      nextBtn.focus();
    }

    function drawFooter() {
      if (probe) {
        footerEl.replaceChildren(h("span", { class: "focus__sub" }, "Probelauf – es wird nichts gespeichert."));
        return;
      }
      const stats = forestStats(cls);
      const reward = rewardProgress(cls);
      footerEl.replaceChildren(
        h("div", { class: "focus__forest" },
          stats.count ? forestView(cls.focus_trees, { limit: 18, scale: 0.6 }) : null,
          h("div", {},
            h("strong", {}, `Wald von ${cls.name}`),
            h("div", { class: "focus__sub" },
              `${stats.count === 1 ? "1 Baum" : `${stats.count} Bäume`} · ${stats.minutes} Fokus-Minuten`))));
      if (reward) {
        footerEl.append(
          h("div", { class: "focus__reward" },
            h("div", { class: "focus__sub" },
              reward.reached ? `Belohnung erreicht: ${reward.text}` : `Belohnung: ${reward.text}`),
            progressBar(reward.done / reward.goal),
            h("div", { class: "focus__sub" }, `${reward.done} / ${reward.goal} Bäume`)));
      }
    }

    function restart() {
      round += 1;
      clearTimeout(witherTimer);
      celebration?.remove();
      celebration = null;
      elapsed = 0;
      loudSince = null;
      phase = "running";
      tree.setProgress(0, { instant: true });
      draw(0);
    }

    function togglePause() {
      if (phase !== "running") return;
      paused = !paused;
      loudSince = null;
      pauseBtn.textContent = paused ? "Weiter" : "Pause";
    }

    function toggleFullscreen() {
      const request = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      request?.catch?.(() => {});
    }

    function requestExit() {
      if (phase === "running" && elapsed >= 30) {
        confirmDelete("Fokus-Phase beenden? Der aktuelle Baum wird nicht gepflanzt.", async () => exit(), "Beenden");
      } else {
        exit();
      }
    }

    function exit() {
      stop();
      showSetup();
    }

    function onKey(event) {
      if (event.key !== " " || event.repeat) return;
      // Leertaste auf Buttons/Feldern normal wirken lassen, ebenso in Dialogen.
      if (event.target.closest?.("button, input, textarea, select, .modal")) return;
      event.preventDefault();
      togglePause();
    }

    async function lockScreen() {
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (stopped) lock?.release().catch(() => {});
        else wakeLock = lock ?? null;
      } catch {
        // Wake-Lock ist nur Komfort (Bildschirm bleibt an).
      }
    }

    function onVisibility() {
      // Der Wake-Lock faellt beim Verstecken der Seite automatisch weg.
      if (document.visibilityState === "visible" && !stopped) lockScreen();
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      clearTimeout(witherTimer);
      noise.stop();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock?.release().catch(() => {});
      wakeLock = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }
}

function confettiView(count = 60) {
  const colors = ["#fde047", "#fb923c", "#22d3ee", "#86efac", "#f472b6", "#a78bfa"];
  return h("div", { class: "confetti", "aria-hidden": "true" },
    Array.from({ length: count }, () => h("span", {
      style: `left:${(Math.random() * 100).toFixed(1)}%;` +
        `background:${colors[Math.floor(Math.random() * colors.length)]};` +
        `--d:${(2.2 + Math.random() * 1.6).toFixed(2)}s;--delay:${(Math.random() * 0.6).toFixed(2)}s`
    })));
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

/** Modal zur Wahl der Unterrichts-Ansicht beim Start. Liefert
 * "kanban" | "sortiert", oder null bei Abbruch. */
function pickLessonMode() {
  return new Promise((resolve) => {
    const panel = h("div", { class: "modal__panel stack" });
    const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, panel);

    const close = (value) => {
      modal.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") close(null); };

    modal.addEventListener("click", (event) => { if (event.target === modal) close(null); });
    document.addEventListener("keydown", onKey);

    panel.append(
      h("h2", { style: "margin-top:0" }, "Ansicht waehlen"),
      h("p", { class: "muted small" },
        "Kanban: Schueler per Drag & Drop durch drei Spalten bewegen. " +
        "Sortierte Ansicht: alle Namen alphabetisch in einem Raster, " +
        "per Antippen weiterschalten."),
      h("div", { class: "stack" },
        h("button", { class: "btn btn--primary", type: "button", onclick: () => close("kanban") },
          "Kanban"),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => close("sortiert") },
          "Sortierte Ansicht")),
      h("button", { class: "btn", type: "button", onclick: () => close(null) }, "Abbrechen")
    );
    document.body.append(modal);
  });
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

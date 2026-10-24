import { getAuthRedirectUrl, getSupabase, getSupabaseConfig, isSupabaseConfigured, registerPatient } from "./supabase.js";
import { signInOrCreatePatient } from "./auth.js";
import { apiRequest } from "./api.js";

let manualAuthInProgress = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  page: location.hash.replace(/^#\/?/, "") || "login",
  roleChoice: "patient",
  authMode: "signin",
  supabase: null,
  user: null,
  profile: null,
  authReady: false,
  authBusy: false,
  authError: "",
  authEmail: "",
  authNotice: "",
  pageBusy: false,
  pageError: "",
  toast: "",
  mobileMenu: false,
  documents: [],
  documentCount: 0,
  models: [],
  assessments: [],
  modelVersions: [],
  adminProfiles: [],
  adminCounts: null,
  trainingRuns: [],
  modelSearch: "",
  localModels: [],
  localResult: null,
  localImagePreview: null,
  localImageName: "",
  federation: { sites: [], models: [] },
  chatMessages: [],
  chatBusy: false,
  chatAttachment: null,
  chatDraft: "",
  extractionStarted: new Set(),
  isCalling: false,
  callTimer: null,
};

const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5M12 8v13"/>',
  spark: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  flask: '<path d="M9 3h6M10 3v7.2L4.7 19a1.8 1.8 0 0 0 1.5 2.8h11.6a1.8 1.8 0 0 0 1.5-2.8L14 10.2V3"/><path d="M7.5 16h9"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7L6 16.1 7.4 15a7 7 0 0 1 0-1.9L6 12l1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9L11 7.6h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.9Z"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  phoneOff: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="1" y1="1" x2="23" y2="23"/>',
};

let callAudioInterval = null;
function startCallRingtone() {
  stopCallRingtone();
  function playToneBurst() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc2.frequency.setValueAtTime(480, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.05, ctx.currentTime + 1.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 1.4);
      osc2.stop(ctx.currentTime + 1.4);
      setTimeout(() => ctx.close().catch(() => {}), 1600);
    } catch {
      // AudioContext unavailable or restricted
    }
  }
  playToneBurst();
  callAudioInterval = window.setInterval(playToneBurst, 3500);
}

function stopCallRingtone() {
  if (callAudioInterval) {
    clearInterval(callAudioInterval);
    callAudioInterval = null;
  }
}

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function chatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderAssistantText(content) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listTag = "";
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(chatInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(`<${listTag}>${list.map(item => `<li>${chatInline(item)}</li>`).join("")}</${listTag}>`);
    list = [];
    listTag = "";
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(`<h4>${chatInline(heading[1])}</h4>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const nextTag = bullet ? "ul" : "ol";
      if (listTag && listTag !== nextTag) flushList();
      listTag = nextTag;
      list.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

function displayName() {
  const full = state.profile?.full_name || state.user?.user_metadata?.full_name || state.user?.user_metadata?.name || "";
  const name = full.trim() || state.user?.email?.split("@")[0] || "there";
  return name.split(/[\s._-]+/)[0];
}

function displayInitials() {
  const name = state.profile?.full_name || state.user?.email || "U";
  return name.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
}

function formattedDate() {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();
}

function toast(message) {
  state.toast = message;
  renderToast();
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => { state.toast = ""; renderToast(); }, 3200);
}

function setAuthError(message) {
  state.authError = message;
  const box = $("#auth-error");
  if (box) {
    box.textContent = message;
    box.hidden = !message;
  }
}

function brand(compact = false) {
  return `<div class="brand"><span class="brand-mark"><i></i><i></i><i></i><i></i></span>${compact ? "" : "<span>Luma<span class='brand-dot'>.</span></span>"}</div>`;
}

function loginPage() {
  const configReady = isSupabaseConfigured();
  const adminMode = state.roleChoice === "admin";
  const mode = state.authMode;
  const title = mode === "reset" ? "Reset your password." : "Good to see you.";
  const buttonLabel = mode === "reset" ? "Send reset link" : adminMode ? "Admin sign in" : "Continue to Luma";
  return `<main class="public-experience">
    <section class="landing-screen" id="landing-screen" aria-label="Luma introduction">
    <header class="public-nav">${brand()}<a class="nav-signin" href="#auth-screen" data-scroll-auth>Sign in <span>${icon("arrow", 15)}</span></a></header>
    <section class="login-hero">
      <div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> YOUR HEALTH, IN A NEW LIGHT</div><h1>Make sense of<br/>your <span>health story.</span></h1><p class="hero-lede">Thoughtful tools to help you understand health risks, explore trusted models, and feel more informed at every step.</p><div class="hero-points"><span>${icon("check", 15)} Clear, personal insights</span><span>${icon("shield", 15)} Designed around your privacy</span></div><div class="hero-art-caption"><span class="caption-line"></span> A clearer view, one signal at a time</div></div>
      <div class="login-stage"><div class="stage-wash"></div><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="hero-sculpture" aria-label="Abstract 3D health signal artwork"><div class="sculpture-core"></div><div class="sculpture-shine"></div><div class="sculpture-ring ring-one"></div><div class="sculpture-ring ring-two"></div><div class="sculpture-ring ring-three"></div><span class="orb-node node-one"></span><span class="orb-node node-two"></span><span class="orb-node node-three"></span></div><div class="float-note note-top"><span class="note-icon lavender">${icon("heart", 16)}</span><span><b>Health, connected</b><small>Your signals, thoughtfully together</small></span></div><div class="float-note note-bottom"><div class="mini-avatar">${icon("shield", 15)}</div><span><b>A more personal picture</b><small>Made to be explored at your pace</small></span><span class="note-check">${icon("check", 14)}</span></div><div class="stage-label"><span>01</span><span>INSIGHT / HUMAN FIRST</span></div></div>
    </section>
    <div class="landing-bottom"><span>A clearer view, one signal at a time</span><button class="scroll-cue" type="button" data-scroll-auth aria-label="Continue to sign in">${icon("arrow", 16)}</button><span>SCROLL TO EXPLORE</span></div>
    </section>
    <section class="auth-screen" id="auth-screen" aria-labelledby="auth-title">
    <header class="auth-nav">${brand()}<button type="button" class="back-to-landing" data-scroll-home>${icon("arrow", 15)} Back to introduction</button></header>
    <div class="auth-dock"><div class="auth-intro"><span class="auth-kicker">${mode === "reset" ? "ACCOUNT ACCESS" : adminMode ? "LUMA ADMIN STUDIO" : "WELCOME TO LUMA"}</span><h2 id="auth-title">${title}</h2><p>${mode === "reset" ? "We’ll email you a secure reset link." : adminMode ? "Sign in with your authorized workspace account." : "Sign in to your health space. If you’re new, we’ll create your patient account automatically."}</p><div class="auth-security-note">${icon("shield", 14)} Supabase-secured account access</div></div>
    <form class="login-form" id="login-form" data-mode="${mode}">
      <div class="auth-error" id="auth-error" role="alert" ${state.authError ? "" : "hidden"}>${escapeHtml(state.authError)}</div>
      ${state.authNotice ? `<p role="status">${escapeHtml(state.authNotice)}</p>` : ""}
      <label class="auth-field">Email address<div class="input-wrap"><span>${icon("users", 17)}</span><input name="email" type="email" placeholder="you@example.com" autocomplete="email" required value="${escapeHtml(adminMode ? getSupabaseConfig().adminEmail : state.authEmail)}"/></div></label>
      ${mode === "reset" ? "" : `<label class="auth-field">Password<div class="input-wrap"><span>${icon("shield", 17)}</span><input name="password" type="password" placeholder="${adminMode ? "Enter your password" : "Your password (8+ characters for a new account)"}" autocomplete="current-password" required minlength="1"/><button class="show-password" type="button" data-action="show-password">Show</button></div></label>`}
      ${mode === "signin" ? `<div class="form-options"><span class="remember">Your session is securely managed by Supabase.</span><button class="text-button" type="button" data-action="forgot">Forgot password?</button></div>` : ""}
      ${mode === "signin" ? `<div class="role-picker"><span>Continue as</span><div><button type="button" data-role="patient" class="${!adminMode ? "selected" : ""}">${icon("heart", 15)} Patient</button><button type="button" data-role="admin" class="${adminMode ? "selected" : ""}">${icon("settings", 15)} Admin</button></div></div>` : ""}
      <button class="primary-button sign-in-button" type="submit" ${state.authBusy || !state.authReady ? "disabled" : ""}>${state.authBusy ? '<span class="spinner"></span> Connecting…' : `${buttonLabel}<span>${icon("arrow", 17)}</span>`}</button>
      ${mode === "signin" && !adminMode ? `<div class="oauth-divider"><span></span> or continue with <span></span></div><div class="oauth-buttons"><button type="button" data-oauth="google" ${state.authBusy ? "disabled" : ""}><b class="google-g">G</b> Google</button><button type="button" data-oauth="github"><b class="github-mark">●</b> GitHub</button></div>` : ""}
      <div class="auth-config ${configReady ? "configured" : "not-configured"}">${configReady ? `${icon("check", 13)} Supabase project connected` : `${icon("info", 13)} Add Supabase URL and anon key in .env to enable sign-in`}</div>
    </form>
    <div class="auth-foot">${mode === "signin" ? (adminMode ? `Admin account · ${escapeHtml(getSupabaseConfig().adminEmail)}` : `One form to sign in or create your patient account.`) : `<button data-action="back-to-login" class="text-button">Back to sign in</button>`}<span class="auth-lock">${icon("shield", 13)} Secure sign-in</span></div></section>
    <footer class="public-footer"><span>© 2026 Luma Health Studio</span><span>Made with care <span class="footer-heart">♥</span></span></footer>
  </main>`;
}

const patientNav = [
  { label: "Your overview", page: "patient/dashboard", icon: "grid", section: "YOUR SPACE" },
  { label: "My documents", page: "patient/documents", icon: "file" },
  { label: "Explore models", page: "patient/models", icon: "box", section: "DISCOVER" },
  { label: "AI companion", page: "patient/assistant", icon: "spark" },
  { label: "Assessment history", page: "patient/history", icon: "clock", section: "YOUR RECORD" },
];
const adminNav = [
  { label: "Overview", page: "admin/dashboard", icon: "grid", section: "WORKSPACE" },
  { label: "Model insights", page: "admin/insights", icon: "chart", section: "MODEL STUDIO" },
  { label: "Publish a model", page: "admin/publish", icon: "upload" },
  { label: "Training lab", page: "admin/lab", icon: "flask" },
  { label: "People & access", page: "admin/access", icon: "users", section: "GOVERNANCE" },
];

function navMarkup(items) {
  let previous = "";
  return items.map(item => {
    const heading = item.section && item.section !== previous ? `<div class="nav-section">${item.section}</div>` : "";
    if (item.section) previous = item.section;
    return `${heading}<button class="side-link ${state.page === item.page ? "active" : ""}" data-route="${item.page}"><span class="side-icon">${icon(item.icon, 18)}</span><span>${item.label}</span></button>`;
  }).join("");
}

function sidebar(role) {
  const patient = role === "patient";
  const items = patient ? patientNav : adminNav;
  return `<aside class="sidebar" id="sidebar"><div class="sidebar-brand">${brand()}<button class="sidebar-close" data-action="close-menu">×</button></div><div class="workspace-pill"><span class="workspace-avatar ${patient ? "patient-avatar" : "admin-avatar"}">${patient ? "P" : "A"}</span><span><b>${patient ? "Patient space" : "Admin studio"}</b><small>${patient ? "Your personal health space" : "Model management"}</small></span><span class="chevron">⌄</span></div><nav class="side-nav">${navMarkup(items)}</nav><div class="sidebar-bottom"><div class="help-card"><div class="help-orb">${icon(patient ? "heart" : "spark", 17)}</div><b>${patient ? "Need a hand?" : "Studio guide"}</b><p>${patient ? "Ask about your documents and health questions." : "Review models and validation before publishing."}</p><button data-route="${patient ? "patient/assistant" : "admin/lab"}">${patient ? "AI companion" : "Open training lab"} ${icon("arrow", 13)}</button></div><button class="profile-row"><span class="profile-avatar">${displayInitials()}</span><span><b>${escapeHtml(state.profile?.full_name || state.user?.email || "Account")}</b><small>${patient ? "Patient account" : "Workspace admin"}</small></span><span class="profile-more">···</span></button><button class="logout-link" data-action="logout">${icon("logout", 16)} Sign out</button></div></aside>`;
}

function topbar(role, title) {
  return `<header class="app-topbar"><button class="mobile-menu" data-action="open-menu" aria-label="Open navigation">${icon("menu", 21)}</button><div class="crumbs"><span>${role === "patient" ? "Patient space" : "Admin studio"}</span><span class="crumb-sep">/</span><b>${title}</b></div><div class="topbar-actions"><span class="demo-chip auth-chip"><i></i> ${escapeHtml(state.user?.email || "SIGNED IN")}</span><button class="icon-button" aria-label="Notifications" data-action="notifications">${icon("bell", 18)}</button><div class="topbar-avatar">${displayInitials()}</div></div></header>`;
}

function pageHeader(kicker, title, description, action = "") {
  return `<div class="page-heading"><div><div class="page-kicker">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function loadingBlock(label = "Loading your workspace…") {
  return `<div class="panel loading-panel"><span class="spinner dark-spinner"></span><span>${label}</span></div>`;
}

function dataErrorBlock(message) {
  return `<div class="panel empty-state"><span class="empty-state-icon">${icon("info", 19)}</span><b>We couldn’t load this information</b><span>${escapeHtml(message || "Check your connection and try again.")}</span><button class="outline-button" data-action="retry-page">Try again</button></div>`;
}

function patientDashboard() {
  const action = `<div class="dashboard-header-actions"><div class="call-action-wrapper"><button class="call-button compact ${state.isCalling ? "is-calling" : ""}" data-action="toggle-call" id="call-button" aria-expanded="${state.isCalling}" aria-label="${state.isCalling ? "Calling you, click to cancel" : "Get call from care team"}">${icon("phone", 15)} <span>${state.isCalling ? 'Calling you<span class="calling-dots"><span>.</span><span>.</span><span>.</span></span>' : "Get call"}</span></button>${state.isCalling ? `<div class="calling-popup" id="calling-popup" role="status" aria-live="polite"><div class="calling-popup-inner"><div class="calling-avatar"><span class="calling-pulse-ring ring-1"></span><span class="calling-pulse-ring ring-2"></span><span class="calling-avatar-icon">${icon("phone", 16)}</span></div><div class="calling-info"><div class="calling-heading"><strong>Calling you…</strong><div class="calling-soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span></div></div><small class="calling-subtext">Care Team &amp; AI Companion</small></div><button class="calling-end-btn" data-action="toggle-call" title="End call" aria-label="End call">${icon("phoneOff", 14)}</button></div></div>` : ""}</div><button class="primary-button compact" data-route="patient/models">Explore models ${icon("arrow", 15)}</button></div>`;
  const first = escapeHtml(displayName());
  const docs = state.documentCount;
  const assessments = state.assessments.length;
  return `${pageHeader(formattedDate(), `A little more clarity, ${first}.`, "Your health space brings your information together in one calm, easy-to-understand place.", action)}
  <div class="welcome-banner"><div class="welcome-copy"><span class="welcome-label">YOUR HEALTH SNAPSHOT <span class="soft-pill">PERSONAL SPACE</span></span><h2>${assessments ? "Your health story<br/>is taking shape." : "Your story is still<br/>taking shape."}</h2><p>${assessments ? `You have ${assessments} saved assessment${assessments === 1 ? "" : "s"}. Review your history whenever you need.` : "Add a health report or explore an available model to begin building your personal picture."}</p><button class="light-button" data-route="${docs ? "patient/documents" : "patient/models"}">${docs ? "View your documents" : "Explore available models"} ${icon("arrow", 15)}</button></div><div class="snapshot-art"><div class="snapshot-rings"><i></i><i></i><i></i><div class="snapshot-heart">${icon("heart", 28)}</div><span class="satellite sat-a"></span><span class="satellite sat-b"></span></div><div class="snapshot-float float-a"><span>${String(docs).padStart(2,"0")}</span> Your documents</div><div class="snapshot-float float-b"><span>${String(assessments).padStart(2,"0")}</span> Saved assessments</div><div class="snapshot-glint">✦</div></div></div>
  <div class="section-row"><div><span class="section-kicker">YOUR SPACE</span><h2>Where would you like to begin?</h2></div><button class="subtle-link" data-route="patient/history">View activity ${icon("arrow", 14)}</button></div>
  <div class="feature-grid"><button class="feature-card docs-card" data-route="patient/documents"><span class="feature-top"><span class="feature-icon peach-icon">${icon("file", 19)}</span><span class="feature-arrow">${icon("arrow", 15)}</span></span><span class="feature-title">Your documents</span><span class="feature-desc">${docs ? `${docs} document${docs === 1 ? "" : "s"} in your library.` : "Bring health reports together in your private library."}</span><span class="feature-foot"><span class="tiny-dot peach-dot"></span> Private to your account</span></button><button class="feature-card model-card" data-route="patient/models"><span class="feature-top"><span class="feature-icon lilac-icon">${icon("box", 19)}</span><span class="feature-arrow">${icon("arrow", 15)}</span></span><span class="feature-title">Explore health models</span><span class="feature-desc">Review available models and what each one is designed to estimate.</span><span class="feature-foot"><span class="tiny-dot purple-dot"></span> Model details and intended use</span></button><button class="feature-card ai-card" data-route="patient/assistant"><span class="feature-top"><span class="feature-icon mint-icon">${icon("spark", 19)}</span><span class="feature-arrow">${icon("arrow", 15)}</span></span><span class="feature-title">AI companion</span><span class="feature-desc">Ask about your reports and get answers grounded in your own history.</span><span class="feature-foot"><span class="tiny-dot mint-dot"></span> Personal context available</span></button></div>
  <div class="dashboard-bottom"><div class="panel recent-panel"><div class="panel-heading"><div><span class="section-kicker">YOUR RECORD</span><h3>Recent assessments</h3></div><button class="subtle-link" data-route="patient/history">View history ${icon("arrow", 13)}</button></div>${assessments ? state.assessments.slice(0,3).map(assessmentRow).join("") : `<div class="empty-activity"><div class="empty-activity-icon">${icon("clock", 19)}</div><div><b>No assessments yet</b><span>When a prediction model is connected, saved results will appear here.</span></div></div>`}</div><div class="panel privacy-panel"><span class="privacy-orb">${icon("shield", 19)}</span><span class="section-kicker">BUILT AROUND YOU</span><h3>Your health,<br/>on your terms.</h3><p>Choose what you share and decide how you use each insight.</p><button data-action="privacy">Privacy and data access ${icon("arrow", 13)}</button></div></div>`;
}

function assessmentRow(item) {
  const name = item.health_models?.name || item.model_name || "Health model assessment";
  const created = item.created_at ? new Date(item.created_at).toLocaleDateString() : "";
  return `<div class="document-row"><span class="doc-type">${icon("chart", 17)}</span><span class="document-name"><b>${escapeHtml(name)}</b><small>${escapeHtml(created)} · ${escapeHtml(item.status || "Saved")}</small></span><span class="live-status status-review">${escapeHtml(item.risk_band || "Recorded")}</span></div>`;
}

function documentsPage() {
  const validDocuments = state.documents.filter(doc => doc?.id);
  const docs = validDocuments.length ? validDocuments.map(doc => `<div class="document-row"><span class="doc-type">${icon("file", 17)}</span><span class="document-name"><b>${escapeHtml(doc.original_name)}</b><small>${escapeHtml(new Date(doc.created_at).toLocaleDateString())} · ${escapeHtml(doc.mime_type || "Document")}</small></span><span class="doc-status">${escapeHtml(doc.processing_status === "ready" ? "Text ready" : doc.processing_status || "Stored")}</span>${doc.processing_status !== "ready" ? `<button class="text-button" data-extract-document="${escapeHtml(doc.id)}">Extract text</button>` : ""}</div>`).join("") : `<div class="empty-documents"><div class="empty-file-stack"><span>${icon("file", 25)}</span><span>${icon("file", 25)}</span><span>${icon("upload", 23)}</span></div><b>No documents yet</b><span>Documents you upload privately will appear here.</span><button class="text-button" data-action="choose-document">Choose a file ${icon("arrow", 13)}</button></div>`;
  return `${pageHeader("YOUR INFORMATION", "Your documents", "Upload and keep health documents in your private library.", `<button class="primary-button compact" data-action="choose-document">${icon("plus", 16)} Add document</button>`)}
  <div class="upload-zone" id="upload-zone"><input id="document-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" multiple hidden/><div class="upload-icon">${icon("upload", 21)}</div><div><b>Drop a document here</b><span>or <button class="text-button" data-action="choose-document">browse your files</button> · PDF, image, CSV or text · up to 15 MB</span></div><span class="upload-private">${icon("shield", 14)} Private to your account</span></div>
  <div class="panel documents-panel"><div class="panel-heading"><div><span class="section-kicker">DOCUMENT LIBRARY</span><h3>Your documents <span class="count-badge">${validDocuments.length}</span></h3></div></div>${docs}</div><div class="notice-strip">${icon("shield", 16)} <span><b>Private storage</b> Files are stored in your account’s private Supabase Storage folder.</span></div>`;
}

function scanScoreRow(item, index) {
  const name = escapeHtml(String(item.name || "Finding").replaceAll("_", " "));
  const percent = Math.max(0, Math.min(100, Number(item.score) * 100));
  const value = percent.toFixed(1);
  return `<div class="scan-score-row"><span class="scan-score-rank">${String(index + 1).padStart(2, "0")}</span><div class="scan-score-body"><div class="scan-score-label"><b>${name}</b><strong>${value}%</strong></div><div class="scan-score-track" role="progressbar" aria-label="${name} model score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div></div></div>`;
}

const scanFindingDescriptions = {
  Atelectasis: "an area of the lung that is not fully inflated",
  Cardiomegaly: "an enlarged heart outline on an X-ray",
  Consolidation: "a dense area in the lung that can have several causes",
  Edema: "possible fluid buildup in the lungs",
  Effusion: "fluid in the space around a lung",
  Emphysema: "lung changes that can occur with emphysema",
  Fibrosis: "scarring in lung tissue",
  Hernia: "tissue extending through an opening in the diaphragm",
  Infiltration: "a nonspecific area of increased lung density",
  Mass: "a larger abnormal-looking area",
  Nodule: "a small, rounded spot in the lung",
  "Pleural Thickening": "thickening of the lining around a lung",
  Pneumonia: "a lung infection",
  Pneumothorax: "air around a lung that can make it collapse",
};

function renderScanReport(result) {
  const findings = (Array.isArray(result.findings) ? result.findings : [])
    .filter(item => item && Number.isFinite(Number(item.score)))
    .sort((a, b) => Number(b.score) - Number(a.score));
  const leading = findings[0];
  const rawLeadingName = leading ? String(leading.name || "a finding").replaceAll("_", " ") : "a finding";
  const leadingName = escapeHtml(rawLeadingName);
  const leadingScore = leading ? `${(Math.max(0, Math.min(1, Number(leading.score))) * 100).toFixed(1)}%` : "—";
  const leadingDescription = scanFindingDescriptions[rawLeadingName];
  const preview = state.localImagePreview ? `<img src="${escapeHtml(state.localImagePreview)}" alt="The image submitted for this model report"/>` : `<span class="scan-preview-empty">Image preview unavailable</span>`;
  return `<article class="scan-report" aria-label="Chest X-ray model report">
    <header class="scan-report-head"><div><span class="scan-report-eyebrow">LUMA / IMAGE ASSESSMENT</span><h3>Your X-ray, explained</h3><p>CheXNet · Experimental analysis</p></div><span class="scan-report-status">Clinical review advised</span></header>
    <div class="scan-report-summary"><span class="scan-report-summary-label">THE SHORT ANSWER</span><h4>The model highlighted ${leadingName} most.</h4><p>${leadingDescription ? `This label refers to ${escapeHtml(leadingDescription)}. ` : ""}Its score was <strong>${leadingScore}</strong>. That score is not a diagnosis or your chance of having the condition.</p></div>
    <div class="scan-report-decision"><div class="scan-decision-primary"><span>SHOULD I SEE A DOCTOR?</span><strong>Yes — arrange a review of this X-ray.</strong><p>A clinician can check the original image together with your symptoms and medical history, then tell you whether any follow-up is needed.</p></div><div class="scan-decision-secondary"><span>DOES THIS MEAN I AM FINE?</span><strong>That cannot be determined here.</strong><p>These model scores cannot confirm or rule out disease, even when every score is low.</p></div></div>
    <div class="scan-report-grid"><section class="scan-report-image"><div class="scan-report-section-heading"><span>01 / SUBMITTED IMAGE</span></div><div class="scan-preview">${preview}</div><p title="${escapeHtml(state.localImageName)}">${escapeHtml(state.localImageName || "Uploaded image")}</p></section>
      <section class="scan-report-scores"><div class="scan-report-section-heading"><span>02 / MODEL OUTPUT</span><small>Highest five of ${findings.length} findings</small></div><div class="scan-score-list">${findings.slice(0, 5).map(scanScoreRow).join("") || `<p>No model scores were returned.</p>`}</div>${findings.length > 5 ? `<details class="scan-more-scores"><summary>View all ${findings.length} scores</summary><div class="scan-score-list">${findings.slice(5).map((item, index) => scanScoreRow(item, index + 5)).join("")}</div></details>` : ""}</section></div>
    <div class="scan-report-guidance"><div><span class="scan-guidance-icon">i</span><div><b>How to read the scores</b><p>Each bar is a separate model output. They do not add up to 100%. The model cannot tell where a finding is or how severe it is.</p></div></div><div><span class="scan-guidance-icon">!</span><div><b>When to get urgent help</b><p>Seek urgent medical care for severe difficulty breathing or sudden, persistent chest pain, regardless of these scores.</p></div></div></div>
    <footer class="scan-report-footer"><span>Experimental output · Not a diagnosis</span><button class="outline-button" type="button" data-route="patient/history">View assessment history ${icon("arrow", 14)}</button></footer>
  </article>`;
}

function modelsPage() {
  const filtered = state.models.filter(model => `${model.name} ${model.outcome || ""} ${model.description || ""}`.toLowerCase().includes(state.modelSearch.toLowerCase()));
  const published = filtered.map(model => `<article class="model-tile"><div class="model-tile-top"><span class="model-art-icon model-lilac">◌</span><span class="model-status">${escapeHtml(model.status)}</span></div><span class="model-kind">${escapeHtml(model.model_type || "HEALTH MODEL")}</span><h3>${escapeHtml(model.name)}</h3><p>${escapeHtml(model.description || "No description provided.")}</p><span class="model-meta">Admin published model</span></article>`).join("");
  const local = state.localModels.filter(model => `${model.name} ${model.task}`.toLowerCase().includes(state.modelSearch.toLowerCase())).map(model => `<article class="model-tile"><div class="model-tile-top"><span class="model-art-icon model-peach">✳</span><span class="model-status">${escapeHtml(model.status)}</span></div><span class="model-kind">LOCAL CHECKPOINT</span><h3>${escapeHtml(model.name)}</h3><p>${escapeHtml(model.description)}</p><div class="model-meta"><span>${escapeHtml(model.task)}${model.required_attributes?.length ? ` · Inputs: ${escapeHtml(model.required_attributes.join(", "))}` : ""}</span></div>${model.available ? `<button class="outline-button" data-choose-local="${model.id}">Use this model ${icon("arrow", 14)}</button>` : `<small>${escapeHtml(model.reason)}</small>`}</article>`).join("");
  const result = state.localResult;
  return `${pageHeader("MODEL LIBRARY", "Explore health models", "Review model status and run a local experimental checkpoint when available.", `<span class="collection-count">${state.models.length + state.localModels.length} MODELS</span>`)}
    <div class="section-row models-toolbar"><div><span class="section-kicker">AVAILABLE MODELS</span><h2>Choose a model</h2></div><label class="search-field">${icon("search", 16)}<input id="model-search" placeholder="Search models" value="${escapeHtml(state.modelSearch)}"/></label></div>
    <div class="model-grid">${local}${published || (!local ? `<div class="panel empty-state">No models available yet.</div>` : "")}</div>
    <section class="panel local-inference"><span class="section-kicker">CHEST X-RAY</span><h2>Try CheXNet locally</h2><p>Choose a chest radiograph image. This experimental output is saved to your assessment history; it is not a diagnosis.</p>
      <form id="local-predict-form"><label class="field-label">Chest X-ray image<input id="local-image" type="file" accept="image/png,image/jpeg,image/webp" required/></label><button class="primary-button" type="submit">Analyze image</button></form>
      ${result ? renderScanReport(result) : ""}
    </section>`;
}
function assistantPage() {
  const messages = state.chatMessages.length ? state.chatMessages.map(message => `
    <article class="chat-bubble ${message.role === "user" ? "from-me" : "from-agent"}">
      ${message.role === "assistant" ? `<span class="agent-avatar">✦</span>` : ""}
      <div><div class="chat-text ${message.role === "assistant" ? "chat-rich" : ""}">${message.role === "assistant" ? renderAssistantText(message.content) : escapeHtml(message.content)}</div>
      ${message.image_document_id ? `<small class="chat-attachment-label">${icon("file", 13)} Image attached</small>` : ""}
      ${message.role === "assistant" && message.sources?.length ? `<small class="chat-sources">Sources: ${escapeHtml([...new Set(message.sources.map(source => source.name))].join(", "))}</small>` : ""}
      ${message.role === "assistant" && message.model_runs?.some(run => run.available) ? `<small class="chat-sources">Model result included</small>` : ""}</div>
    </article>`).join("") : `<div class="chat-start"><span class="agent-avatar large">✦</span><h3>Ask about your health story.</h3><p>I can explain your uploaded reports, help prepare questions for a clinician, and use a published model when its inference service is connected.</p></div>`;
  return `${pageHeader("YOUR HEALTH, IN CONTEXT", "Your AI companion", "Ask about your documents, assessments, or an image you attach.", `<span class="availability"><i></i> AI COMPANION READY</span>`)}
    <div class="assistant-layout"><section class="chat-panel">
      <div class="chat-top"><div class="assistant-presence"><span class="agent-avatar large">✦</span><span><b>Luma companion</b><small><i></i> Your private health context</small></span></div></div>
      <div class="chat-messages" id="chat-messages" aria-live="polite">${messages}${state.chatBusy ? `<div class="chat-bubble from-agent"><span class="agent-avatar">✦</span><div>Thinking through your question…</div></div>` : ""}</div>
      ${state.chatAttachment ? `<div class="chat-selected-image">${icon("file", 16)} ${escapeHtml(state.chatAttachment.name)} <button type="button" data-action="clear-chat-image" aria-label="Remove attached image">×</button></div>` : ""}
      <form class="chat-composer" id="chat-form"><label class="chat-attach" title="Attach an image" aria-label="Attach an image">${icon("plus", 20)}<input id="chat-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden ${state.chatBusy ? "disabled" : ""}/></label><input name="message" placeholder="Ask about a report or attach an image…" autocomplete="off" value="${escapeHtml(state.chatDraft)}" ${state.chatBusy ? "disabled" : ""}/><button type="submit" ${state.chatBusy ? "disabled" : ""} aria-label="Send message">${icon("arrow", 17)}</button></form>
      <div class="chat-disclaimer">For understanding and preparation. Luma does not diagnose or replace your clinician.</div>
    </section><aside class="assistant-aside"><span class="section-kicker">TRY ASKING</span>
      <button class="prompt-card" data-chat-prompt="Summarize my uploaded health reports in plain language."><span class="prompt-symbol prompt-lilac">?</span><span><b>Summarize my reports</b><small>Key details from your documents</small></span></button>
      <button class="prompt-card" data-chat-prompt="What questions should I ask my clinician about my recent results?"><span class="prompt-symbol prompt-peach">${icon("file", 16)}</span><span><b>Prepare for a visit</b><small>Questions based on your history</small></span></button>
      <button class="prompt-card" data-chat-prompt="Is there a published model that can help with my question?"><span class="prompt-symbol prompt-mint">${icon("box", 16)}</span><span><b>Explore model support</b><small>Use a model when connected</small></span></button>
      <div class="agent-boundary">${icon("shield", 16)}<span><b>Your context stays in your account</b><small>Relevant excerpts and attached images are sent to Gemini to answer your question.</small></span></div>
    </aside></div>`;
}

function historyPage() {
  return `${pageHeader("YOUR RECORD", "Assessment history", "Review model assessments saved to your account.", `<span class="soft-pill">${state.assessments.length} ASSESSMENTS</span>`)}<div class="history-summary"><div><span class="section-kicker">YOUR ACTIVITY</span><h2>${state.assessments.length ? "Your recent assessments." : "A fresh start."}</h2><p>Only assessments belonging to your account appear here.</p></div><div class="history-illustration"><span class="timeline-line"></span><i></i><i></i><i></i><span class="timeline-card">${state.assessments.length ? `${state.assessments.length} saved` : "No assessments yet"}</span></div></div><div class="panel history-panel"><div class="panel-heading"><div><span class="section-kicker">ASSESSMENTS</span><h3>Your activity</h3></div></div>${state.assessments.length ? state.assessments.map(assessmentRow).join("") : `<div class="empty-history"><span class="history-empty-icon">${icon("clock", 20)}</span><b>Your timeline starts with you</b><span>Completed assessments will appear here when a prediction model is connected.</span><button class="primary-button compact" data-route="patient/models">Explore models ${icon("arrow", 14)}</button></div>`}</div>`;
}

function adminDashboard() {
  const counts = state.adminCounts || {};
  const latest = state.models.slice(0, 4).map(model => `<div class="registry-row"><span class="registry-mark registry-lilac">◌</span><span><b>${escapeHtml(model.name)}</b><small>${escapeHtml(model.model_type || "Health model")} · Updated ${escapeHtml(new Date(model.updated_at || model.created_at).toLocaleDateString())}</small></span><span class="live-status ${model.status === "published" ? "status-live" : "status-review"}">${escapeHtml(model.status)}</span></div>`).join("");
  return `${pageHeader(formattedDate(), `Good morning, ${escapeHtml(displayName())}.`, "Your model workspace and publishing activity.", `<button class="primary-button compact" data-route="admin/publish">${icon("plus", 15)} Add a model</button>`)}<div class="admin-welcome"><div><span class="welcome-label">MODEL STUDIO</span><h2>Thoughtful models.<br/><em>Clearer decisions.</em></h2><p>Review model records, validation details, and access in one place.</p><button class="light-button" data-route="admin/lab">Open training lab ${icon("arrow", 15)}</button></div><div class="admin-visual"><div class="admin-cube"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="cube-orbit orbit-1"></div><div class="cube-orbit orbit-2"></div><div class="cube-tag tag-model">${icon("box", 14)} MODEL REGISTRY</div><div class="cube-tag tag-safe">${icon("shield", 14)} VALIDATE BEFORE PUBLISH</div><span class="cube-spark spark-1">✦</span><span class="cube-spark spark-2">✳</span></div></div><div class="metric-grid"><div class="metric-card"><span class="metric-label">MODEL RECORDS</span><strong>${counts.models ?? "—"}</strong><span class="metric-foot">Saved in the registry</span><span class="metric-icon lilac-icon">${icon("box", 17)}</span></div><div class="metric-card"><span class="metric-label">ASSESSMENTS</span><strong>${counts.assessments ?? "—"}</strong><span class="metric-foot">Recorded model runs</span><span class="metric-icon peach-icon">${icon("chart", 17)}</span></div><div class="metric-card"><span class="metric-label">PATIENT ACCOUNTS</span><strong>${counts.patients ?? "—"}</strong><span class="metric-foot">Profiles in this project</span><span class="metric-icon mint-icon">${icon("users", 17)}</span></div><div class="metric-card"><span class="metric-label">TRAINING RUNS</span><strong>${counts.training ?? "—"}</strong><span class="metric-foot">Recorded in the lab</span><span class="metric-icon gold-icon">${icon("flask", 17)}</span></div></div><div class="admin-dashboard-grid"><div class="panel chart-panel"><div class="panel-heading"><div><span class="section-kicker">MODEL ACTIVITY</span><h3>Usage overview</h3></div><button class="subtle-link" data-route="admin/insights">Open insights ${icon("arrow", 13)}</button></div><div class="empty-activity admin-empty-activity"><div class="empty-activity-icon">${icon("chart", 19)}</div><div><b>No activity chart yet</b><span>Usage trends will appear after the prediction service records model runs.</span></div></div></div><div class="panel live-models-panel"><div class="panel-heading"><div><span class="section-kicker">MODEL REGISTRY</span><h3>Recently updated</h3></div><button class="subtle-link" data-route="admin/insights">All models ${icon("arrow", 13)}</button></div>${latest || `<div class="empty-activity"><div class="empty-activity-icon">${icon("box", 19)}</div><div><b>No model records</b><span>Add a model to begin the registry.</span></div></div>`}<button class="registry-footer" data-route="admin/publish">Add a model ${icon("arrow", 14)}</button></div></div>`;
}

function adminInsights() {
  const rows = state.models.map(model => {
    const versions = state.modelVersions.filter(version => version.model_id === model.id);
    const metrics = versions.find(v => v.validation_metrics)?.validation_metrics;
    const totalRuns = state.assessments.filter(item => item.model_id === model.id).length;
    return `<tr><td><span class="table-model"><i class="registry-mark registry-lilac">◌</i><b>${escapeHtml(model.name)}</b></span></td><td><span class="live-status ${model.status === "published" ? "status-live" : "status-review"}">${escapeHtml(model.status)}</span></td><td>${totalRuns}</td><td>${metrics?.accuracy != null ? `${Math.round(metrics.accuracy * (metrics.accuracy <= 1 ? 100 : 1))}%` : "Not recorded"}</td><td>${metrics?.roc_auc != null ? Number(metrics.roc_auc).toFixed(3) : "—"}</td><td>${escapeHtml(model.updated_at ? new Date(model.updated_at).toLocaleDateString() : "—")}</td></tr>`;
  }).join("");
  const successful = state.assessments.filter(item => item.status === "completed").length;
  const completedRate = state.assessments.length ? Math.round(successful / state.assessments.length * 100) : null;
  return `${pageHeader("MODEL STUDIO / REPORTING", "Model insights", "Review the registry, recorded assessments, and validation metrics stored for each model.", `<button class="outline-button compact" data-action="export-report" ${state.models.length ? "" : "disabled"}>${icon("file", 15)} Export report</button>`)}<div class="report-filter"><span>${icon("box", 16)} All model records</span><span class="sample-tag">LIVE DATABASE VALUES</span></div><div class="report-metric-grid"><div class="report-stat"><span>Model records</span><b>${state.models.length}</b><small>All statuses</small></div><div class="report-stat"><span>Recorded assessments</span><b>${state.assessments.length}</b><small>Stored across all models</small></div><div class="report-stat"><span>Completed assessments</span><b>${successful}</b><small>${completedRate == null ? "No completed runs recorded" : `${completedRate}% of recorded assessments`}</small></div><div class="report-stat"><span>Validation metrics</span><b>${state.modelVersions.filter(v => v.validation_metrics).length}</b><small>Versions with saved metrics</small></div></div><div class="panel table-panel"><div class="panel-heading"><div><span class="section-kicker">MODEL PERFORMANCE</span><h3>Registry and validation summary</h3></div></div><div class="table-scroll"><table><thead><tr><th>MODEL</th><th>STATUS</th><th>RUNS</th><th>ACCURACY</th><th>ROC AUC</th><th>UPDATED</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No model records yet. Published and draft models will appear here.</td></tr>`}</tbody></table></div></div><div class="notice-strip">${icon("info", 16)} <span>Only metrics saved with a model version are shown. No performance values are estimated or filled in.</span></div>`;
}

function publishPage() {
  return `${pageHeader("MODEL STUDIO / REGISTRY", "Add a model", "Create a model record and optionally store its first artifact version.", `<span class="step-count">DRAFT UNTIL REVIEWED</span>`)}<div class="publish-layout"><form class="panel publish-form" id="publish-form"><div class="form-section-title"><span class="form-step">01</span><div><h3>Model details</h3><p>Describe the outcome and intended use in clear language.</p></div></div><label class="field-label">Model name <span>*</span><input required name="modelName" placeholder="e.g. Diabetes risk overview"/></label><label class="field-label">Health outcome<select name="outcome" required><option value="">Choose a health outcome</option><option>Diabetes risk</option><option>Cardiovascular risk</option><option>Other health outcome</option></select></label><div class="field-row"><label class="field-label">Model type<select name="modelType"><option value="tabular_classification">Tabular classification</option><option value="regression">Regression</option><option value="image_classification">Image classification</option><option value="qml">Quantum ML (tabular)</option></select></label><label class="field-label">Version<input name="version" value="0.1.0" required/></label></div><label class="field-label">Description<textarea name="description" rows="3" placeholder="What does this model estimate? What should users know before using it?" required></textarea><small class="field-hint">This description is visible in the patient model library.</small></label><div class="form-section-title file-title"><span class="form-step">02</span><div><h3>Model artifact</h3><p>Optionally store a private first version. Publishing stays a separate review step.</p></div></div><label class="artifact-drop" for="model-file"><input type="file" id="model-file" accept=".onnx,.joblib,.pkl,.pickle,.zip"/><span class="artifact-icon">${icon("upload", 19)}</span><b id="artifact-name">Choose a model artifact</b><small>ONNX, joblib, pickle or ZIP · up to 250 MB</small><span class="artifact-note">Stored in the private model-artifacts bucket.</span></label><div class="form-actions"><button type="submit" class="primary-button">Save model draft ${icon("arrow", 15)}</button></div></form><aside class="publish-aside"><div class="publish-preview-card"><span class="section-kicker">PATIENT MODEL CARD</span><div class="preview-card-art"><div class="preview-blob">◌</div><span class="preview-small-chip">MODEL</span></div><span class="preview-kind">HEALTH MODEL</span><h3>Your model name</h3><p>A clear description helps people understand what the model is designed to estimate.</p><span class="preview-publish-state">Visible after review ${icon("arrow", 13)}</span></div><div class="publish-checklist"><span class="section-kicker">BEFORE PUBLISHING</span><p>${icon("check", 14)} Record dataset provenance</p><p>${icon("check", 14)} Add intended use and limits</p><p>${icon("check", 14)} Validate a version</p><p>${icon("check", 14)} Review before publishing</p></div></aside></div>`;
}

function labPage() {
  const sites = state.federation.sites || [];
  const chexnet = (state.federation.models || []).find(model => model.id === "cxr-pneumo-cnn");
  const runs = state.trainingRuns.map(run => { const last = run.metrics?.history?.at(-1) || run.metrics || {}; return `<div class="registry-row"><span class="registry-mark registry-lilac">${icon("flask", 16)}</span><span><b>${escapeHtml(run.model_name)}</b><small>${escapeHtml(new Date(run.created_at).toLocaleString())} · ${escapeHtml(run.configuration?.sites?.join(", ") || "")}</small></span><span class="live-status ${run.status === "completed" ? "status-live" : "status-review"}">${escapeHtml(run.status)}</span><small>${last.held_out_accuracy !== undefined ? `Held-out: ${(last.held_out_accuracy * 100).toFixed(1)}% (${last.held_out_samples} images)` : ""}${run.error_summary ? escapeHtml(run.error_summary) : ""}</small>${run.status === "completed" && run.metrics?.filename && state.federation.active?.sha256 !== run.metrics.sha256 ? `<button class="outline-button" data-activate-run="${escapeHtml(run.id)}">Activate experimental checkpoint</button>` : ""}</div>`; }).join("");
  return `${pageHeader("MODEL STUDIO / FEDERATION", "Training & testing lab", "Train a CheXNet classifier across explicitly labeled local sites using sample-weighted FedAvg.", `<span class="lab-state"><i></i> ${sites.length} LOCAL SITES</span>`)}
    <div class="lab-layout"><section class="panel lab-config"><div class="panel-heading"><div><span class="section-kicker">REAL TRAINING</span><h3>Federated run</h3></div><span class="form-step">01</span></div>
      <p>Each site keeps images and a labels.csv file on this machine. The coordinator averages model updates by the number of labeled samples. No synthetic metrics or patient uploads are used.</p>
      <div class="notice-strip">${icon("shield", 16)} <span>Checkpoint: ${chexnet?.checkpoint_present ? "CheXNet update found" : "missing"} · Minimum two sites, four labeled images per site.</span></div>
      <p>Active inference checkpoint: ${escapeHtml(state.federation.active?.filename || "original local CheXNet update")}</p>
      <div class="panel-heading"><h3>Detected sites</h3><button class="subtle-link" data-action="refresh-lab">Refresh</button></div>
      ${sites.length ? sites.map(site => `<div class="registry-row"><b>${escapeHtml(site.id)}</b><span class="live-status status-live">labels.csv found</span></div>`).join("") : `<div class="empty-activity"><b>No labeled sites found.</b><span>See the README for the local folder format.</span></div>`}
      <form id="federated-form"><div class="field-row"><label class="field-label">Rounds<input name="rounds" type="number" min="1" max="10" value="1" required/></label><label class="field-label">Local epochs<input name="epochs" type="number" min="1" max="5" value="1" required/></label></div>
        <button class="primary-button run-training" type="submit" ${sites.length < 2 || !chexnet?.available ? "disabled" : ""}>${icon("flask", 16)} Start real training</button></form>
      <small class="demo-only">Training may take several minutes. Review the held-out result before activating a checkpoint. Activation remains experimental and is not clinical validation.</small>
    </section><section class="lab-results"><div class="panel experiment-panel"><div class="panel-heading"><div><span class="section-kicker">TRAINING RUNS</span><h3>Experiment history</h3></div><button class="subtle-link" data-action="refresh-lab">Refresh</button></div>${runs || `<div class="run-illustration"><b>No federated runs yet.</b></div>`}</div></section></div>`;
}
function accessPage() {
  const rows = state.adminProfiles.map(profile => `<tr><td><span class="person-cell"><i class="person-avatar">${escapeHtml((profile.full_name || profile.email || "U").split(/[\s.@_-]+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join(""))}</i><span><b>${escapeHtml(profile.full_name || "Account")}</b><small>${escapeHtml(profile.email || "")}</small></span></span></td><td>${escapeHtml(profile.role)}</td><td>${escapeHtml(new Date(profile.created_at).toLocaleDateString())}</td><td><span class="live-status status-live">Active</span></td></tr>`).join("");
  const audit = state.trainingRuns.slice(0,4).map(event => `<div class="audit-event"><span class="audit-dot dot-purple"></span><span><b>${escapeHtml(event.event_type || "Training run updated")}</b><small>${escapeHtml(event.model_name || event.status || "Model workspace")}</small></span><time>${escapeHtml(new Date(event.created_at).toLocaleDateString())}</time></div>`).join("");
  return `${pageHeader("ADMIN STUDIO / GOVERNANCE", "People & access", "Review registered profiles and recorded workspace events.", "")}<div class="access-summary"><div><span>${icon("users", 18)}</span><b>${state.adminProfiles.length}</b><small>Profiles visible to admins</small></div><div><span>${icon("shield", 18)}</span><b>${state.adminProfiles.filter(p=>p.role === "admin").length}</b><small>Admin profiles</small></div><div><span>${icon("clock", 18)}</span><b>${state.trainingRuns.length}</b><small>Recent training events</small></div></div><div class="panel access-table"><div class="panel-heading"><div><span class="section-kicker">PROFILES</span><h3>Workspace accounts</h3></div><label class="search-field">${icon("search", 15)}<input id="profile-search" placeholder="Search profiles"/></label></div><div class="table-scroll"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>CREATED</th><th>STATUS</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No profiles available.</td></tr>`}</tbody></table></div></div><div class="panel audit-panel"><div class="panel-heading"><div><span class="section-kicker">WORKSPACE EVENTS</span><h3>Recent training activity</h3></div></div>${audit || `<div class="empty-activity"><div class="empty-activity-icon">${icon("clock", 19)}</div><div><b>No events recorded</b><span>Auditable admin actions will appear here when the service is connected.</span></div></div>`}</div><div class="notice-strip">${icon("shield", 16)} <span>Admin access is enforced with Supabase Auth profiles and database row-level security.</span></div>`;
}

const pages = {
  "patient/dashboard": ["Your overview", patientDashboard],
  "patient/documents": ["Your documents", documentsPage],
  "patient/models": ["Explore health models", modelsPage],
  "patient/assistant": ["Your AI companion", assistantPage],
  "patient/history": ["Assessment history", historyPage],
  "admin/dashboard": ["Overview", adminDashboard],
  "admin/insights": ["Model insights", adminInsights],
  "admin/publish": ["Publish a model", publishPage],
  "admin/lab": ["Training & testing lab", labPage],
  "admin/access": ["People & access", accessPage],
};

function appShell() {
  const role = state.profile?.role;
  const [title, renderContent] = pages[state.page];
  return `<div class="app-shell ${state.mobileMenu ? "menu-open" : ""}">${sidebar(role)}<div class="app-main">${topbar(role, title)}<main class="content-area"><div class="content-inner">${state.pageError ? dataErrorBlock(state.pageError) : state.pageBusy ? loadingBlock() : renderContent()}</div></main><footer class="app-footer"><span>© 2026 Luma Health Studio</span><span>Health insights, with care ${icon("heart", 13)}</span></footer></div><div class="sidebar-scrim" data-action="close-menu"></div></div>`;
}

function render() {
  const app = $("#app");
  if (!state.authReady || !state.user || !state.profile) {
    app.innerHTML = loginPage();
  } else if (!pages[state.page] || (state.profile.role === "patient" && state.page.startsWith("admin/")) || (state.profile.role === "admin" && state.page.startsWith("patient/"))) {
    state.page = state.profile.role === "admin" ? "admin/dashboard" : "patient/dashboard";
    location.hash = `/${state.page}`;
    app.innerHTML = appShell();
  } else {
    app.innerHTML = appShell();
  }
  renderToast();
  bindDynamicPage();
}

function renderToast() {
  $(".toast")?.remove();
  if (!state.toast) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<span>${icon("check", 16)}</span>${escapeHtml(state.toast)}`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add("visible"));
}

function route(page) {
  if (page !== "login" && !state.user) {
    state.authError = "Please sign in to open your workspace.";
    state.page = "login";
    location.hash = "/";
    render();
    return;
  }
  state.page = page;
  state.pageError = "";
  state.pageBusy = false;
  state.mobileMenu = false;
  if (page === "login") location.hash = "/";
  else location.hash = `/${page}`;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page !== "login") loadPageData(page);
}

async function loadProfile(user) {
  const profileFields = "id,email,full_name,role,created_at";
  let { data, error } = await state.supabase.from("profiles").select(profileFields).eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: repairError } = await state.supabase.rpc("ensure_my_profile");
    if (repairError) {
      console.error("Profile repair failed", repairError.code);
      throw new Error("We couldn’t prepare your account. Please try again or contact the workspace administrator.");
    }
    ({ data, error } = await state.supabase.from("profiles").select(profileFields).eq("id", user.id).maybeSingle());
    if (error) throw error;
  }
  if (!data) throw new Error("Your account is signed in, but its profile could not be loaded. Contact the workspace administrator.");
  if (!["patient", "admin"].includes(data.role)) throw new Error("This account does not have a supported portal role.");
  return data;
}

async function applySession(user, roleHint) {
  if (!user) {
    state.user = null;
    state.profile = null;
    state.authBusy = false;
    state.authReady = true;
    state.page = "login";
    render();
    return;
  }
  state.user = user;
  try {
    state.profile = await loadProfile(user);
    if (roleHint && state.profile.role !== roleHint) {
      await state.supabase.auth.signOut({ scope: "local" });
      state.user = null;
      state.profile = null;
      state.authBusy = false;
      state.authError = `This account is not registered as ${roleHint === "admin" ? "an admin" : "a patient"}.`;
      state.page = "login";
      state.authReady = true;
      render();
      return;
    }
    state.authBusy = false;
    state.authReady = true;
    state.page = state.profile.role === "admin" ? "admin/dashboard" : "patient/dashboard";
    location.hash = `/${state.page}`;
    render();
    loadPageData(state.page);
  } catch (error) {
    await state.supabase.auth.signOut({ scope: "local" }).catch(() => {});
    state.user = null;
    state.profile = null;
    state.authBusy = false;
    state.authReady = true;
    state.authError = error.message || "Could not load your account profile.";
    state.page = "login";
    location.hash = "/";
    render();
    $("#auth-screen")?.scrollIntoView({ block: "start" });
  }
}

async function initializeAuth() {
  if (!isSupabaseConfigured()) {
    state.authReady = true;
    state.page = "login";
    render();
    return;
  }
  try {
    state.supabase = await getSupabase();
    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await applySession(data.session.user);
    else {
      state.authReady = true;
      state.page = "login";
      render();
    }
    state.supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || manualAuthInProgress) return;
      if (session?.user.id === state.user?.id && state.profile && ["SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) return;
      window.setTimeout(() => applySession(session?.user || null), 0);
    });
  } catch (error) {
    state.authReady = true;
    state.authError = error.message || "Unable to initialize Supabase Auth.";
    state.page = "login";
    render();
  }
}

async function signIn(form) {
  if (state.authBusy || !state.authReady) return;
  const values = new FormData(form);
  const email = String(values.get("email") || "").trim().toLowerCase();
  const password = String(values.get("password") || "");
  const mode = form.dataset.mode;
  const role = state.roleChoice;
  state.authEmail = email;
  state.authError = "";
  state.authNotice = "";
  if (!isSupabaseConfigured()) {
    setAuthError("Supabase is not configured yet. Add the project URL and anon key to .env, then restart the app.");
    return;
  }
  state.authBusy = true;
  manualAuthInProgress = true;
  render();
  try {
    state.supabase = await getSupabase();
    if (mode === "reset") {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: getAuthRedirectUrl() });
      if (error) throw error;
      state.authMode = "signin";
      state.authBusy = false;
      render();
      toast("If the account exists, a password reset email has been sent.");
      return;
    }
    const result = await signInOrCreatePatient(state.supabase.auth, {
      email, password, role, adminEmail: getSupabaseConfig().adminEmail, redirectTo: getAuthRedirectUrl(),
    }, registerPatient);
    if (result.requiresConfirmation) {
      state.authBusy = false;
      state.authNotice = "Check your email to confirm your account, then return here to sign in.";
      render();
      return;
    }
    await applySession(result.session.user, role);
  } catch (error) {
    state.authBusy = false;
    state.authError = friendlyAuthError(error);
    render();
  } finally {
    manualAuthInProgress = false;
    if (!state.profile) $("#auth-screen")?.scrollIntoView({ block: "start" });
  }
}

function friendlyAuthError(error) {
  const message = String(error?.message || "Sign-in could not be completed.");
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email before signing in.";
  if (/email logins are disabled|email provider is disabled/i.test(message)) return "Email sign-in is currently unavailable. Continue with Google or ask the workspace administrator to enable email sign-in.";
  if (/failed to fetch|network/i.test(message)) return "Could not reach Supabase. Check the project URL and network connection.";
  return message;
}

async function startOAuth(provider) {
  if (state.authBusy || !state.authReady) return;
  if (state.roleChoice !== "patient") {
    toast("Social sign-in is for patient accounts. Use the admin email and password for the admin portal.");
    return;
  }
  if (!isSupabaseConfigured()) {
    state.authError = "Add the Supabase project URL and anon key before using OAuth.";
    render();
    return;
  }
  state.authBusy = true;
  render();
  try {
    state.supabase = await getSupabase();
    const { error } = await state.supabase.auth.signInWithOAuth({ provider, options: { redirectTo: getAuthRedirectUrl() } });
    if (error) throw error;
  } catch (error) {
    state.authBusy = false;
    state.authError = friendlyAuthError(error);
    render();
  }
}

async function signOut() {
  if (state.supabase) await state.supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.page = "login";
  state.authError = "";
  state.authEmail = "";
  state.authNotice = "";
  location.hash = "/";
  render();
}

async function loadPageData(page) {
  if (!state.supabase || !state.user) return;
  state.pageBusy = true;
  state.pageError = "";
  render();
  try {
    if (page === "patient/documents") {
      const { data, error } = await state.supabase.from("documents").select("id,original_name,mime_type,created_at,processing_status").eq("owner_id", state.user.id).order("created_at", { ascending: false });
      if (error) throw error;
      state.documents = data || [];
      state.documentCount = state.documents.length;
      const pending = state.documents.filter(doc => ["stored", "queued"].includes(doc.processing_status) && !state.extractionStarted.has(doc.id));
      if (pending.length) window.setTimeout(() => processPendingDocuments(pending), 0);
    } else if (page === "patient/assistant") {
      const { messages } = await apiRequest("/api/chat/messages");
      state.chatMessages = messages || [];
    } else if (page === "patient/models") {
      const [{ data, error }, local] = await Promise.all([
        state.supabase.from("health_models").select("id,name,outcome,description,model_type,status,required_attributes,updated_at").eq("status", "published").order("updated_at", { ascending: false }),
        apiRequest("/api/models/local"),
      ]);
      if (error) throw error;
      state.models = data || [];
      state.localModels = local.models || [];
    } else if (page === "patient/history") {
      const { data, error } = await state.supabase.from("assessments").select("id,model_id,model_name,status,risk_band,created_at").eq("owner_id", state.user.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      state.assessments = data || [];
    } else if (page === "patient/dashboard") {
      const [docRes, assessmentRes] = await Promise.all([
        state.supabase.from("documents").select("id", { count: "exact", head: true }).eq("owner_id", state.user.id),
        state.supabase.from("assessments").select("id,model_id,model_name,status,risk_band,created_at", { count: "exact" }).eq("owner_id", state.user.id).order("created_at", { ascending: false }).limit(3),
      ]);
      if (docRes.error) throw docRes.error;
      if (assessmentRes.error) throw assessmentRes.error;
      state.documentCount = docRes.count || 0;
      state.assessments = assessmentRes.data || [];
    } else if (page === "admin/dashboard" || page === "admin/insights" || page === "admin/access" || page === "admin/lab") {
      await loadAdminData(page);
    }
  } catch (error) {
    state.pageError = friendlyDataError(error);
  } finally {
    state.pageBusy = false;
    render();
  }
}

async function loadAdminData(page) {
  const modelQuery = state.supabase.from("health_models").select("id,name,outcome,description,model_type,status,required_attributes,updated_at,created_at,owner_id").order("updated_at", { ascending: false });
  const [modelsResult, assessmentResult, versionResult] = await Promise.all([
    modelQuery,
    state.supabase.from("assessments").select("id,model_id,status,created_at"),
    state.supabase.from("model_versions").select("id,model_id,version,status,validation_metrics,created_at"),
  ]);
  if (modelsResult.error) throw modelsResult.error;
  if (assessmentResult.error) throw assessmentResult.error;
  if (versionResult.error) throw versionResult.error;
  state.models = modelsResult.data || [];
  state.assessments = assessmentResult.data || [];
  state.modelVersions = versionResult.data || [];
  if (page === "admin/dashboard") {
    const [profiles, runs] = await Promise.all([
      state.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
      state.supabase.from("training_runs").select("id", { count: "exact", head: true }),
    ]);
    if (profiles.error) throw profiles.error;
    if (runs.error) throw runs.error;
    state.adminCounts = { models: state.models.length, assessments: state.assessments.length, patients: profiles.count || 0, training: runs.count || 0 };
  }
  if (page === "admin/access") {
    const [profiles, events] = await Promise.all([
      state.supabase.from("profiles").select("id,email,full_name,role,created_at").order("created_at", { ascending: false }).limit(100),
      state.supabase.from("audit_events").select("id,event_type,model_name,status,created_at").order("created_at", { ascending: false }).limit(10),
    ]);
    if (profiles.error) throw profiles.error;
    if (events.error) throw events.error;
    state.adminProfiles = profiles.data || [];
    state.trainingRuns = events.data || [];
  }
  if (page === "admin/lab") {
    const [{ data, error }, federation] = await Promise.all([
      state.supabase.from("training_runs").select("id,model_name,status,configuration,metrics,error_summary,created_at").order("created_at", { ascending: false }).limit(25),
      apiRequest("/api/federation/status"),
    ]);
    if (error) throw error;
    state.trainingRuns = data || [];
    state.federation = federation;
  }
}

function friendlyDataError(error) {
  const message = String(error?.message || "");
  if (/does not exist|schema cache|could not find/i.test(message)) return "The Supabase schema is not installed yet. Apply the migrations in backend/supabase/migrations before loading data.";
  if (/row-level security|permission denied|not allowed/i.test(message)) return "Supabase denied access under the current row-level security policies.";
  return message || "Check your connection and try again.";
}

function bindDynamicPage() {
  const stage = $(".login-stage");
  const sculpture = $(".hero-sculpture");
  if (stage && sculpture) {
    stage.addEventListener("pointermove", event => {
      const rect = stage.getBoundingClientRect();
      sculpture.style.setProperty("--tilt-x", `${-((event.clientY - rect.top) / rect.height - .5) * 8}deg`);
      sculpture.style.setProperty("--tilt-y", `${((event.clientX - rect.left) / rect.width - .5) * 10}deg`);
    });
    stage.addEventListener("pointerleave", () => { sculpture.style.setProperty("--tilt-x", "0deg"); sculpture.style.setProperty("--tilt-y", "0deg"); });
  }
  const zone = $("#upload-zone");
  if (zone) {
    ["dragenter", "dragover"].forEach(eventName => zone.addEventListener(eventName, event => { event.preventDefault(); zone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(eventName => zone.addEventListener(eventName, event => { event.preventDefault(); zone.classList.remove("dragging"); }));
    zone.addEventListener("drop", event => uploadDocuments(event.dataTransfer.files));
  }
}

async function uploadDocuments(files) {
  if (!state.supabase || !state.user) return;
  const selected = [...files];
  if (!selected.length) return;
  state.pageBusy = true;
  render();
  let saved = 0;
  let failed = 0;
  for (const file of selected) {
    try { await storePatientDocument(file); saved += 1; }
    catch (error) { failed += 1; toast(`${file.name}: ${friendlyDataError(error)}`); }
  }
  await loadPageData("patient/documents");
  if (saved && !failed) toast(`${saved} document${saved === 1 ? "" : "s"} stored and processed.`);
}

async function storePatientDocument(file) {
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv", "text/plain"]);
  if (!allowed.has(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Choose a supported file under 15 MB.");
  if (file.type.startsWith("image/") && file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB for text extraction.");
  const path = `${state.user.id}/${crypto.randomUUID()}-${file.name.replace(/[\\/]/g, "_")}`;
  const storage = state.supabase.storage.from("patient-documents");
  const { error: uploadError } = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data: document, error: rowError } = await state.supabase.from("documents").insert({
    owner_id: state.user.id, storage_path: path, original_name: file.name,
    mime_type: file.type, byte_size: file.size, processing_status: "queued",
  }).select("id").single();
  if (rowError) { await storage.remove([path]); throw rowError; }
  await apiRequest("/api/documents/extract", { method: "POST", body: { documentId: document.id } });
  return document.id;
}

async function processPendingDocuments(documents) {
  for (const doc of documents) {
    state.extractionStarted.add(doc.id);
    try { await apiRequest("/api/documents/extract", { method: "POST", body: { documentId: doc.id } }); }
    catch (error) { toast(`${doc.original_name}: ${friendlyDataError(error)}`); }
  }
  if (state.page === "patient/documents") await loadPageData("patient/documents");
}

async function sendChat(form) {
  if (state.chatBusy || !state.user) return;
  const message = String(new FormData(form).get("message") || "").trim();
  state.chatDraft = message;
  const attachment = state.chatAttachment;
  if (!message && !attachment) return;
  state.chatBusy = true;
  render();
  try {
    const imageDocumentId = attachment ? await storePatientDocument(attachment) : null;
    const { message: reply } = await apiRequest("/api/chat", { method: "POST", body: { message, imageDocumentId } });
    state.chatAttachment = null;
    state.chatDraft = "";
    const { messages } = await apiRequest("/api/chat/messages");
    state.chatMessages = messages || [reply];
  } catch (error) {
    toast(friendlyDataError(error));
  } finally {
    state.chatBusy = false;
    render();
    $("#chat-messages")?.scrollTo({ top: $("#chat-messages").scrollHeight });
  }
}

async function predictLocalModel(form) {
  const file = form.querySelector("#local-image")?.files?.[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    toast("Choose a PNG, JPEG, or WebP chest X-ray under 10 MB.");
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Analyzing image…";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const result = await apiRequest("/api/models/local/predict", { method: "POST", body: {
      modelId: "cxr-pneumo-cnn", fileName: file.name, image: { mimeType: file.type, data: btoa(binary) },
    } });
    if (!result.available) throw new Error(result.reason || "The model could not run.");
    if (state.localImagePreview) URL.revokeObjectURL(state.localImagePreview);
    state.localImagePreview = URL.createObjectURL(file);
    state.localImageName = file.name;
    state.localResult = result.result;
    render();
  } catch (error) {
    toast(friendlyDataError(error));
    button.disabled = false;
    button.textContent = "Analyze image";
  }
}

async function startFederatedTraining(form) {
  const values = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await apiRequest("/api/federation/run", { method: "POST", body: {
      rounds: Number(values.get("rounds")), epochs: Number(values.get("epochs")),
    } });
    toast("Federated training started. Refresh the lab to see its progress.");
    await loadPageData("admin/lab");
  } catch (error) {
    toast(friendlyDataError(error));
    button.disabled = false;
  }
}

async function createModel(form) {
  if (!state.supabase || !state.profile || state.profile.role !== "admin") return;
  const values = new FormData(form);
  const file = $("#model-file")?.files?.[0];
  const modelName = String(values.get("modelName") || "").trim();
  const version = String(values.get("version") || "0.1.0").trim();
  state.pageBusy = true;
  render();
  let storagePath = null;
  try {
    if (file) {
      if (file.size > 250 * 1024 * 1024) throw new Error("Model artifacts must be smaller than 250 MB.");
      storagePath = `${state.user.id}/${crypto.randomUUID()}-${file.name.replace(/[\\/]/g, "_")}`;
      const { error } = await state.supabase.storage.from("model-artifacts").upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) throw error;
    }
    const { data: model, error: modelError } = await state.supabase.from("health_models").insert({
      owner_id: state.user.id,
      name: modelName,
      slug: slugify(modelName),
      outcome: String(values.get("outcome") || "").trim(),
      model_type: String(values.get("modelType") || "tabular_classification"),
      input_modality: String(values.get("modelType")) === "image_classification" ? "image" : "tabular",
      description: String(values.get("description") || "").trim(),
      status: "draft",
      required_attributes: [],
    }).select("id").single();
    if (modelError) throw modelError;
    const { error: versionError } = await state.supabase.from("model_versions").insert({ model_id: model.id, version, storage_path: storagePath, status: "draft", created_by: state.user.id });
    if (versionError) throw versionError;
    state.pageBusy = false;
    state.page = "admin/insights";
    location.hash = "/admin/insights";
    await loadPageData("admin/insights");
    toast("Model draft saved. It is not published to patients.");
  } catch (error) {
    if (storagePath) await state.supabase.storage.from("model-artifacts").remove([storagePath]).catch(() => {});
    state.pageBusy = false;
    state.pageError = friendlyDataError(error);
    state.page = "admin/publish";
    location.hash = "/admin/publish";
    render();
  }
}

function slugify(text) {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || crypto.randomUUID();
}

document.addEventListener("click", async event => {
  const authScroll = event.target.closest("[data-scroll-auth]");
  if (authScroll) {
    event.preventDefault();
    $("#auth-screen")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const homeScroll = event.target.closest("[data-scroll-home]");
  if (homeScroll) {
    $("#landing-screen")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    if (state.callTimer) {
      window.clearTimeout(state.callTimer);
      state.callTimer = null;
    }
    if (state.isCalling) {
      state.isCalling = false;
      stopCallRingtone();
    }
    route(routeButton.dataset.route);
    return;
  }
  const prompt = event.target.closest("[data-chat-prompt]");
  if (prompt) { const input = $("#chat-form input[name=message]"); state.chatDraft = prompt.dataset.chatPrompt; if (input) { input.value = state.chatDraft; input.focus(); } return; }
  const retryExtraction = event.target.closest("[data-extract-document]");
  if (retryExtraction) { await processPendingDocuments([{ id: retryExtraction.dataset.extractDocument, original_name: "Document" }]); return; }
  const roleButton = event.target.closest("[data-role]");
  if (roleButton) {
    if (state.authBusy) return;
    state.roleChoice = roleButton.dataset.role;
    state.authError = "";
    state.authNotice = "";
    render();
    return;
  }
  const oauth = event.target.closest("[data-oauth]");
  if (oauth) { await startOAuth(oauth.dataset.oauth); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "choose-document") $("#document-input")?.click();
  if (action === "clear-chat-image") { state.chatAttachment = null; render(); }
  if (action === "show-password") { const input = $("input[name=password]"); input.type = input.type === "password" ? "text" : "password"; event.target.textContent = input.type === "password" ? "Show" : "Hide"; }
  if (action === "forgot" && !state.authBusy) { state.authMode = "reset"; state.authError = ""; state.authNotice = ""; render(); }
  if (action === "back-to-login" && !state.authBusy) { state.authMode = "signin"; state.authError = ""; state.authNotice = ""; render(); }
  if (action === "toggle-call") {
    if (state.callTimer) {
      window.clearTimeout(state.callTimer);
      state.callTimer = null;
    }
    state.isCalling = !state.isCalling;
    if (state.isCalling) {
      startCallRingtone();
      toast("Calling you…");
      state.callTimer = window.setTimeout(() => {
        state.isCalling = false;
        stopCallRingtone();
        state.callTimer = null;
        render();
      }, 3500);
    } else {
      stopCallRingtone();
      toast("Call ended");
    }
    render();
    return;
  }
  if (action === "logout") {
    if (state.callTimer) {
      window.clearTimeout(state.callTimer);
      state.callTimer = null;
    }
    if (state.isCalling) {
      state.isCalling = false;
      stopCallRingtone();
    }
    await signOut();
  }
  if (action === "open-menu") { state.mobileMenu = true; render(); }
  if (action === "close-menu") { state.mobileMenu = false; render(); }
  if (action === "notifications") toast("There are no new notifications.");
  if (action === "privacy") toast("Your account and document access are governed by Supabase policies.");
  if (action === "retry-page") loadPageData(state.page);
  if (action === "refresh-lab") loadPageData("admin/lab");
  const activateRun = event.target.closest("[data-activate-run]");
  if (activateRun) {
    try { await apiRequest("/api/federation/activate", { method: "POST", body: { runId: activateRun.dataset.activateRun } }); toast("Experimental checkpoint activated."); await loadPageData("admin/lab"); }
    catch (error) { toast(friendlyDataError(error)); }
    return;
  }
  if (event.target.closest("[data-choose-local]")) $("#local-image")?.click();
  if (action === "choose-dataset") toast("Dataset upload will be added with the training pipeline.");
  if (action === "export-report") toast("Report export will be added after the reporting requirements are set.");
});

document.addEventListener("change", event => {
  if (event.target.id === "document-input") uploadDocuments(event.target.files);
  if (event.target.id === "chat-image-input") {
    const file = event.target.files?.[0];
    if (file && (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      toast("Choose a PNG, JPEG, or WebP image under 10 MB.");
      return;
    }
    state.chatAttachment = file || null;
    render();
  }
  if (event.target.id === "model-file" && event.target.files[0]) $("#artifact-name").textContent = event.target.files[0].name;
});

document.addEventListener("input", event => {
  if (event.target.matches("#chat-form input[name=message]")) state.chatDraft = event.target.value;
  if (event.target.id === "model-search") {
    state.modelSearch = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const input = $("#model-search");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  }
  if (event.target.id === "profile-search") {
    const query = event.target.value.toLowerCase();
    $$(".person-cell").forEach(cell => { const row = cell.closest("tr"); row.hidden = !cell.textContent.toLowerCase().includes(query); });
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id === "login-form") await signIn(event.target);
  if (event.target.id === "publish-form") await createModel(event.target);
  if (event.target.id === "chat-form") await sendChat(event.target);
  if (event.target.id === "local-predict-form") await predictLocalModel(event.target);
  if (event.target.id === "federated-form") await startFederatedTraining(event.target);
});

window.addEventListener("hashchange", () => {
  const page = location.hash.replace(/^#\/?/, "") || "login";
  if (page === "login") { state.page = "login"; render(); return; }
  route(page);
});

render();
initializeAuth();

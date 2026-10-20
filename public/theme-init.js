// Apply the persisted theme before first paint so the window never flashes.
//
// Must stay in sync with usePersistedState (lib/usePersistedState.ts), which
// stores its value through JSON.stringify — a dark theme therefore lands in
// localStorage as the string `"dark"` (quotes included). Reading it raw hands
// the quoted form to data-theme, no [data-theme="…"] block matches, and the
// entire palette is undefined for the first frame. Parse first; keep tolerating
// a legacy unquoted value for profiles already written by older builds.
(function () {
  function readTheme() {
    var raw = null;
    try {
      raw = localStorage.getItem("app:theme");
    } catch (e) {
      return "system";
    }
    if (!raw) return "system";
    try {
      var parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
    } catch (e) {
      // Not JSON — fall through to the legacy unquoted form.
    }
    return raw.replace(/^"|"$/g, "");
  }

  var choice = readTheme();
  var theme =
    choice === "light" || choice === "dark"
      ? choice
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  document.documentElement.dataset.theme = theme;

  // settingsStore writes this one unquoted, so it needs no JSON parsing.
  var uiFont = "system";
  try {
    uiFont = localStorage.getItem("app:ui-font") || "system";
  } catch (e) {}
  document.documentElement.dataset.uiFont = [
    "system",
    "segoe",
    "yahei",
    "dengxian",
    "source-han",
  ].includes(uiFont)
    ? uiFont
    : "system";
})();

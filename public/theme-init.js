// Apply the persisted theme before first paint to avoid a flash.
(function () {
  var theme = "system";
  try {
    theme = localStorage.getItem("app:theme") || "system";
  } catch (e) {}
  if (theme === "system") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.dataset.theme = theme;
})();

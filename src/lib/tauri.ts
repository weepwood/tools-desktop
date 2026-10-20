/*
 * Thin wrappers around Tauri APIs that degrade gracefully when the
 * frontend runs in a plain browser (`npm run dev` without Tauri).
 * Keeps every component free of environment checks.
 */

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isMacOS(): boolean {
  return navigator.userAgent.includes("Macintosh");
}

export async function minimizeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // Intercepted on the Rust side: hides to the menu bar instead of quitting.
  await getCurrentWindow().close();
}

/**
 * Tell the Rust side the loading screen has painted so it can reveal the
 * (initially hidden) window. Keeping the window hidden until now avoids
 * the webview's white-flash on startup. The resolved theme lets Rust
 * paint a matching native window background during the show transition.
 */
export async function notifyFrontendReady() {
  if (!isTauri()) return;
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("frontend_ready", { theme });
}

/**
 * Fire a system notification, requesting permission if needed. Uses the
 * Tauri notification plugin in the desktop app and the web Notification
 * API as a fallback in a plain browser. Resolves to whether it was shown.
 */
export async function sendNotification(title: string, body: string): Promise<boolean> {
  if (isTauri()) {
    const { isPermissionGranted, requestPermission, sendNotification: send } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) send({ title, body });
    return granted;
  }

  if (!("Notification" in window)) return false;
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  new Notification(title, { body });
  return true;
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("is_autostart_enabled");
}

/**
 * Enable/disable launch at login. `minimized` registers the login entry to
 * start hidden in the menu bar. On macOS this rides on the login item's
 * hidden flag; on Windows/Linux it's read back from settings at launch.
 */
export async function setAutostartEnabled(enabled: boolean, minimized: boolean) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_autostart", { enabled, minimized });
}

/** Show or hide the menu-bar / system-tray icon at runtime. */
export async function setMenuBarVisible(visible: boolean) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_menu_bar_visible", { visible });
}

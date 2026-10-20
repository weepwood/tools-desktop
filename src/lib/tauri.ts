/** Compatibility surface for the original XIMA components, powered by Electron. */
export const isTauri = () => Boolean(window.xima);
export const isMacOS = () => navigator.userAgent.includes('Macintosh');
const desktop = (cmd: string, args: Record<string, unknown> = {}) => window.xima?.invoke(cmd, args);
export async function minimizeWindow() { await desktop('window_minimize') }
export async function toggleMaximizeWindow() { await desktop('window_toggle_maximize') }
export async function closeWindow() { await desktop('window_close') }
export async function notifyFrontendReady() { await desktop('frontend_ready', { theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }) }
export async function sendNotification(title: string, body: string): Promise<boolean> {
  if (window.xima) return Boolean(await desktop('notify', { title, body }))
  if (!('Notification' in window)) return false
  let status = Notification.permission
  if (status === 'default') status = await Notification.requestPermission()
  if (status !== 'granted') return false
  new Notification(title, { body })
  return true
}
export async function isAutostartEnabled(): Promise<boolean> { return Boolean(await desktop('is_autostart_enabled')) }
export async function setAutostartEnabled(enabled: boolean, minimized: boolean) { await desktop('set_autostart', { enabled, minimized }) }
export async function setMenuBarVisible(visible: boolean) { await desktop('set_menu_bar_visible', { visible }) }

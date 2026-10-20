export interface DialogOptions { title?: string; directory?: boolean; multiple?: boolean; filters?: { name: string; extensions: string[] }[] }
export async function open(options: DialogOptions): Promise<string | string[] | null> {
  if (!window.xima) return null
  return window.xima.invoke('dialog_open', { options })
}
export async function save(options: DialogOptions): Promise<string | null> {
  if (!window.xima) return null
  return window.xima.invoke('dialog_save', { options })
}
export async function confirm(message: string, options?: {title?: string; kind?: string}): Promise<boolean> {
  if (!window.xima) return false
  return window.xima.invoke('dialog_confirm', { message, options })
}

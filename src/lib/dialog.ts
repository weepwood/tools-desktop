export interface DialogOptions { title?: string; defaultPath?: string; directory?: boolean; multiple?: boolean; filters?: { name: string; extensions: string[] }[] }
export async function open(options: DialogOptions): Promise<string | string[] | null> {
  if (!window.halo) return null
  return window.halo.invoke<string | string[] | null>('dialog_open', { options })
}
export async function save(options: DialogOptions): Promise<string | null> {
  if (!window.halo) return null
  return window.halo.invoke<string | null>('dialog_save', { options })
}
export async function confirm(message: string, options?: {title?: string; kind?: string}): Promise<boolean> {
  if (!window.halo) return false
  return window.halo.invoke<boolean>('dialog_confirm', { message, options })
}

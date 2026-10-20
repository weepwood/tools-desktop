/// <reference types="vite/client" />
interface Window {
  halo?: {
    invoke<T>(command: string, args?: Record<string, unknown>, requestId?: string): Promise<T>;
    on<T = any>(name: string, callback: (payload: T) => void): () => void;
  }
}

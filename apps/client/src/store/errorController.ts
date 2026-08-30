import type { StoreState } from "./types.js";

export function createErrorController(set: (state: Partial<StoreState>) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    show(message: string) {
      if (timer) clearTimeout(timer);
      set({ error: message });
      timer = setTimeout(() => set({ error: null }), 4000);
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ error: null });
    },
  };
}

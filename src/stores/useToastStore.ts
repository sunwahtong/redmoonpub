import {create} from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Lifetime in ms. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & {duration?: number}) => string;
  dismiss: (id: string) => void;
}

/**
 * Transient feedback, shown bottom right.
 *
 * Replaces the per-page `useState` notice strings that each page grew its own
 * copy of. Those had two problems: the message appeared somewhere the eye was
 * not (often below the fold after a submit), and every page styled it slightly
 * differently.
 *
 * A store rather than context because non-component code — an API helper, a
 * store action — needs to raise one too, and `useToastStore.getState().push()`
 * works anywhere.
 */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: ({kind, title, message, duration = 4200}) => {
    const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    // Cap the stack: more than three at once is a wall, not a notification.
    set((state) => ({toasts: [...state.toasts, {id, kind, title, message, duration}].slice(-3)}));
    window.setTimeout(() => get().dismiss(id), duration);
    return id;
  },

  dismiss: (id) => set((state) => ({toasts: state.toasts.filter((toast) => toast.id !== id)}))
}));

/** Shorthands, so a caller never has to spell out the object. */
export const toast = {
  success: (title: string, message?: string) => useToastStore.getState().push({kind: 'success', title, message}),
  error: (title: string, message?: string) => useToastStore.getState().push({kind: 'error', title, message}),
  info: (title: string, message?: string) => useToastStore.getState().push({kind: 'info', title, message})
};

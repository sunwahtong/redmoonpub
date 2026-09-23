import {create} from 'zustand';

/**
 * Modal dialogs in the house style, replacing `window.confirm` / `prompt`.
 *
 * A store rather than context because the callers are event handlers that
 * want a promise: `if (!(await dialog.confirm({...}))) return;` reads like the
 * browser API it replaces, and works from anywhere, not only inside a
 * component tree.
 */

export type DialogTone = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Extra content under the message, e.g. a summary block. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  initial?: string;
  type?: 'text' | 'password' | 'number' | 'textarea';
  /** Returns an error message to block submission, or null to accept. */
  validate?: (value: string) => string | null;
  maxLength?: number;
}

export interface AlertOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: DialogTone;
}

type Pending =
  | {kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void}
  | {kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void}
  | {kind: 'alert'; options: AlertOptions; resolve: () => void};

interface DialogState {
  queue: Pending[];
  push: (item: Pending) => void;
  /** Settles the front dialog. */
  settle: (value: unknown) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (item) => set((state) => ({queue: [...state.queue, item]})),
  settle: (value) => {
    const [current, ...rest] = get().queue;
    if (!current) return;
    set({queue: rest});
    (current.resolve as (value: unknown) => void)(value);
  }
}));

export const dialog = {
  confirm: (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => useDialogStore.getState().push({kind: 'confirm', options, resolve})),
  prompt: (options: PromptOptions) =>
    new Promise<string | null>((resolve) => useDialogStore.getState().push({kind: 'prompt', options, resolve})),
  alert: (options: AlertOptions) =>
    new Promise<void>((resolve) => useDialogStore.getState().push({kind: 'alert', options, resolve}))
};

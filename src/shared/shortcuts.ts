// Channel for the Ctrl+R refresh shortcut (main -> renderer, one-way push).
// Kept separate from src/shared/ipc.ts so it can be added without touching that file.
export const APP_REFRESH_SHORTCUT = 'app:refresh-shortcut'

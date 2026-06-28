export const APP_NAME = 'Versed';

// In production (Vercel frontend + Railway backend), set VITE_SERVER_URL to the Railway URL.
// When empty, falls back to same origin (works when backend serves the frontend itself).
export const BACKEND_URL: string = import.meta.env.VITE_SERVER_URL ?? '';

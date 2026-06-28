import { io } from 'socket.io-client';

// VITE_SERVER_URL overrides when the frontend is on a different host than the backend.
// Falls back to window.location.origin (works both in dev via Vite proxy and on Railway).
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? window.location.origin;

export const socket = io(SERVER_URL, { autoConnect: false });

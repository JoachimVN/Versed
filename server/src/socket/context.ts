import { Server } from 'socket.io';

// Set once at startup by index.ts; every socket module reads it via getIo().
let io: Server;
export function setIo(server: Server) { io = server; }
export function getIo(): Server { return io; }

// Countdown shown on the host before a song plays, used to buffer the track.
export const PLAYBACK_COUNTDOWN_MS = 3000;

// Grace periods before treating a disconnect as permanent.
export const HOST_GRACE_MS = 60_000;
export const PLAYER_GRACE_MS = 30_000;

// pin → pending host-disconnect timer
export const hostDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
// socketId → pending player-disconnect timer
export const playerDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

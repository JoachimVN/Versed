import { Server, Socket } from 'socket.io';

export const MAX_NAME_LENGTH = 20;
export const MAX_GUESS_LENGTH = 100;
// Playlist-backed games can legitimately carry a large start_game settings
// payload. This is still a finite ceiling, unlike trusting arbitrary packet
// size, while keeping the existing 5,000-track product cap usable.
export const MAX_SOCKET_MESSAGE_BYTES = 2 * 1024 * 1024;

const PIN_PATTERN = /^\d{3}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

export type SocketAck<T> = ((response: T) => void) | undefined;

export function respond<T>(ack: unknown, response: T): void {
  if (typeof ack === 'function') (ack as (value: T) => void)(response);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePin(value: unknown): string | null {
  return typeof value === 'string' && PIN_PATTERN.test(value) ? value : null;
}

export function parseSessionToken(value: unknown): string | null {
  return typeof value === 'string' && SESSION_TOKEN_PATTERN.test(value) ? value : null;
}

export function parsePlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH || CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function parseGuessText(value: unknown, optional = false): string | undefined | null {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.length > MAX_GUESS_LENGTH || CONTROL_CHAR_PATTERN.test(value)) return null;
  return value;
}

export function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

type RateRule = { limit: number; windowMs: number };
type RateCounter = { count: number; startedAt: number };

const IDENTITY_EVENTS = new Set(['check_game', 'join_game', 'rejoin_player', 'rejoin_host', 'create_game']);
const identityAttemptsByIp = new Map<string, RateCounter>();
// A full 50-player room may legitimately join or reconnect from one shared
// party Wi-Fi address. Leave room for that burst while still bounding PIN
// probes and reconnect churn from a single origin.
const IDENTITY_IP_RULE: RateRule = { limit: 150, windowMs: 60_000 };
const MAX_CONNECTIONS_PER_IP = 75;
const CONNECTION_ATTEMPT_RULE: RateRule = { limit: 200, windowMs: 60_000 };
const activeConnectionsByIp = new Map<string, Set<string>>();
const connectionAttemptsByIp = new Map<string, RateCounter>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, counter] of identityAttemptsByIp) {
    if (now - counter.startedAt >= IDENTITY_IP_RULE.windowMs) identityAttemptsByIp.delete(ip);
  }
  for (const [ip, counter] of connectionAttemptsByIp) {
    if (now - counter.startedAt >= CONNECTION_ATTEMPT_RULE.windowMs) connectionAttemptsByIp.delete(ip);
  }
}, IDENTITY_IP_RULE.windowMs).unref();

export function installConnectionLimits(io: Server): void {
  io.use((socket, next) => {
    const ip = socket.handshake.address;
    const now = Date.now();
    const current = connectionAttemptsByIp.get(ip);
    const attempts = !current || now - current.startedAt >= CONNECTION_ATTEMPT_RULE.windowMs
      ? { count: 0, startedAt: now }
      : current;
    attempts.count += 1;
    connectionAttemptsByIp.set(ip, attempts);

    const active = activeConnectionsByIp.get(ip) ?? new Set<string>();
    if (attempts.count > CONNECTION_ATTEMPT_RULE.limit || active.size >= MAX_CONNECTIONS_PER_IP) {
      console.warn(`[socket-security] connection limit ip=${ip}`);
      next(new Error('Too many connections'));
      return;
    }

    active.add(socket.id);
    activeConnectionsByIp.set(ip, active);
    socket.once('disconnect', () => {
      active.delete(socket.id);
      if (active.size === 0) activeConnectionsByIp.delete(ip);
    });
    next();
  });
}

export function logSecurityViolation(socket: Socket, event: string): void {
  console.warn(`[socket-security] rejected socket=${socket.id} event=${event}`);
}

function ruleFor(event: string): RateRule {
  if (IDENTITY_EVENTS.has(event)) return { limit: 20, windowMs: 60_000 };
  if (event === 'update_guess_draft') return { limit: 120, windowMs: 10_000 };
  return { limit: 60, windowMs: 10_000 };
}

// Socket.IO traffic does not pass through Express's HTTP rate limiter. This
// packet middleware gives each connection a small fixed-window budget before
// any game handler sees the event. Game rules still perform their own phase
// and identity authorization after this coarse abuse-control layer.
export function installSocketRateLimit(socket: Socket): void {
  const counters = new Map<string, RateCounter>();
  socket.use(([event], next) => {
    const eventName = typeof event === 'string' ? event : 'unknown';
    if (IDENTITY_EVENTS.has(eventName)) {
      const ip = socket.handshake.address;
      const now = Date.now();
      const current = identityAttemptsByIp.get(ip);
      const counter = !current || now - current.startedAt >= IDENTITY_IP_RULE.windowMs
        ? { count: 0, startedAt: now }
        : current;
      counter.count += 1;
      identityAttemptsByIp.set(ip, counter);
      if (counter.count > IDENTITY_IP_RULE.limit) {
        console.warn(`[socket-security] identity rate limit ip=${ip} event=${eventName}`);
        next(new Error('Rate limit exceeded'));
        return;
      }
    }
    const rule = ruleFor(eventName);
    const now = Date.now();
    const current = counters.get(eventName);
    const counter = !current || now - current.startedAt >= rule.windowMs
      ? { count: 0, startedAt: now }
      : current;
    counter.count += 1;
    counters.set(eventName, counter);
    if (counter.count > rule.limit) {
      console.warn(`[socket-security] rate limit socket=${socket.id} event=${eventName}`);
      next(new Error('Rate limit exceeded'));
      return;
    }
    next();
  });
  socket.on('disconnect', () => counters.clear());
}

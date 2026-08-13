import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import * as gm from '../gameManager';
import { setIo } from './context';
import { registerHostHandlers } from './hostHandlers';
import { registerPlayerHandlers } from './playerHandlers';
import { installSocketRateLimit, MAX_NAME_LENGTH, parsePlayerName } from './security';

type GameCreated = { pin?: string; hostToken?: string; error?: string };
type PlayerJoined = { success?: boolean; playerToken?: string; error?: string };

function emitAck<T>(socket: ClientSocket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const callback = (response: T) => resolve(response);
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1500);
    const done = (response: T) => { clearTimeout(timer); callback(response); };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

describe('socket security boundaries', () => {
  let httpServer: HttpServer;
  let ioServer: Server;
  let baseUrl: string;
  const clients: ClientSocket[] = [];
  const pins: string[] = [];

  beforeAll(async () => {
    gm.initSongs();
    httpServer = createServer();
    ioServer = new Server(httpServer);
    setIo(ioServer);
    ioServer.on('connection', socket => {
      installSocketRateLimit(socket);
      registerHostHandlers(socket);
      registerPlayerHandlers(socket);
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    clients.forEach(client => client.disconnect());
    pins.forEach(pin => gm.cleanupGame(pin));
    await new Promise<void>(resolve => ioServer.close(() => resolve()));
  });

  async function connect(): Promise<ClientSocket> {
    const client = createClient(baseUrl, { forceNew: true, transports: ['websocket'] });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }

  async function createGame(host: ClientSocket): Promise<Required<Pick<GameCreated, 'pin' | 'hostToken'>>> {
    const created = await emitAck<GameCreated>(host, 'create_game');
    expect(created.error).toBeUndefined();
    expect(created.pin).toMatch(/^\d{3}$/);
    expect(created.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    pins.push(created.pin!);
    return { pin: created.pin!, hostToken: created.hostToken! };
  }

  it('does not crash when an acknowledgement callback is omitted', async () => {
    const client = await connect();
    client.emit('create_game');
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(client.connected).toBe(true);
    await createGame(client);
  });

  it('requires the host session token before moving host authority', async () => {
    const originalHost = await connect();
    const attacker = await connect();
    const { pin, hostToken } = await createGame(originalHost);

    const rejected = await emitAck<{ error?: string }>(attacker, 'rejoin_host', {
      pin, hostToken: 'a'.repeat(43), fresh: false,
    });
    expect(rejected.error).toBeTruthy();
    expect(gm.getGame(pin)?.hostSocketId).toBe(originalHost.id);

    const accepted = await emitAck<{ error?: string }>(attacker, 'rejoin_host', {
      pin, hostToken, fresh: false,
    });
    expect(accepted.error).toBeUndefined();
    expect(gm.getGame(pin)?.hostSocketId).toBe(attacker.id);
  });

  it('does not treat a display name as player authentication', async () => {
    const host = await connect();
    const player = await connect();
    const attacker = await connect();
    const { pin } = await createGame(host);

    const joined = await emitAck<PlayerJoined>(player, 'join_game', { pin, name: 'Anna' });
    expect(joined.playerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rejected = await emitAck<PlayerJoined>(attacker, 'join_game', { pin, name: 'Anna' });
    expect(rejected.error).toBe('Name already taken');
    expect(gm.getGame(pin)?.players.has(player.id!)).toBe(true);

    const reclaimed = await emitAck<PlayerJoined>(attacker, 'join_game', {
      pin, name: 'Anna', playerToken: joined.playerToken,
    });
    expect(reclaimed.success).toBe(true);
    expect(gm.getGame(pin)?.players.has(attacker.id!)).toBe(true);
  });

  it('enforces the UI name limit on untrusted socket input', async () => {
    expect(parsePlayerName('A'.repeat(MAX_NAME_LENGTH))).toHaveLength(MAX_NAME_LENGTH);
    expect(parsePlayerName('A'.repeat(MAX_NAME_LENGTH + 1))).toBeNull();
    expect(parsePlayerName('Normal\u0000Name')).toBeNull();

    const host = await connect();
    const player = await connect();
    const { pin } = await createGame(host);
    const rejected = await emitAck<PlayerJoined>(player, 'join_game', {
      pin,
      name: 'A'.repeat(MAX_NAME_LENGTH + 1),
    });
    expect(rejected.error).toBe(`Name must be ${MAX_NAME_LENGTH} characters or fewer`);
  });

  it('accepts only a strict four-digit year answer', () => {
    expect(gm.parseYearGuess('1994')).toBe(1994);
    expect(gm.parseYearGuess(' 1994 ')).toBe(1994);
    expect(gm.parseYearGuess('19945')).toBeNull();
    expect(gm.parseYearGuess('19-94')).toBeNull();
  });

  it('rejects a late guess using the server monotonic deadline', () => {
    const game = gm.createGame('deadline-host');
    pins.push(game.pin);
    const player = gm.addPlayer(game, 'deadline-player', 'Timer Test')!;
    game.mode = 'race';
    const round = gm.startRound(game);
    gm.markRaceStarted(game);
    game.phaseEndsAt = Date.now() + 60_000;
    round.guessingEndsMono = performance.now() - 1_000;

    expect(gm.recordRaceGuess(game, player.socketId, round.song.title)).toBeNull();
  });
});

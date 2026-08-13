import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import authRouter from './spotifyAuth';

describe('Spotify OAuth state protection', () => {
  let server: Server;
  let baseUrl: string;
  const previousFrontendUrl = process.env.FRONTEND_URL;

  beforeAll(async () => {
    process.env.FRONTEND_URL = 'https://example.test';
    const app = express();
    app.use('/api/auth', authRouter);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });

  it('binds the authorization redirect to an HttpOnly state cookie', async () => {
    const response = await fetch(`${baseUrl}/api/auth/spotify`, { redirect: 'manual' });
    const location = response.headers.get('location');
    const cookie = response.headers.get('set-cookie');
    expect(response.status).toBe(302);
    expect(cookie).toContain('versed_oauth_state=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const state = new URL(location!).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain(`versed_oauth_state=${state}`);
  });

  it('rejects a callback whose state is absent or does not match', async () => {
    const response = await fetch(`${baseUrl}/api/auth/callback?code=synthetic`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.test/host?error=auth_failed');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

import { Router } from 'express';
import axios from 'axios';

const router = Router();

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ');

router.get('/spotify', (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES,
  });
  res.redirect(`${SPOTIFY_AUTH_URL}?${params}`);
});

router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const { data } = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const frontendBase = process.env.FRONTEND_URL ?? '';
    res.redirect(
      `${frontendBase}/host?access_token=${data.access_token}&refresh_token=${data.refresh_token}`
    );
  } catch {
    res.redirect('/?error=auth_failed');
  }
});

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const { data } = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    res.json({ access_token: data.access_token });
  } catch {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

export default router;

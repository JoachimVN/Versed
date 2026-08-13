import { Router, Request, Response } from 'express';
import axios from 'axios';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const router = Router();
const OAUTH_STATE_COOKIE = 'versed_oauth_state';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

function stateMatches(expected: string | undefined, received: unknown): boolean {
  if (!expected || typeof received !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

function cookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

function stateCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

router.get('/spotify', (_req, res) => {
  const state = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES,
    state,
  });
  res.setHeader('Set-Cookie', stateCookie(state, OAUTH_STATE_MAX_AGE_SECONDS));
  res.redirect(`${SPOTIFY_AUTH_URL}?${params}`);
});

router.get('/callback', async (req, res) => {
  const frontendBase = process.env.FRONTEND_URL ?? '';
  const expectedState = cookieValue(req, OAUTH_STATE_COOKIE);
  res.setHeader('Set-Cookie', stateCookie('', 0));
  if (!stateMatches(expectedState, req.query.state)) {
    return res.redirect(`${frontendBase}/host?error=auth_failed`);
  }
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  if (error) return res.redirect(`${frontendBase}/host?error=${encodeURIComponent(error)}`);
  const code = typeof req.query.code === 'string' && req.query.code.length <= 2048 ? req.query.code : undefined;
  if (!code) return res.redirect(`${frontendBase}/host?error=cancelled`);

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

    // Tokens go in the URL fragment, not the query string: fragments never
    // leave the browser, so they can't end up in server/proxy logs, and the
    // client strips them from history immediately after reading them.
    res.redirect(
      `${frontendBase}/host#access_token=${data.access_token}&refresh_token=${data.refresh_token}`
    );
  } catch {
    res.redirect(`${frontendBase}/host?error=auth_failed`);
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

// Spotify playlist IDs are base62 — re-validated here (not just trusted from
// the client) immediately before being used to build a request URL.
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{1,50}$/;

// Only the item shape the importer actually needs — kept server-side (rather
// than accepting a client-supplied `fields` string) so nothing from the
// request body ever becomes part of the query beyond a validated id/offset.
const PLAYLIST_ITEMS_FIELDS =
  'total,items(item(type,id,name,duration_ms,is_local,artists(name),album(images,release_date)))';

function parseOffset(offset: unknown): number {
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

// Every branch below builds its URL from a fixed literal template with only
// a regex-validated playlist id or an integer offset spliced in — the client
// never supplies a URL, host, or path shape, only these two primitives.
router.post('/fetch-playlist', async (req: Request, res: Response) => {
  const { access_token, kind, playlist_id, offset } = req.body as {
    access_token?: string;
    kind?: 'me_playlists' | 'playlist_meta' | 'playlist_items';
    playlist_id?: string;
    offset?: number;
  };
  if (!access_token || !kind) return res.status(400).json({ error: 'Missing access_token or kind' });

  if (kind !== 'me_playlists' && (!playlist_id || !PLAYLIST_ID_PATTERN.test(playlist_id))) {
    return res.status(400).json({ error: 'Invalid playlist_id' });
  }

  let url: string;
  switch (kind) {
    case 'me_playlists':
      url = `https://api.spotify.com/v1/me/playlists?limit=50&offset=${parseOffset(offset)}`;
      break;
    case 'playlist_meta':
      url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlist_id!)}?fields=name`;
      break;
    case 'playlist_items':
      url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlist_id!)}/items?limit=100&offset=${parseOffset(offset)}`
        + `&fields=${encodeURIComponent(PLAYLIST_ITEMS_FIELDS)}`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid kind' });
  }

  try {
    const result = await axios.get(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 12000,
    });
    res.json(result.data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      // Proxy the Spotify API response status and data
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(500).json({ error: 'Failed to fetch playlist' });
    }
  }
});

// Used by the playlist picker to probe real per-playlist access (Spotify's
// `collaborative` flag on /me/playlists only reports true to the owner, so
// metadata alone can't tell a collaborator apart from someone who merely
// follows a public playlist). Always replies 200 — the forbidden/importable
// result lives in the body instead of the HTTP status, so a normal "you
// can't import this" outcome doesn't show up as a failed request in the
// browser's network console.
router.post('/check-playlist-access', async (req: Request, res: Response) => {
  const { access_token, playlist_id } = req.body as { access_token?: string; playlist_id?: string };
  if (!access_token || !playlist_id || !PLAYLIST_ID_PATTERN.test(playlist_id)) {
    return res.status(400).json({ error: 'Missing or invalid access_token or playlist_id' });
  }

  try {
    await axios.get(`https://api.spotify.com/v1/playlists/${playlist_id}/items?limit=1&fields=next`, {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 12000,
    });
    res.json({ importable: true });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      res.json({ importable: false });
    } else {
      // Anything else (network blip, rate limit, expired token) fails open —
      // a flaky probe shouldn't grey out a playlist that might be fine. The
      // real fetch when the user actually picks it will surface a genuine
      // problem properly.
      res.json({ importable: true });
    }
  }
});

export default router;

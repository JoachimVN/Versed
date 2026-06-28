import axios from 'axios';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let clientToken: string | null = null;
let tokenExpiry = 0;
const artCache = new Map<string, string | null>();

async function getClientToken(): Promise<string | null> {
  if (clientToken && Date.now() < tokenExpiry) return clientToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const { data } = await axios.post(
      SPOTIFY_TOKEN_URL,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    clientToken = data.access_token as string;
    tokenExpiry = Date.now() + (data.expires_in as number - 60) * 1000;
    return clientToken;
  } catch {
    return null;
  }
}

export async function getAlbumArtUrl(trackId: string): Promise<string | null> {
  if (artCache.has(trackId)) return artCache.get(trackId) ?? null;

  const token = await getClientToken();
  if (!token) return null;

  try {
    const { data } = await axios.get(`${SPOTIFY_API_BASE}/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Prefer the 300×300 medium image (index 1); fall back to largest.
    const images: { url: string }[] = data.album?.images ?? [];
    const url = (images[1] ?? images[0])?.url ?? null;
    artCache.set(trackId, url);
    return url;
  } catch {
    artCache.set(trackId, null);
    return null;
  }
}

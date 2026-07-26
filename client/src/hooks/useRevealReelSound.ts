import { useCallback } from 'react';

// Shared timing for every "hidden number" slot-reel reveal (year, mystery
// multiplier): 2 beats at 112bpm, so the reel's flicker-then-land beat feels
// like it's on the same clock as the rest of the game's music/SFX rather than
// an arbitrary UI duration.
const BEAT_MS = (60 / 112) * 1000;
export const REEL_BEATS = 2;
// Precise (fractional) duration — used to schedule the audio pair below,
// where sample-accurate timing matters. The visual reel's own step array
// (REEL_STEPS_MS) sums to the nearest whole ms and is exported separately,
// since setTimeout steps have to be integers anyway.
export const REEL_SEC = (BEAT_MS * REEL_BEATS) / 1000;

// Step durations for the reel flicker, front-loaded fast then slowing down
// like a wheel losing momentum — the deceleration is what sells "landing"
// rather than "the label just changed". Shared by the year and mystery
// multiplier reels since both now run the same total duration (REEL_SEC).
export const REEL_STEPS_MS = [75, 90, 112, 135, 172, 217, 270];

// Total time (ms) from the reel starting until it lands — downstream reveal
// timing (score count-up delays, timeline build-in, etc.) syncs against this.
export const REEL_LAND_MS = REEL_STEPS_MS.reduce((a, b) => a + b, 0);

// A single AudioContext + pair of decoded buffers shared by every reel in the
// app, rather than one per component instance: YearHeading and
// MysteryMultiplierChip remount fresh on every single round (their parent
// RevealView unmounts whenever the game phase changes away from 'reveal' and
// back — see Host.tsx/Play.tsx's phase switch), so a per-mount fetch+decode
// would race the reel's own start on every round and never win — the fetch
// takes longer than the reel takes to land. Fetching/decoding once at module
// load (i.e. as soon as the /host or /play chunk loads, well before the
// first round even starts) means the buffers are already sitting in memory
// by the time any reel actually calls play().
let ctx: AudioContext | null = null;
function getContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

type Buffers = { rise: AudioBuffer; hit: AudioBuffer; hit2: AudioBuffer; hit3: AudioBuffer };

let buffersPromise: Promise<Buffers> | null = null;
function loadBuffers(): Promise<Buffers> {
  buffersPromise ??= (async () => {
    const audioCtx = getContext();
    const base = import.meta.env.BASE_URL;
    const [riseRes, hitRes, hit2Res, hit3Res] = await Promise.all([
      fetch(`${base}sfx/reveal_rise.wav`),
      fetch(`${base}sfx/reveal_hit.wav`),
      fetch(`${base}sfx/reveal_hit2.wav`),
      fetch(`${base}sfx/reveal_hit3.wav`),
    ]);
    const [riseData, hitData, hit2Data, hit3Data] = await Promise.all([
      riseRes.arrayBuffer(), hitRes.arrayBuffer(), hit2Res.arrayBuffer(), hit3Res.arrayBuffer(),
    ]);
    const [rise, hit, hit2, hit3] = await Promise.all([
      audioCtx.decodeAudioData(riseData),
      audioCtx.decodeAudioData(hitData),
      audioCtx.decodeAudioData(hit2Data),
      audioCtx.decodeAudioData(hit3Data),
    ]);
    return { rise, hit, hit2, hit3 };
  })();
  return buffersPromise;
}
loadBuffers().catch(() => { /* fetch/decode failed; play() just stays a no-op */ });

// A fresh AudioContext starts suspended until a user gesture. Attached once
// at module scope rather than per-component-mount, since by the time the
// first reel ever mounts (well into a game — after joining, betting, etc.)
// there have already been plenty of gestures to resume on.
const resume = () => { ctx?.resume().catch(() => {}); };
document.addEventListener('pointerdown', resume);
document.addEventListener('keydown', resume);

// Landed-value tier for the hit sound: mystery multiplier jackpots (×5, ×10)
// get a beefier hit than the routine ×1.5-×4 rolls or the year reveal, so the
// rarer the roll, the more the sting sells it.
export type RevealHitTier = 1 | 2 | 3;

// Plays the reveal_rise/reveal_hit pair for a slot-reel landing, scheduled on
// the shared AudioContext clock so reveal_hit always lands exactly REEL_SEC
// after reveal_rise starts — independent of the setTimeout jitter driving the
// visual reel steps above, which only need to land close enough for the eye,
// not the ear. Call play() at the same moment the visual reel starts spinning;
// pass the jackpot tier (2 for ×5, 3 for ×10) to swap in the bigger hit sfx.
export function useRevealReelSound() {
  return useCallback((tier: RevealHitTier = 1) => {
    loadBuffers().then((buffers) => {
      const hit = tier === 3 ? buffers.hit3 : tier === 2 ? buffers.hit2 : buffers.hit;
      const audioCtx = getContext();
      const start = audioCtx.currentTime;
      const riseSource = audioCtx.createBufferSource();
      riseSource.buffer = buffers.rise;
      riseSource.connect(audioCtx.destination);
      riseSource.start(start);
      const hitSource = audioCtx.createBufferSource();
      hitSource.buffer = hit;
      hitSource.connect(audioCtx.destination);
      hitSource.start(start + REEL_SEC);
    }).catch(() => { /* buffers never loaded; play() just stays silent */ });
  }, []);
}

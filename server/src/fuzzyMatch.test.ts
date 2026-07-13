import { describe, it, expect } from 'vitest';
import { isCorrectGuess, isCorrectArtistGuess, textsCollide } from './fuzzyMatch';

// Characterization suite for guess matching. Every block locks in behavior
// that was previously fixed after a live playtest — if a change here starts
// failing, it's probably reintroducing an old bug, not finding a new one.

describe('isCorrectGuess — plain titles', () => {
  it('accepts an exact match', () => {
    expect(isCorrectGuess('Shake It Off', 'Shake It Off')).toBe(true);
  });

  it('ignores case and punctuation', () => {
    expect(isCorrectGuess("shake it off!!", 'Shake It Off')).toBe(true);
    expect(isCorrectGuess("dont stop believin", "Don't Stop Believin'")).toBe(true);
  });

  it('ignores leading articles', () => {
    expect(isCorrectGuess('A Team', 'The A Team')).toBe(true);
  });

  it('treats & and "and" as the same', () => {
    expect(isCorrectGuess('Me and Your Mama', 'Me & Your Mama')).toBe(true);
  });

  it('tolerates small typos in long titles', () => {
    expect(isCorrectGuess('I Wanna Dance With Sombody', 'I Wanna Dance With Somebody')).toBe(true);
  });

  it('rejects a different song', () => {
    expect(isCorrectGuess('Bad Blood', 'Shake It Off')).toBe(false);
  });

  it('stays strict on short titles (no 2-edit collisions)', () => {
    expect(isCorrectGuess('rose', 'love')).toBe(false);
  });

  it('rejects an empty or whitespace guess', () => {
    expect(isCorrectGuess('', 'Shake It Off')).toBe(false);
    expect(isCorrectGuess('   ', 'Shake It Off')).toBe(false);
  });
});

describe('isCorrectGuess — homophones and spacing', () => {
  it('accepts number/word homophones both ways', () => {
    expect(isCorrectGuess('4 you', 'For You')).toBe(true);
    expect(isCorrectGuess('for you', '4 You')).toBe(true);
    expect(isCorrectGuess('two of us', '2 of Us')).toBe(true);
  });

  it('survives a missing space that would explode homophone edit distance', () => {
    // "close tonyou" vs "Close To You": raw spelling comparison catches this
    // even though the homophone-collapsed forms ("close 2 u") drift apart.
    expect(isCorrectGuess('close tonyou', 'Close To You')).toBe(true);
  });
});

describe('isCorrectGuess — parentheticals and subtitles', () => {
  const title = 'I Wanna Dance With Somebody (Who Loves Me)';

  it('accepts the pre-parenthetical title', () => {
    expect(isCorrectGuess('I Wanna Dance With Somebody', title)).toBe(true);
  });

  it('accepts a true subtitle from inside the parenthetical', () => {
    expect(isCorrectGuess('Who Loves Me', title)).toBe(true);
  });

  it('does NOT accept metadata parentheticals as an answer', () => {
    expect(isCorrectGuess('Doja Cat', '34+35 Remix (feat. Doja Cat, Megan Thee Stallion)')).toBe(false);
    expect(isCorrectGuess('remastered', 'Landslide (Remastered)')).toBe(false);
  });

  it('strips a metadata word sitting before the parenthetical', () => {
    // The "Remix" lives outside the parens on Spotify's listing.
    expect(isCorrectGuess('34+35', '34+35 Remix (feat. Doja Cat, Megan Thee Stallion)')).toBe(true);
  });
});

describe('isCorrectGuess — dash and plus attribution', () => {
  it('strips dash-attributed soundtrack metadata', () => {
    expect(isCorrectGuess('Wondering', 'Wondering - From "High School Musical: The Musical: The Series"')).toBe(true);
  });

  it('strips a year-prefixed remaster tag', () => {
    expect(isCorrectGuess('Say You Will', 'Say You Will - 2008 Remaster')).toBe(true);
    expect(isCorrectGuess('Landslide', 'Landslide - 1997 Digital Remaster')).toBe(true);
  });

  it('strips other dash-attributed mix/version tags', () => {
    expect(isCorrectGuess('Are You Gonna Go My Way', 'Are You Gonna Go My Way - Mono')).toBe(true);
    expect(isCorrectGuess('Come Together', 'Come Together - Stereo Mix')).toBe(true);
    expect(isCorrectGuess('Somebody Told Me', 'Somebody Told Me - Single Version')).toBe(true);
    expect(isCorrectGuess('Chasing', 'Chasing - Demo')).toBe(true);
    expect(isCorrectGuess('Some Song', 'Some Song - Clean Edit')).toBe(true);
    expect(isCorrectGuess('Deluxe Track', 'Deluxe Track - Deluxe Edition')).toBe(true);
  });

  it('does NOT treat mono/stereo/single/clean as metadata mid-title', () => {
    expect(isCorrectGuess('Stereo Love', 'Stereo Love')).toBe(true);
    expect(isCorrectGuess('Life In Mono', 'Life In Mono')).toBe(true);
    expect(isCorrectGuess('Single Ladies', 'Single Ladies (Put A Ring On It)')).toBe(true);
    expect(isCorrectGuess('Clean Up Woman', 'Clean Up Woman')).toBe(true);
  });

  it('strips a "+ Artist" feature suffix when it names the featured artist', () => {
    expect(isCorrectGuess('Stateside', 'Stateside + Zara Larsson', 'PinkPantheress', 'Zara Larsson')).toBe(true);
  });

  it('keeps real "+" titles intact', () => {
    // "Sound" is not the artist, so "Safe" alone must not match "Safe + Sound".
    expect(isCorrectGuess('Safe', 'Safe + Sound', 'Capital Cities')).toBe(false);
    expect(isCorrectGuess('Safe + Sound', 'Safe + Sound', 'Capital Cities')).toBe(true);
  });
});

describe('isCorrectArtistGuess', () => {
  it('matches the main artist, fuzzily', () => {
    expect(isCorrectArtistGuess('taylor swift', 'Taylor Swift')).toBe(true);
    expect(isCorrectArtistGuess('tayler swift', 'Taylor Swift')).toBe(true);
  });

  it('matches any featured artist from the comma list', () => {
    expect(isCorrectArtistGuess('Doja Cat', 'Ariana Grande', 'Doja Cat, Megan Thee Stallion')).toBe(true);
    expect(isCorrectArtistGuess('Megan Thee Stallion', 'Ariana Grande', 'Doja Cat, Megan Thee Stallion')).toBe(true);
  });

  it('rejects an unrelated artist', () => {
    expect(isCorrectArtistGuess('Katy Perry', 'Taylor Swift')).toBe(false);
  });

  it('tolerates an adjacent-letter swap on a short name', () => {
    expect(isCorrectArtistGuess('the wekend', 'The Weeknd')).toBe(true);
  });
});

describe('textsCollide (multiple-choice distractor safety)', () => {
  it('collides when one option reads as the other', () => {
    expect(textsCollide('The A Team', 'A Team')).toBe(true);
    expect(textsCollide('Shake It Off', 'shake it off')).toBe(true);
  });

  it('does not collide distinct short options', () => {
    expect(textsCollide('Love', 'Rose')).toBe(false);
  });
});

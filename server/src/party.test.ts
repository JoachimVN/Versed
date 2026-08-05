import { describe, expect, it } from 'vitest';
import { buildPartyConfig } from './party';
import { createGame } from './gameManager';

describe('buildPartyConfig', () => {
  it('honours Double Duty when it is the only selected round type', () => {
    const game = createGame('host-double-duty-only');
    game.mode = 'party';
    game.enabledRoundTypes = new Set(['both']);

    // The opening warm-up and later rounds must both retain the only selected
    // target variant, even though Classic is the format fallback.
    expect(buildPartyConfig(game)).toMatchObject({
      format: 'classic', target: 'both', intro: { title: 'Warm-Up · Double Duty' },
    });
    game.roundIndex = 1;
    expect(buildPartyConfig(game)).toMatchObject({ format: 'classic', target: 'both' });
  });
});

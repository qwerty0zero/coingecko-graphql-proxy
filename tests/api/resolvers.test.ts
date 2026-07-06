import { resolvers } from '../../src/api/resolvers.js';

describe('Resolvers', () => {
  it('should export Query.historicalPrices', () => {
    expect(typeof resolvers.Query.historicalPrices).toBe('function');
  });
});

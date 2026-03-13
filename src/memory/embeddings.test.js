import { describe, it, expect } from 'vitest';
import { embed, cosineSimilarity, EMBEDDING_DIM } from './embeddings.js';

describe('embeddings', () => {
      describe('cosineSimilarity', () => {
            it('returns 1 for identical vectors', () => {
                  const v = [1, 0, 0, 1];
                  expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
            });

            it('returns 0 for orthogonal vectors', () => {
                  const a = [1, 0];
                  const b = [0, 1];
                  expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
            });

            it('returns -1 for opposite vectors', () => {
                  const a = [1, 0];
                  const b = [-1, 0];
                  expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
            });

            it('throws when dimensions mismatch', () => {
                  expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
            });

            it('returns 0 for zero vectors', () => {
                  expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
            });
      });

      describe('embed', () => {
            it('returns an array of ' + EMBEDDING_DIM + ' numbers', async () => {
                  const result = await embed('hello world');
                  expect(Array.isArray(result)).toBe(true);
                  expect(result).toHaveLength(EMBEDDING_DIM);
                  result.forEach((v) => expect(typeof v).toBe('number'));
            }, 30000);

            it('returns normalized vector (magnitude ≈ 1)', async () => {
                  const result = await embed('test normalization');
                  const magnitude = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
                  expect(magnitude).toBeCloseTo(1, 2);
            }, 30000);

            it('similar sentences have higher similarity than dissimilar ones', async () => {
                  const [a, b, c] = await Promise.all([
                        embed('The cat sat on the mat'),
                        embed('A cat is sitting on a rug'),
                        embed('Quantum physics equations'),
                  ]);
                  const simAB = cosineSimilarity(a, b);
                  const simAC = cosineSimilarity(a, c);
                  expect(simAB).toBeGreaterThan(simAC);
            }, 60000);

            it('embedding completes in < 500ms after model is loaded', async () => {
                  // Warm up the model first (may take longer on first call)
                  await embed('warm up');
                  // Actual performance test
                  const start = Date.now();
                  await embed('performance test sentence');
                  const elapsed = Date.now() - start;
                  expect(elapsed).toBeLessThan(500);
            }, 60000);
      });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubtitleScheduler, selectViewportSubtitles } from '../src/lib/subtitleScheduler.ts';

const flush = () => new Promise(setImmediate);
const bundleIds = Array.from({ length: 14 }, (_, index) => `app.${index}`);

function createHarness(context, resolved = new Set()) {
  const requests = [];
  const results = [];
  const errors = [];
  const scheduler = new SubtitleScheduler({
    request: (batch, country) => new Promise((resolve, reject) => {
      requests.push({ batch, country, resolve, reject });
    }),
    isResolved: (bundleId, country) => resolved.has(`${country}:${bundleId}`),
    onResult: (subtitles, country, batch) => {
      batch.forEach((bundleId) => resolved.add(`${country}:${bundleId}`));
      results.push({ subtitles, country, batch });
    },
    onError: (error) => errors.push(error),
  });
  context.after(() => {
    scheduler.dispose();
    requests.forEach((request) => request.resolve({}));
  });
  return { scheduler, requests, results, errors };
}

test('starts four batches concurrently and refills the first available slot', async (context) => {
  const { scheduler, requests, results } = createHarness(context);
  scheduler.replace(bundleIds, [], 'us');
  await flush();
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.flatMap((request) => request.batch), bundleIds.slice(0, 8));
  requests[2].resolve({ 'app.4': 'Ready first' });
  await flush();
  assert.equal(results.length, 1);
  assert.equal(results[0].subtitles['app.4'], 'Ready first');
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[4].batch, bundleIds.slice(8, 10));
});

test('replaces old queued work with the current viewport before prefetching', async (context) => {
  const { scheduler, requests } = createHarness(context);
  scheduler.replace(bundleIds.slice(0, 4), bundleIds.slice(4), 'us');
  await flush();
  scheduler.replace(['visible.new.1', 'visible.new.2'], ['nearby.new'], 'us');
  requests[0].resolve({});
  await flush();
  assert.deepEqual(requests[4].batch, ['visible.new.1', 'visible.new.2']);
  requests[1].resolve({});
  await flush();
  assert.deepEqual(requests[5].batch, ['nearby.new']);
  assert.ok(!requests.some((request) => request.batch.includes('app.8')));
});

test('deduplicates queued, active and resolved apps within each region', async (context) => {
  const { scheduler, requests } = createHarness(context, new Set(['us:cached']));
  scheduler.prioritize(['cached', 'same', 'same'], 'US');
  scheduler.prioritize(['same'], 'us');
  scheduler.prioritize(['same'], 'gb');
  await flush();
  assert.deepEqual(requests.map(({ batch, country }) => ({ batch, country })), [
    { batch: ['same'], country: 'us' },
    { batch: ['same'], country: 'gb' },
  ]);
});

test('a failed batch frees its slot without dropping other pending apps', async (context) => {
  const { scheduler, requests, errors } = createHarness(context);
  scheduler.replace(bundleIds, [], 'us');
  await flush();
  requests[0].reject(new Error('Temporary network failure'));
  await flush();
  assert.equal(errors.length, 1);
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[4].batch, bundleIds.slice(8, 10));
});

test('disposal drops queued work and ignores late responses', async (context) => {
  const { scheduler, requests, results } = createHarness(context);
  scheduler.replace(bundleIds, [], 'us');
  await flush();
  scheduler.dispose();
  requests[0].resolve({ 'app.0': 'Late result' });
  await flush();
  assert.equal(results.length, 0);
  assert.equal(requests.length, 4);
});

test('uses actual card bounds and ranks visible apps before nearby apps', () => {
  const selected = selectViewportSubtitles([
    { bundleId: 'above', top: 20, bottom: 75 },
    { bundleId: 'visible.left', top: 110, bottom: 180 },
    { bundleId: 'visible.right', top: 110, bottom: 220 },
    { bundleId: 'hidden', top: 0, bottom: 0 },
    { bundleId: 'below', top: 330, bottom: 440 },
    { bundleId: 'far', top: 700, bottom: 800 },
  ], { top: 100, bottom: 300 });
  assert.deepEqual(selected, {
    visible: ['visible.left', 'visible.right'],
    prefetch: ['above', 'below'],
  });
  assert.deepEqual(selectViewportSubtitles([], { top: 100, bottom: 100 }), {
    visible: [], prefetch: [],
  });
});
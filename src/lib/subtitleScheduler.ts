interface SubtitleSchedulerOptions {
  request: (bundleIds: string[], country: string) => Promise<Record<string, string>>;
  onResult: (subtitles: Record<string, string>, country: string, bundleIds: string[]) => void;
  isResolved: (bundleId: string, country: string) => boolean;
  onError: (error: unknown) => void;
}

interface SubtitleJob {
  bundleId: string;
  country: string;
  key: string;
}

export class SubtitleScheduler {
  private options: SubtitleSchedulerOptions;
  private pending: SubtitleJob[] = [];
  private inFlight = new Set<string>();
  private activeRequests = 0;
  private disposed = false;

  constructor(options: SubtitleSchedulerOptions) {
    this.options = options;
  }

  replace(visible: string[], prefetch: string[], country: string) {
    this.pending = [];
    this.prioritize([...visible, ...prefetch], country);
  }

  prioritize(bundleIds: string[], country: string) {
    if (this.disposed) return;
    country = country.trim().toLowerCase();
    const keys = new Set<string>();
    const jobs: SubtitleJob[] = [];
    for (const bundleId of bundleIds) {
      const key = `${country}:${bundleId}`;
      if (!bundleId || keys.has(key) || this.inFlight.has(key) || this.options.isResolved(bundleId, country)) continue;
      keys.add(key);
      jobs.push({ bundleId, country, key });
    }
    this.pending = [...jobs, ...this.pending.filter((job) => !keys.has(job.key))];
    this.pump();
  }

  dispose() {
    this.disposed = true;
    this.pending = [];
  }

  private pump() {
    while (!this.disposed && this.activeRequests < 4 && this.pending.length > 0) {
      const first = this.pending.shift()!;
      if (this.options.isResolved(first.bundleId, first.country)) continue;
      const batch = [first];
      while (batch.length < 2 && this.pending[0]?.country === first.country) {
        const next = this.pending.shift()!;
        if (!this.options.isResolved(next.bundleId, next.country)) batch.push(next);
      }
      const bundleIds = batch.map((job) => job.bundleId);
      batch.forEach((job) => this.inFlight.add(job.key));
      this.activeRequests++;
      void Promise.resolve()
        .then(() => this.options.request(bundleIds, first.country))
        .then((subtitles) => {
          if (!this.disposed) this.options.onResult(subtitles, first.country, bundleIds);
        })
        .catch((error: unknown) => {
          if (!this.disposed) this.options.onError(error);
        })
        .finally(() => {
          batch.forEach((job) => this.inFlight.delete(job.key));
          this.activeRequests--;
          this.pump();
        });
    }
  }
}

export function selectViewportSubtitles(
  cards: { bundleId: string; top: number; bottom: number }[],
  viewport: { top: number; bottom: number },
  overscan = 240,
) {
  const visible: string[] = [];
  const nearby: { bundleId: string; distance: number }[] = [];
  if (viewport.bottom <= viewport.top) return { visible, prefetch: [] as string[] };
  for (const card of cards) {
    if (card.bottom <= card.top) continue;
    if (card.bottom > viewport.top && card.top < viewport.bottom) {
      visible.push(card.bundleId);
    } else {
      const distance = Math.max(viewport.top - card.bottom, card.top - viewport.bottom);
      if (distance <= overscan) nearby.push({ bundleId: card.bundleId, distance });
    }
  }
  nearby.sort((first, second) => first.distance - second.distance);
  return { visible, prefetch: nearby.slice(0, 6).map((card) => card.bundleId) };
}
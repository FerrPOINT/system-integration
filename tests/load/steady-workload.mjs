import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';

export async function runSteadyArrivals({ rate, durationMs, maxInFlight, perform, shouldStop = () => null }) {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(durationMs) || durationMs <= 0 ||
      !Number.isInteger(maxInFlight) || maxInFlight < 1) throw new Error('Invalid fixed-rate arrival configuration');
  const planned = Math.floor(rate * durationMs / 1000);
  const active = new Set(), startDelaysMs = [];
  const began = performance.now();
  let scheduled = 0, started = 0, missed = 0, peakInFlight = 0, stoppedFor = null, failure;
  try {
    for (let index = 0; index < planned; index++) {
      const due = began + index * 1000 / rate;
      const wait = due - performance.now();
      if (wait > 0) await pause(wait);
      stoppedFor = shouldStop();
      if (!stoppedFor && performance.now() >= began + durationMs) stoppedFor = 'generator-window-overrun';
      if (stoppedFor || failure) break;
      scheduled++;
      if (active.size >= maxInFlight) { missed++; continue; }
      startDelaysMs.push(Math.max(0, performance.now() - due));
      started++;
      let work;
      work = Promise.resolve().then(() => perform(index)).catch(error => { failure ??= error; })
        .finally(() => active.delete(work));
      active.add(work);
      peakInFlight = Math.max(peakInFlight, active.size);
    }
    if (!stoppedFor && !failure) await pause(Math.max(0, began + durationMs - performance.now()));
  } finally { await Promise.all(active); }
  if (failure) throw failure;
  return { planned, scheduled, started, missed, notOffered: planned - scheduled, peakInFlight, startDelaysMs,
    plannedDurationMs: durationMs, elapsedIncludingTailMs: performance.now() - began, stoppedFor };
}

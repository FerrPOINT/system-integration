import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';

// One clock and one in-flight set span every phase. Response tails join only after
// the full schedule, so neither a phase boundary nor observation pauses arrivals.
export async function runSteadyArrivals({ phases, maxInFlight, perform, shouldStop = () => null }) {
  if (
    !Array.isArray(phases) ||
    !phases.length ||
    phases.some(
      ({ rate, durationMs }) =>
        !Number.isFinite(rate) ||
        rate <= 0 ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        !Number.isSafeInteger(Math.floor((rate * durationMs) / 1000)) ||
        rate * durationMs < 1000,
    ) ||
    !Number.isInteger(maxInFlight) ||
    maxInFlight < 1
  )
    throw new Error('Invalid fixed-rate arrival configuration');
  let offset = 0;
  const results = phases.map(({ rate, durationMs }) => {
    const phase = {
      rate,
      plannedDurationMs: durationMs,
      plannedStartOffsetMs: offset,
      planned: Math.floor((rate * durationMs) / 1000),
      scheduled: 0,
      started: 0,
      missed: 0,
      peakInFlight: 0,
      startDelaysMs: [],
      firstOfferedOffsetMs: null,
      lastOfferedOffsetMs: null,
      stoppedFor: null,
    };
    offset += durationMs;
    return phase;
  });
  const active = new Set();
  const began = performance.now(),
    wall = Date.now();
  for (const phase of results) {
    phase.startedAt = new Date(wall + phase.plannedStartOffsetMs).toISOString();
    phase.finishedAt = new Date(wall + phase.plannedStartOffsetMs + phase.plannedDurationMs).toISOString();
  }
  let peakInFlight = 0,
    stoppedFor = null,
    failure,
    sequence = 0;
  try {
    arrivals: for (const [phaseIndex, phase] of results.entries()) {
      const phaseStart = began + phase.plannedStartOffsetMs;
      for (let index = 0; index < phase.planned; index++) {
        const due = phaseStart + (index * 1000) / phase.rate;
        const wait = due - performance.now();
        if (wait > 0) await pause(wait);
        stoppedFor = shouldStop() || null;
        if (!stoppedFor && performance.now() >= phaseStart + phase.plannedDurationMs)
          stoppedFor = 'generator-window-overrun';
        if (stoppedFor || failure) {
          phase.stoppedFor = stoppedFor;
          break arrivals;
        }
        const offered = performance.now();
        phase.firstOfferedOffsetMs ??= offered - began;
        phase.lastOfferedOffsetMs = offered - began;
        phase.scheduled++;
        const current = sequence++;
        if (active.size >= maxInFlight) {
          phase.missed++;
          continue;
        }
        phase.startDelaysMs.push(Math.max(0, offered - due));
        phase.started++;
        let work;
        work = Promise.resolve()
          .then(() => perform(current, phaseIndex))
          .catch((error) => {
            failure ??= { error };
          })
          .finally(() => active.delete(work));
        active.add(work);
        peakInFlight = Math.max(peakInFlight, active.size);
        phase.peakInFlight = Math.max(phase.peakInFlight, active.size);
      }
    }
    if (!stoppedFor && !failure) await pause(Math.max(0, began + offset - performance.now()));
  } finally {
    await Promise.all(active);
  }
  if (failure) throw failure.error;
  for (const phase of results) {
    phase.notOffered = phase.planned - phase.scheduled;
    if (phase.notOffered && !phase.stoppedFor) phase.stoppedFor = stoppedFor || 'not-reached';
  }
  const elapsedIncludingTailMs = performance.now() - began;
  return {
    phases: results,
    planned: results.reduce((n, phase) => n + phase.planned, 0),
    scheduled: results.reduce((n, phase) => n + phase.scheduled, 0),
    started: results.reduce((n, phase) => n + phase.started, 0),
    missed: results.reduce((n, phase) => n + phase.missed, 0),
    notOffered: results.reduce((n, phase) => n + phase.notOffered, 0),
    peakInFlight,
    stoppedFor,
    plannedDurationMs: offset,
    elapsedIncludingTailMs,
    startedAt: new Date(wall).toISOString(),
    finishedAt: new Date(wall + elapsedIncludingTailMs).toISOString(),
  };
}

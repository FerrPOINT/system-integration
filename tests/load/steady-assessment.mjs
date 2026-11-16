const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Test-report criteria only; this function never throttles or rejects application requests.
export function assessSteadyPhase(phase, samples) {
  if (phase.plannedSeconds < 120) return { passed: false, reason: 'screening-window-too-short' };
  const start = Date.parse(phase.startedAt);
  const end = start + phase.plannedSeconds * 1000;
  const selected = samples.filter((sample) => Date.parse(sample.at) >= start && Date.parse(sample.at) < end);
  if (
    selected.some(
      (sample) =>
        ![sample.app.pending, sample.app.oldestPendingSeconds].every((value) => Number.isFinite(value) && value >= 0),
    )
  )
    throw new Error('Invalid queue observation');
  const first = selected.filter((sample) => Date.parse(sample.at) < start + 60000);
  const last = selected.filter((sample) => Date.parse(sample.at) >= end - 60000);
  const warm = selected.filter((sample) => Date.parse(sample.at) >= start + 30000);
  if (first.length < 10 || last.length < 10 || !warm.length)
    return { passed: false, reason: 'insufficient-window-observations' };
  const firstPendingMean = mean(first.map((sample) => sample.app.pending));
  const lastPendingMean = mean(last.map((sample) => sample.app.pending));
  const firstAgeP95Seconds = p95(first.map((sample) => sample.app.oldestPendingSeconds));
  const lastAgeP95Seconds = p95(last.map((sample) => sample.app.oldestPendingSeconds));
  const maximumWarmAgeSeconds = Math.max(...warm.map((sample) => sample.app.oldestPendingSeconds));
  const pendingGrowthLimit = Math.max(2, phase.targetCreatesPerSecond * 0.02);
  return {
    passed:
      lastPendingMean - firstPendingMean <= pendingGrowthLimit &&
      lastAgeP95Seconds - firstAgeP95Seconds <= 1 &&
      maximumWarmAgeSeconds <= 5,
    firstPendingMean,
    lastPendingMean,
    pendingGrowthLimit,
    firstAgeP95Seconds,
    lastAgeP95Seconds,
    maximumWarmAgeSeconds,
    firstSamples: first.length,
    lastSamples: last.length,
  };
}

import type { RunMetrics } from '@aen/protocol'

export interface RateEstimate {
  estimate: number
  lower: number
  upper: number
  method: string
}

/** Acklam inverse-normal approximation for preregistered confidence levels. */
function inverseNormal(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error('probability must be between 0 and 1')
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  const high = 1 - low
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability))
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  const q = probability - 0.5
  const r = q * q
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

export function zForConfidence(confidenceLevel: number): number {
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new Error('confidenceLevel must be between 0 and 1')
  }
  return inverseNormal(0.5 + confidenceLevel / 2)
}

export function wilsonInterval(successes: number, total: number, confidenceLevel: number): RateEstimate {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || successes < 0 || total < successes) {
    throw new Error('invalid binomial counts')
  }
  if (total === 0) throw new Error('Wilson interval requires at least one trial')
  const z = zForConfidence(confidenceLevel)
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denominator
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator
  return {
    estimate: p,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    method: `Wilson score interval (${confidenceLevel})`,
  }
}

export function passAtK(successRate: number, k: number): number {
  return 1 - (1 - successRate) ** k
}

export function passPowerK(successRate: number, k: number): number {
  return successRate ** k
}

export function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantile(values: number[], probability: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1)
  return sorted[index]
}

export function sampleStandardDeviation(values: number[]): number | undefined {
  if (values.length < 2) return undefined
  const average = mean(values)!
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function metricSummary(metrics: RunMetrics[], successes: number, validTrials: number) {
  const quality = metrics.flatMap((item) => item.qualityScore === undefined ? [] : [item.qualityScore])
  const cost = metrics.flatMap((item) => item.totalCostUsd === undefined ? [] : [item.totalCostUsd])
  const latency = metrics.flatMap((item) => item.latencyMs === undefined ? [] : [item.latencyMs])
  return {
    sampleSize: validTrials,
    ...(validTrials === 0 ? {} : { successRate: successes / validTrials }),
    ...(mean(quality) === undefined ? {} : { quality: { mean: mean(quality)! } }),
    ...(mean(cost) === undefined ? {} : { costUsd: { mean: mean(cost)! } }),
    ...(latency.length === 0 ? {} : {
      latencyMs: { p50: quantile(latency, 0.5)!, p95: quantile(latency, 0.95)! },
    }),
    method: 'arithmetic means and nearest-rank latency quantiles over valid trials',
  }
}

export function continuousDifferenceInterval(
  baseline: number[],
  treatment: number[],
  confidenceLevel: number,
): { baseline: number; treatment: number; difference: number; lower?: number; upper?: number; method: string } | undefined {
  const baselineMean = mean(baseline)
  const treatmentMean = mean(treatment)
  if (baselineMean === undefined || treatmentMean === undefined) return undefined
  const difference = treatmentMean - baselineMean
  const baselineSd = sampleStandardDeviation(baseline)
  const treatmentSd = sampleStandardDeviation(treatment)
  if (baselineSd === undefined || treatmentSd === undefined) {
    return { baseline: baselineMean, treatment: treatmentMean, difference, method: 'difference of arithmetic means; interval unavailable' }
  }
  const standardError = Math.sqrt((baselineSd ** 2) / baseline.length + (treatmentSd ** 2) / treatment.length)
  const z = zForConfidence(confidenceLevel)
  return {
    baseline: baselineMean,
    treatment: treatmentMean,
    difference,
    lower: difference - z * standardError,
    upper: difference + z * standardError,
    method: `normal Welch-style difference interval (${confidenceLevel})`,
  }
}

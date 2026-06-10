export type BehaviorOccurrence = {
  timestamp: number;
  intensity: number | null;
};

export type BehaviorLike = {
  id: string;
  type?: string;
  intensity?: number | null;
  occurrences?: unknown;
  intensityRecords?: unknown;
  count?: number;
  durationSec?: number;
};

export type BehaviorIntensityStats = {
  totalOccurrences: number;
  ratedOccurrences: number;
  averageIntensity: number | null;
  highestIntensity: number | null;
  lowestIntensity: number | null;
  trendValues: number[];
  trendLabel: string;
  trendDirection: "rising" | "falling" | "flat" | "mixed" | "single" | "none";
};

function isOccurrence(value: unknown): value is BehaviorOccurrence {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BehaviorOccurrence>;
  return typeof record.timestamp === "number" && Number.isFinite(record.timestamp);
}

function normalizeOccurrence(value: unknown): BehaviorOccurrence | null {
  if (!isOccurrence(value)) return null;
  const record = value as Partial<BehaviorOccurrence>;
  const timestamp = record.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const intensity = typeof record.intensity === "number" && Number.isFinite(record.intensity) ? record.intensity : null;
  return {
    timestamp,
    intensity,
  };
}

export function normalizeBehaviorOccurrences(behavior: BehaviorLike): BehaviorOccurrence[] {
  const rawOccurrences = Array.isArray(behavior.occurrences)
    ? behavior.occurrences
    : Array.isArray(behavior.intensityRecords)
      ? behavior.intensityRecords
      : [];

  const normalized = rawOccurrences
    .map(normalizeOccurrence)
    .filter((record): record is BehaviorOccurrence => record !== null);

  if (normalized.length === 0 && typeof behavior.intensity === "number" && Number.isFinite(behavior.intensity)) {
    normalized.push({
      timestamp: 0,
      intensity: behavior.intensity,
    });
  }

  return normalized.sort((a, b) => a.timestamp - b.timestamp);
}

export function buildIntensityTrendLabel(values: number[]) {
  if (values.length === 0) return "No ratings";
  return values.join(" -> ");
}

export function getIntensityTrendDirection(values: number[]): BehaviorIntensityStats["trendDirection"] {
  if (values.length === 0) return "none";
  if (values.length === 1) return "single";

  let rising = true;
  let falling = true;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) rising = false;
    if (values[index] > values[index - 1]) falling = false;
  }

  if (rising && !falling) return "rising";
  if (falling && !rising) return "falling";
  if (rising && falling) return "flat";
  return "mixed";
}

export function getBehaviorIntensityStats(behavior: BehaviorLike): BehaviorIntensityStats {
  const occurrences = normalizeBehaviorOccurrences(behavior);
  const ratedValues = occurrences
    .map((record) => record.intensity)
    .filter((intensity): intensity is number => typeof intensity === "number" && Number.isFinite(intensity));

  const totalOccurrences =
    occurrences.length ||
    (behavior.count && behavior.count > 0 ? behavior.count : 0) ||
    (typeof behavior.intensity === "number" && Number.isFinite(behavior.intensity) ? 1 : 0) ||
    (behavior.durationSec ? 1 : 0);
  const ratedOccurrences = ratedValues.length;
  const averageIntensity =
    ratedValues.length > 0
      ? ratedValues.reduce((sum, value) => sum + value, 0) / ratedValues.length
      : null;
  const highestIntensity = ratedValues.length > 0 ? Math.max(...ratedValues) : null;
  const lowestIntensity = ratedValues.length > 0 ? Math.min(...ratedValues) : null;

  return {
    totalOccurrences,
    ratedOccurrences,
    averageIntensity,
    highestIntensity,
    lowestIntensity,
    trendValues: ratedValues,
    trendLabel: buildIntensityTrendLabel(ratedValues),
    trendDirection: getIntensityTrendDirection(ratedValues),
  };
}

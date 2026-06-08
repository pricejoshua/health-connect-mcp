import type { Row } from "./sqlite";

export const SERIES_TABLES = [
  "heart_rate_record_series_table",
  "exercise_route_table",
  "cycling_pedaling_cadence_record_table",
  "power_record_table",
  "speed_record_table",
  "steps_cadence_record_table",
  "skin_temperature_delta_table",
];

const ROW_THRESHOLD = 500_000;

export function shouldAggregate(
  tableName: string,
  aggregateFlag: boolean,
  rowCount: number
): boolean {
  if (!aggregateFlag) return false;
  return SERIES_TABLES.includes(tableName) || rowCount >= ROW_THRESHOLD;
}

function epochToDate(epochMillis: number): string {
  return new Date(epochMillis).toISOString().slice(0, 10);
}

function groupByDate(rows: Row[], timeKey: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const date = epochToDate(row[timeKey] as number);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(row);
  }
  return groups;
}

export function aggregateRows(tableName: string, rows: Row[]): Row[] {
  if (!rows.length) return [];

  switch (tableName) {
    case "heart_rate_record_series_table":
      return aggregateHeartRate(rows);
    case "exercise_route_table":
      return aggregateRoute(rows);
    case "cycling_pedaling_cadence_record_table":
    case "steps_cadence_record_table":
      return aggregateCadence(rows);
    case "power_record_table":
      return aggregatePower(rows);
    case "speed_record_table":
      return aggregateSpeed(rows);
    case "skin_temperature_delta_table":
      return aggregateSkinTemp(rows);
    default:
      return aggregateGeneric(rows);
  }
}

function aggregateHeartRate(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const bpms = dayRows.map(r => r.beats_per_minute as number);
    return {
      date,
      min_bpm: Math.min(...bpms),
      max_bpm: Math.max(...bpms),
      avg_bpm: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      sample_count: bpms.length,
    };
  });
}

function aggregateRoute(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "timestamp_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => ({
    date,
    point_count: dayRows.length,
  }));
}

function aggregateCadence(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const rates = dayRows.map(r => r.rate as number);
    return {
      date,
      avg_rate: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
      sample_count: rates.length,
    };
  });
}

function aggregatePower(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const powers = dayRows.map(r => r.power as number);
    return {
      date,
      avg_power: Math.round(powers.reduce((a, b) => a + b, 0) / powers.length),
      max_power: Math.max(...powers),
      sample_count: powers.length,
    };
  });
}

function aggregateSpeed(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const speeds = dayRows.map(r => r.speed as number);
    return {
      date,
      avg_speed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
      max_speed: Math.max(...speeds),
      sample_count: speeds.length,
    };
  });
}

function aggregateSkinTemp(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const deltas = dayRows.map(r => r.delta as number);
    return {
      date,
      avg_delta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      sample_count: deltas.length,
    };
  });
}

function aggregateGeneric(rows: Row[]): Row[] {
  const timeKey = Object.keys(rows[0]).find(
    k => k.includes("epoch") || k === "time"
  );
  if (!timeKey) return [{ row_count: rows.length }];
  const groups = groupByDate(rows, timeKey);
  return Array.from(groups.entries()).map(([date, dayRows]) => ({
    date,
    row_count: dayRows.length,
  }));
}

import { describe, it, expect } from "vitest";
import { SERIES_TABLES, shouldAggregate, aggregateRows } from "../src/aggregate";

describe("SERIES_TABLES", () => {
  it("includes heart_rate_record_series_table", () => {
    expect(SERIES_TABLES).toContain("heart_rate_record_series_table");
  });

  it("includes exercise_route_table", () => {
    expect(SERIES_TABLES).toContain("exercise_route_table");
  });
});

describe("shouldAggregate", () => {
  it("returns true for series table when AGGREGATE=true", () => {
    expect(shouldAggregate("heart_rate_record_series_table", true, 100)).toBe(true);
  });

  it("returns false for non-series table when AGGREGATE=true", () => {
    expect(shouldAggregate("steps_record_table", true, 100)).toBe(false);
  });

  it("returns false for series table when AGGREGATE=false", () => {
    expect(shouldAggregate("heart_rate_record_series_table", false, 100)).toBe(false);
  });

  it("returns true for any table exceeding 500k rows when AGGREGATE=true", () => {
    expect(shouldAggregate("unknown_big_table", true, 600_000)).toBe(true);
  });

  it("returns false for large table when AGGREGATE=false", () => {
    expect(shouldAggregate("unknown_big_table", false, 600_000)).toBe(false);
  });
});

describe("aggregateRows — heart_rate_record_series_table", () => {
  it("aggregates to daily min/avg/max bpm", () => {
    const rows = [
      { epoch_millis: 1700006400000, beats_per_minute: 70 }, // 2023-11-15
      { epoch_millis: 1700006460000, beats_per_minute: 80 }, // same day
      { epoch_millis: 1700092800000, beats_per_minute: 65 }, // 2023-11-16
    ];
    const result = aggregateRows("heart_rate_record_series_table", rows);
    expect(result).toHaveLength(2);
    const day1 = result.find(r => r.date === "2023-11-15");
    expect(day1).toBeDefined();
    expect(day1!.min_bpm).toBe(70);
    expect(day1!.max_bpm).toBe(80);
    expect(day1!.avg_bpm).toBe(75);
    expect(day1!.sample_count).toBe(2);
  });
});

describe("aggregateRows — exercise_route_table", () => {
  it("aggregates to daily GPS point counts, dropping coordinates", () => {
    const rows = [
      { timestamp_millis: 1700006400000, latitude: 48.8, longitude: 2.3, altitude: 100 },
      { timestamp_millis: 1700006460000, latitude: 48.9, longitude: 2.4, altitude: 101 },
    ];
    const result = aggregateRows("exercise_route_table", rows);
    expect(result).toHaveLength(1);
    expect(result[0].point_count).toBe(2);
    expect(result[0]).not.toHaveProperty("latitude");
    expect(result[0]).not.toHaveProperty("longitude");
  });
});

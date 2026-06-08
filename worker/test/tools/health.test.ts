import { describe, it, expect, vi } from "vitest";
import { getStepsTool, getWeightTool, getSleepTool, getHealthSummaryTool } from "../../src/tools/health";

function makeDb(results: unknown[] = []): D1Database {
  const all = vi.fn().mockResolvedValue({ results });
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ all, bind }));
  return { prepare } as unknown as D1Database;
}

describe("getStepsTool", () => {
  it("returns step data as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", total_steps: 8000 }]);
    const result = await getStepsTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("8000");
  });

  it("returns no-data message for empty results", async () => {
    const db = makeDb([]);
    const result = await getStepsTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("No step data");
  });
});

describe("getWeightTool", () => {
  it("returns weight records as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", weight: 75.5 }]);
    const result = await getWeightTool(db, "2024-01-01", "2024-01-31");
    expect(result).toContain("75.5");
  });
});

describe("getSleepTool", () => {
  it("returns sleep sessions as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", start_time: 1000, end_time: 2000, stages: null }]);
    const result = await getSleepTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("2024-01-01");
  });
});

describe("getHealthSummaryTool", () => {
  it("returns summary with period field", async () => {
    const db = makeDb([{ avg_steps: 7500 }]);
    const result = await getHealthSummaryTool(db, "2024-01-01", "2024-01-07");
    const parsed = JSON.parse(result);
    expect(parsed.period.from).toBe("2024-01-01");
  });
});

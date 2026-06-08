import { listTablesTool, getTableSchemaTool, queryTableTool } from "./query";
import {
  getHeartRateTool, getStepsTool, getSleepTool, getWorkoutsTool,
  getNutritionTool, getWeightTool, getHealthSummaryTool,
} from "./health";
import { getLastSyncTool } from "./sync";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

const DATE_RANGE_SCHEMA = {
  properties: {
    start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
    end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
  },
  required: ["start_date", "end_date"],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_tables",
    description: "List all health data tables in the database.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_table_schema",
    description: "Get the column names and types for a specific table.",
    inputSchema: {
      type: "object",
      properties: { table_name: { type: "string", description: "Name of the table" } },
      required: ["table_name"],
    },
  },
  {
    name: "query_table",
    description: "Run a raw SQL SELECT query against the health database.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "SQL SELECT query to execute" } },
      required: ["sql"],
    },
  },
  { name: "get_heart_rate", description: "Get daily min/avg/max heart rate for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_steps", description: "Get daily step counts for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_sleep", description: "Get sleep sessions with stage breakdowns for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_workouts", description: "Get exercise sessions with type, duration, and distance for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_nutrition", description: "Get daily nutrition totals (calories, protein, carbs, fat) for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_weight", description: "Get weight and body composition readings for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_health_summary", description: "Get a high-level health summary across all metrics for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  {
    name: "get_last_sync",
    description: "Get information about the last successful data sync from Health Connect.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function callTool(
  name: string,
  args: Record<string, string>,
  db: D1Database
): Promise<string> {
  switch (name) {
    case "list_tables":       return listTablesTool(db);
    case "get_table_schema":  return getTableSchemaTool(db, args.table_name);
    case "query_table":       return queryTableTool(db, args.sql);
    case "get_heart_rate":    return getHeartRateTool(db, args.start_date, args.end_date);
    case "get_steps":         return getStepsTool(db, args.start_date, args.end_date);
    case "get_sleep":         return getSleepTool(db, args.start_date, args.end_date);
    case "get_workouts":      return getWorkoutsTool(db, args.start_date, args.end_date);
    case "get_nutrition":     return getNutritionTool(db, args.start_date, args.end_date);
    case "get_weight":        return getWeightTool(db, args.start_date, args.end_date);
    case "get_health_summary": return getHealthSummaryTool(db, args.start_date, args.end_date);
    case "get_last_sync":     return getLastSyncTool(db);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

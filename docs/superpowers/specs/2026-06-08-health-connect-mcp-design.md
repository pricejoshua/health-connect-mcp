# Health Connect MCP — Design Spec
**Date:** 2026-06-08

## Overview

A fully hosted MCP server that exposes Android Health Connect data to Claude. A weekly Google Apps Script syncs the Health Connect SQLite export from Google Drive into a Cloudflare D1 database. A Cloudflare Worker serves as both the ingest endpoint and the MCP server. Claude on mobile queries health data conversationally via MCP tools.

---

## Architecture

```
Android Health Connect
        ↓ (manual export → zip)
Google Drive
        ↓ (weekly Google Apps Script cron)
Cloudflare Worker: /ingest
        ↓ (parses SQLite via WASM, maps to D1 tables)
Cloudflare D1 (all Health Connect tables)
        ↓ (MCP tools over HTTP)
Cloudflare Worker: /mcp
        ↑
Claude (mobile)
```

---

## Components

### 1. Cloudflare Worker — Ingest (`/ingest`)

- Accepts `POST /ingest` with raw `.db` binary in the request body
- Authenticates via `Authorization: Bearer <API_KEY>`
- Parses the SQLite file using a WASM SQLite library (e.g. `sql.js`)
- Queries `sqlite_master` to discover all tables dynamically
- For each table:
  - Creates the matching D1 table if it doesn't exist (using the same table name and column schema as the source)
  - Upserts all rows (keyed on `uuid` or `row_id` where available, `rowid` otherwise)
- Respects the `AGGREGATE` environment variable (default `true`):
  - **`AGGREGATE=true`**: large series tables (see list below) are aggregated to daily summaries before writing to D1
  - **`AGGREGATE=false`**: all rows stored raw (assumes D1 paid tier)
- Returns a JSON response: `{ success: true, tables: { <name>: { rows: N, status: "upserted"|"aggregated"|"skipped" } } }`
- On any parsing error, rolls back the entire sync — no partial data in D1
- Records sync metadata (timestamp, row counts, status) in a `_sync_log` table in D1

**Series tables aggregated when `AGGREGATE=true`:**
- `heart_rate_record_series_table` → daily min/avg/max bpm
- `exercise_route_table` → daily GPS point count only (coordinates dropped)
- `cycling_pedaling_cadence_record_table` → daily avg cadence
- `power_record_table` → daily avg/max power
- `speed_record_table` → daily avg/max speed
- `steps_cadence_record_table` → daily avg cadence
- `skin_temperature_delta_table` → daily avg delta

All other tables are stored raw regardless of `AGGREGATE` setting.

**Safety valve:** if any table's row count exceeds 500k rows and `AGGREGATE=true`, it is auto-aggregated even if not in the list above.

---

### 2. Cloudflare Worker — MCP Server (`/mcp`)

Implements the MCP protocol over **streamable HTTP** (the current MCP standard transport for hosted servers). Authenticates via `Authorization: Bearer <API_KEY>`.

**Query tools:**
| Tool | Description |
|---|---|
| `list_tables` | Returns all D1 tables with row counts and last sync time |
| `get_table_schema` | Returns column names and types for a given table |
| `query_table` | Runs a raw SQL SELECT against any D1 table |

**Convenience tools:**
| Tool | Description |
|---|---|
| `get_health_summary` | High-level stats across all data types for a date range |
| `get_heart_rate` | Daily avg/min/max heart rate for a date range |
| `get_steps` | Daily step counts for a date range |
| `get_sleep` | Sleep sessions with stage breakdowns |
| `get_workouts` | Exercise sessions with type, duration, distance |
| `get_nutrition` | Daily nutrition totals (calories, protein, carbs, fat, etc.) |
| `get_weight` | Weight and body composition over time |

**Sync tool:**
| Tool | Description |
|---|---|
| `get_last_sync` | Returns timestamp of last successful ingest |

All tools return structured JSON. Errors return a readable message Claude can relay to the user rather than a raw stack trace.

---

### 3. Google Apps Script — Weekly Sync

Runs on a weekly time-based trigger (e.g. Sunday 3am).

**Steps:**
1. Searches Google Drive for the Health Connect export file by name (`health_connect_export.db` or a `.zip` containing it)
2. If zipped: extracts the `.db` in-memory
3. POSTs the raw `.db` bytes to `INGEST_URL` with `Authorization: Bearer <API_KEY>`
4. Logs result (timestamp, status, per-table row counts) to Apps Script execution logs

**Script Properties required:**
- `INGEST_URL` — Cloudflare Worker ingest URL
- `API_KEY` — shared secret token

**Constraints:**
- 6-minute execution limit (well within for a single `.db` file)
- 50MB request body limit (well within for personal health data)

---

## D1 Schema

- All table names match the source Health Connect SQLite table names exactly (e.g. `heart_rate_record_table`, `steps_record_table`)
- All column names match source column names exactly
- Tables are created dynamically at ingest time — no migrations needed for new record types
- Additional system table: `_sync_log` with columns `sync_id`, `synced_at`, `status`, `tables_json`
- Aggregated series tables get a `date` column (ISO date string) replacing the raw timestamp columns

---

## Security

- All Worker endpoints require `Authorization: Bearer <API_KEY>`
- API key stored as a Cloudflare Worker secret (not in source code)
- D1 database is private — no direct public access
- No credentials stored in Apps Script source — only Script Properties

---

## Environment Variables / Secrets

| Variable | Where | Description |
|---|---|---|
| `API_KEY` | Cloudflare Worker secret | Shared auth token for ingest + MCP |
| `AGGREGATE` | Cloudflare Worker env var | `true` (default) or `false` |
| `INGEST_URL` | Apps Script Script Property | Full URL to `/ingest` endpoint |
| `API_KEY` | Apps Script Script Property | Same shared token |

---

## Error Handling

- Ingest failures roll back the entire sync — D1 is never left in a partial state
- Ingest returns per-table status in the JSON response for debugging
- MCP tool errors return structured error objects Claude can interpret
- Apps Script logs all sync attempts with timestamp and result
- Auto-aggregation safety valve prevents accidental D1 limit overruns on free tier

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite-compatible) |
| SQLite parsing | `sql.js` (WASM) in Worker |
| Sync script | Google Apps Script |
| MCP protocol | HTTP (streamable HTTP / SSE) |
| Language | TypeScript (Worker), JavaScript (Apps Script) |

---

## Future Roadmap

- Dashboard UI (Cloudflare Pages + D1 query API)
- Webhook trigger from Apps Script instead of polling (on-demand sync)
- Additional MCP convenience tools as usage patterns emerge

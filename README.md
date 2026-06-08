# Health Connect MCP

A free, self-hosted MCP server that syncs your Android Health Connect data to Cloudflare D1 and exposes it as tools for Claude.

Ask Claude things like:
- *"How were my steps last week?"*
- *"What's my average resting heart rate this month?"*
- *"Show me my sleep patterns for November."*
- *"How many calories did I burn during workouts last week?"*

## How it works

```
Android Health Connect
        ↓ export → zip → Google Drive
Google Apps Script (weekly cron)
        ↓ POST raw .db file
Cloudflare Worker /ingest
        ↓ parse all 75 tables → write to D1
Cloudflare D1 (your health database)
        ↓ MCP tools
Cloudflare Worker /mcp
        ↑
Claude (mobile or desktop)
```

## Cost

**$0/month.** Cloudflare Workers, D1, and Google Apps Script are all free for personal use.

## MCP Tools

| Tool | Description |
|---|---|
| `get_health_summary` | High-level stats (steps, weight, sleep, HR) for a date range |
| `get_heart_rate` | Daily min/avg/max heart rate |
| `get_steps` | Daily step counts |
| `get_sleep` | Sleep sessions with stage breakdowns |
| `get_workouts` | Exercise sessions with type, duration, distance |
| `get_nutrition` | Daily nutrition totals (calories, protein, carbs, fat) |
| `get_weight` | Weight and body composition over time |
| `list_tables` | List all tables synced to D1 |
| `get_table_schema` | Column names and types for any table |
| `query_table` | Run a raw SQL SELECT against your health data |
| `get_last_sync` | When was the data last synced |

## Data

All 75 Health Connect record types are synced, including:

- Heart rate, HRV, resting heart rate
- Steps, distance, calories, floors
- Sleep sessions and stages
- Exercise sessions and GPS routes
- Weight, body fat, body water, bone mass, BMR
- Nutrition (50+ nutrient fields)
- Skin temperature, oxygen saturation
- And more — any new record types are auto-discovered on the next sync

**Free tier mode (`AGGREGATE=true`):** Large time-series tables (heart rate samples, GPS routes) are aggregated to daily summaries to stay within D1 free limits. All other tables are stored raw.

## Project structure

```
worker/
├── src/
│   ├── index.ts        - Worker entry point + Env types
│   ├── auth.ts         - Bearer token authentication
│   ├── ingest.ts       - POST /ingest handler
│   ├── mcp.ts          - POST /mcp JSON-RPC handler
│   ├── sqlite.ts       - sql.js WASM SQLite parsing
│   ├── aggregate.ts    - Series table aggregation
│   ├── d1.ts           - D1 schema + upsert helpers
│   └── tools/          - MCP tool implementations
├── test/               - Vitest test suite (44 tests)
└── wrangler.toml       - Cloudflare configuration
apps-script/
└── sync.js             - Google Apps Script weekly sync
```

## Development

```bash
cd worker
npm install
npm test          # run tests
npm run dev       # local dev server
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for step-by-step deployment instructions.

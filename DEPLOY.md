# Deployment Guide

Complete step-by-step guide to deploying Health Connect MCP on Cloudflare's **free plan**.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- A [Google account](https://accounts.google.com/) with Health Connect export in Google Drive

---

## Step 1: Clone and install

```bash
git clone https://github.com/pricejoshua/health-connect-mcp.git
cd health-connect-mcp/worker
npm install
```

## Step 2: Log in to Cloudflare

```bash
wrangler login
```

This opens a browser window to authorize Wrangler with your Cloudflare account.

## Step 3: Create the D1 database

```bash
wrangler d1 create health-connect
```

You'll see output like:
```
✅ Successfully created DB 'health-connect'

[[d1_databases]]
binding = "DB"
database_name = "health-connect"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value.

## Step 4: Update wrangler.toml

Open `worker/wrangler.toml` and replace `REPLACE_AFTER_CREATION` with your actual database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "health-connect"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← paste here
```

## Step 5: Set your API key secret

Choose a strong random string as your API key — this protects your health data:

```bash
# Generate a random key (or use any strong password)
wrangler secret put API_KEY
```

When prompted, enter your chosen API key. **Save it somewhere safe** — you'll need it for the Apps Script and Claude.

## Step 6: Deploy the Worker

```bash
npm run deploy
```

Expected output:
```
⛅️ wrangler 3.x
Published health-connect-mcp (0.xx sec)
  https://health-connect-mcp.<your-subdomain>.workers.dev
```

Note your Worker URL — you'll use it in the next steps.

## Step 7: Verify deployment

```bash
curl -X POST https://health-connect-mcp.<your-subdomain>.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}'
```

You should get back a JSON response with `serverInfo.name: "health-connect-mcp"`.

---

## Step 8: Set up Google Apps Script

### 8a. Create a new Apps Script project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename it to "Health Connect Sync"

### 8b. Add the sync script

1. Delete the default `Code.gs` content
2. Open `apps-script/sync.js` from this repo
3. Paste the entire contents into the editor
4. Click **Save** (Ctrl+S)

### 8c. Configure Script Properties

1. Click **Project Settings** (gear icon, left sidebar)
2. Scroll to **Script Properties**
3. Click **Add script property** for each:

| Property | Value |
|---|---|
| `INGEST_URL` | `https://health-connect-mcp.<your-subdomain>.workers.dev/ingest` |
| `API_KEY` | Your API key from Step 5 |

### 8d. Run once manually to test

1. Back in the editor, select `syncHealthConnect` from the function dropdown
2. Click **Run**
3. You'll be prompted to authorize Drive access — click through
4. Check **View → Logs** to see the sync output

If successful, you'll see something like:
```
Syncing health_connect_export.db (or zip)...
Sync complete: 42 tables written
```

### 8e. Set up the weekly trigger

1. In the editor, select `setupWeeklyTrigger` from the function dropdown
2. Click **Run**
3. This creates a trigger that runs every Sunday at 3am

To verify: **Edit → Triggers** — you should see `syncHealthConnect` listed.

> **Note:** Apps Script is free for personal use. It has a 6 min/run execution limit, which is plenty for a weekly sync.

---

## Step 9: Seed D1 with existing data

If you already have a Health Connect export, you can seed it immediately without waiting for the weekly sync.

### Option A: Trigger the Apps Script manually (recommended)

Just run `syncHealthConnect` in the Apps Script editor (Step 8d above). It will find your export in Drive automatically.

### Option B: Upload manually with curl

```bash
# If you have the .db file locally
curl -X POST https://health-connect-mcp.<your-subdomain>.workers.dev/ingest \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @/path/to/health_connect_export.db
```

---

## Step 10: Connect Claude

### Claude on mobile (iOS / Android)

1. Open the Claude app
2. Go to **Settings → Integrations** (or **MCP Servers**)
3. Tap **Add server**
4. Enter:
   - **Name:** Health Connect
   - **URL:** `https://health-connect-mcp.<your-subdomain>.workers.dev/mcp`
   - **Auth:** Bearer token → your API key

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "health-connect": {
      "url": "https://health-connect-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Config file locations:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

---

## Configuration

### AGGREGATE mode (default: true)

Controls how large time-series tables are stored in D1.

| Value | Behavior |
|---|---|
| `true` (default) | Heart rate samples, GPS routes, etc. aggregated to daily summaries. Stays within D1 free limits. |
| `false` | Raw rows stored as-is. Requires D1 paid plan if you have large datasets (1.7M+ heart rate rows). |

To change, edit `worker/wrangler.toml`:
```toml
[vars]
AGGREGATE = "false"   # disable aggregation
```

Then redeploy: `npm run deploy`

---

## Troubleshooting

### "Authentication failed"
- Check your `API_KEY` secret was set: `wrangler secret list`
- Verify the Bearer token matches exactly (no extra spaces)

### "Database not found"
- Confirm `database_id` in `wrangler.toml` matches what `wrangler d1 list` shows
- Redeploy after any `wrangler.toml` changes: `npm run deploy`

### Apps Script can't find the export file
- Make sure the export file (`.db` or `.zip`) is in your Google Drive (not a shared drive)
- File should be named something like `health_connect_export.db` or `health-connect-export.zip`
- Check **View → Logs** in Apps Script for the exact error

### Sync succeeds but no data in Claude
- Ask Claude: *"When was my health data last synced?"* — uses the `get_last_sync` tool
- Check the `_sync_log` table: `wrangler d1 execute health-connect --command "SELECT * FROM _sync_log ORDER BY synced_at DESC LIMIT 5"`

### Worker errors after deploy
- Check live logs: `wrangler tail`
- Run tests locally: `cd worker && npm test`

---

## Updating

When new versions are released:

```bash
git pull
cd worker
npm install
npm test
npm run deploy
```

Your D1 database and secrets are preserved across deployments.

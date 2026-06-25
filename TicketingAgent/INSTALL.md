# ETL Jira Ticketing Agent - Installation Guide

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Python | 3.10+ | https://www.python.org/downloads/ |
| Node.js | 18+ | https://nodejs.org/ |
| VS Code | 1.85+ | https://code.visualstudio.com/ |
| GitHub Copilot extension | Latest | VS Code Marketplace |
| Git | Any | https://git-scm.com/ |

---

## Step 1 - Configure credentials

Open `config/config.ini` and fill in all sections:

```ini
[postgresql]
host     = your-db-host        # e.g. localhost or 192.168.1.10
port     = 5432
database = your_database_name
user     = your_db_user
password = your_db_password

[query]
fetch_errors =
    SELECT
        id            AS error_id,
        pipeline_name AS pipeline_name,
        error_message AS error_message,
        error_time    AS error_time,
        source_table  AS source_table
    FROM etl_error_logs
    WHERE status = 'FAILED'
      AND error_time >= NOW() - INTERVAL '24 hours'
    ORDER BY error_time DESC

[jira]
url         = http://your-jira-server.com
project_key = ETL
issue_type  = Bug
username    = your_jira_username
password    = your_jira_password_or_personal_access_token
```

> For Jira Server use a Personal Access Token as the password.
> Go to Jira > Profile > Personal Access Tokens > Create token.

---

## Step 2 - Install Python dependencies

Open a terminal in the `TicketingAgent` folder:

```bash
pip install -r requirements.txt
```

Installs: `mcp[cli]`, `psycopg2-binary`, `requests`

---

## Step 3 - Install the VS Code companion extension

```bash
cd vscode-companion
npm install
npm run compile
```

**Option A - Development mode (easiest)**
1. Open `vscode-companion/` in VS Code
2. Press `F5` - a new VS Code window opens with the extension active

**Option B - Install permanently**
```bash
npm run package    # creates etl-jira-companion-1.0.0.vsix
```
In VS Code: `Ctrl+Shift+P` > `Extensions: Install from VSIX` > select the `.vsix` file

---

## Step 4 - Register the MCP server in VS Code

Open `.vscode/mcp.json` and update the full path to `server.py`:

```json
{
  "servers": {
    "etl-jira-agent": {
      "type": "stdio",
      "command": "python",
      "args": ["C:/full/path/to/TicketingAgent/mcp_server/server.py"]
    }
  }
}
```

Enable MCP in VS Code settings (`Ctrl+,` > search `mcp`):
```json
"github.copilot.chat.experimental.mcp": true
```

Reload VS Code: `Ctrl+Shift+P` > `Developer: Reload Window`

---

## Step 5 - Tracking table

Auto-created on first run. If your DB user lacks `CREATE TABLE` permission, ask your DBA to run this manually:

```sql
CREATE TABLE public.etl_jira_tracking (
    fingerprint   TEXT PRIMARY KEY,
    jira_key      TEXT,
    pipeline_name TEXT,
    error_message TEXT,
    source_table  TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
);
```

---

## Step 6 - Test the server

```bash
python mcp_server/server.py
```

No errors = server is ready. Press `Ctrl+C` to stop.
VS Code manages this process automatically during normal use.

---

## Using in VS Code Copilot Chat

Open Copilot Chat (`Ctrl+Shift+I`) and type:

| What you want | What to type |
|--------------|-------------|
| Check for new errors | `Check ETL errors and raise Jira tickets` |
| Review open tickets | `Show me all open ETL tickets with resolution steps` |
| Today's summary | `Give me today's ETL error summary` |
| Analyse a specific ticket | `What is the resolution for ETL-123?` |

When new errors are found a popup appears in VS Code for each one:

```
[1/3] [Orders Pipeline] - DB connection timeout

Pipeline : Orders Pipeline
Time     : 2026-06-25 09:14
Occurs   : 3x  |  Priority: High

Resolution preview:
1. Check DB connection pool settings
2. Verify network connectivity to DB host
3. Check for blocking long-running queries

  [Create Ticket]   [Skip]   [Stop All]
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ModuleNotFoundError: mcp` | Run `pip install mcp[cli]` |
| `psycopg2 connection refused` | Check host/port/credentials in `config/config.ini` |
| `Jira 401 Unauthorized` | Check username and token in `config/config.ini` |
| Popup not appearing | Ensure companion extension is running (Step 3) |
| MCP server not found in Copilot | Verify path in `.vscode/mcp.json` and reload VS Code |
| `permission denied CREATE TABLE` | Ask DBA to create `etl_jira_tracking` manually |

---

## Folder Structure

```
TicketingAgent/
├── config/
│   └── config.ini             <- Credentials and SQL query (edit this first)
├── mcp_server/
│   ├── server.py              <- MCP server entry point
│   ├── db.py                  <- PostgreSQL logic
│   ├── grouper.py             <- Groups similar errors
│   ├── jira_client.py         <- Jira REST API
│   └── sunsystems_kb.py       <- Infor Sun Systems knowledge base
├── vscode-companion/
│   ├── src/extension.ts       <- VS Code popup extension
│   ├── package.json
│   └── tsconfig.json
├── .vscode/
│   └── mcp.json               <- Registers MCP server in VS Code
├── requirements.txt
├── INSTALL.md                 <- This file
└── SETUP.md                   <- Quick reference
```

# ETL Jira Agent — Setup Guide

## Step 1: Install Python dependencies
```
cd etl-jira-agent
pip install -r requirements.txt
```

## Step 2: Fill in config.ini
Edit `config.ini` with your:
- PostgreSQL connection details
- Your actual ETL error SQL query (under `[query] fetch_errors`)
- Jira Server URL, project key, username, password

## Step 3: Install the VS Code companion extension
```
cd vscode-companion
npm install
npm run compile
```
Then in VS Code: press F5 to run the extension in development mode,
or package it with `npm run package` and install the `.vsix` file.

## Step 4: Register the MCP server in VS Code
Copy `.vscode/mcp.json` into your workspace `.vscode/` folder.
Update the path to point to where `server.py` lives on your machine.

In VS Code settings, ensure GitHub Copilot MCP is enabled:
`"github.copilot.chat.experimental.mcp": true`

## Step 5: Use in Copilot Chat
Open Copilot Chat (Ctrl+Shift+I) and type:

| What you want | What to type |
|---|---|
| Check for new errors | `Check ETL errors and raise Jira tickets` |
| Review open tickets | `Show me all open ETL tickets with resolution steps` |
| Today's summary | `Give me today's ETL error summary` |

When creating tickets, a popup will appear in VS Code for each error — click:
- **Create Ticket** — creates the Jira ticket and moves to next
- **Skip** — skips this error, moves to next
- **Stop All** — stops processing

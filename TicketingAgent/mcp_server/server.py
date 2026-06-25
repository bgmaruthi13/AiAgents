"""
ETL Jira MCP Server
Exposes tools to VS Code Copilot for reading ETL errors and managing Jira tickets.
"""

import json
import configparser
import requests
from mcp.server.fastmcp import FastMCP

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import db
import jira_client as jira
import grouper
import sunsystems_kb as kb

config = configparser.ConfigParser()
config.read(os.path.join(os.path.dirname(__file__), "..", "config", "config.ini"))

COMPANION_PORT = config.get("companion", "port", fallback="3131")
COMPANION_URL  = f"http://localhost:{COMPANION_PORT}/confirm"

mcp = FastMCP("ETL Jira Agent")

db.ensure_tracking_table()


def _build_description(error: dict, resolution: list[str]) -> str:
    occurrences = error.get("occurrences", 1)
    grouped_ids = error.get("grouped_ids", [str(error.get("error_id", ""))])
    lines = [
        f"*Pipeline:*    {error.get('pipeline_name', 'N/A')}",
        f"*Error Time:*  {error.get('error_time', 'N/A')}",
        f"*Source:*      {error.get('source_table', 'N/A')}",
        f"*Occurrences:* {occurrences} (Error IDs: {', '.join(grouped_ids)})",
        "",
        "*Error Message:*",
        "{code}" + str(error.get("error_message", "")) + "{code}",
        "",
        "*Possible Resolution Steps:*",
    ]
    for i, step in enumerate(resolution, 1):
        lines.append(f"{i}. {step}")
    return "\n".join(lines)


def _ask_companion(preview: dict) -> str:
    """
    Send ticket preview to VS Code companion extension and wait for user decision.
    Returns 'yes', 'no', or 'stop'.
    Falls back to 'yes' if companion is not running (headless mode).
    """
    try:
        resp = requests.post(COMPANION_URL, json=preview, timeout=120)
        return resp.json().get("decision", "no")
    except Exception:
        return "yes"


@mcp.tool()
def read_etl_errors() -> str:
    """
    Read ETL error logs from PostgreSQL using the configured query.
    Groups similar errors together to avoid duplicate tickets.
    Returns a summary of new (un-ticketed) errors found.
    """
    raw_errors = db.fetch_errors()
    if not raw_errors:
        return "No ETL errors found matching the configured query."

    grouped = grouper.group_errors(raw_errors)

    new_errors = []
    skipped = 0
    for error in grouped:
        fp = db.make_fingerprint(error)
        existing = db.is_duplicate(fp)
        if existing:
            skipped += 1
        else:
            error["_fingerprint"] = fp
            new_errors.append(error)

    summary = (
        f"Found {len(raw_errors)} total error(s), grouped into {len(grouped)} unique issue(s).\n"
        f"New (no ticket yet): {len(new_errors)}\n"
        f"Already ticketed (skipped): {skipped}\n\n"
    )

    if not new_errors:
        return summary + "All errors already have Jira tickets."

    summary += "New errors ready for ticketing:\n"
    for i, e in enumerate(new_errors, 1):
        summary += (
            f"\n#{i}  [{e.get('pipeline_name')}]  "
            f"x{e.get('occurrences', 1)} occurrence(s)\n"
            f"     {str(e.get('error_message', ''))[:120]}\n"
        )

    summary += f"\nCall create_jira_tickets to process these {len(new_errors)} error(s)."
    return summary


@mcp.tool()
def create_jira_tickets() -> str:
    """
    For each new un-ticketed ETL error:
      1. Shows a preview popup in VS Code (via companion extension).
      2. Waits for user to click Create / Skip / Stop.
      3. Creates the Jira ticket if confirmed.
    Returns a summary of what was created and what was skipped.
    """
    raw_errors = db.fetch_errors()
    if not raw_errors:
        return "No ETL errors found."

    grouped = grouper.group_errors(raw_errors)
    new_errors = [e for e in grouped if not db.is_duplicate(db.make_fingerprint(e))]

    if not new_errors:
        return "All errors already have Jira tickets — nothing to create."

    created, skipped, stopped = [], [], []

    for i, error in enumerate(new_errors):
        fp           = db.make_fingerprint(error)
        kb_info      = kb.lookup(error.get("error_message", ""))
        priority     = kb_info.get("priority") or kb.get_priority_from_config(error.get("error_message", ""), config)
        resolution   = kb_info.get("resolution") or ["Investigate error logs for root cause.", "Re-run pipeline after fix."]
        pipeline     = error.get("pipeline_name", "Unknown Pipeline")
        short_msg    = str(error.get("error_message", ""))[:80]
        title        = f"[{pipeline}] {kb_info.get('kb_title', short_msg)}"
        description  = _build_description(error, resolution)

        preview = {
            "index":       i + 1,
            "total":       len(new_errors),
            "title":       title,
            "priority":    priority,
            "pipeline":    pipeline,
            "error_time":  str(error.get("error_time", "")),
            "occurrences": error.get("occurrences", 1),
            "error_msg":   str(error.get("error_message", ""))[:300],
            "resolution":  resolution,
        }

        decision = _ask_companion(preview)

        if decision == "stop":
            stopped.append(title)
            break
        elif decision == "no":
            skipped.append(title)
            continue

        # Check for related past tickets and link them
        related = jira.find_related_ticket(pipeline)

        jira_key = jira.create_ticket(title, description, priority)
        db.mark_ticketed(fp, jira_key, error)

        for rel in related:
            try:
                jira.link_tickets(jira_key, rel["key"])
            except Exception:
                pass

        created.append(f"{jira_key}: {title}")

    lines = [f"Done processing {len(new_errors)} error group(s).\n"]
    if created:
        lines.append(f"✅ Created {len(created)} ticket(s):")
        lines += [f"   {t}" for t in created]
    if skipped:
        lines.append(f"\n⏭  Skipped {len(skipped)} error(s).")
    if stopped:
        lines.append(f"\n🛑 Stopped early — {len(stopped)} error(s) not processed.")
    return "\n".join(lines)


@mcp.tool()
def read_jira_tickets() -> str:
    """
    Fetch all open ETL Jira tickets and provide Sun Systems–aware analysis
    and resolution suggestions for each one.
    """
    tickets = jira.get_open_tickets()
    if not tickets:
        return f"No open tickets found in Jira project {config['jira']['project_key']}."

    lines = [f"Found {len(tickets)} open ticket(s) in {config['jira']['project_key']}:\n"]

    for t in tickets:
        kb_info    = kb.lookup(t.get("summary", "") + " " + t.get("description", ""))
        resolution = kb_info.get("resolution", ["No specific resolution found in knowledge base. Review error details manually."])

        lines += [
            f"{'─'*60}",
            f"TICKET: {t['key']}  [{t['priority']}]  Status: {t['status']}",
            f"Title:  {t['summary']}",
            f"Created: {t['created'][:10]}",
            "",
            "Possible Resolution Steps:",
        ]
        for i, step in enumerate(resolution, 1):
            lines.append(f"  {i}. {step}")
        lines.append("")

    return "\n".join(lines)


@mcp.tool()
def daily_summary() -> str:
    """
    Show a summary of ETL errors and Jira tickets created today.
    """
    summary_data = db.get_daily_summary()
    open_tickets = jira.get_open_tickets(max_results=100)

    lines = [
        f"ETL Health Report — {__import__('datetime').date.today()}",
        "─" * 45,
        f"Tickets created today : {summary_data.get('tickets_created', 0)}",
        f"First error seen      : {str(summary_data.get('first_seen', 'N/A'))[:19]}",
        f"Last error seen       : {str(summary_data.get('last_seen',  'N/A'))[:19]}",
        f"Total open in Jira    : {len(open_tickets)}",
        "",
    ]

    critical = [t for t in open_tickets if t["priority"] in ("Critical", "Highest")]
    if critical:
        lines.append(f"⚠️  Critical open tickets ({len(critical)}):")
        for t in critical:
            lines.append(f"   {t['key']}: {t['summary']}")

    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run(transport="stdio")

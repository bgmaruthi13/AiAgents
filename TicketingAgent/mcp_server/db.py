import os
import hashlib
import configparser
from datetime import datetime
from typing import Optional
import psycopg2
import psycopg2.extras

config = configparser.ConfigParser()
config.read(os.path.join(os.path.dirname(__file__), "..", "config", "config.ini"))

DB = config["postgresql"]
TRACKING = config["tracking"]
TRACKING_TABLE = f'{TRACKING["schema"]}.{TRACKING["table"]}'


def _connect():
    return psycopg2.connect(
        host=DB["host"],
        port=DB["port"],
        dbname=DB["database"],
        user=DB["user"],
        password=DB["password"],
    )


def ensure_tracking_table():
    """Create tracking table if it doesn't exist. Called once on startup."""
    sql = f"""
        CREATE TABLE IF NOT EXISTS {TRACKING_TABLE} (
            fingerprint   TEXT PRIMARY KEY,
            jira_key      TEXT,
            pipeline_name TEXT,
            error_message TEXT,
            source_table  TEXT,
            created_at    TIMESTAMP DEFAULT NOW()
        );
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def fetch_errors() -> list[dict]:
    """Run the user-configured SQL query and return rows as dicts."""
    query = config["query"]["fetch_errors"]
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def make_fingerprint(error: dict) -> str:
    """MD5 hash of pipeline + error_message to detect duplicates."""
    raw = f"{error.get('pipeline_name', '')}::{error.get('error_message', '')}"
    return hashlib.md5(raw.encode()).hexdigest()


def is_duplicate(fingerprint: str) -> Optional[str]:
    """Return existing jira_key if this error was already ticketed, else None."""
    sql = f"SELECT jira_key FROM {TRACKING_TABLE} WHERE fingerprint = %s"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (fingerprint,))
            row = cur.fetchone()
    return row[0] if row else None


def mark_ticketed(fingerprint: str, jira_key: str, error: dict):
    """Record that a Jira ticket was created for this error fingerprint."""
    sql = f"""
        INSERT INTO {TRACKING_TABLE}
            (fingerprint, jira_key, pipeline_name, error_message, source_table)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (fingerprint) DO UPDATE SET jira_key = EXCLUDED.jira_key;
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (
                fingerprint,
                jira_key,
                error.get("pipeline_name"),
                error.get("error_message"),
                error.get("source_table"),
            ))
        conn.commit()


def get_daily_summary() -> dict:
    """Return counts for today's tracking activity."""
    sql = f"""
        SELECT
            COUNT(*)                                      AS total_ticketed,
            COUNT(*) FILTER (WHERE jira_key IS NOT NULL) AS tickets_created,
            MIN(created_at)                               AS first_seen,
            MAX(created_at)                               AS last_seen
        FROM {TRACKING_TABLE}
        WHERE created_at::date = CURRENT_DATE;
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            row = cur.fetchone()
    return dict(row) if row else {}

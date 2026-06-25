"""
Infor Sun Systems error knowledge base.
Maps known error patterns to resolution steps and priority.
"""

KNOWLEDGE_BASE = [
    {
        "patterns": ["period not open", "accounting period", "period closed", "no open period"],
        "title":    "Sun Systems Accounting Period Not Open",
        "priority": "Critical",
        "resolution": [
            "Log into Sun Systems → Ledger Setup → Period Management",
            "Check that the period for the current posting date is set to OPEN",
            "If closed in error, contact your Sun Systems admin to reopen via System Admin → Period Control",
            "Re-run the ETL interface job after the period is confirmed open",
            "If the period must stay closed, adjust the ETL posting date to an open period",
        ],
    },
    {
        "patterns": ["ledger locked", "ledger in use", "lock timeout"],
        "title":    "Sun Systems Ledger Lock Conflict",
        "priority": "Critical",
        "resolution": [
            "Check Sun Systems → System Admin → Active Sessions for any long-running processes holding the ledger lock",
            "Contact the user/process holding the lock and ask them to complete or cancel their transaction",
            "If the session is stale, use Sun Systems admin tools to kill the orphaned session",
            "Re-run the ETL job once the ledger is unlocked",
            "Consider scheduling ETL jobs outside of peak user hours to avoid lock contention",
        ],
    },
    {
        "patterns": ["gl interface", "general ledger interface", "gl batch", "gl posting"],
        "title":    "Sun Systems GL Interface Failure",
        "priority": "High",
        "resolution": [
            "Check the GL Interface log in Sun Systems → Interfaces → GL Interface Log",
            "Validate that all mandatory fields (account code, cost centre, analysis) are populated in the source data",
            "Verify the chart of accounts mapping in the ETL configuration matches Sun Systems account codes",
            "Check for invalid account combinations or closed account codes",
            "Re-submit the GL batch after correcting the data",
            "If recurring, review the account code mapping table in the ETL pipeline config",
        ],
    },
    {
        "patterns": ["currency revaluation", "exchange rate", "fx rate", "currency conversion"],
        "title":    "Sun Systems Currency / Exchange Rate Error",
        "priority": "High",
        "resolution": [
            "Verify that exchange rates for the relevant currency pair are loaded in Sun Systems → Currency → Exchange Rates",
            "Check the rate date — ensure rates cover the transaction date range",
            "If rates are missing, load them via Sun Systems → Currency Maintenance before re-running",
            "Confirm the ETL is using the correct rate type (SPOT, AVERAGE, BUDGET)",
            "Check Sun Systems → System Parameters for the base currency setting",
        ],
    },
    {
        "patterns": ["intercompany", "inter-company", "ic transaction", "interco"],
        "title":    "Sun Systems Intercompany Transaction Error",
        "priority": "High",
        "resolution": [
            "Verify intercompany relationships are configured in Sun Systems → Intercompany Setup",
            "Check that both entities (source and target) are active and have open periods",
            "Validate that intercompany account codes are mapped correctly in the ETL pipeline",
            "Ensure the elimination entries balance (debits = credits across entities)",
            "Re-run after confirming intercompany configuration is complete",
        ],
    },
    {
        "patterns": ["authentication failed", "login failed", "invalid credentials", "access denied"],
        "title":    "Sun Systems Authentication / Access Failure",
        "priority": "Critical",
        "resolution": [
            "Verify the service account credentials used by the ETL are still valid in Sun Systems",
            "Check if the Sun Systems service account password has expired — reset if needed",
            "Confirm the service account has the required roles/permissions for the interface being run",
            "Check Sun Systems → Security → User Maintenance for account status",
            "Update credentials in the ETL configuration if they have changed",
        ],
    },
    {
        "patterns": ["database down", "connection refused", "cannot connect", "db connection"],
        "title":    "Database Connectivity Failure",
        "priority": "Critical",
        "resolution": [
            "Verify the Sun Systems database server is running and reachable from the ETL server",
            "Check network connectivity: ping the DB host and test the port (default 1521 for Oracle, 1433 for SQL Server)",
            "Review DB server logs for any shutdown or crash events",
            "Check if connection pool is exhausted — review max_connections setting",
            "Restart the ETL service after DB connectivity is restored",
        ],
    },
    {
        "patterns": ["timeout", "timed out", "query timeout"],
        "title":    "ETL Query / Connection Timeout",
        "priority": "High",
        "resolution": [
            "Check for long-running queries blocking the ETL on the Sun Systems DB",
            "Review DB performance — look for missing indexes on large interface tables",
            "Increase the timeout threshold in the ETL connection config if the load is expected to be heavy",
            "Check if concurrent ETL jobs are competing for the same DB resources",
            "Consider breaking large batch jobs into smaller chunks to avoid timeout",
        ],
    },
    {
        "patterns": ["report failed", "report extract", "ssrs", "crystal report"],
        "title":    "Sun Systems Report Extraction Failure",
        "priority": "Medium",
        "resolution": [
            "Check the report parameters — date ranges, entity filters, and cost centre selections",
            "Verify the report data source connection to Sun Systems is active",
            "Review Sun Systems report logs for any data validation errors",
            "Confirm the user running the report has access to the required data sets",
            "Re-run the report with a smaller date range to isolate the issue",
        ],
    },
    {
        "patterns": ["file not found", "missing file", "file does not exist", "path not found"],
        "title":    "ETL Source File Not Found",
        "priority": "Medium",
        "resolution": [
            "Check the expected file path in the ETL pipeline configuration",
            "Verify the upstream process (SFTP, file drop, API export) completed successfully",
            "Check file transfer logs for any errors during delivery",
            "Confirm the file naming convention matches what the ETL expects",
            "Manually place the file in the correct location and re-trigger the ETL job",
        ],
    },
    {
        "patterns": ["archive", "archiving", "purge", "data retention"],
        "title":    "ETL Archive / Purge Warning",
        "priority": "Low",
        "resolution": [
            "Review the archiving policy configuration in the ETL pipeline",
            "Confirm available disk space on the archive target",
            "Check archive job logs for any permission or path errors",
            "If purge is premature, update the data retention window in ETL config",
        ],
    },
]


def lookup(error_message: str) -> dict:
    """
    Match an error message against the knowledge base.
    Returns resolution steps and priority if matched, else empty dict.
    """
    msg = error_message.lower()
    for entry in KNOWLEDGE_BASE:
        if any(p in msg for p in entry["patterns"]):
            return {
                "kb_title":    entry["title"],
                "priority":    entry["priority"],
                "resolution":  entry["resolution"],
            }
    return {}


def get_priority_from_config(error_message: str, config) -> str:
    """
    Fallback priority from config.ini [priority] keyword lists
    when no KB match is found.
    """
    msg = error_message.lower()
    priority_map = {
        "Critical": config.get("priority", "critical", fallback="").split(","),
        "High":     config.get("priority", "high",     fallback="").split(","),
        "Medium":   config.get("priority", "medium",   fallback="").split(","),
        "Low":      config.get("priority", "low",      fallback="").split(","),
    }
    for level, keywords in priority_map.items():
        if any(k.strip().lower() in msg for k in keywords if k.strip()):
            return level
    return "Medium"

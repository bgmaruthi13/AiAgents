import os
import configparser
import requests
from requests.auth import HTTPBasicAuth

config = configparser.ConfigParser()
config.read(os.path.join(os.path.dirname(__file__), "..", "config", "config.ini"))

JIRA = config["jira"]
BASE_URL = JIRA["url"].rstrip("/")
AUTH = HTTPBasicAuth(JIRA["username"], JIRA["password"])
PROJECT = JIRA["project_key"]
ISSUE_TYPE = JIRA["issue_type"]
HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}


def _api(path: str) -> str:
    return f"{BASE_URL}/rest/api/2{path}"


def create_ticket(title: str, description: str, priority: str) -> str:
    """Create a Jira issue and return the issue key (e.g. ETL-123)."""
    payload = {
        "fields": {
            "project":     {"key": PROJECT},
            "summary":     title,
            "description": description,
            "issuetype":   {"name": ISSUE_TYPE},
            "priority":    {"name": priority},
            "labels":      ["ETL", "SunSystems", "auto-created"],
        }
    }
    resp = requests.post(_api("/issue"), json=payload, auth=AUTH, headers=HEADERS)
    resp.raise_for_status()
    return resp.json()["key"]


def get_open_tickets(max_results: int = 50) -> list[dict]:
    """Fetch open tickets from the configured Jira project."""
    jql = (
        f'project = "{PROJECT}" '
        f'AND status in ("Open", "To Do", "In Progress", "Reopened") '
        f'ORDER BY created DESC'
    )
    params = {
        "jql":        jql,
        "maxResults": max_results,
        "fields":     "summary,description,status,priority,created,labels",
    }
    resp = requests.get(_api("/search"), params=params, auth=AUTH, headers=HEADERS)
    resp.raise_for_status()
    issues = resp.json().get("issues", [])
    return [
        {
            "key":         i["key"],
            "summary":     i["fields"]["summary"],
            "description": i["fields"].get("description", ""),
            "status":      i["fields"]["status"]["name"],
            "priority":    i["fields"]["priority"]["name"],
            "created":     i["fields"]["created"],
        }
        for i in issues
    ]


def find_related_ticket(title_keywords: str) -> list[dict]:
    """Search Jira (open + closed) for tickets matching keywords."""
    jql = f'project = "{PROJECT}" AND summary ~ "{title_keywords}" ORDER BY created DESC'
    params = {"jql": jql, "maxResults": 5, "fields": "summary,status,key"}
    resp = requests.get(_api("/search"), params=params, auth=AUTH, headers=HEADERS)
    resp.raise_for_status()
    return [
        {"key": i["key"], "summary": i["fields"]["summary"], "status": i["fields"]["status"]["name"]}
        for i in resp.json().get("issues", [])
    ]


def link_tickets(from_key: str, to_key: str, link_type: str = "relates to"):
    """Link two Jira tickets as related issues."""
    payload = {
        "type":         {"name": link_type},
        "inwardIssue":  {"key": from_key},
        "outwardIssue": {"key": to_key},
    }
    resp = requests.post(_api("/issueLink"), json=payload, auth=AUTH, headers=HEADERS)
    resp.raise_for_status()


def reopen_ticket(issue_key: str, comment: str):
    """Add a comment to a closed ticket noting the error recurred, then reopen it."""
    comment_payload = {"body": f"⚠️ This error has recurred.\n\n{comment}"}
    requests.post(_api(f"/issue/{issue_key}/comment"), json=comment_payload, auth=AUTH, headers=HEADERS)

    transitions_resp = requests.get(_api(f"/issue/{issue_key}/transitions"), auth=AUTH, headers=HEADERS)
    transitions_resp.raise_for_status()
    reopen_id = next(
        (t["id"] for t in transitions_resp.json()["transitions"] if "reopen" in t["name"].lower()),
        None,
    )
    if reopen_id:
        requests.post(
            _api(f"/issue/{issue_key}/transitions"),
            json={"transition": {"id": reopen_id}},
            auth=AUTH,
            headers=HEADERS,
        )

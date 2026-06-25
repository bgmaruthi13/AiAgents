"""
Groups similar ETL errors together so we raise one Jira ticket
instead of flooding Jira with dozens of near-identical issues.
"""

import re
from collections import defaultdict


def _normalize(text: str) -> str:
    """Strip dynamic values (IDs, timestamps, line numbers) to get a stable signature."""
    text = text.lower()
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}(t\d{2}:\d{2}:\d{2})?\b", "<DATE>", text)
    text = re.sub(r"\b\d+\b", "<N>", text)
    text = re.sub(r"'[^']*'", "<VAL>", text)
    text = re.sub(r'"[^"]*"', "<VAL>", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def group_errors(errors: list[dict]) -> list[dict]:
    """
    Cluster errors by (pipeline_name, normalised error signature).
    Returns one representative error per group with an added 'occurrences' count
    and 'grouped_ids' list so the Jira ticket can mention all affected error IDs.
    """
    groups: dict[str, list[dict]] = defaultdict(list)

    for error in errors:
        pipeline = error.get("pipeline_name", "unknown")
        signature = _normalize(error.get("error_message", ""))
        key = f"{pipeline}::{signature}"
        groups[key].append(error)

    result = []
    for key, members in groups.items():
        representative = dict(members[0])
        representative["occurrences"]  = len(members)
        representative["grouped_ids"]  = [str(e.get("error_id", "")) for e in members]
        representative["all_messages"] = list({e.get("error_message", "") for e in members})
        result.append(representative)

    return result

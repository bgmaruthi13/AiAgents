import * as vscode from 'vscode';
import { AdoConfig } from '../config';
import { getSprintWorkItems, patchWorkItem, WorkItem } from '../adoClient';

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

export async function runPokerPlanning(
  cfg: AdoConfig,
  model: vscode.LanguageModelChat,
  stream: vscode.ChatResponseStream
): Promise<void> {
  stream.markdown(`## 🃏 Poker Planning — ${cfg.sprintName}\n\n`);
  stream.markdown(`Fetching stories for estimation...\n\n`);

  const stories = await getSprintWorkItems(cfg, 'User Story');
  if (!stories.length) {
    stream.markdown(`> No User Stories found in **${cfg.iterationPath}**`);
    return;
  }

  stream.markdown(`| # | Title | Suggested Points | Risk | Reason |\n`);
  stream.markdown(`|---|-------|-----------------|------|--------|\n`);

  let highRiskCount = 0;

  for (const story of stories) {
    const prompt = buildEstimationPrompt(story);
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let raw = '';
    for await (const chunk of response.text) { raw += chunk; }

    const result = parseEstimation(raw);
    const riskIcon = result.risk === 'HIGH' ? '🔴 High' : result.risk === 'MEDIUM' ? '🟡 Med' : '🟢 Low';

    stream.markdown(`| #${story.id} | ${story.title} | **${result.points}** | ${riskIcon} | ${result.reason} |\n`);

    const ops = [
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: result.points },
    ];
    if (result.risk === 'HIGH') {
      highRiskCount++;
      ops.push({ op: 'add', path: '/fields/System.Tags', value: `${story.tags}; Risk-High`.replace(/^; /, '') });
    }
    await patchWorkItem(cfg, story.id, ops);
  }

  stream.markdown(`\n---\n`);
  stream.markdown(`✅ **Estimation complete** — ${stories.length} stories updated`);
  if (highRiskCount > 0) {
    stream.markdown(` · ⚠️ **${highRiskCount} high-risk items** flagged — review before committing to sprint.`);
  }
}

function buildEstimationPrompt(story: WorkItem): string {
  return `You are an experienced Scrum Master running Planning Poker.

USER STORY #${story.id}
Title: ${story.title}
Description: ${story.description || '(empty)'}
Acceptance Criteria: ${story.acceptanceCriteria || '(empty)'}
Current Story Points: ${story.storyPoints || 'not estimated'}

Fibonacci scale: 1, 2, 3, 5, 8, 13, 21

Analyse complexity, uncertainty, and effort. Respond in this exact format:
POINTS: <single fibonacci number>
RISK: <LOW|MEDIUM|HIGH>
REASON: <one sentence explaining the estimate>`;
}

function parseEstimation(raw: string): { points: number; risk: string; reason: string } {
  const points = parseInt(raw.match(/POINTS:\s*(\d+)/)?.[1] ?? '5');
  const risk = raw.match(/RISK:\s*(LOW|MEDIUM|HIGH)/)?.[1] ?? 'MEDIUM';
  const reason = raw.match(/REASON:\s*(.+)/)?.[1]?.trim() ?? 'No reason provided';
  const validPoint = FIBONACCI.includes(points) ? points : 5;
  return { points: validPoint, risk, reason };
}

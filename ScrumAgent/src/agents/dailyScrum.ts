import * as vscode from 'vscode';
import { AdoConfig } from '../config';
import { getSprintWorkItems, getBlockedItems } from '../adoClient';

export async function runDailyScrum(
  cfg: AdoConfig,
  model: vscode.LanguageModelChat,
  stream: vscode.ChatResponseStream
): Promise<void> {
  stream.markdown(`## ☀️ Daily Scrum — ${cfg.sprintName}\n`);
  stream.markdown(`_${new Date().toDateString()}_\n\n`);

  const [allStories, blocked] = await Promise.all([
    getSprintWorkItems(cfg, 'User Story'),
    getBlockedItems(cfg),
  ]);

  const done = allStories.filter(s => s.state === 'Done').length;
  const inProgress = allStories.filter(s => s.state === 'In Progress').length;
  const todo = allStories.filter(s => s.state === 'New' || s.state === 'To Do').length;
  const totalPoints = allStories.reduce((s, x) => s + x.storyPoints, 0);
  const donePoints = allStories.filter(s => s.state === 'Done').reduce((s, x) => s + x.storyPoints, 0);

  stream.markdown(`### Sprint Progress\n`);
  stream.markdown(`| Status | Count | Story Points |\n|--------|-------|--------------|\n`);
  stream.markdown(`| ✅ Done | ${done} | ${donePoints} pts |\n`);
  stream.markdown(`| 🔄 In Progress | ${inProgress} | — |\n`);
  stream.markdown(`| 📋 To Do | ${todo} | — |\n`);
  stream.markdown(`| **Total** | **${allStories.length}** | **${totalPoints} pts** |\n\n`);

  if (blocked.length > 0) {
    stream.markdown(`### 🔴 Blockers (${blocked.length})\n`);
    for (const item of blocked) {
      stream.markdown(`- **#${item.id}** ${item.title} *(${item.assignedTo})*\n`);
    }
    stream.markdown(`\n`);
  } else {
    stream.markdown(`### ✅ No blockers today\n\n`);
  }

  const prompt = buildStandupPrompt(allStories.slice(0, 10), blocked, done, inProgress);
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

  stream.markdown(`### 📣 Standup Summary\n`);
  for await (const chunk of response.text) {
    stream.markdown(chunk);
  }

  stream.markdown(`\n\n---\n_Copy this summary to your Teams standup channel._`);
}

import { WorkItem } from '../adoClient';

function buildStandupPrompt(stories: WorkItem[], blocked: WorkItem[], done: number, inProgress: number): string {
  return `You are a Scrum Master writing a concise daily standup summary for the team.

Sprint data:
- Stories Done: ${done}
- Stories In Progress: ${inProgress}
- Blocked items: ${blocked.map(b => `#${b.id} ${b.title}`).join(', ') || 'none'}

Active stories:
${stories.map(s => `- #${s.id} [${s.state}] ${s.title} (${s.assignedTo})`).join('\n')}

Write a short standup summary (3-5 bullet points) covering:
• What was completed yesterday
• What is in progress today
• Any blockers that need attention

Keep it professional and under 100 words.`;
}

import * as vscode from 'vscode';
import { AdoConfig } from '../config';
import { getSprintWorkItems, getCompletedStories, createChildTask } from '../adoClient';

export async function runRetrospective(
  cfg: AdoConfig,
  model: vscode.LanguageModelChat,
  stream: vscode.ChatResponseStream
): Promise<void> {
  stream.markdown(`## 🔄 Retrospective — ${cfg.sprintName}\n\n`);
  stream.markdown(`Analysing sprint data...\n\n`);

  const [allStories, completed] = await Promise.all([
    getSprintWorkItems(cfg, 'User Story'),
    getCompletedStories(cfg),
  ]);

  const totalPoints = allStories.reduce((s, x) => s + x.storyPoints, 0);
  const completedPoints = completed.reduce((s, x) => s + x.storyPoints, 0);
  const velocity = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
  const incomplete = allStories.filter(s => s.state !== 'Done');

  stream.markdown(`### Sprint Metrics\n`);
  stream.markdown(`| Metric | Value |\n|--------|-------|\n`);
  stream.markdown(`| Total Stories | ${allStories.length} |\n`);
  stream.markdown(`| Completed | ${completed.length} |\n`);
  stream.markdown(`| Incomplete | ${incomplete.length} |\n`);
  stream.markdown(`| Planned Points | ${totalPoints} |\n`);
  stream.markdown(`| Completed Points | ${completedPoints} |\n`);
  stream.markdown(`| Velocity | **${velocity}%** |\n\n`);

  if (incomplete.length > 0) {
    stream.markdown(`### Stories Carried Over\n`);
    for (const s of incomplete) {
      stream.markdown(`- #${s.id} ${s.title} *(${s.state})*\n`);
    }
    stream.markdown(`\n`);
  }

  const prompt = buildRetroPrompt(allStories, completed, incomplete, velocity);
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

  let retroText = '';
  stream.markdown(`### 📝 Retrospective Report\n`);
  for await (const chunk of response.text) {
    retroText += chunk;
    stream.markdown(chunk);
  }

  // Create improvement work items in ADO from retro findings
  const improvements = extractImprovements(retroText);
  if (improvements.length > 0) {
    stream.markdown(`\n\n### ✅ Improvement Items Added to Backlog\n`);
    for (const imp of improvements) {
      const id = await createChildTask(cfg, 0, `[Retro] ${imp}`, `Improvement action from ${cfg.sprintName} retrospective`, 0, 'Retro; Improvement');
      stream.markdown(`- #${id} ${imp}\n`);
      void id;
    }
  }
}

import { WorkItem } from '../adoClient';

function buildRetroPrompt(all: WorkItem[], done: WorkItem[], incomplete: WorkItem[], velocity: number): string {
  return `You are a Scrum Master facilitating a sprint retrospective.

Sprint: velocity ${velocity}%
Completed: ${done.map(s => s.title).join(', ') || 'none'}
Incomplete: ${incomplete.map(s => s.title).join(', ') || 'none'}

Write a retrospective report with these sections:
## What Went Well
(3 bullet points)

## What Could Be Improved
(3 bullet points)

## Action Items
(2-3 specific, actionable improvements for next sprint — prefix each with "ACTION:")

Keep it honest, constructive and under 200 words.`;
}

function extractImprovements(retroText: string): string[] {
  const lines = retroText.split('\n');
  return lines
    .filter(l => l.trim().startsWith('ACTION:'))
    .map(l => l.replace(/^ACTION:\s*/i, '').trim())
    .slice(0, 3);
}

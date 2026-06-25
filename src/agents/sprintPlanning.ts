import * as vscode from 'vscode';
import { AdoConfig } from '../config';
import { getSprintWorkItems, createChildTask, WorkItem } from '../adoClient';

const SDLC_PHASES = ['Design', 'Backend Dev', 'Frontend Dev', 'Unit Testing', 'QA Integration', 'Documentation', 'Deployment'];

export async function runSprintPlanning(
  cfg: AdoConfig,
  model: vscode.LanguageModelChat,
  stream: vscode.ChatResponseStream
): Promise<void> {
  stream.markdown(`## 🗓️ Sprint Planning — ${cfg.sprintName}\n\n`);
  stream.markdown(`Fetching User Stories...\n\n`);

  const stories = await getSprintWorkItems(cfg, 'User Story');
  if (!stories.length) {
    stream.markdown(`> No User Stories found in **${cfg.iterationPath}**`);
    return;
  }

  const totalPoints = stories.reduce((s, x) => s + x.storyPoints, 0);
  stream.markdown(`Found **${stories.length} stories** · **${totalPoints} total story points**\n\n`);
  stream.markdown(`Generating SDLC child tasks for each story...\n\n---\n\n`);

  let totalTasks = 0;

  for (const story of stories) {
    stream.markdown(`### #${story.id} — ${story.title} *(${story.storyPoints} pts)*\n`);

    const prompt = buildSDLCPrompt(story);
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let raw = '';
    for await (const chunk of response.text) { raw += chunk; }

    const tasks = parseSDLCTasks(raw);
    stream.markdown(`| Phase | Task Title | Hours |\n|-------|-----------|-------|\n`);

    for (const task of tasks) {
      const childId = await createChildTask(
        cfg,
        story.id,
        `[${task.phase}] ${task.title}`,
        task.description,
        task.hours,
        `SDLC; ${task.phase}`
      );
      stream.markdown(`| ${task.phase} | ${task.title} | ${task.hours}h |\n`);
      totalTasks++;
      void childId;
    }

    const totalHours = tasks.reduce((s, t) => s + t.hours, 0);
    stream.markdown(`\n✅ **${tasks.length} tasks created** · ${totalHours}h total · linked to #${story.id}\n\n---\n\n`);
  }

  stream.markdown(`\n🎉 **Sprint Planning complete** — ${totalTasks} SDLC tasks created across ${stories.length} stories.`);
}

function buildSDLCPrompt(story: WorkItem): string {
  const targetHours = (story.storyPoints || 5) * 6;
  return `You are a senior Scrum Master creating SDLC child tasks for a User Story.

USER STORY #${story.id}
Title: ${story.title}
Description: ${story.description || '(not provided)'}
Acceptance Criteria: ${story.acceptanceCriteria || '(not provided)'}
Story Points: ${story.storyPoints} (target ~${targetHours} total hours)

Available SDLC phases: ${SDLC_PHASES.join(', ')}

Rules:
- Only include phases relevant to this specific story
- Task titles must be specific to THIS story, not generic
- Descriptions must reference the actual ACs where applicable
- Total estimated hours should be close to ${targetHours}h

Respond as a JSON array only, no markdown:
[
  { "phase": "Design", "title": "...", "description": "...", "hours": 4 },
  { "phase": "Backend Dev", "title": "...", "description": "...", "hours": 8 }
]`;
}

interface SDLCTask { phase: string; title: string; description: string; hours: number }

function parseSDLCTasks(raw: string): SDLCTask[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackTasks();
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return fallbackTasks();
    return parsed.map((t) => ({
      phase: t.phase ?? 'Development',
      title: t.title ?? 'Task',
      description: t.description ?? '',
      hours: Number(t.hours ?? 4),
    }));
  } catch {
    return fallbackTasks();
  }
}

function fallbackTasks(): SDLCTask[] {
  return [
    { phase: 'Design', title: 'Design solution', description: 'Design the technical approach', hours: 4 },
    { phase: 'Backend Dev', title: 'Implement backend', description: 'Implement backend logic', hours: 8 },
    { phase: 'Unit Testing', title: 'Write unit tests', description: 'Write unit tests for backend logic', hours: 4 },
    { phase: 'QA Integration', title: 'QA testing', description: 'Integration and regression testing', hours: 4 },
  ];
}

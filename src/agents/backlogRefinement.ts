import * as vscode from 'vscode';
import { AdoConfig } from '../config';
import { getSprintWorkItems, patchWorkItem, WorkItem } from '../adoClient';

export async function runBacklogRefinement(
  cfg: AdoConfig,
  model: vscode.LanguageModelChat,
  stream: vscode.ChatResponseStream
): Promise<void> {
  stream.markdown(`## 📋 Backlog Refinement — ${cfg.sprintName}\n\n`);
  stream.markdown(`Fetching User Stories from Azure DevOps...\n\n`);

  const stories = await getSprintWorkItems(cfg, 'User Story');
  if (!stories.length) {
    stream.markdown(`> No User Stories found in **${cfg.iterationPath}**`);
    return;
  }

  stream.markdown(`Found **${stories.length}** stories. Refining each one...\n\n---\n\n`);

  for (const story of stories) {
    stream.markdown(`### #${story.id} — ${story.title}\n`);

    const prompt = buildRefinementPrompt(story);
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let refined = '';
    for await (const chunk of response.text) {
      refined += chunk;
    }

    const parsed = parseRefinedOutput(refined);
    stream.markdown(`**Refined Description:**\n${parsed.description}\n\n`);
    stream.markdown(`**Acceptance Criteria:**\n${parsed.acceptanceCriteria}\n\n`);

    // Write back to ADO
    await patchWorkItem(cfg, story.id, [
      { op: 'add', path: '/fields/System.Description', value: parsed.description },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: parsed.acceptanceCriteria },
    ]);
    stream.markdown(`✅ Updated in Azure DevOps\n\n---\n\n`);
  }

  stream.markdown(`\n🎉 **Backlog Refinement complete** — ${stories.length} stories updated.`);
}

function buildRefinementPrompt(story: WorkItem): string {
  return `You are a senior Scrum Master refining a User Story for the development team.

USER STORY #${story.id}
Title: ${story.title}
Current Description: ${story.description || '(empty)'}
Current Acceptance Criteria: ${story.acceptanceCriteria || '(empty)'}

Tasks:
1. Rewrite the Description clearly in "As a [user], I want [goal], so that [benefit]" format if not already.
2. Write detailed, testable Acceptance Criteria using "Given / When / Then" format. Minimum 3 criteria.
3. Keep it concise and actionable for developers.

Respond in this exact format:
DESCRIPTION:
<rewritten description>

ACCEPTANCE_CRITERIA:
<given/when/then criteria, one per line starting with •>`;
}

function parseRefinedOutput(raw: string): { description: string; acceptanceCriteria: string } {
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]*?)ACCEPTANCE_CRITERIA:/);
  const acMatch = raw.match(/ACCEPTANCE_CRITERIA:\s*([\s\S]*)/);
  return {
    description: descMatch?.[1]?.trim() ?? raw,
    acceptanceCriteria: acMatch?.[1]?.trim() ?? '',
  };
}

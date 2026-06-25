import * as vscode from 'vscode';
import * as path from 'path';
import { loadConfig, resetConfig } from './config';
import { runBacklogRefinement } from './agents/backlogRefinement';
import { runPokerPlanning } from './agents/pokerPlanning';
import { runSprintPlanning } from './agents/sprintPlanning';
import { runDailyScrum } from './agents/dailyScrum';
import { runRetrospective } from './agents/retrospective';
import { runReleaseNotes } from './agents/releaseNotes';

export function activate(context: vscode.ExtensionContext) {
  const agent = vscode.chat.createChatParticipant('able.ScrumAgent', async (request, _ctx, stream, token) => {
    // Reload config each time so user can edit config.ini without restarting
    resetConfig();

    let cfg;
    try {
      cfg = loadConfig(context.extensionPath);
    } catch (err: unknown) {
      stream.markdown(`❌ **Configuration Error**\n\n${(err as Error).message}\n\n`);
      stream.markdown(`Please update **config.ini** at:\n\`${path.join(context.extensionPath, '..', 'config.ini')}\``);
      return;
    }

    // Select model — prefer gpt-4o, fall back to any available
    const [model] = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: 'gpt-4o',
    });

    if (!model) {
      stream.markdown(`❌ No language model available. Make sure GitHub Copilot is signed in.`);
      return;
    }

    void token;

    try {
      switch (request.command) {
        case 'BacklogRefinement':
          await runBacklogRefinement(cfg.ado, model, stream);
          break;

        case 'PokerPlanning':
          await runPokerPlanning(cfg.ado, model, stream);
          break;

        case 'SprintPlanning':
          await runSprintPlanning(cfg.ado, model, stream);
          break;

        case 'DailyScrum':
          await runDailyScrum(cfg.ado, model, stream);
          break;

        case 'Retrospective':
          await runRetrospective(cfg.ado, model, stream);
          break;

        case 'ReleaseNotes': {
          const version = request.prompt?.trim() || undefined;
          await runReleaseNotes(cfg.ado, model, stream, version);
          break;
        }

        default:
          showHelp(stream, cfg.ado.sprintName, cfg.ado.iterationPath);
      }
    } catch (err: unknown) {
      const msg = (err as Error).message ?? String(err);
      stream.markdown(`\n\n❌ **Error:** ${msg}`);
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        stream.markdown(`\n\n> Your PAT token may be expired or missing required scopes.\n> Needs: **Work Items (Read & Write)**, **Code (Read)**`);
      }
    }
  });

  agent.iconPath = new vscode.ThemeIcon('organization');
  context.subscriptions.push(agent);
}

function showHelp(stream: vscode.ChatResponseStream, sprintName: string, iterationPath: string) {
  stream.markdown(`## 👋 Able ScrumAgent\n\n`);
  stream.markdown(`**Active Sprint:** ${sprintName}\n`);
  stream.markdown(`**Iteration:** \`${iterationPath}\`\n\n`);
  stream.markdown(`### Available Commands\n\n`);
  stream.markdown(`| Command | Description |\n|---------|-------------|\n`);
  stream.markdown(`| \`@ScrumAgent /BacklogRefinement\` | Refine stories + write Acceptance Criteria |\n`);
  stream.markdown(`| \`@ScrumAgent /PokerPlanning\` | Suggest story points + flag risk |\n`);
  stream.markdown(`| \`@ScrumAgent /SprintPlanning\` | Assign sprint + create SDLC child tasks |\n`);
  stream.markdown(`| \`@ScrumAgent /DailyScrum\` | Generate standup summary + surface blockers |\n`);
  stream.markdown(`| \`@ScrumAgent /Retrospective\` | Draft retro report + create improvement items |\n`);
  stream.markdown(`| \`@ScrumAgent /ReleaseNotes [v1.0]\` | Generate release notes from completed stories |\n`);
  stream.markdown(`\n_Tip: Type \`@ScrumAgent /\` and press **Tab** to see all commands._`);
}

export function deactivate() {}

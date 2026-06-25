import * as fs from 'fs';
import * as path from 'path';
import * as ini from 'ini';

export interface AdoConfig {
  orgUrl: string;
  org: string;
  project: string;
  team: string;
  iterationPath: string;
  sprintName: string;
  pat: string;
  authHeader: string;
}

export interface AppConfig {
  ado: AdoConfig;
  openai: { endpoint: string; deployment: string; key: string };
}

let cached: AppConfig | null = null;

export function loadConfig(extensionPath: string): AppConfig {
  if (cached) return cached;

  const iniPath = path.join(extensionPath, '..', 'config.ini');
  if (!fs.existsSync(iniPath)) {
    throw new Error(`config.ini not found at ${iniPath}. Please add it alongside the extension folder.`);
  }

  const raw = ini.parse(fs.readFileSync(iniPath, 'utf-8'));
  const sprintUrl: string = raw['azure_devops']?.sprint_url ?? '';
  const pat: string = raw['azure_devops']?.pat ?? '';

  if (!sprintUrl || sprintUrl.includes('YOUR_ORG')) {
    throw new Error('Please set your sprint_url in config.ini before using @ScrumAgent.');
  }
  if (!pat || pat === 'YOUR_PAT_TOKEN_HERE') {
    throw new Error('Please set your PAT token in config.ini before using @ScrumAgent.');
  }

  // Parse: https://dev.azure.com/{org}/{project}/_sprints/taskboard/{team}/{sprint}
  const match = sprintUrl.match(
    /https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_sprints\/taskboard\/([^/]+)\/(.+)/
  );
  if (!match) {
    throw new Error('sprint_url format not recognised. Expected: https://dev.azure.com/org/project/_sprints/taskboard/team/SprintName');
  }

  const [, org, project, team, rawSprint] = match;
  const sprintName = decodeURIComponent(rawSprint);
  const iterationPath = `${project}\\${sprintName}`;

  cached = {
    ado: {
      orgUrl: `https://dev.azure.com/${org}`,
      org,
      project,
      team,
      iterationPath,
      sprintName,
      pat,
      authHeader: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    },
    openai: {
      endpoint: raw['openai']?.endpoint ?? '',
      deployment: raw['openai']?.deployment ?? 'gpt-4o',
      key: raw['openai']?.key ?? '',
    },
  };

  return cached;
}

export function resetConfig() {
  cached = null;
}

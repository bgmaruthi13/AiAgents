import axios from 'axios';
import { AdoConfig } from './config';

export interface WorkItem {
  id: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  storyPoints: number;
  state: string;
  assignedTo: string;
  iterationPath: string;
  tags: string;
  workItemType: string;
}

function headers(cfg: AdoConfig) {
  return { Authorization: cfg.authHeader, 'Content-Type': 'application/json' };
}

function patchHeaders(cfg: AdoConfig) {
  return { Authorization: cfg.authHeader, 'Content-Type': 'application/json-patch+json' };
}

export async function getSprintWorkItems(cfg: AdoConfig, type = 'User Story'): Promise<WorkItem[]> {
  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.TeamProject] = '${cfg.project}'
            AND [System.IterationPath] = '${cfg.iterationPath}'
            AND [System.WorkItemType] = '${type}'
            ORDER BY [Microsoft.VSTS.Common.Priority] ASC`,
  };
  const wiqlRes = await axios.post(
    `${cfg.orgUrl}/${cfg.project}/_apis/wit/wiql?api-version=7.1`,
    wiql,
    { headers: headers(cfg) }
  );

  const ids: number[] = wiqlRes.data.workItems.map((w: { id: number }) => w.id);
  if (!ids.length) return [];

  const detailRes = await axios.get(
    `${cfg.orgUrl}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=7.1`,
    { headers: headers(cfg) }
  );

  return detailRes.data.value.map(mapWorkItem);
}

export async function getBlockedItems(cfg: AdoConfig): Promise<WorkItem[]> {
  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.TeamProject] = '${cfg.project}'
            AND [System.IterationPath] = '${cfg.iterationPath}'
            AND [System.Tags] CONTAINS 'Blocked'
            AND [System.State] <> 'Done'`,
  };
  const res = await axios.post(
    `${cfg.orgUrl}/${cfg.project}/_apis/wit/wiql?api-version=7.1`,
    wiql,
    { headers: headers(cfg) }
  );
  const ids: number[] = res.data.workItems.map((w: { id: number }) => w.id);
  if (!ids.length) return [];
  const detail = await axios.get(
    `${cfg.orgUrl}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=7.1`,
    { headers: headers(cfg) }
  );
  return detail.data.value.map(mapWorkItem);
}

export async function patchWorkItem(cfg: AdoConfig, id: number, ops: object[]): Promise<void> {
  await axios.patch(
    `${cfg.orgUrl}/_apis/wit/workitems/${id}?api-version=7.1`,
    ops,
    { headers: patchHeaders(cfg) }
  );
}

export async function createChildTask(
  cfg: AdoConfig,
  parentId: number,
  title: string,
  description: string,
  estimatedHours: number,
  tags: string
): Promise<number> {
  const ops = [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/System.Description', value: description },
    { op: 'add', path: '/fields/System.IterationPath', value: cfg.iterationPath },
    { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: estimatedHours },
    { op: 'add', path: '/fields/System.Tags', value: tags },
    {
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `${cfg.orgUrl}/_apis/wit/workitems/${parentId}`,
      },
    },
  ];
  const res = await axios.post(
    `${cfg.orgUrl}/${cfg.project}/_apis/wit/workitems/$Task?api-version=7.1`,
    ops,
    { headers: patchHeaders(cfg) }
  );
  return res.data.id;
}

export async function getCompletedStories(cfg: AdoConfig): Promise<WorkItem[]> {
  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.TeamProject] = '${cfg.project}'
            AND [System.IterationPath] = '${cfg.iterationPath}'
            AND [System.WorkItemType] = 'User Story'
            AND [System.State] = 'Done'`,
  };
  const res = await axios.post(
    `${cfg.orgUrl}/${cfg.project}/_apis/wit/wiql?api-version=7.1`,
    wiql,
    { headers: headers(cfg) }
  );
  const ids: number[] = res.data.workItems.map((w: { id: number }) => w.id);
  if (!ids.length) return [];
  const detail = await axios.get(
    `${cfg.orgUrl}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=7.1`,
    { headers: headers(cfg) }
  );
  return detail.data.value.map(mapWorkItem);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWorkItem(item: any): WorkItem {
  const f = item.fields;
  return {
    id: item.id,
    title: f['System.Title'] ?? '',
    description: stripHtml(f['System.Description'] ?? ''),
    acceptanceCriteria: stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? ''),
    storyPoints: Number(f['Microsoft.VSTS.Scheduling.StoryPoints'] ?? 0),
    state: f['System.State'] ?? '',
    assignedTo: f['System.AssignedTo']?.displayName ?? f['System.AssignedTo'] ?? 'Unassigned',
    iterationPath: f['System.IterationPath'] ?? '',
    tags: f['System.Tags'] ?? '',
    workItemType: f['System.WorkItemType'] ?? '',
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

import { getPocketBase } from '../pocketbase';
import { withAuthRequestHeaders } from '../security';

export interface EsaConfigView {
  configured: boolean;
  enabled: boolean;
  accessKeyId: string;
  siteId: number;
  hasSecret: boolean;
  updatedAt: string;
}

export interface EsaConfigInput {
  accessKeyId: string;
  /** 留空表示保留已保存的 Secret */
  accessKeySecret?: string;
  siteId: number;
  enabled: boolean;
}

export interface EsaPurgeTaskResult {
  taskId: string;
  recordId: string;
  status: string;
}

export interface EsaPurgeResult {
  ok: boolean;
  tasks: EsaPurgeTaskResult[];
}

export interface EsaTaskItem {
  id: string;
  taskId: string;
  type: 'purgeall' | 'file' | 'directory' | string;
  content: string[];
  status: 'submitted' | 'complete' | 'failed' | 'rejected' | string;
  message: string;
  created: string;
}

export interface EsaTaskList {
  items: EsaTaskItem[];
}

const CONFIG_PATH = '/api/blog-admin/esa/config';
const PURGE_PATH = '/api/blog-admin/esa/purge';
const TASKS_PATH = '/api/blog-admin/esa/tasks';

export async function getEsaConfig(): Promise<EsaConfigView> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<EsaConfigView>(CONFIG_PATH, { method: 'GET' }));
}

export async function saveEsaConfig(input: EsaConfigInput): Promise<EsaConfigView> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<EsaConfigView>(CONFIG_PATH, { method: 'PUT', body: input }));
}

export async function purgeEsaCacheAll(): Promise<EsaPurgeResult> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<EsaPurgeResult>(PURGE_PATH, { method: 'POST', body: { type: 'purgeall' } }));
}

export async function purgeEsaCacheUrls(urls: string[]): Promise<EsaPurgeResult> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<EsaPurgeResult>(PURGE_PATH, { method: 'POST', body: { type: 'auto', urls } }));
}

export async function listEsaTasks(): Promise<EsaTaskList> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<EsaTaskList>(TASKS_PATH, { method: 'GET' }));
}

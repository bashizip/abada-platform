import { authenticatedFetch, apiError } from './authenticatedFetch';
import { config } from '@/config/runtime';

const API_BASE = `${config.apiUrl}/v1/admin`;

export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  groups: string[];
  createdTimestamp: number;
}

export interface AdminGroup {
  id: string;
  name: string;
  path?: string;
  memberCount: number;
}

export interface CreateUserRequest {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  enabled?: boolean;
  groupIds?: string[];
}

export interface UpdateUserRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  addGroups?: string[];
  removeGroups?: string[];
}

export interface AdminStatus {
  configured: boolean;
  realm: string | null;
}

export const AdminAPI = {
  async status(): Promise<AdminStatus> {
    const res = await authenticatedFetch(`${API_BASE}/status`);
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminStatus>;
  },

  async listUsers(query?: string): Promise<AdminUser[]> {
    const url = new URL(`${API_BASE}/users`, window.location.origin);
    if (query) url.searchParams.set('query', query);
    const res = await authenticatedFetch(url.toString());
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminUser[]>;
  },

  async getUser(id: string): Promise<AdminUser> {
    const res = await authenticatedFetch(`${API_BASE}/users/${id}`);
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminUser>;
  },

  async createUser(req: CreateUserRequest): Promise<AdminUser> {
    const res = await authenticatedFetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminUser>;
  },

  async updateUser(id: string, req: UpdateUserRequest): Promise<AdminUser> {
    const res = await authenticatedFetch(`${API_BASE}/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminUser>;
  },

  async assignGroup(userId: string, groupId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}/users/${userId}/groups/${groupId}`, {
      method: 'PUT',
    });
    if (!res.ok) throw await apiError(res);
  },

  async revokeGroup(userId: string, groupId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}/users/${userId}/groups/${groupId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw await apiError(res);
  },

  async listGroups(): Promise<AdminGroup[]> {
    const res = await authenticatedFetch(`${API_BASE}/groups`);
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminGroup[]>;
  },

  async createGroup(name: string): Promise<AdminGroup> {
    const url = new URL(`${API_BASE}/groups`, window.location.origin);
    url.searchParams.set('name', name);
    const res = await authenticatedFetch(url.toString(), { method: 'POST' });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminGroup>;
  },
};

// ── Administration audit trail (S10) ──

export type AdminAuditOutcome = 'SUCCESS' | 'DENIED';

export interface AdminAuditEvent {
  id: number;
  occurredAt: string;
  actor: string;
  actorPrincipalId: string | null;
  actorRoles: string[];
  action: string;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  outcome: AdminAuditOutcome;
  traceId: string | null;
  clientIp: string | null;
  /** Non-sensitive before/after values: `{ field: { before, after } }` or plain facts. */
  details: Record<string, unknown> | null;
}

export interface AdminAuditPage {
  items: AdminAuditEvent[];
  /** Pass as `cursor` for older events; null on the last page. */
  nextCursor: number | null;
}

export interface AdminAuditFilter {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  projectId?: string;
  outcome?: AdminAuditOutcome | '';
}

export interface AdminAuditCatalog {
  actions: string[];
  outcomes: AdminAuditOutcome[];
}

function auditUrl(path: string, filter: AdminAuditFilter, extra: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`${API_BASE}/audit${path}`, window.location.origin);
  for (const [key, value] of Object.entries({ ...filter, ...extra })) {
    if (value !== undefined && value !== null && String(value).trim() !== '') url.searchParams.set(key, String(value).trim());
  }
  return url.toString();
}

export const AdminAuditAPI = {
  /** Newest first; `cursor` continues to older events, `after` returns only newer ones (live updates). */
  async list(filter: AdminAuditFilter, page: { cursor?: number; after?: number; limit?: number } = {}): Promise<AdminAuditPage> {
    const res = await authenticatedFetch(auditUrl('', filter, page));
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminAuditPage>;
  },

  async catalog(): Promise<AdminAuditCatalog> {
    const res = await authenticatedFetch(`${API_BASE}/audit/catalog`);
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminAuditCatalog>;
  },

  /** The filtered events as CSV (at most 10,000, newest first). */
  async exportCsv(filter: AdminAuditFilter): Promise<Blob> {
    const res = await authenticatedFetch(auditUrl('/export', filter));
    if (!res.ok) throw await apiError(res);
    return res.blob();
  },
};

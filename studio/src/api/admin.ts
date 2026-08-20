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
    const url = new URL(`${API_BASE}/users`);
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
    const url = new URL(`${API_BASE}/groups`);
    url.searchParams.set('name', name);
    const res = await authenticatedFetch(url.toString(), { method: 'POST' });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<AdminGroup>;
  },
};

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Shield, FolderKanban, ClipboardList, Plus, Search, Loader2, Check, X, ChevronDown } from 'lucide-react';
import { AdminAPI, AdminUser, AdminGroup } from '@/api/admin';
import { ProjectAdmin } from './ProjectAdmin';
import { Project } from '@/api/projects';
import { useToast } from '@/components/ToastContext';

type AdminTab = 'users' | 'groups' | 'projects' | 'audit';

interface AdministrationViewProps {
  activeProject?: Project | null;
}

export const AdministrationView: React.FC<AdministrationViewProps> = ({ activeProject }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const { showToast } = useToast();

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { key: 'groups', label: 'Groups', icon: <Shield className="w-4 h-4" /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban className="w-4 h-4" /> },
    { key: 'audit', label: 'Audit', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#1A1614]">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-[#3A322E]">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all font-medium ${
              activeTab === tab.key
                ? 'bg-[#25201D] text-[#EAE3D9] border border-[#3A322E]'
                : 'text-[#A89F91] hover:text-[#EAE3D9] border border-transparent'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'users' && <AdminUsersPanel />}
        {activeTab === 'groups' && <AdminGroupsPanel />}
        {activeTab === 'projects' && <AdminProjectsPanel activeProject={activeProject} />}
        {activeTab === 'audit' && <AdminAuditPlaceholder />}
      </div>
    </div>
  );
};

// ── Users Panel ──

const AdminUsersPanel: React.FC = () => {
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    enabled: true,
    groupIds: [] as string[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, g] = await Promise.all([
        AdminAPI.listUsers(search || undefined),
        AdminAPI.listGroups(),
      ]);
      setUsers(u);
      setGroups(g);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!createForm.username.trim()) return;
    try {
      await AdminAPI.createUser({
        username: createForm.username.trim(),
        email: createForm.email.trim() || undefined,
        firstName: createForm.firstName.trim() || undefined,
        lastName: createForm.lastName.trim() || undefined,
        password: createForm.password.trim() || undefined,
        enabled: createForm.enabled,
        groupIds: createForm.groupIds,
      });
      showToast('success', 'User created successfully');
      setShowCreate(false);
      setCreateForm({ username: '', email: '', firstName: '', lastName: '', password: '', enabled: true, groupIds: [] });
      void load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const toggleGroup = async (userId: string, groupId: string, assign: boolean) => {
    try {
      if (assign) {
        await AdminAPI.assignGroup(userId, groupId);
      } else {
        await AdminAPI.revokeGroup(userId, groupId);
      }
      void load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update group');
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-[#25201D] rounded-lg border border-[#3A322E] px-3 py-1.5 w-72">
          <Search className="w-4 h-4 text-[#A89F91]" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs text-[#EAE3D9] placeholder-[#A89F91]/50 outline-none w-full"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New User
        </button>
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#9D4EDD] animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(user => (
            <div
              key={user.id}
              className="flex items-center justify-between bg-[#25201D] border border-[#3A322E] rounded-xl px-4 py-3 hover:border-[#9D4EDD]/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#9D4EDD] to-[#25201D] flex items-center justify-center text-xs font-bold text-[#EAE3D9]">
                  {(user.firstName?.[0] || user.username[0] || '?').toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#EAE3D9]">{user.username}</div>
                  <div className="text-xs text-[#A89F91]">{user.email || 'No email'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-wrap gap-1 max-w-[280px] justify-end">
                  {user.groups.map(g => (
                    <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-[#3A322E] text-[#A89F91] border border-[#3A322E]">
                      {g}
                    </span>
                  ))}
                  {user.groups.length === 0 && (
                    <span className="text-[10px] text-[#A89F91]/50 italic">No groups</span>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  user.enabled
                    ? 'bg-[#2A9D8F]/20 text-[#2A9D8F]'
                    : 'bg-[#E76F51]/20 text-[#E76F51]'
                }`}>
                  {user.enabled ? 'Active' : 'Disabled'}
                </span>
                {/* Group assignment dropdown */}
                <div className="relative group">
                  <button className="flex items-center gap-1 text-[10px] text-[#A89F91] hover:text-[#EAE3D9] px-2 py-1 rounded border border-[#3A322E] hover:border-[#9D4EDD]/40 transition-all">
                    Groups <ChevronDown className="w-3 h-3" />
                  </button>
                  <div className="absolute right-0 top-full mt-1 w-48 bg-[#25201D] border border-[#3A322E] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 py-1">
                    {groups.map(g => {
                      const isMember = user.groups.includes(g.name);
                      return (
                        <button
                          key={g.id}
                          onClick={() => void toggleGroup(user.id, g.id, !isMember)}
                          className="flex items-center justify-between w-full px-3 py-1.5 text-xs text-[#EAE3D9] hover:bg-[#3A322E] transition-colors"
                        >
                          <span>{g.name}</span>
                          {isMember && <Check className="w-3 h-3 text-[#2A9D8F]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && !loading && (
            <div className="text-center py-12 text-[#A89F91] text-sm">No users found</div>
          )}
        </div>
      )}

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-6 w-[420px] shadow-2xl">
            <h3 className="text-sm font-semibold text-[#EAE3D9] mb-4">Create User</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#A89F91] uppercase tracking-wider">Username *</label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full mt-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/50"
                  placeholder="e.g. charlie"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#A89F91] uppercase tracking-wider">First Name</label>
                  <input
                    type="text"
                    value={createForm.firstName}
                    onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full mt-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#A89F91] uppercase tracking-wider">Last Name</label>
                  <input
                    type="text"
                    value={createForm.lastName}
                    onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full mt-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#A89F91] uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full mt-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#A89F91] uppercase tracking-wider">Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full mt-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/50"
                  placeholder="Leave blank for no password"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#A89F91] uppercase tracking-wider mb-1 block">Groups</label>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map(g => {
                    const selected = createForm.groupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        onClick={() => setCreateForm(f => ({
                          ...f,
                          groupIds: selected
                            ? f.groupIds.filter(id => id !== g.id)
                            : [...f.groupIds, g.id],
                        }))}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                          selected
                            ? 'bg-[#9D4EDD]/20 border-[#9D4EDD] text-[#EAE3D9]'
                            : 'bg-[#1A1614] border-[#3A322E] text-[#A89F91] hover:border-[#9D4EDD]/40'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#EAE3D9]">
                <input
                  type="checkbox"
                  checked={createForm.enabled}
                  onChange={e => setCreateForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="accent-[#2A9D8F]"
                />
                Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-3 py-1.5 rounded-lg text-[#A89F91] hover:text-[#EAE3D9] border border-[#3A322E] hover:border-[#3A322E] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={!createForm.username.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Groups Panel ──

const AdminGroupsPanel: React.FC = () => {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const g = await AdminAPI.listGroups();
      setGroups(g);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!newGroupName.trim()) return;
    try {
      await AdminAPI.createGroup(newGroupName.trim());
      showToast('success', 'Group created');
      setNewGroupName('');
      void load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="New group name..."
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
          className="bg-[#25201D] border border-[#3A322E] rounded-lg px-3 py-1.5 text-xs text-[#EAE3D9] placeholder-[#A89F91]/50 outline-none focus:border-[#9D4EDD]/50 w-64"
        />
        <button
          onClick={() => void handleCreate()}
          disabled={!newGroupName.trim()}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Create
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#9D4EDD] animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {groups.map(g => (
            <div
              key={g.id}
              className="bg-[#25201D] border border-[#3A322E] rounded-xl px-4 py-3 hover:border-[#9D4EDD]/30 transition-colors"
            >
              <div className="text-sm font-medium text-[#EAE3D9]">{g.name}</div>
              <div className="text-xs text-[#A89F91] mt-0.5">{g.path}</div>
              <div className="text-[10px] text-[#A89F91]/60 mt-1">{g.memberCount} members</div>
            </div>
          ))}
          {groups.length === 0 && !loading && (
            <div className="col-span-3 text-center py-12 text-[#A89F91] text-sm">No groups found</div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Projects Panel ──

const AdminProjectsPanel: React.FC<{ activeProject?: Project | null }> = ({ activeProject }) => {
  return (
    <div className="space-y-4">
      {activeProject ? (
        <ProjectAdmin project={activeProject} />
      ) : (
        <div className="text-center py-12 text-[#A89F91] text-sm">
          Select a project from the Canvas to manage its members and roles.
        </div>
      )}
    </div>
  );
};

// ── Audit Placeholder ──

const AdminAuditPlaceholder: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 text-[#A89F91]">
    <ClipboardList className="w-10 h-10 mb-3 opacity-30" />
    <p className="text-sm">Audit trail coming soon</p>
    <p className="text-xs opacity-50 mt-1">Track every administrative action with tamper-evident logging</p>
  </div>
);

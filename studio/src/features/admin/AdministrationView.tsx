import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  FolderKanban,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { AdminAPI, AdminGroup, AdminStatus, AdminUser } from '@/api/admin';
import { ProjectAdmin } from './ProjectAdmin';
import { Project } from '@/api/projects';
import { useToast } from '@/components/ToastContext';
import { UITooltip, TooltipProvider } from '@/components/ui';

type AdminTab = 'users' | 'groups' | 'projects' | 'audit';

interface AdministrationViewProps {
  activeProject?: Project | null;
}

const PanelHeader: React.FC<{
  icon: React.ReactNode;
  accent: string;
  title: string;
  description: string;
  count?: number;
}> = ({ icon, accent, title, description, count }) => (
  <div className="flex items-center gap-3">
    <div className={`flex h-9 w-9 items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] ${accent}`}>
      {icon}
    </div>
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-semibold text-[#EAE3D9]">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[#9D4EDD]">
          {count}
        </span>
      )}
    </div>
    <p className="text-xs text-[#A89F91] hidden lg:block">{description}</p>
  </div>
);

const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div className="animate-shimmer overflow-hidden rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-md">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={`flex items-center gap-4 px-4 ${i > 0 ? 'border-t border-[#3A322E]' : ''} h-16`}>
        <div className="h-9 w-9 rounded-full bg-[#2F2926]" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-1/3 rounded bg-[#2F2926]" />
          <div className="h-2 w-1/2 rounded bg-[#2F2926]" />
        </div>
        <div className="h-5 w-16 rounded-full bg-[#2F2926]" />
        <div className="h-5 w-24 rounded-full bg-[#2F2926]" />
      </div>
    ))}
  </div>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}> = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#3A322E] bg-[#25201D]/50 py-16 animate-rise">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#3A322E] bg-[#1A1614] text-[#A89F91] mb-4">
      {icon}
    </div>
    <p className="text-sm font-semibold text-[#EAE3D9]">{title}</p>
    <p className="mt-1 text-xs text-[#A89F91] max-w-sm text-center">{hint}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

const formatJoined = (ts?: number): string => {
  if (!ts) return '—';
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const AdministrationView: React.FC<AdministrationViewProps> = ({ activeProject }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const { showToast } = useToast();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    AdminAPI.status()
      .then(setStatus)
      .catch(err => {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch admin status');
      })
      .finally(() => setLoadingStatus(false));
  }, [showToast]);

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { key: 'groups', label: 'Groups', icon: <Shield className="w-4 h-4" /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban className="w-4 h-4" /> },
    { key: 'audit', label: 'Audit', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  if (loadingStatus) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#1A1614]">
        <Loader2 className="w-8 h-8 animate-spin text-[#9D4EDD]" />
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-[#A89F91] bg-[#1A1614] px-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#E76F51]/40 bg-[#E76F51]/10 glow-amethyst-subtle animate-rise">
          <ShieldAlert className="w-8 h-8 text-[#E76F51]" />
        </div>
        <h2 className="text-xl font-semibold text-[#EAE3D9] mt-5">Identity Provider Not Configured</h2>
        <p className="text-sm mt-2 max-w-md text-center">
          The Abada Engine requires a configured Keycloak identity provider to manage users and groups.
        </p>
        <div className="mt-8 bg-[#25201D] border border-[#3A322E] p-5 rounded-2xl max-w-md w-full text-xs shadow-warm-md">
          <p className="font-mono text-[#F4A261] mb-2">application.yaml</p>
          <pre className="text-[#A89F91] font-mono leading-relaxed">
abada.identity.admin:
  url: http://keycloak:8080
  realm: abada
  client-id: abada-engine
  client-secret: ***
          </pre>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-full bg-[#1A1614] overflow-hidden">
      {/* Main Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#3A322E] bg-[#25201D] shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#25201D] border border-[#9D4EDD]/40 glow-amethyst-subtle">
            <Settings className="w-5 h-5 text-[#EAE3D9]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#EAE3D9] leading-tight">Platform Administration</h1>
            <p className="text-xs text-[#A89F91]">Manage global platform users, groups, and audit trails.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[#2A9D8F]/30 bg-[#2A9D8F]/10 px-3.5 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 bg-[#2A9D8F]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2A9D8F]" />
          </span>
          <span className="text-xs font-medium text-[#2A9D8F] flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            Keycloak · {status.realm}
          </span>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-8 pt-4 pb-3 border-b border-[#3A322E] bg-[#25201D] shrink-0">
        <div className="flex items-center bg-[#1A1614] rounded-full border border-[#3A322E] p-1 gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 text-xs px-4 py-2 rounded-full transition-all font-medium ${
                activeTab === tab.key
                  ? 'bg-gradient-to-br from-[#9D4EDD]/30 to-[#25201D] text-[#EAE3D9] border border-[#9D4EDD]/40 glow-amethyst-subtle'
                  : 'text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] border border-transparent'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8 space-y-5 animate-rise">
        {activeTab === 'users' && <AdminUsersPanel />}
        {activeTab === 'groups' && <AdminGroupsPanel />}
        {activeTab === 'projects' && <AdminProjectsPanel activeProject={activeProject} />}
        {activeTab === 'audit' && <AdminAuditPlaceholder />}
      </div>
      </div>
    </TooltipProvider>
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
  const [groupsMenuFor, setGroupsMenuFor] = useState<string | null>(null);
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

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  );

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

  const toggleEnabled = async (user: AdminUser) => {
    try {
      await AdminAPI.updateUser(user.id, { enabled: !user.enabled });
      showToast('success', `${user.username} ${user.enabled ? 'disabled' : 'enabled'}`);
      void load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  return (
    <div className="space-y-4">
      {/* Panel header + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelHeader
          icon={<Users className="w-4 h-4 text-[#9D4EDD]" />}
          accent=""
          title="Users"
          description="Identity source of truth is Keycloak — changes apply live."
          count={loading ? undefined : sortedUsers.length}
        />
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 bg-[#25201D] rounded-lg border border-[#3A322E] px-3 py-2 w-64 transition-all focus-within:border-[#9D4EDD]/50 focus-within:shadow-warm-md">
            <Search className="w-4 h-4 text-[#A89F91] shrink-0" />
            <input
              type="text"
              placeholder="Search users…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-xs text-[#EAE3D9] placeholder-[#A89F91]/50 outline-none w-full"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] transition-all active:scale-95 shadow-warm-md"
          >
            <UserPlus className="w-3.5 h-3.5" />
            New User
          </button>
        </div>
      </div>

      {/* User list */}
      {loading ? (
        <SkeletonRows />
      ) : sortedUsers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-5 h-5" />}
          title="No users found"
          hint={search ? `No users match "${search}". Clear the search or create a new user.` : 'This realm has no users yet. Create the first one to get started.'}
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] transition-all"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Create user
            </button>
          }
        />
      ) : (
        <div className="rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-md">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1A1614] text-[#A89F91] text-[10px] uppercase tracking-[0.14em]">
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] rounded-tl-2xl">User</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E]">Status</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] hidden md:table-cell">Groups</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] hidden lg:table-cell">Joined</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] rounded-tr-2xl text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {sortedUsers.map(user => (
                <tr key={user.id} className="border-b border-[#3A322E] last:border-0 hover:bg-[#2F2926] transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9D4EDD] to-[#3A322E] text-[#EAE3D9] text-xs font-bold ring-1 ring-[#9D4EDD]/30">
                        {(user.firstName?.[0] || user.username[0] || '?').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-[#EAE3D9] truncate">{user.username}</div>
                        <div className="text-xs text-[#A89F91] truncate">{user.email || 'No email'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                      user.enabled
                        ? 'border-[#2A9D8F]/30 bg-[#2A9D8F]/10 text-[#2A9D8F]'
                        : 'border-[#E76F51]/30 bg-[#E76F51]/10 text-[#E76F51]'
                    }`}>
                      <span className="relative flex h-1.5 w-1.5">
                        {user.enabled && (
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 bg-[#2A9D8F]" />
                        )}
                        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${user.enabled ? 'bg-[#2A9D8F]' : 'bg-[#E76F51]'}`} />
                      </span>
                      {user.enabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1.5 max-w-[300px]">
                      {user.groups.map(g => (
                        <span key={g} className="px-2 py-0.5 rounded-md bg-[#9D4EDD]/15 text-[#9D4EDD] text-[10px] font-bold tracking-wide border border-[#9D4EDD]/30">
                          {g}
                        </span>
                      ))}
                      {user.groups.length === 0 && (
                        <span className="text-[10px] text-[#A89F91]/60 italic">None</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 hidden lg:table-cell">
                    <span className="text-xs text-[#A89F91] flex items-center gap-1.5 tabular-nums">
                      <Clock className="w-3 h-3 opacity-60" />
                      {formatJoined(user.createdTimestamp)}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <UITooltip content={user.enabled ? `Disable ${user.username} — the account is locked until re-enabled` : `Enable ${user.username}`}>
                        <button
                          type="button"
                          aria-label={user.enabled ? `Disable ${user.username}` : `Enable ${user.username}`}
                          onClick={() => void toggleEnabled(user)}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                            user.enabled
                              ? 'border-[#E76F51]/40 text-[#E76F51] hover:bg-[#2F2926]'
                              : 'border-[#2A9D8F]/40 text-[#2A9D8F] hover:bg-[#2F2926]'
                          }`}
                        >
                          {user.enabled ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                      </UITooltip>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setGroupsMenuFor(groupsMenuFor === user.id ? null : user.id)}
                          className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                            groupsMenuFor === user.id
                              ? 'border-[#9D4EDD]/50 bg-[#9D4EDD]/20 text-[#EAE3D9]'
                              : 'border-[#9D4EDD]/40 bg-[#9D4EDD]/10 text-[#9D4EDD] hover:bg-[#9D4EDD]/25'
                          }`}
                        >
                          Groups <ChevronDown className={`w-3 h-3 transition-transform ${groupsMenuFor === user.id ? 'rotate-180' : ''}`} />
                        </button>
                        {groupsMenuFor === user.id && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setGroupsMenuFor(null)} />
                            <div className="absolute right-0 top-full mt-2 w-56 bg-[#25201D] border border-[#3A322E] rounded-xl shadow-warm-lg py-1.5 z-30 animate-rise max-h-72 overflow-y-auto">
                              <p className="px-3 pb-1.5 pt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#A89F91]">
                                {user.username}'s groups
                              </p>
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
                              {groups.length === 0 && (
                                <div className="px-3 py-1.5 text-xs text-[#A89F91] italic">No groups available</div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-[#1A1614]/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div
            className="relative bg-[#25201D]/95 backdrop-blur-xl border border-[#3A322E] rounded-2xl p-6 w-[440px] shadow-warm-lg animate-rise"
            onClick={e => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-[#9D4EDD] via-[#F4A261] to-[#2A9D8F]" />
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#9D4EDD] to-[#25201D] border border-[#9D4EDD]/40">
                  <UserPlus className="w-4 h-4 text-[#EAE3D9]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EAE3D9]">Create User</h3>
                  <p className="text-xs text-[#A89F91]">Provisioned live in Keycloak</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowCreate(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#3A322E] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Username *</label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full mt-1.5 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all"
                  placeholder="e.g. charlie"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">First Name</label>
                  <input
                    type="text"
                    value={createForm.firstName}
                    onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full mt-1.5 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Last Name</label>
                  <input
                    type="text"
                    value={createForm.lastName}
                    onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full mt-1.5 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full mt-1.5 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full mt-1.5 bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-xs text-[#EAE3D9] outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all"
                  placeholder="Leave blank for no password"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91] mb-2 block">Groups</label>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map(g => {
                    const selected = createForm.groupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setCreateForm(f => ({
                          ...f,
                          groupIds: selected
                            ? f.groupIds.filter(id => id !== g.id)
                            : [...f.groupIds, g.id],
                        }))}
                        className={`flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                          selected
                            ? 'bg-[#9D4EDD]/20 border-[#9D4EDD]/70 text-[#EAE3D9]'
                            : 'bg-[#1A1614] border-[#3A322E] text-[#A89F91] hover:border-[#9D4EDD]/40 hover:text-[#EAE3D9]'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3 text-[#9D4EDD]" />}
                        {g.name}
                      </button>
                    );
                  })}
                  {groups.length === 0 && (
                    <span className="text-xs text-[#A89F91]/60 italic">No groups available</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[#A89F91]">Account status</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={createForm.enabled}
                  onClick={() => setCreateForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`relative h-6 w-11 rounded-full transition-colors ${createForm.enabled ? 'bg-[#2A9D8F]' : 'bg-[#3A322E]'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#EAE3D9] shadow transition-all ${createForm.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-3.5 py-2 rounded-lg text-[#A89F91] hover:text-[#EAE3D9] border border-[#3A322E] hover:border-[#4A403A] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={!createForm.username.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Create User
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

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  );

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

  const totalMembers = useMemo(() => groups.reduce((sum, g) => sum + g.memberCount, 0), [groups]);

  return (
    <div className="space-y-4">
      {/* Panel header + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelHeader
          icon={<Shield className="w-4 h-4 text-[#2A9D8F]" />}
          accent=""
          title="Groups"
          description={`${groups.length} groups · ${totalMembers} total memberships`}
          count={loading ? undefined : sortedGroups.length}
        />
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 bg-[#25201D] rounded-lg border border-[#3A322E] px-3 py-2 w-64 transition-all focus-within:border-[#9D4EDD]/50 focus-within:shadow-warm-md">
            <Shield className="w-4 h-4 text-[#A89F91] shrink-0" />
            <input
              type="text"
              placeholder="New group name…"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              className="bg-transparent text-xs text-[#EAE3D9] placeholder-[#A89F91]/50 outline-none w-full"
            />
          </div>
          <button
            onClick={() => void handleCreate()}
            disabled={!newGroupName.trim()}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shadow-warm-md"
          >
            <Plus className="w-3.5 h-3.5" />
            Create
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : sortedGroups.length === 0 ? (
        <EmptyState
          icon={<Shield className="w-5 h-5" />}
          title="No groups yet"
          hint="Groups map to engine RBAC authorities. Create your first group, then assign users from the Users tab."
        />
      ) : (
        <div className="rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-md">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1A1614] text-[#A89F91] text-[10px] uppercase tracking-[0.14em]">
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] rounded-tl-2xl">Group Name</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] hidden md:table-cell">Path</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] rounded-tr-2xl text-right">Members</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {sortedGroups.map(g => (
                <tr key={g.id} className="border-b border-[#3A322E] last:border-0 hover:bg-[#2F2926] transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2A9D8F]/70 to-[#25201D] border border-[#2A9D8F]/30">
                        <Shield className="w-4 h-4 text-[#EAE3D9]" />
                      </div>
                      <div className="font-semibold text-[#EAE3D9]">{g.name}</div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 hidden md:table-cell text-xs font-mono text-[#A89F91]">
                    {g.path || '/'}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2A9D8F]/30 bg-[#2A9D8F]/10 px-2.5 py-1 text-[10px] font-bold tabular-nums text-[#2A9D8F]">
                      <Users className="w-3 h-3" />
                      {g.memberCount}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Projects Panel ──

const AdminProjectsPanel: React.FC<{ activeProject?: Project | null }> = ({ activeProject }) => {
  return (
    <div className="space-y-4">
      <PanelHeader
        icon={<FolderKanban className="w-4 h-4 text-[#F4A261]" />}
        accent=""
        title="Projects"
        description="Project-scoped member and role management."
        count={activeProject ? 1 : undefined}
      />
      {activeProject ? (
        <div className="overflow-hidden rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-md animate-rise">
          <ProjectAdmin project={activeProject} />
        </div>
      ) : (
        <EmptyState
          icon={<FolderKanban className="w-5 h-5" />}
          title="No project selected"
          hint="Select a project in the Canvas to manage its members and roles here. Projects stay scoped: users and groups are platform-wide."
        />
      )}
    </div>
  );
};

// ── Audit Placeholder ──

const AdminAuditPlaceholder: React.FC = () => (
  <div className="space-y-4">
    <PanelHeader
      icon={<ClipboardList className="w-4 h-4 text-[#9D4EDD]" />}
      accent=""
      title="Audit Trail"
      description="Every administrative action, tamper-evident."
    />
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3A322E] bg-[#25201D]/50 py-20 shadow-warm-md">
      <div className="relative">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#9D4EDD]/40 to-[#25201D] border border-[#9D4EDD]/30 glow-amethyst-subtle">
          <Lock className="w-6 h-6 text-[#EAE3D9]" />
        </div>
        <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 bg-[#F4A261]" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-[#F4A261] border-2 border-[#25201D]" />
        </span>
      </div>
      <p className="text-sm font-semibold text-[#EAE3D9] mt-5">Audit trail coming soon</p>
      <p className="text-xs text-[#A89F91] mt-1.5 max-w-sm text-center">
        Track every administrative action — actor, action, target, and trace ID — recorded transactionally with the mutation it audits.
      </p>
      <span className="mt-5 rounded-full border border-[#F4A261]/30 bg-[#F4A261]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4A261]">
        Planned · Phase 4
      </span>
    </div>
  </div>
);
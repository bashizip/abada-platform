import React, { useEffect, useState } from 'react';
import { Project, ProjectAPI, ProjectMember, ProjectRole, Principal } from '@/api/projects';
import { useToast } from '@/components/ToastContext';
import { Users, Shield, Plus, X, Search, ShieldAlert, Loader2, Check } from 'lucide-react';
import { keycloak } from '@/auth/keycloakClient';

interface ProjectAdminProps {
  project: Project;
}

const AVAILABLE_ROLES: { id: ProjectRole; label: string; desc: string }[] = [
  { id: 'OWNER', label: 'Owner', desc: 'Full administrative access including deletion' },
  { id: 'MAINTAINER', label: 'Maintainer', desc: 'Manage workflows, members, and settings' },
  { id: 'OPERATOR', label: 'Operator', desc: 'Deploy workflows and manage live instances' },
  { id: 'REVIEWER', label: 'Reviewer', desc: 'Approve or reject governance policies and diffs' },
  { id: 'VIEWER', label: 'Viewer', desc: 'Read-only access to the project' },
];

export const ProjectAdmin: React.FC<ProjectAdminProps> = ({ project }) => {
  const { showToast } = useToast();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Member Modal State
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Principal[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPrincipal, setSelectedPrincipal] = useState<Principal | null>(null);
  
  // Edit Role State (used for both Add and Update)
  const [editingRoles, setEditingRoles] = useState<ProjectRole[]>(['VIEWER']);
  const [editingLanes, setEditingLanes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  
  // Existing member being edited
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  const fetchMembers = async () => {
    try {
      const data = await ProjectAPI.members(project.id);
      setMembers(data);
    } catch (err: any) {
      showToast('error', 'Failed to load project members', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMembers();
  }, [project.id]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delay = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await ProjectAPI.principals(project.id, searchQuery);
        setSearchResults(results);
      } catch {
        // Ignore search errors
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(delay);
  }, [searchQuery, project.id]);

  const handleSaveMember = async () => {
    if (!selectedPrincipal && !editingMemberId) return;
    const principalId = selectedPrincipal ? selectedPrincipal.id : editingMemberId!;
    const reviewLanesList = editingLanes.split(',').map(l => l.trim()).filter(Boolean);

    setSaving(true);
    try {
      const existing = members.find(m => m.principalId === principalId);
      await ProjectAPI.putMember(project.id, principalId, editingRoles, reviewLanesList, existing?.version);
      showToast('success', 'Member roles updated successfully');
      setIsAdding(false);
      setEditingMemberId(null);
      setSelectedPrincipal(null);
      await fetchMembers();
    } catch (err: any) {
      showToast('error', 'Failed to update member', err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (member: ProjectMember) => {
    setEditingMemberId(member.principalId);
    setEditingRoles(member.roles);
    setEditingLanes(member.reviewLanes.join(', '));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#A89F91]">
        <Loader2 className="w-8 h-8 animate-spin text-[#9D4EDD]" />
      </div>
    );
  }

  const isAuthorized = project.currentUserRoles.includes('OWNER') || project.currentUserRoles.includes('MAINTAINER');
  if (!isAuthorized) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-[#A89F91]">
        <ShieldAlert className="w-12 h-12 text-[#E76F51] mb-4" />
        <h2 className="text-lg font-semibold text-[#EAE3D9]">Access Denied</h2>
        <p className="text-sm mt-2">You need the OWNER or MAINTAINER role to view and manage project members.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1A1614] overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[#3A322E] bg-[#25201D]">
        <div>
          <h1 className="text-xl font-bold text-[#EAE3D9] flex items-center gap-3">
            <Shield className="w-6 h-6 text-[#9D4EDD]" />
            Administration & Roles
          </h1>
          <p className="text-sm text-[#A89F91] mt-1">Manage project members, permissions, and human task review lanes.</p>
        </div>
        <button
          onClick={() => {
            setIsAdding(true);
            setSelectedPrincipal(null);
            setEditingRoles(['VIEWER']);
            setEditingLanes('');
            setSearchQuery('');
          }}
          className="flex items-center gap-2 bg-[#9D4EDD] hover:bg-[#7B2CBF] text-[#EAE3D9] px-4 py-2 rounded-lg font-semibold transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="border border-[#3A322E] rounded-xl overflow-hidden bg-[#25201D]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1A1614] text-[#A89F91] text-xs uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E]">User / Principal</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E]">Type</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E]">Roles</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E]">Review Lanes</th>
                <th className="py-3 px-4 font-semibold border-b border-[#3A322E] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {members.map(member => (
                <tr key={member.principalId} className="border-b border-[#3A322E] last:border-0 hover:bg-[#2B2523] transition-colors group">
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#3A322E] flex items-center justify-center text-[#EAE3D9] font-bold">
                        {member.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-[#EAE3D9]">{member.username}</div>
                        <div className="text-xs text-[#A89F91] font-mono">{member.principalId.split('-')[0]}...</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-[#A89F91]">
                    {member.principalType}
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {member.roles.map(role => (
                        <span key={role} className="px-2 py-0.5 rounded-md bg-[#9D4EDD]/20 text-[#9D4EDD] text-[10px] font-bold tracking-wide border border-[#9D4EDD]/30">
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-[#A89F91] text-xs">
                    {member.reviewLanes.length > 0 ? member.reviewLanes.join(', ') : <span className="italic text-[#737D69]">None</span>}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button
                      onClick={() => openEditModal(member)}
                      className="text-[#9D4EDD] hover:text-[#EAE3D9] text-xs font-semibold px-3 py-1.5 rounded bg-[#9D4EDD]/10 hover:bg-[#9D4EDD]/30 transition-colors"
                    >
                      Edit Roles
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#A89F91]">
                    No members found in this project.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Member Modal */}
      {(isAdding || editingMemberId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#25201D] border border-[#3A322E] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A322E]">
              <h2 className="text-lg font-bold text-[#EAE3D9]">
                {isAdding ? 'Add Project Member' : 'Edit Member Roles'}
              </h2>
              <button onClick={() => { setIsAdding(false); setEditingMemberId(null); }} className="text-[#A89F91] hover:text-[#EAE3D9] transition-colors p-1 rounded-lg hover:bg-[#3A322E]">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              {isAdding && !selectedPrincipal ? (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A89F91]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search users or service accounts..."
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg py-2 pl-9 pr-4 text-[#EAE3D9] text-sm focus:outline-none focus:border-[#9D4EDD] placeholder-[#737D69]"
                    />
                    {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9D4EDD] animate-spin" />}
                  </div>
                  
                  {searchQuery.trim() && (
                    <div className="border border-[#3A322E] rounded-lg bg-[#1A1614] max-h-48 overflow-y-auto">
                      {searchResults.length === 0 && !searching ? (
                        <div className="p-4 text-center text-sm text-[#A89F91]">No matching users found.</div>
                      ) : (
                        searchResults.map(p => (
                          <button
                            key={p.id}
                            onClick={() => setSelectedPrincipal(p)}
                            disabled={members.some(m => m.principalId === p.id)}
                            className="w-full text-left px-4 py-3 border-b border-[#3A322E] last:border-0 hover:bg-[#2B2523] flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed group"
                          >
                            <div>
                              <div className="text-sm font-semibold text-[#EAE3D9]">{p.username}</div>
                              <div className="text-xs text-[#A89F91] font-mono">{p.type}</div>
                            </div>
                            {members.some(m => m.principalId === p.id) && (
                              <span className="text-[10px] text-[#2A9D8F] font-semibold bg-[#2A9D8F]/10 px-2 py-0.5 rounded">Already Member</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Selected Principal Info */}
                  <div className="flex items-center gap-3 p-3 bg-[#1A1614] border border-[#3A322E] rounded-lg">
                    <div className="w-10 h-10 rounded-full bg-[#3A322E] flex items-center justify-center text-[#EAE3D9] font-bold text-lg">
                      {selectedPrincipal?.username.charAt(0).toUpperCase() || members.find(m => m.principalId === editingMemberId)?.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-[#EAE3D9]">{selectedPrincipal?.username || members.find(m => m.principalId === editingMemberId)?.username}</div>
                      <div className="text-xs text-[#A89F91]">{selectedPrincipal?.type || members.find(m => m.principalId === editingMemberId)?.principalType}</div>
                    </div>
                    {isAdding && (
                      <button onClick={() => setSelectedPrincipal(null)} className="ml-auto text-xs text-[#E76F51] hover:underline px-2">Change</button>
                    )}
                  </div>

                  {/* Roles Selection */}
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-[#A89F91]">Assign Roles</label>
                    <div className="space-y-2">
                      {AVAILABLE_ROLES.map(role => {
                        const isSelected = editingRoles.includes(role.id);
                        return (
                          <label key={role.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-[#9D4EDD]/10 border-[#9D4EDD]/50' : 'bg-[#1A1614] border-[#3A322E] hover:border-[#9D4EDD]/30'}`}>
                            <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-[#9D4EDD] border-[#9D4EDD]' : 'bg-transparent border-[#737D69]'}`}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <input type="checkbox" className="hidden" checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) setEditingRoles([...editingRoles, role.id]);
                                else setEditingRoles(editingRoles.filter(r => r !== role.id));
                              }}
                            />
                            <div>
                              <div className="text-sm font-semibold text-[#EAE3D9]">{role.label}</div>
                              <div className="text-xs text-[#A89F91] mt-0.5">{role.desc}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Review Lanes */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[#A89F91]">Human Task Review Lanes (Optional)</label>
                    <input
                      type="text"
                      value={editingLanes}
                      onChange={(e) => setEditingLanes(e.target.value)}
                      placeholder="e.g. tier-1-support, finance-approvers"
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg py-2 px-3 text-[#EAE3D9] text-sm focus:outline-none focus:border-[#9D4EDD]"
                    />
                    <p className="text-[10px] text-[#737D69]">Comma-separated list of lanes this user is permitted to review.</p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-[#3A322E] bg-[#1A1614] flex justify-end gap-3">
              <button
                onClick={() => { setIsAdding(false); setEditingMemberId(null); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[#A89F91] hover:text-[#EAE3D9] transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
              {(!isAdding || selectedPrincipal) && (
                <button
                  onClick={handleSaveMember}
                  disabled={saving || editingRoles.length === 0}
                  className="flex items-center gap-2 bg-[#9D4EDD] hover:bg-[#7B2CBF] text-[#EAE3D9] px-6 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {isAdding ? 'Add Member' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

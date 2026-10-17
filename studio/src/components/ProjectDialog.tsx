import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Search, Shield, Users, X } from 'lucide-react';
import { Principal, Project, ProjectAPI, ProjectMember, ProjectRole } from '@/api/projects';

const ROLES: ProjectRole[] = ['OWNER', 'MAINTAINER', 'OPERATOR', 'REVIEWER', 'VIEWER'];

interface ProjectDialogProps {
  isOpen: boolean;
  projects: Project[];
  activeProject?: Project;
  onClose: () => void;
  onOpen: (project: Project) => void;
  onCreated: (project: Project) => void;
}

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  isOpen, projects, activeProject, onClose, onOpen, onCreated,
}) => {
  const [tab, setTab] = useState<'open' | 'new' | 'team'>('open');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || tab !== 'team' || !activeProject) return;
    Promise.all([ProjectAPI.members(activeProject.id), ProjectAPI.principals(activeProject.id, query)])
      .then(([nextMembers, nextPrincipals]) => { setMembers(nextMembers); setPrincipals(nextPrincipals); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [isOpen, tab, activeProject, query]);

  if (!isOpen) return null;

  const create = async () => {
    setBusy(true); setError('');
    try {
      const project = await ProjectAPI.create(slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name, description);
      onCreated(project); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const addViewer = async (principal: Principal) => {
    if (!activeProject) return;
    try {
      const member = await ProjectAPI.putMember(activeProject.id, principal.id, ['VIEWER'], [], []);
      setMembers((current) => [...current.filter((item) => item.principalId !== member.principalId), member]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const toggleRole = async (member: ProjectMember, role: ProjectRole) => {
    if (!activeProject) return;
    const roles = member.roles.includes(role)
      ? member.roles.filter((item) => item !== role) : [...member.roles, role];
    try {
      const updated = await ProjectAPI.putMember(activeProject.id, member.principalId, roles,
        member.reviewLanes, member.taskGroups, member.version);
      setMembers((current) => current.map((item) => item.principalId === updated.principalId ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const saveLanes = async (member: ProjectMember, value: string) => {
    if (!activeProject) return;
    const lanes = value.split(',').map((lane) => lane.trim()).filter(Boolean);
    try {
      const updated = await ProjectAPI.putMember(activeProject.id, member.principalId,
        member.roles, lanes, member.taskGroups, member.version);
      setMembers((current) => current.map((item) => item.principalId === updated.principalId ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const canManage = !!activeProject?.currentUserRoles.some((role) => role === 'OWNER');

  return (
    <div className="fixed inset-0 z-[100] bg-[#0F0C0A]/80 backdrop-blur-sm flex items-center justify-center p-6">
      <section className="w-full max-w-3xl max-h-[82vh] overflow-hidden rounded-2xl border border-hairline bg-mocha shadow-2xl">
        <header className="h-14 px-5 flex items-center justify-between border-b border-hairline">
          <div>
            <h2 className="text-sm font-semibold text-linen">Project workspace</h2>
            <p className="text-[10px] text-sand">Processes, runtime access and review lanes share this boundary.</p>
          </div>
          <button onClick={onClose} className="p-2 text-sand hover:text-white"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex border-b border-hairline px-4 pt-2 gap-1">
          {([['open', FolderOpen, 'Open project'], ['new', Plus, 'New project'], ['team', Users, 'Access']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => { setTab(id); setError(''); }}
              className={`px-3 py-2 text-xs flex items-center gap-2 border-b-2 ${tab === id ? 'border-saffron text-linen' : 'border-transparent text-sand'}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto max-h-[65vh]">
          {error && <div className="mb-4 text-xs text-desert-rose bg-desert-rose/10 border border-desert-rose/30 rounded-lg p-3">{error}</div>}
          {tab === 'open' && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {projects.map((project) => <button key={project.id} onClick={() => { onOpen(project); onClose(); }}
              className={`text-left rounded-xl border p-4 transition-colors ${project.id === activeProject?.id ? 'border-saffron/70 bg-charcoal' : 'border-hairline hover:border-sand/50'}`}>
              <div className="flex justify-between gap-3"><span className="text-sm font-medium">{project.name}</span>
                <span className="text-[9px] uppercase text-mineral-teal">{project.status}</span></div>
              <p className="text-xs text-sand mt-2 line-clamp-2">{project.description || 'No description'}</p>
              <div className="mt-3 text-[10px] text-sand">{project.processCount} processes · {project.currentUserRoles.join(' · ')}</div>
            </button>)}
            {!projects.length && <p className="text-sm text-sand">No accessible project yet. Create your first project.</p>}
          </div>}
          {tab === 'new' && <div className="max-w-xl space-y-4">
            <label className="block text-xs text-sand">Name<input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')); }}
              className="mt-1 w-full rounded-lg border border-hairline bg-charcoal px-3 py-2 text-linen" /></label>
            <label className="block text-xs text-sand">Slug<input value={slug} onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-lg border border-hairline bg-charcoal px-3 py-2 font-mono text-linen" /></label>
            <label className="block text-xs text-sand">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="mt-1 w-full rounded-lg border border-hairline bg-charcoal px-3 py-2 text-linen" /></label>
            <button disabled={busy || !name.trim()} onClick={create} className="rounded-lg bg-saffron px-4 py-2 text-xs font-semibold text-charcoal disabled:opacity-50">{busy ? 'Creating…' : 'Create project'}</button>
            <p className="text-[10px] text-sand">The creator receives Owner, Maintainer, Operator and Viewer. Reviewer is deliberately separate to preserve approval independence.</p>
          </div>}
          {tab === 'team' && <div className="space-y-5">
            {!activeProject && <p className="text-sm text-sand">Open a project to manage its access.</p>}
            {activeProject && !canManage && <p className="text-sm text-sand">Only project owners can change memberships and review lanes.</p>}
            {activeProject && canManage && <>
              <div className="rounded-xl border border-hairline overflow-hidden">
                {members.map((member) => <div key={member.principalId} className="p-3 border-b last:border-b-0 border-hairline">
                  <div className="flex items-center justify-between"><span className="text-xs font-medium">{member.username}</span><span className="text-[9px] text-sand">{member.principalType}</span></div>
                  <div className="flex flex-wrap gap-2 mt-2">{ROLES.map((role) => <label key={role} className="text-[10px] text-sand flex gap-1 items-center"><input type="checkbox" checked={member.roles.includes(role)} onChange={() => toggleRole(member, role)} />{role}</label>)}</div>
                  <label className="mt-2 flex items-center gap-2 text-[10px] text-sand"><Shield className="w-3 h-3" />Review lanes<input defaultValue={member.reviewLanes.join(', ')} onBlur={(e) => saveLanes(member, e.target.value)} placeholder="TECHNICAL, COMPLIANCE" className="flex-1 rounded border border-hairline bg-charcoal px-2 py-1" /></label>
                </div>)}
              </div>
              <div><div className="flex items-center gap-2 rounded-lg border border-hairline bg-charcoal px-3"><Search className="w-3.5 h-3.5 text-sand" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Observed OIDC users" className="w-full bg-transparent py-2 text-xs outline-none" /></div>
                <div className="mt-2 flex flex-wrap gap-2">{principals.filter((principal) => !members.some((member) => member.principalId === principal.id)).map((principal) => <button key={principal.id} onClick={() => addViewer(principal)} className="rounded-lg border border-hairline px-2 py-1 text-[10px] text-sand hover:text-white">+ {principal.username}</button>)}</div></div>
            </>}
          </div>}
        </div>
      </section>
    </div>
  );
};

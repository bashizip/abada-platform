import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileJson, Loader2, Plus } from 'lucide-react';
import { ProjectAPI, ProjectFormDTO } from '@/api/projects';
import { FormEditor } from '@/features/designer/FormEditor';
import { FormSchema } from '@/features/inbox/formSchema';
import { useToast } from '@/components/ToastContext';

const slugOf = (name: string): string => name.replace(/\.json$/i, '');

function slugify(value: string): string {
  const slug = value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || 'new-form';
}

function b64of(json: string): string {
  const bytes = new TextEncoder().encode(json);
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

interface FormPickerProps {
  projectId?: string;
  /** Current formKey (a bare slug). */
  value?: string;
  onChange: (key?: string) => void;
}

/**
 * Picks the task form referenced by a human node's formKey. Lists the
 * project's FORM resources by bare slug, allows a custom key, and can create a
 * new form (FormEditor) and link it in place.
 */
export const FormPicker: React.FC<FormPickerProps> = ({ projectId, value, onChange }) => {
  const { showToast } = useToast();
  const [forms, setForms] = useState<ProjectFormDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [formsFolderId, setFormsFolderId] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setForms([]);
      setFormsFolderId(null);
      return;
    }
    setLoading(true);
    try {
      const [list, tree] = await Promise.all([
        ProjectAPI.listForms(projectId),
        ProjectAPI.tree(projectId),
      ]);
      setForms(list);
      const formsRoot = tree.find((node) => node.kind === 'FOLDER' && node.name === 'forms');
      setFormsFolderId(formsRoot?.id ?? null);
    } catch {
      showToast('error', 'Failed to load project forms');
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const slugs = useMemo(() => forms.map((form) => slugOf(form.name)).sort(), [forms]);
  const known = value ? slugs.includes(value) : true;

  const selectValue = value && known ? value : customMode ? '__custom__' : '';

  const handleSelect = (next: string) => {
    if (next === '__custom__') {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onChange(next === '' ? undefined : next);
  };

  const handleCreate = async (schema: FormSchema) => {
    if (!projectId) {
      showToast('error', 'Open a project before creating a form');
      return;
    }
    if (!formsFolderId) {
      showToast('error', 'The project forms folder is unavailable');
      return;
    }
    setCreating(true);
    try {
      const slug = slugify(schema.title || 'new-form');
      const json = JSON.stringify(schema, null, 2);
      await ProjectAPI.createResource(projectId, `${slug}.json`, 'FORM', 'application/json',
        b64of(json), formsFolderId);
      onChange(slug);
      setCustomMode(false);
      setShowCreate(false);
      void load();
      showToast('success', `Form '${slug}' created and linked`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create form');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <FileJson className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#2A9D8F] pointer-events-none" />
          <select
            value={selectValue}
            onChange={(e) => handleSelect(e.target.value)}
            className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl pl-8 pr-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F] disabled:opacity-60"
            disabled={loading || !projectId}
          >
            <option value="">No form</option>
            {slugs.map((slug) => (
              <option key={slug} value={slug}>{slug}</option>
            ))}
            {value && !known && (
              <option value={value}>{value} (custom)</option>
            )}
            <option value="__custom__">Custom key…</option>
          </select>
          {loading && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A89F91] animate-spin" />
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!projectId}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 text-[#2A9D8F] hover:bg-[#2A9D8F]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="Create a new form and link it to this task"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      {customMode && (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder="e.g. loan-approval"
          className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
        />
      )}

      {value && !known && (
        <p className="flex items-center gap-1 text-[10px] text-[#E76F51]">
          <AlertTriangle className="w-3 h-3" />
          No project form matches this key.
        </p>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-7xl h-[90vh]">
            <FormEditor
              initialSchema={{ title: 'New Form', fields: [] }}
              saving={creating}
              onClose={() => setShowCreate(false)}
              onSave={(schema) => void handleCreate(schema)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

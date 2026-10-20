import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Maximize2, Save } from 'lucide-react';
import { ProjectAPI } from '@/api/projects';
import { useToast } from '@/components/ToastContext';
import { FormEditor } from '@/features/designer/FormEditor';
import { withLayout, shiftInRow, nudgeField, updateField } from '@/features/designer/form/formModel';
import { FormSchema, cellField, isInput } from '@/features/inbox/formSchema';

function decode(content: string): string {
  const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

interface Loaded {
  id: string;
  name: string;
  revision: number;
  schema: FormSchema;
}

/**
 * Quick tweaks to the form a human task uses, in the properties panel:
 * rename a field, toggle required, reorder. Layout, rules and visibility live
 * in the full editor, one click away. Saving changes the project form; tasks
 * use it once the process is deployed again.
 */
export const FormQuickEdit: React.FC<{ projectId: string; formKey: string }> = ({ projectId, formKey }) => {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<FormSchema | null>(null);
  const [saving, setSaving] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const resource = await ProjectAPI.resolveForm(projectId, formKey);
      const schema = withLayout(JSON.parse(decode(resource.contentBase64)) as FormSchema);
      setLoaded({ id: resource.id, name: resource.name, revision: resource.revision, schema });
      setDraft(schema);
    } catch (err) {
      setLoaded(null);
      setDraft(null);
      setError(err instanceof Error ? err.message : 'The form could not be loaded');
    }
  }, [projectId, formKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (schema: FormSchema) => {
    if (!loaded) return;
    setSaving(true);
    try {
      const updated = await ProjectAPI.replaceResource(projectId, loaded.id, 'application/json',
        encode(JSON.stringify(schema, null, 2)), loaded.revision);
      setLoaded({ ...loaded, revision: updated.revision, schema });
      setDraft(schema);
      showToast('success', `Form '${formKey}' saved. Deploy the process to use it in new tasks.`);
      setFull(false);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save the form');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="text-[10.5px] text-sand-dim">{error}</p>;
  if (!draft || !loaded) {
    return <div className="flex justify-center py-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-sand" /></div>;
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.schema);
  const inputs = draft.fields.filter(isInput).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] text-sand-dim">
          {inputs} field{inputs === 1 ? '' : 's'} · {draft.layout?.sections.length ?? 1} section{(draft.layout?.sections.length ?? 1) === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {dirty && (
          <button type="button" onClick={() => void persist(draft)} disabled={saving}
            className="flex h-6 items-center gap-1 rounded-md border border-mineral-teal/50 bg-mineral-teal/15 px-2 text-[11px] font-semibold text-linen disabled:opacity-50">
            <Save className="h-3 w-3" /> Save
          </button>
        )}
        <button type="button" onClick={() => setFull(true)}
          className="flex h-6 items-center gap-1 rounded-md bg-mineral-teal px-2 text-[11px] font-semibold text-charcoal hover:bg-mineral-teal-bright">
          <Maximize2 className="h-3 w-3" /> Open full editor
        </button>
      </div>
      <ul className="max-h-72 space-y-px overflow-y-auto rounded-lg border border-hairline bg-charcoal p-1" aria-label="Form fields">
        {draft.layout?.sections.map((section) => (
          <React.Fragment key={section.id}>
            {section.title && (
              <li className="px-1.5 pb-0.5 pt-1 text-[9.5px] font-semibold uppercase tracking-wider text-moss">{section.title}</li>
            )}
            {section.rows.flatMap((row) => row.map(cellField)).map((id) => {
              const field = draft.fields.find((candidate) => candidate.id === id);
              if (!field) return null;
              return (
                <li key={id} className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded px-1 hover:bg-mocha">
                  <input aria-label={`Label of ${id}`} value={field.label}
                    onChange={(event) => setDraft(updateField(draft, id, { label: event.target.value }))}
                    className="h-6 min-w-0 rounded border border-transparent bg-transparent px-1 text-[11.5px] text-linen hover:border-hairline focus:border-mineral-teal focus:outline-none" />
                  <span className="font-mono text-[9.5px] text-sand-dim">{field.type}</span>
                  <span className="flex items-center gap-0.5">
                    {isInput(field) && (
                      <input type="checkbox" aria-label={`Required: ${field.label || id}`} title="Required"
                        checked={!!field.required} className="h-3 w-3 accent-mineral-teal"
                        onChange={(event) => setDraft(updateField(draft, id, { required: event.target.checked || undefined }))} />
                    )}
                    <button type="button" aria-label={`Move ${field.label || id} up`} className="p-0.5 text-sand opacity-0 hover:text-linen group-hover:opacity-100 focus:opacity-100"
                      onClick={() => setDraft(shiftOrNudge(draft, id, -1))}><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" aria-label={`Move ${field.label || id} down`} className="p-0.5 text-sand opacity-0 hover:text-linen group-hover:opacity-100 focus:opacity-100"
                      onClick={() => setDraft(shiftOrNudge(draft, id, 1))}><ArrowDown className="h-3 w-3" /></button>
                  </span>
                </li>
              );
            })}
          </React.Fragment>
        ))}
      </ul>
      {full && (
        <FormEditor initialSchema={draft} location={`forms/${loaded.name}`} saving={saving}
          onClose={() => setFull(false)} onSave={(schema) => void persist(schema)} />
      )}
    </div>
  );
};

/** In reading order: within the row first, then across rows. */
function shiftOrNudge(schema: FormSchema, id: string, delta: -1 | 1): FormSchema {
  const moved = shiftInRow(schema, id, delta);
  if (moved !== schema && JSON.stringify(moved) !== JSON.stringify(schema)) return moved;
  return nudgeField(schema, id, delta < 0 ? 'up' : 'down');
}

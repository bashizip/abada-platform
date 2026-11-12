import React, { useId } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { AgentConfig, WorkflowNode } from '@/types';
import { issuesAt } from '@/lib/apl/issues';
import {
  AGENT_FILE_TYPES, MAX_FILES_DEFAULT, MAX_FILES_LIMIT, nextFileName, useFileFieldOptions,
} from '@/lib/agentFiles';
import { Field, Note, NumberInput } from './InspectorKit';
import { MONO_INPUT } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';

/**
 * The *Files* of an agent (S15): the documents the model reads, each a name and an
 * expression giving a file reference or a list of them. Default-deny: only files listed
 * here reach a model. Suggestions come from the file fields of the process's task forms.
 */
export const AgentFilesEditor: React.FC<{
  config: AgentConfig;
  nodes: WorkflowNode[];
  projectId?: string;
  issues: NodeEditorProps['issues'];
  /** Changes several agent fields in one update (one undo step). */
  patch: (changes: Partial<AgentConfig>) => void;
}> = ({ config, nodes, projectId, issues, patch }) => {
  const listId = useId();
  const files = config.files ?? {};
  const entries = Object.entries(files);
  const formKeys = nodes.map((node) => node.humanConfig?.formKey).filter((key): key is string => Boolean(key));
  const options = useFileFieldOptions(projectId, formKeys);

  // `files` and `max_files` change together: removing the last file also drops max_files.
  const write = (next: Record<string, string>) => {
    const empty = Object.keys(next).length === 0;
    patch({ files: empty ? undefined : next, maxFiles: empty ? undefined : config.maxFiles });
  };

  return (
    <>
      <Field label="Files the model reads" apl="files" issues={issuesAt(issues, 'files')}
        help="Each name reads a file variable, usually a file field of an earlier task form. Only these files reach the model; the engine checks each one belongs to this instance.">
        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-charcoal">
          {entries.map(([name, expr]) => (
            <div key={name} className="group flex items-center gap-1.5 px-2 py-1.5">
              <FileText className="h-3 w-3 shrink-0 text-sand" aria-hidden="true" />
              <input aria-label={`File name ${name}`} value={name} className={`${MONO_INPUT} w-28`}
                onChange={(e) => {
                  const next = Object.fromEntries(entries.map(([key, value]) =>
                    key === name ? [e.target.value, value] : [key, value]));
                  write(next);
                }} />
              <input aria-label={`File variable ${name}`} value={expr} placeholder="bordereau_scan"
                list={`${listId}-fields`} className={MONO_INPUT}
                onChange={(e) => write({ ...files, [name]: e.target.value })} />
              <button type="button" aria-label={`Remove file ${name}`} title="Remove file"
                className="shrink-0 text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  const next = { ...files };
                  delete next[name];
                  write(next);
                }}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button type="button" className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-medium text-amethyst hover:text-amethyst-bright"
            onClick={() => write({ ...files, [nextFileName(files)]: options[0]?.id ?? '' })}>
            <Plus className="h-3 w-3" /> Add file
          </button>
        </div>
        <datalist id={`${listId}-fields`}>
          {options.map((option) => (
            <option key={`${option.formKey}:${option.id}`} value={option.id}>
              {`${option.label} (form ${option.formKey}${option.multiple ? ', several files' : ''})`}
            </option>
          ))}
        </datalist>
      </Field>
      {entries.length > 0 && (
        <>
          <Field label="Most files per call" apl="max_files" issues={issuesAt(issues, 'max_files')}
            help={`More files fail the step with AGENT_FILE_LIMIT; nothing is cut silently. Default ${MAX_FILES_DEFAULT}.`}>
            <NumberInput label="Most files per call" value={config.maxFiles} min={1} max={MAX_FILES_LIMIT}
              onChange={(maxFiles) => patch({ maxFiles })} />
          </Field>
          <Note>
            <span className="font-semibold text-linen-muted">Accepted types. </span>
            {AGENT_FILE_TYPES.map((entry) => `${entry.types}: ${entry.providers}.`).join(' ')}
            {' '}A model that cannot read a file is skipped in favour of a fallback that can; with none left the step fails with AGENT_FILE_UNSUPPORTED.
          </Note>
        </>
      )}
    </>
  );
};

import React, { useEffect, useState } from 'react';
import { FileLock2, Loader2 } from 'lucide-react';
import { EvidenceAPI, EvidencePolicy } from '@/api/evidence';

const MODES: { id: EvidencePolicy['payloads']; label: string; desc: string }[] = [
  { id: 'none', label: 'None', desc: 'No payloads: digests, tokens and cost only' },
  { id: 'redacted', label: 'Redacted', desc: 'Secrets and sensitive variables masked' },
  { id: 'full', label: 'Full', desc: 'As sent (still encrypted at rest)' },
];

/**
 * What the project's agent evidence keeps of prompts, tool arguments and
 * results, and for how long. Owners change it; it applies to steps recorded
 * afterwards, and an agent step may only make it stricter.
 */
export const EvidencePolicyCard: React.FC<{ projectId: string; canEdit: boolean }> = ({ projectId, canEdit }) => {
  const [policy, setPolicy] = useState<EvidencePolicy | null>(null);
  const [draft, setDraft] = useState<EvidencePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    EvidenceAPI.policy(projectId).then((loaded) => {
      if (cancelled) return;
      setPolicy(loaded);
      setDraft(loaded);
    }).catch((cause) => { if (!cancelled) setMessage(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!draft || !policy) {
    return message ? <p className="text-xs text-[#E76F51]">{message}</p> : null;
  }

  const changed = draft.payloads !== policy.payloads || draft.retentionDays !== policy.retentionDays;
  const validDays = Number.isInteger(draft.retentionDays) && draft.retentionDays >= 1 && draft.retentionDays <= 3650;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await EvidenceAPI.setPolicy(projectId, draft);
      setPolicy(saved);
      setDraft(saved);
      setMessage('Saved. It applies to agent steps recorded from now on.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-[#3A322E] bg-[#25201D] p-4" aria-label="Agent evidence policy">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-[#EAE3D9]">
        <FileLock2 className="h-4 w-4 text-[#2A9D8F]" /> Agent evidence
      </h2>
      <p className="mb-3 text-[11px] text-[#A89F91]">
        What the step journal keeps of agent prompts, tool arguments and results. Digests, tokens and cost are always
        kept. Payloads are readable only by members with the <span className="font-mono">abada-evidence-reader</span> role,
        and every read is recorded.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex gap-2" disabled={!canEdit}>
          {MODES.map((mode) => (
            <label key={mode.id} title={mode.desc}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${draft.payloads === mode.id ? 'border-[#2A9D8F] bg-[#2A9D8F]/10 text-[#EAE3D9]' : 'border-[#3A322E] text-[#A89F91]'}`}>
              <input type="radio" className="sr-only" name="evidence-payloads" value={mode.id}
                checked={draft.payloads === mode.id} onChange={() => setDraft({ ...draft, payloads: mode.id })} />
              {mode.label}
            </label>
          ))}
        </fieldset>
        <label className="text-[11px] text-[#A89F91]">Keep payloads (days)
          <input aria-label="Retention days" type="number" min={1} max={3650} disabled={!canEdit}
            value={draft.retentionDays}
            onChange={(event) => setDraft({ ...draft, retentionDays: Number(event.target.value) })}
            className="ml-2 w-20 rounded-lg border border-[#3A322E] bg-[#14110D] px-2 py-1.5 text-xs text-[#EAE3D9]" />
        </label>
        {canEdit && (
          <button type="button" disabled={!changed || !validDays || saving} onClick={() => void save()}
            className="flex items-center gap-1 rounded-md border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-3 py-1.5 text-[11px] font-semibold text-[#2A9D8F] hover:bg-[#2A9D8F]/20 disabled:opacity-50">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save
          </button>
        )}
      </div>
      {message && <p className="mt-2 text-[11px] text-[#A89F91]">{message}</p>}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import * as yaml from 'yaml';
import {
  Plus,
  Trash2,
  Copy,
  FileDown,
  CheckCircle2,
  XCircle,
  Braces,
} from 'lucide-react';
import { WorkflowNode, DMNValue } from '@/types';
import {
  stringifyDecisionTableYaml,
  parseDecisionTableYaml,
} from '@/lib/apl/parser';

export type DmnOutputType = 'STRING' | 'NUMBER' | 'BOOLEAN';

const TOKEN_TYPE_OPTIONS = [
  { value: 'STRING', label: 'STRING — text' },
  { value: 'NUMBER', label: 'NUMBER — numeric' },
  { value: 'BOOLEAN', label: 'BOOLEAN — true/false' },
] as const;

/** Maps legacy/loose engine type labels onto the three typed output columns. */
const normType = (type?: string): DmnOutputType => {
  const t = (type || 'STRING').toUpperCase();
  if (t.includes('BOOL')) return 'BOOLEAN';
  if (t.includes('NUM') || t.includes('INT') || t === 'PERCENT') return 'NUMBER';
  return 'STRING';
};

const defaultForType = (type: DmnOutputType): DMNValue => {
  switch (type) {
    case 'BOOLEAN':
      return false;
    case 'NUMBER':
      return 0;
    default:
      return '';
  }
};

/** Renders a raw then-value as editable per declared output type. */
const TypedValueCell: React.FC<{
  value: DMNValue;
  type: DmnOutputType;
  onChange: (value: DMNValue) => void;
}> = ({ value, type, onChange }) => {
  if (type === 'BOOLEAN') {
    return (
      <input
        type="checkbox"
        checked={value === true || value === 'true'}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[#2A9D8F] rounded w-4 h-4"
      />
    );
  }
  if (type === 'NUMBER') {
    return (
      <input
        type="number"
        step="any"
        value={typeof value === 'number' ? value : ''}
        placeholder="0"
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-full bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
      />
    );
  }
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : String(value)}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
    />
  );
};

interface DmnRuleInspectorProps {
  node: WorkflowNode;
  onUpdateNode: (updatedNode: WorkflowNode) => void;
}

export const DmnRuleInspector: React.FC<DmnRuleInspectorProps> = ({ node, onUpdateNode }) => {
  const config = node.dmnConfig ?? null;
  const [yamlDraft, setYamlDraft] = useState<string>('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [yamlApplied, setYamlApplied] = useState(false);
  const [showYaml, setShowYaml] = useState<boolean>(false);

  const canonicalYaml = useMemo(
    () => (config ? stringifyDecisionTableYaml(config, node.id) : ''),
    [config, node.id]
  );

  if (!config) return null;

  const handleChange = (next: Partial<typeof config>) => {
    onUpdateNode({
      ...node,
      dmnConfig: { ...config, ...next },
    });
  };

  const updateRule = (id: string, patch: Partial<(typeof config.rules)[number]>) => {
    handleChange({
      rules: config.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  };

  const addRule = () => {
    handleChange({
      rules: [
        ...config.rules,
        {
          id: `r-${Date.now()}`,
          when: config.inputs.map((i) => i.name).join(' > 0 && ') + ' > 0',
          then: Object.fromEntries(config.outputs.map((o) => [o.name, defaultForType(normType(o.type))])),
          description: 'New rule',
        },
      ],
    });
  };

  const removeRule = (id: string) => {
    handleChange({ rules: config.rules.filter((r) => r.id !== id) });
  };

  const applyYaml = () => {
    try {
      const parsedNode = yaml.parse(yamlDraft) as any;
      const imported = parseDecisionTableYaml(parsedNode);
      onUpdateNode({ ...node, dmnConfig: imported });
      setYamlError(null);
      setYamlApplied(true);
    } catch (err: any) {
      setYamlError(err.message || 'Invalid APL YAML');
      setYamlApplied(false);
    }
  };

  const copyYaml = () => {
    navigator.clipboard?.writeText(canonicalYaml).catch(() => undefined);
  };

  return (
    <div className="space-y-4 pt-4 border-t border-[#3A322E]">
      <span className="text-[11px] font-semibold tracking-wider text-[#2A9D8F] uppercase block">
        Decision Table (Law / Guardrail)
      </span>

      <div className="space-y-1.5">
        <label className="text-xs text-[#A89F91] block">Decision Key ID</label>
        <input
          type="text"
          value={config.decisionKey}
          onChange={(e) => handleChange({ decisionKey: e.target.value })}
          className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-[#A89F91] block">Hit Policy</label>
        <select
          value={config.hitPolicy}
          onChange={(e) => handleChange({ hitPolicy: e.target.value as typeof config.hitPolicy })}
          className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
        >
          <option value="FIRST">FIRST (First matching rule applies)</option>
          <option value="UNIQUE">UNIQUE (Only one rule can match)</option>
          <option value="COLLECT">COLLECT (Accumulate all outcomes)</option>
        </select>
      </div>

      {/* Input variables mapping */}
      <div className="space-y-1.5">
        <label className="text-xs text-[#A89F91] block">Input Variables (name + {'${...}'} expression)</label>
        <div className="rounded-lg border border-[#3A322E] divide-y divide-[#3A322E] bg-[#1A1614] overflow-hidden">
          {config.inputs.map((input, idx) => (
            <div key={`${input.name}-${idx}`} className="group flex items-center gap-1.5 px-2 py-1.5">
              <input
                type="text"
                value={input.name}
                placeholder="credit_score"
                onChange={(e) => {
                  const inputs = [...config.inputs];
                  inputs[idx] = { ...inputs[idx], name: e.target.value };
                  handleChange({ inputs });
                }}
                className="w-28 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
              />
              <input
                type="text"
                value={input.expr || ''}
                placeholder="${extract_data.credit_score}"
                onChange={(e) => {
                  const inputs = [...config.inputs];
                  inputs[idx] = { ...inputs[idx], expr: e.target.value };
                  handleChange({ inputs });
                }}
                className="flex-1 min-w-0 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
              />
              <button
                onClick={() => handleChange({ inputs: config.inputs.filter((_, i) => i !== idx) })}
                className="text-red-400 hover:text-red-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete input"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => handleChange({ inputs: [...config.inputs, { name: `input_${config.inputs.length + 1}`, expr: '' }] })}
            className="w-full text-left text-xs text-[#2A9D8F] hover:text-[#38c2b1] flex items-center gap-1 font-medium px-3 py-2"
          >
            <Plus className="w-3 h-3" />
            <span>Add Input</span>
          </button>
        </div>
      </div>

      {/* Outputs declaration */}
      <div className="space-y-1.5">
        <label className="text-xs text-[#A89F91] block">Output Columns (typed)</label>
        <div className="rounded-lg divide-y divide-[#3A322E] border border-[#3A322E] bg-[#1A1614] overflow-hidden">
          {config.outputs.map((out, idx) => (
            <div key={`${out.name}-${idx}`} className="group flex items-center gap-1.5 px-2 py-1.5">
              <input
                type="text"
                value={out.name}
                placeholder="tax_rate"
                onChange={(e) => {
                  const outputs = [...config.outputs];
                  outputs[idx] = { ...outputs[idx], name: e.target.value };
                  handleChange({ outputs });
                }}
                className="w-28 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
              />
              <select
                value={out.type}
                onChange={(e) => {
                  const outputs = [...config.outputs];
                  outputs[idx] = { ...outputs[idx], type: e.target.value };
                  handleChange({ outputs });
                }}
                className="flex-1 bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#2A9D8F] focus:outline-none focus:border-[#2A9D8F]"
              >
                {TOKEN_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleChange({ outputs: config.outputs.filter((_, i) => i !== idx) })}
                className="text-red-400 hover:text-red-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete output"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => handleChange({ outputs: [...config.outputs, { name: `output_${config.outputs.length + 1}`, type: 'STRING' }] })}
            className="w-full text-left text-xs text-[#2A9D8F] hover:text-[#38c2b1] flex items-center gap-1 font-medium px-3 py-2"
          >
            <Plus className="w-3 h-3" />
            <span>Add Output Column</span>
          </button>
        </div>
      </div>

      {/* Rules matrix */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-[#EAE3D9]">Rules Matrix ({config.rules.length})</span>
          <button
            onClick={addRule}
            className="text-xs text-[#2A9D8F] hover:text-[#38c2b1] flex items-center gap-1 font-medium"
          >
            <Plus className="w-3 h-3" />
            <span>Add Rule</span>
          </button>
        </div>

        <div className="space-y-2">
          {config.rules.map((rule, idx) => (
            <div key={rule.id} className="p-2.5 bg-[#1A1614] rounded-xl border border-[#3A322E] text-xs space-y-1.5 relative group">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#2A9D8F]">Rule #{idx + 1}</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] text-[#A89F91] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.otherwise || false}
                      onChange={(e) => {
                        const updated = [...config.rules];
                        updated.forEach((r) => (r.otherwise = false));
                        updated[idx] = {
                          ...updated[idx],
                          otherwise: e.target.checked,
                          when: e.target.checked ? undefined : updated[idx].when,
                        };
                        handleChange({ rules: updated });
                      }}
                      className="accent-[#2A9D8F] rounded"
                    />
                    otherwise
                  </label>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {rule.otherwise ? (
                <span className="text-[10px] text-[#F4A261] block font-semibold">
                  ↳ Else branch — applied when no other rule matches
                </span>
              ) : (
                <div>
                  <span className="text-[10px] text-[#A89F91] block">WHEN (deterministic condition)</span>
                  <input
                    type="text"
                    value={rule.when || ''}
                    placeholder={config.inputs.map((i) => i.name).join(' && ') || 'condition'}
                    onChange={(e) => updateRule(rule.id, { when: e.target.value })}
                    className="w-full bg-[#25201D] border border-[#3A322E] rounded px-2 py-1 text-[11px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                  />
                </div>
              )}

              {/* Typed THEN outputs — one cell per declared output column */}
              <div className="grid gap-1.5 pt-1">
                <span className="text-[10px] text-[#A89F91]">THEN outputs</span>
                {config.outputs.map((out) => (
                  <div key={out.name} className="flex items-center gap-1.5">
                    <span className="w-28 text-[10px] font-mono text-[#EAE3D9] truncate">{out.name}</span>
                    <TypedValueCell
                      type={normType(out.type)}
                      value={rule.then?.[out.name] ?? defaultForType(normType(out.type))}
                      onChange={(value) =>
                        updateRule(rule.id, {
                          then: { ...rule.then, [out.name]: value },
                        })
                      }
                    />
                  </div>
                ))}
                {config.outputs.length === 0 && (
                  <p className="text-[10px] text-[#A89F91]">
                    Declare output columns above to bind typed rule outputs.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Canonical APL YAML sync mirror */}
      <div className="pt-3 border-t border-[#3A322E] space-y-2">
        <button
          onClick={() => setShowYaml((s) => !s)}
          className="w-full text-left text-[11px] font-semibold text-[#9D4EDD] uppercase tracking-wider flex items-center gap-1.5"
        >
          <Braces className="w-3.5 h-3.5" />
          Canonical APL YAML (AI Diff / PR format)
          <span className="text-[#A89F91] normal-case font-normal ml-auto">{showYaml ? 'Hide' : 'Show'}</span>
        </button>

        {showYaml && (
          <div className="space-y-2">
            <pre className="bg-[#1A1614] border border-[#3A322E] rounded-xl p-3 text-[10px] font-mono text-[#9D4EDD] overflow-x-auto max-h-56 whitespace-pre-wrap">
              {canonicalYaml}
            </pre>
            <div className="flex items-center gap-2">
              <button
                onClick={copyYaml}
                className="text-[11px] text-[#EAE3D9] bg-[#25201D] hover:bg-[#2F2926] border border-[#3A322E] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
              >
                <Copy className="w-3 h-3 text-[#2A9D8F]" />
                Copy
              </button>
            </div>

            <textarea
              rows={5}
              value={yamlDraft}
              onChange={(e) => {
                setYamlDraft(e.target.value);
                setYamlError(null);
                setYamlApplied(false);
              }}
              placeholder={
                'Paste a canonical decision-table node here, e.g.:\n' +
                'id: extract_data\n' +
                'type: decision-table\n' +
                'decisionKey: DMN_POLICY_V1\n' +
                'hitPolicy: FIRST\n' +
                'inputs:\n' +
                '  - name: score\n' +
                "    expr: '${extract_data.credit_score}'\n" +
                'rules:\n' +
                '  - when: score >= 750\n' +
                '    then:\n' +
                '      risk_level: LOW'
              }
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl p-3 text-[10px] font-mono text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]"
            />
            {yamlError && <p className="text-[10px] text-red-400">{yamlError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={applyYaml}
                className="text-[11px] font-semibold text-[#1A1614] bg-[#9D4EDD] hover:bg-[#b56ef2] px-3 py-1.5 rounded-lg flex items-center gap-1"
              >
                <FileDown className="w-3 h-3" />
                Import and Normalize
              </button>
              {yamlApplied && (
                <span className="text-[11px] text-[#90A955] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Imported — rules normalized
                </span>
              )}
              {yamlError && (
                <span className="text-[11px] text-[#E76F51] flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  Invalid YAML
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
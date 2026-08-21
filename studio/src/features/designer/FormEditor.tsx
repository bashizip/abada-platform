import React, { useState, useEffect } from 'react';
import { Type, Hash, ToggleLeft, ListOrdered, Save, Trash2, ArrowUp, ArrowDown, LayoutTemplate, Settings2, X, Plus, AlignLeft, Calendar } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { FormField, FormFieldType, FormSchema } from '@/features/inbox/formSchema';

export type { FormFieldType, FormField, FormSchema } from '@/features/inbox/formSchema';

interface FormEditorProps {
  initialSchema: FormSchema;
  onSave: (schema: FormSchema) => void;
  onClose: () => void;
  saving?: boolean;
}

const DEFAULT_SCHEMA: FormSchema = { title: 'New Form', fields: [] };

export const FormEditor: React.FC<FormEditorProps> = ({ initialSchema, onSave, onClose, saving = false }) => {
  const [schema, setSchema] = useState<FormSchema>(initialSchema || DEFAULT_SCHEMA);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null);

  const addField = (type: FormFieldType) => {
    const newField: FormField = {
      id: `field_${Date.now()}`,
      type,
      label: `New ${type} field`,
      required: false,
      ...(type === 'select' ? { options: ['Option 1', 'Option 2'] } : {})
    };
    setSchema(prev => ({ ...prev, fields: [...prev.fields, newField] }));
    setSelectedFieldIndex(schema.fields.length);
  };

  const updateSelectedField = (updates: Partial<FormField>) => {
    if (selectedFieldIndex === null) return;
    setSchema(prev => {
      const newFields = [...prev.fields];
      newFields[selectedFieldIndex] = { ...newFields[selectedFieldIndex], ...updates };
      return { ...prev, fields: newFields };
    });
  };

  const removeField = (index: number) => {
    setSchema(prev => {
      const newFields = [...prev.fields];
      newFields.splice(index, 1);
      return { ...prev, fields: newFields };
    });
    if (selectedFieldIndex === index) setSelectedFieldIndex(null);
    else if (selectedFieldIndex !== null && selectedFieldIndex > index) setSelectedFieldIndex(selectedFieldIndex - 1);
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === schema.fields.length - 1) return;

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    setSchema(prev => {
      const newFields = [...prev.fields];
      const temp = newFields[index];
      newFields[index] = newFields[swapIndex];
      newFields[swapIndex] = temp;
      return { ...prev, fields: newFields };
    });

    if (selectedFieldIndex === index) setSelectedFieldIndex(swapIndex);
    else if (selectedFieldIndex === swapIndex) setSelectedFieldIndex(index);
  };

  const selectedField = selectedFieldIndex !== null ? schema.fields[selectedFieldIndex] : null;

  return (
    <div className="flex flex-col h-full bg-[#1A1614] overflow-hidden rounded-xl border border-[#3A322E] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A322E] bg-[#25201D] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#2A9D8F]/10 border border-[#2A9D8F]/30 flex items-center justify-center">
            <LayoutTemplate className="w-4 h-4 text-[#2A9D8F]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#EAE3D9]">Form Builder</h2>
            <p className="text-xs text-[#A89F91]">Design human task approval forms</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-[#A89F91] hover:text-[#EAE3D9] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(schema)}
            disabled={saving}
            className="flex items-center gap-2 bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] px-6 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 text-sm shadow-warm-md"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Form'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Palette (Left) */}
        <div className="w-64 border-r border-[#3A322E] bg-[#25201D] p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-xs font-bold uppercase tracking-wider text-[#737D69]">Form Settings</div>
          <div className="space-y-1">
            <label className="text-xs text-[#A89F91]">Form Title</label>
            <input
              type="text"
              value={schema.title}
              onChange={(e) => setSchema({ ...schema, title: e.target.value })}
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-md px-3 py-1.5 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
            />
          </div>

          <div className="text-xs font-bold uppercase tracking-wider text-[#737D69] mt-4">Add Fields</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => addField('string')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <Type className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Text</span>
            </button>
            <button onClick={() => addField('number')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <Hash className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Number</span>
            </button>
            <button onClick={() => addField('boolean')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <ToggleLeft className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Boolean</span>
            </button>
            <button onClick={() => addField('select')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <ListOrdered className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Select</span>
            </button>
            <button onClick={() => addField('textarea')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <AlignLeft className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Textarea</span>
            </button>
            <button onClick={() => addField('date')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50 hover:bg-[#2A9D8F]/10 transition-colors group">
              <Calendar className="w-5 h-5 text-[#A89F91] group-hover:text-[#2A9D8F]" />
              <span className="text-xs font-semibold text-[#EAE3D9]">Date</span>
            </button>
          </div>
        </div>

        {/* Canvas (Center) */}
        <div className="flex-1 bg-[#1A1614] p-8 overflow-y-auto relative">
          <div className="max-w-2xl mx-auto">
            <div className="bg-[#25201D] border border-[#3A322E] rounded-xl shadow-xl min-h-[400px]">
              <div className="p-6 border-b border-[#3A322E] bg-[#2B2523] rounded-t-xl">
                <h1 className="text-2xl font-bold text-[#EAE3D9]">{schema.title || 'Untitled Form'}</h1>
              </div>
              
              <div className="p-6 space-y-4">
                {schema.fields.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-[#A89F91] border-2 border-dashed border-[#3A322E] rounded-xl">
                    <LayoutTemplate className="w-12 h-12 mb-3 text-[#3A322E]" />
                    <p className="text-sm font-semibold">Empty Form</p>
                    <p className="text-xs text-[#737D69] mt-1">Click fields on the left to add them to your form.</p>
                  </div>
                ) : (
                  schema.fields.map((field, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedFieldIndex(idx)}
                      className={`relative p-4 rounded-xl border-2 transition-colors cursor-pointer group ${selectedFieldIndex === idx ? 'border-[#2A9D8F] bg-[#2A9D8F]/5' : 'border-[#3A322E] bg-[#1A1614] hover:border-[#2A9D8F]/50'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <label className="text-sm font-semibold text-[#EAE3D9]">
                          {field.label} {field.required && <span className="text-[#E76F51]">*</span>}
                        </label>
                        
                        {/* Hover Actions */}
                        <div className={`flex items-center gap-1 bg-[#25201D] border border-[#3A322E] rounded-lg p-1 transition-opacity ${selectedFieldIndex === idx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'up'); }} disabled={idx === 0} className="p-1 hover:text-[#EAE3D9] text-[#A89F91] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ArrowUp className="w-3.5 h-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'down'); }} disabled={idx === schema.fields.length - 1} className="p-1 hover:text-[#EAE3D9] text-[#A89F91] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ArrowDown className="w-3.5 h-3.5" /></button>
                          <div className="w-px h-4 bg-[#3A322E] mx-1" />
                          <button onClick={(e) => { e.stopPropagation(); removeField(idx); }} className="p-1 hover:text-[#E76F51] text-[#A89F91] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      {field.type === 'string' && <div className="h-10 border border-[#3A322E] bg-[#25201D] rounded-lg w-full flex items-center px-3 text-[#A89F91] text-sm">Text input...</div>}
                      {field.type === 'number' && <div className="h-10 border border-[#3A322E] bg-[#25201D] rounded-lg w-full flex items-center px-3 text-[#A89F91] text-sm">0.00</div>}
                      {field.type === 'boolean' && <div className="w-10 h-6 bg-[#3A322E] rounded-full flex items-center p-1"><div className="w-4 h-4 bg-[#A89F91] rounded-full" /></div>}
                      {field.type === 'select' && (
                        <div className="h-10 border border-[#3A322E] bg-[#25201D] rounded-lg w-full flex items-center px-3 text-[#EAE3D9] text-sm justify-between">
                          <span>{field.options?.[0] || 'Select an option'}</span>
                          <ArrowDown className="w-3 h-3 text-[#A89F91]" />
                        </div>
                      )}
                      {field.type === 'textarea' && (
                        <div className="h-16 border border-[#3A322E] bg-[#25201D] rounded-lg w-full p-3 text-[#A89F91] text-sm">Multi-line text input...</div>
                      )}
                      {field.type === 'date' && (
                        <div className="h-10 border border-[#3A322E] bg-[#25201D] rounded-lg w-full flex items-center px-3 text-[#A89F91] text-sm">YYYY-MM-DD</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Properties (Right) */}
        <div className="w-72 border-l border-[#3A322E] bg-[#25201D] p-5 flex flex-col overflow-y-auto">
          <div className="flex items-center gap-2 mb-6 text-[#EAE3D9]">
            <Settings2 className="w-4 h-4 text-[#2A9D8F]" />
            <h3 className="font-bold">Field Properties</h3>
          </div>

          {selectedField ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#A89F91]">Field Label</label>
                <input
                  type="text"
                  value={selectedField.label}
                  onChange={(e) => updateSelectedField({ label: e.target.value })}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#A89F91]">Process Variable ID</label>
                <input
                  type="text"
                  value={selectedField.id}
                  onChange={(e) => updateSelectedField({ id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] font-mono focus:outline-none focus:border-[#2A9D8F]"
                />
                <p className="text-[10px] text-[#737D69]">Only alphanumeric and underscores.</p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(e) => updateSelectedField({ required: e.target.checked })}
                  className="rounded border-[#3A322E] text-[#2A9D8F] focus:ring-[#2A9D8F]"
                />
                <span className="text-sm font-semibold text-[#EAE3D9]">Required Field</span>
              </label>

              {selectedField.type !== 'boolean' && (
                <div className="space-y-1.5 pt-3 border-t border-[#3A322E]">
                  <label className="text-xs font-semibold text-[#A89F91]">Default Value</label>
                  {selectedField.type === 'textarea' ? (
                    <textarea
                      rows={2}
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value })}
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F] resize-y"
                    />
                  ) : selectedField.type === 'number' ? (
                    <input
                      type="number"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value === '' ? undefined : Number(e.target.value) })}
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                    />
                  ) : selectedField.type === 'date' ? (
                    <input
                      type="date"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value || undefined })}
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                    />
                  ) : (
                    <input
                      type="text"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value })}
                      className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                    />
                  )}
                </div>
              )}

              {(selectedField.type === 'string' || selectedField.type === 'textarea' || selectedField.type === 'number') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#A89F91]">Placeholder</label>
                  <input
                    type="text"
                    value={selectedField.placeholder || ''}
                    onChange={(e) => updateSelectedField({ placeholder: e.target.value })}
                    className="w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-3 py-2 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                  />
                </div>
              )}

              {selectedField.type === 'select' && (
                <div className="space-y-3 pt-4 border-t border-[#3A322E]">
                  <label className="text-xs font-semibold text-[#A89F91]">Select Options</label>
                  <div className="space-y-2">
                    {(selectedField.options || []).map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const newOpts = [...(selectedField.options || [])];
                            newOpts[idx] = e.target.value;
                            updateSelectedField({ options: newOpts });
                          }}
                          className="flex-1 bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1.5 text-sm text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]"
                        />
                        <button
                          onClick={() => {
                            const newOpts = [...(selectedField.options || [])];
                            newOpts.splice(idx, 1);
                            updateSelectedField({ options: newOpts });
                          }}
                          className="p-1 text-[#A89F91] hover:text-[#E76F51] transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => updateSelectedField({ options: [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`] })}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[#2A9D8F] hover:text-[#34bdae] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Option
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-[#A89F91] text-sm">
              Select a field on the canvas to edit its properties.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
    <div className="flex flex-col h-full bg-charcoal overflow-hidden rounded-xl border border-hairline shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline bg-mocha shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-mineral-teal/10 border border-mineral-teal/30 flex items-center justify-center">
            <LayoutTemplate className="w-4 h-4 text-mineral-teal" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-linen">Form Builder</h2>
            <p className="text-xs text-sand">Design human task approval forms</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-sand hover:text-linen transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(schema)}
            disabled={saving}
            className="flex items-center gap-2 bg-mineral-teal hover:bg-mineral-teal-bright text-charcoal px-6 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 text-sm shadow-warm-md"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Form'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Palette (Left) */}
        <div className="w-64 border-r border-hairline bg-mocha p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-xs font-bold uppercase tracking-wider text-moss">Form Settings</div>
          <div className="space-y-1">
            <label className="text-xs text-sand">Form Title</label>
            <input
              type="text"
              value={schema.title}
              onChange={(e) => setSchema({ ...schema, title: e.target.value })}
              className="w-full bg-charcoal border border-hairline rounded-md px-3 py-1.5 text-sm text-linen focus:outline-none focus:border-mineral-teal"
            />
          </div>

          <div className="text-xs font-bold uppercase tracking-wider text-moss mt-4">Add Fields</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => addField('string')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <Type className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Text</span>
            </button>
            <button onClick={() => addField('number')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <Hash className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Number</span>
            </button>
            <button onClick={() => addField('boolean')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <ToggleLeft className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Boolean</span>
            </button>
            <button onClick={() => addField('select')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <ListOrdered className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Select</span>
            </button>
            <button onClick={() => addField('textarea')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <AlignLeft className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Textarea</span>
            </button>
            <button onClick={() => addField('date')} className="flex flex-col items-center gap-2 p-3 rounded-lg border border-hairline bg-charcoal hover:border-mineral-teal/50 hover:bg-mineral-teal/10 transition-colors group">
              <Calendar className="w-5 h-5 text-sand group-hover:text-mineral-teal" />
              <span className="text-xs font-semibold text-linen">Date</span>
            </button>
          </div>
        </div>

        {/* Canvas (Center) */}
        <div className="flex-1 bg-charcoal p-8 overflow-y-auto relative">
          <div className="max-w-2xl mx-auto">
            <div className="bg-mocha border border-hairline rounded-xl shadow-xl min-h-[400px]">
              <div className="p-6 border-b border-hairline bg-[#2B2523] rounded-t-xl">
                <h1 className="text-2xl font-bold text-linen">{schema.title || 'Untitled Form'}</h1>
              </div>
              
              <div className="p-6 space-y-4">
                {schema.fields.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-sand border-2 border-dashed border-hairline rounded-xl">
                    <LayoutTemplate className="w-12 h-12 mb-3 text-hairline" />
                    <p className="text-sm font-semibold">Empty Form</p>
                    <p className="text-xs text-moss mt-1">Click fields on the left to add them to your form.</p>
                  </div>
                ) : (
                  schema.fields.map((field, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedFieldIndex(idx)}
                      className={`relative p-4 rounded-xl border-2 transition-colors cursor-pointer group ${selectedFieldIndex === idx ? 'border-mineral-teal bg-mineral-teal/5' : 'border-hairline bg-charcoal hover:border-mineral-teal/50'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <label className="text-sm font-semibold text-linen">
                          {field.label} {field.required && <span className="text-desert-rose">*</span>}
                        </label>
                        
                        {/* Hover Actions */}
                        <div className={`flex items-center gap-1 bg-mocha border border-hairline rounded-lg p-1 transition-opacity ${selectedFieldIndex === idx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'up'); }} disabled={idx === 0} className="p-1 hover:text-linen text-sand disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ArrowUp className="w-3.5 h-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'down'); }} disabled={idx === schema.fields.length - 1} className="p-1 hover:text-linen text-sand disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ArrowDown className="w-3.5 h-3.5" /></button>
                          <div className="w-px h-4 bg-hairline mx-1" />
                          <button onClick={(e) => { e.stopPropagation(); removeField(idx); }} className="p-1 hover:text-desert-rose text-sand transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      {field.type === 'string' && <div className="h-10 border border-hairline bg-mocha rounded-lg w-full flex items-center px-3 text-sand text-sm">Text input...</div>}
                      {field.type === 'number' && <div className="h-10 border border-hairline bg-mocha rounded-lg w-full flex items-center px-3 text-sand text-sm">0.00</div>}
                      {field.type === 'boolean' && <div className="w-10 h-6 bg-hairline rounded-full flex items-center p-1"><div className="w-4 h-4 bg-sand rounded-full" /></div>}
                      {field.type === 'select' && (
                        <div className="h-10 border border-hairline bg-mocha rounded-lg w-full flex items-center px-3 text-linen text-sm justify-between">
                          <span>{field.options?.[0] || 'Select an option'}</span>
                          <ArrowDown className="w-3 h-3 text-sand" />
                        </div>
                      )}
                      {field.type === 'textarea' && (
                        <div className="h-16 border border-hairline bg-mocha rounded-lg w-full p-3 text-sand text-sm">Multi-line text input...</div>
                      )}
                      {field.type === 'date' && (
                        <div className="h-10 border border-hairline bg-mocha rounded-lg w-full flex items-center px-3 text-sand text-sm">YYYY-MM-DD</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Properties (Right) */}
        <div className="w-72 border-l border-hairline bg-mocha p-5 flex flex-col overflow-y-auto">
          <div className="flex items-center gap-2 mb-6 text-linen">
            <Settings2 className="w-4 h-4 text-mineral-teal" />
            <h3 className="font-bold">Field Properties</h3>
          </div>

          {selectedField ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sand">Field Label</label>
                <input
                  type="text"
                  value={selectedField.label}
                  onChange={(e) => updateSelectedField({ label: e.target.value })}
                  className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sand">Process Variable ID</label>
                <input
                  type="text"
                  value={selectedField.id}
                  onChange={(e) => updateSelectedField({ id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                  className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen font-mono focus:outline-none focus:border-mineral-teal"
                />
                <p className="text-[10px] text-moss">Only alphanumeric and underscores.</p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(e) => updateSelectedField({ required: e.target.checked })}
                  className="rounded border-hairline text-mineral-teal focus:ring-mineral-teal"
                />
                <span className="text-sm font-semibold text-linen">Required Field</span>
              </label>

              {selectedField.type !== 'boolean' && (
                <div className="space-y-1.5 pt-3 border-t border-hairline">
                  <label className="text-xs font-semibold text-sand">Default Value</label>
                  {selectedField.type === 'textarea' ? (
                    <textarea
                      rows={2}
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value })}
                      className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal resize-y"
                    />
                  ) : selectedField.type === 'number' ? (
                    <input
                      type="number"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value === '' ? undefined : Number(e.target.value) })}
                      className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                    />
                  ) : selectedField.type === 'date' ? (
                    <input
                      type="date"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value || undefined })}
                      className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                    />
                  ) : (
                    <input
                      type="text"
                      value={selectedField.defaultValue === undefined ? '' : String(selectedField.defaultValue)}
                      onChange={(e) => updateSelectedField({ defaultValue: e.target.value })}
                      className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                    />
                  )}
                </div>
              )}

              {(selectedField.type === 'string' || selectedField.type === 'textarea' || selectedField.type === 'number') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-sand">Placeholder</label>
                  <input
                    type="text"
                    value={selectedField.placeholder || ''}
                    onChange={(e) => updateSelectedField({ placeholder: e.target.value })}
                    className="w-full bg-charcoal border border-hairline rounded-lg px-3 py-2 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                  />
                </div>
              )}

              {selectedField.type === 'select' && (
                <div className="space-y-3 pt-4 border-t border-hairline">
                  <label className="text-xs font-semibold text-sand">Select Options</label>
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
                          className="flex-1 bg-charcoal border border-hairline rounded-lg px-2 py-1.5 text-sm text-linen focus:outline-none focus:border-mineral-teal"
                        />
                        <button
                          onClick={() => {
                            const newOpts = [...(selectedField.options || [])];
                            newOpts.splice(idx, 1);
                            updateSelectedField({ options: newOpts });
                          }}
                          className="p-1 text-sand hover:text-desert-rose transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => updateSelectedField({ options: [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`] })}
                    className="flex items-center gap-1.5 text-xs font-semibold text-mineral-teal hover:text-mineral-teal-bright transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Option
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sand text-sm">
              Select a field on the canvas to edit its properties.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

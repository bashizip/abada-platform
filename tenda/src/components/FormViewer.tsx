import React, { useMemo } from 'react';
import { ProjectResourceContentDTO } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type FormFieldType = 'string' | 'number' | 'boolean' | 'select';

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  options?: string[];
}

export interface FormSchema {
  title?: string;
  fields?: FormField[];
}

interface FormViewerProps {
  formData: ProjectResourceContentDTO;
  values?: Record<string, unknown>;
  onChange?: (name: string, value: unknown) => void;
  readOnly?: boolean;
}

export const FormViewer: React.FC<FormViewerProps> = ({
  formData,
  values = {},
  onChange,
  readOnly = true,
}) => {
  const schema: FormSchema | null = useMemo(() => {
    if (!formData?.contentBase64) return null;
    try {
      const jsonStr = atob(formData.contentBase64);
      return JSON.parse(jsonStr) as FormSchema;
    } catch {
      try {
        const decoded = decodeURIComponent(
          escape(atob(formData.contentBase64))
        );
        return JSON.parse(decoded) as FormSchema;
      } catch {
        return null;
      }
    }
  }, [formData]);

  if (!schema || !schema.fields || schema.fields.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">
        {schema?.title ? `Form: ${schema.title} (No fields defined)` : 'Empty or invalid form schema'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schema.title && (
        <div className="border-b border-slate-700/60 pb-2">
          <h3 className="text-sm font-semibold text-slate-200 tracking-tight">
            {schema.title}
          </h3>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {schema.fields.map((field) => {
          const fieldId = `field-${field.id}`;
          const fieldValue = values[field.label || field.id];

          return (
            <div
              key={field.id}
              className="space-y-1 bg-slate-900/40 p-2.5 rounded border border-slate-800/80"
            >
              <div className="flex items-center justify-between">
                <Label
                  htmlFor={fieldId}
                  className="text-xs font-medium text-slate-300 tracking-wide"
                >
                  {field.label || field.id}
                  {field.required && (
                    <span className="text-rose-400 ml-1">*</span>
                  )}
                </Label>
                <span className="text-[10px] uppercase font-mono text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded">
                  {field.type}
                </span>
              </div>

              {field.type === 'string' && (
                <Input
                  id={fieldId}
                  value={String(fieldValue ?? '')}
                  onChange={(e) =>
                    onChange?.(field.label || field.id, e.target.value)
                  }
                  disabled={readOnly}
                  className="h-8 text-xs bg-slate-950/60 border-slate-800 focus:border-indigo-500 text-slate-200"
                  placeholder={`Enter ${field.label || 'value'}...`}
                />
              )}

              {field.type === 'number' && (
                <Input
                  id={fieldId}
                  type="number"
                  value={fieldValue !== undefined ? String(fieldValue) : ''}
                  onChange={(e) =>
                    onChange?.(
                      field.label || field.id,
                      e.target.value === '' ? undefined : Number(e.target.value)
                    )
                  }
                  disabled={readOnly}
                  className="h-8 text-xs bg-slate-950/60 border-slate-800 focus:border-indigo-500 text-slate-200"
                  placeholder="0"
                />
              )}

              {field.type === 'boolean' && (
                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox
                    id={fieldId}
                    checked={Boolean(fieldValue)}
                    onCheckedChange={(checked) =>
                      onChange?.(field.label || field.id, Boolean(checked))
                    }
                    disabled={readOnly}
                  />
                  <label
                    htmlFor={fieldId}
                    className="text-xs text-slate-400 cursor-pointer"
                  >
                    {field.label || 'Yes / No'}
                  </label>
                </div>
              )}

              {field.type === 'select' && (
                <Select
                  value={String(fieldValue ?? '')}
                  onValueChange={(val) => onChange?.(field.label || field.id, val)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-8 text-xs bg-slate-950/60 border-slate-800 text-slate-200">
                    <SelectValue placeholder="Select an option..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-200 text-xs">
                    {(field.options || []).map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-xs">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

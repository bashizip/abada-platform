-- Add form_key column to tasks table for human-input nodes.
-- The form_key stores the project file identifier (e.g., "forms/leads.json") that
-- the tenda task detail view will load dynamically to render the human input form.

ALTER TABLE tasks ADD COLUMN form_key TEXT;
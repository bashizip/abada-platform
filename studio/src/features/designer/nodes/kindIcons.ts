import { Bot, Clock, Code2, Mail, Radio, Repeat, Table, UserCheck, Workflow, Zap, type LucideIcon } from 'lucide-react';
import type { NodeKind } from './nodeCatalog';

const ICON: Partial<Record<NodeKind, LucideIcon>> = {
  message: Mail,
  timer: Clock,
  signal: Radio,
  agent: Bot,
  'human-input': UserCheck,
  'engine-task': Zap,
  script: Code2,
  'decision-table': Table,
  'call-process': Workflow,
  'for-each': Repeat,
};

/** The icon of a kind (catch events and activities); start, end and gateways draw a marker instead. */
export const kindIcon = (kind: NodeKind): LucideIcon | undefined => ICON[kind];

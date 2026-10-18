import { createContext } from 'react';

/** The node kind whose sections are shown; scopes the remembered open/closed state of each section. */
export const SectionScope = createContext('node');

import { createContext, useContext } from 'react';

/**
 * Where file references in a JSON view can be downloaded from: the project of
 * the instance on screen. Without it a file chip only shows the file.
 */
export interface FileAccess {
  projectId: string;
}

export const FileAccessContext = createContext<FileAccess | null>(null);

export const useFileAccess = (): FileAccess | null => useContext(FileAccessContext);

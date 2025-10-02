/**
 * Utility functions for message formatting and parsing
 */

// File path patterns
const FILE_PATH_PATTERN = /(?:^|\s)((?:[a-zA-Z]:)?(?:[\/\\][\w\s\-\.]+)+\.[\w]+)(?::(\d+))?/g;
const FILE_MENTION_PATTERN = /@((?:[a-zA-Z]:)?(?:[\/\\][\w\s\-\.]+)+\.[\w]+)/g;

export interface FileReference {
  path: string;
  lineNumber?: number;
  startIndex: number;
  endIndex: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface MultiEditOperation {
  file_path: string;
  edits: EditOperation[];
}

/**
 * Extract file references from text
 */
export function extractFileReferences(text: string): FileReference[] {
  const references: FileReference[] = [];
  const regex = new RegExp(FILE_PATH_PATTERN);
  let match;

  while ((match = regex.exec(text)) !== null) {
    references.push({
      path: match[1],
      lineNumber: match[2] ? parseInt(match[2], 10) : undefined,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return references;
}

/**
 * Extract @file mentions from text
 */
export function extractFileMentions(text: string): FileReference[] {
  const mentions: FileReference[] = [];
  const regex = new RegExp(FILE_MENTION_PATTERN);
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      path: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return mentions;
}

/**
 * Parse tool input JSON
 */
export function parseToolInput(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Parse TodoWrite tool input
 */
export function parseTodoWrite(content: string): TodoItem[] | null {
  const parsed = parseToolInput(content);
  if (!parsed || !Array.isArray(parsed.todos)) {
    return null;
  }
  return parsed.todos;
}

/**
 * Get status icon for todo item
 */
export function getTodoStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'in_progress':
      return '🔄';
    case 'pending':
      return '⏳';
    default:
      return '⏳';
  }
}

/**
 * Parse Edit tool input
 */
export function parseEditTool(content: string): {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
} | null {
  const parsed = parseToolInput(content);
  if (!parsed || !parsed.file_path || !parsed.old_string || !parsed.new_string) {
    return null;
  }
  return parsed;
}

/**
 * Parse MultiEdit tool input
 */
export function parseMultiEditTool(content: string): MultiEditOperation[] | null {
  const parsed = parseToolInput(content);
  if (!parsed || !Array.isArray(parsed.edits)) {
    return null;
  }
  return parsed.edits;
}

/**
 * Parse Write tool input
 */
export function parseWriteTool(content: string): {
  file_path: string;
  content: string;
} | null {
  const parsed = parseToolInput(content);
  if (!parsed || !parsed.file_path || parsed.content === undefined) {
    return null;
  }
  return parsed;
}

/**
 * Parse Read tool input
 */
export function parseReadTool(content: string): {
  file_path: string;
  offset?: number;
  limit?: number;
} | null {
  const parsed = parseToolInput(content);
  if (!parsed || !parsed.file_path) {
    return null;
  }
  return parsed;
}

/**
 * Truncate content for display
 */
export function truncateContent(content: string, maxLines: number = 10): {
  truncated: string;
  isTruncated: boolean;
  totalLines: number;
} {
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines) {
    return {
      truncated: content,
      isTruncated: false,
      totalLines,
    };
  }

  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    isTruncated: true,
    totalLines,
  };
}

/**
 * Format diff lines with +/- prefix
 */
export function formatDiffLines(oldString: string, newString: string): {
  oldLines: string[];
  newLines: string[];
} {
  return {
    oldLines: oldString.split('\n').map(line => `- ${line}`),
    newLines: newString.split('\n').map(line => `+ ${line}`),
  };
}

/**
 * Get file extension from path
 */
export function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.(\w+)$/);
  return match ? match[1] : '';
}

/**
 * Get file name from path
 */
export function getFileName(filePath: string): string {
  return filePath.split(/[\/\\]/).pop() || filePath;
}

/**
 * Normalize path for display (convert backslashes to forward slashes)
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Get icon for file type
 */
export function getFileIcon(filePath: string): string {
  const ext = getFileExtension(filePath).toLowerCase();

  const iconMap: Record<string, string> = {
    js: '📜',
    jsx: '⚛️',
    ts: '📘',
    tsx: '⚛️',
    py: '🐍',
    java: '☕',
    cpp: '⚙️',
    c: '⚙️',
    h: '⚙️',
    cs: '🎯',
    go: '🐹',
    rs: '🦀',
    rb: '💎',
    php: '🐘',
    html: '🌐',
    css: '🎨',
    scss: '🎨',
    json: '📋',
    xml: '📄',
    md: '📝',
    txt: '📄',
    yml: '⚙️',
    yaml: '⚙️',
    toml: '⚙️',
    ini: '⚙️',
    conf: '⚙️',
    sh: '💻',
    bash: '💻',
    zsh: '💻',
    sql: '🗃️',
    db: '🗃️',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    svg: '🎨',
    pdf: '📕',
    zip: '📦',
    tar: '📦',
    gz: '📦',
  };

  return iconMap[ext] || '📄';
}

/**
 * Parse ExitPlanMode tool input
 */
export function parseExitPlanMode(content: string): {
  plan: string;
} | null {
  const parsed = parseToolInput(content);
  if (!parsed || !parsed.plan) {
    return null;
  }
  return parsed;
}

/**
 * Format tool name for display
 */
export function formatToolName(toolName: string): string {
  // Special cases
  const specialNames: Record<string, string> = {
    TodoWrite: 'Update Todos',
    WebFetch: 'Web Fetch',
    WebSearch: 'Web Search',
    NotebookEdit: 'Notebook Edit',
    BashOutput: 'Bash Output',
    KillShell: 'Kill Shell',
    SlashCommand: 'Slash Command',
    ExitPlanMode: 'Plan Complete',
  };

  return specialNames[toolName] || toolName;
}

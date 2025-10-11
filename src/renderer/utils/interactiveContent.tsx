/**
 * Interactive Content Utilities
 * Enhances tool results with clickable elements for better UX
 */

import React from 'react';

/**
 * Parse file paths from text (including Windows and Unix paths)
 * Matches patterns like:
 * - /path/to/file.ts:123
 * - C:\path\to\file.ts:123
 * - ./relative/path/file.ts
 * - src/components/App.tsx:45
 */
export function detectFilePaths(
  text: string
): Array<{ path: string; lineNumber?: number; start: number; end: number }> {
  const results: Array<{
    path: string;
    lineNumber?: number;
    start: number;
    end: number;
  }> = [];

  // Pattern for file paths with optional line numbers
  // Matches: path/to/file.ext:123 or path\to\file.ext:123
  const filePathRegex = /(?:^|\s|["']|at\s+)([A-Za-z]:[\\\/](?:[^\s:'"]+[\\\/])*[^\s:'"]+\.[a-zA-Z]{1,5}|(?:\.{1,2}[\\\/])?(?:[^\s:'"]+[\\\/])*[^\s:'"]+\.[a-zA-Z]{1,5})(?::(\d+))?/g;

  let match;
  while ((match = filePathRegex.exec(text)) !== null) {
    const fullMatch = match[0].trim();
    const path = match[1];
    const lineNumber = match[2] ? parseInt(match[2], 10) : undefined;

    results.push({
      path,
      lineNumber,
      start: match.index,
      end: match.index + fullMatch.length,
    });
  }

  return results;
}

/**
 * Parse error stack traces to extract file references
 * Handles common error formats:
 * - at functionName (file.ts:123:45)
 * - Error: message\n  at file.ts:123
 */
export function detectErrorTraces(
  text: string
): Array<{ path: string; lineNumber?: number; column?: number; context?: string }> {
  const traces: Array<{
    path: string;
    lineNumber?: number;
    column?: number;
    context?: string;
  }> = [];

  // Pattern for stack trace lines
  // Matches: at functionName (C:\path\file.ts:123:45) or at C:\path\file.ts:123
  const stackTraceRegex = /at\s+(?:(.+?)\s+\()?([A-Za-z]:[\\\/](?:[^)]+)|(?:\.{1,2}[\\\/])?[^\s)]+):(\d+)(?::(\d+))?\)?/g;

  let match;
  while ((match = stackTraceRegex.exec(text)) !== null) {
    const context = match[1]; // function name if present
    const path = match[2];
    const lineNumber = match[3] ? parseInt(match[3], 10) : undefined;
    const column = match[4] ? parseInt(match[4], 10) : undefined;

    traces.push({
      path,
      lineNumber,
      column,
      context,
    });
  }

  return traces;
}

/**
 * Parse grep output to extract file:line:content matches
 * Handles ripgrep and grep output formats
 */
export function parseGrepResults(
  content: string
): Array<{ path: string; lineNumber: number; lineContent: string }> {
  const results: Array<{
    path: string;
    lineNumber: number;
    lineContent: string;
  }> = [];

  const lines = content.split('\n');

  // Pattern: filepath:lineNumber:content or filepath:lineNumber-content
  const grepLineRegex = /^([^:]+):(\d+)[:-]\s*(.*)$/;

  for (const line of lines) {
    const match = grepLineRegex.exec(line);
    if (match) {
      results.push({
        path: match[1],
        lineNumber: parseInt(match[2], 10),
        lineContent: match[3],
      });
    }
  }

  return results;
}

/**
 * Convert glob results into a tree structure
 */
export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export function buildFileTree(filePaths: string[]): FileTreeNode {
  const root: FileTreeNode = {
    name: '.',
    path: '.',
    isDirectory: true,
    children: [],
  };

  for (const filePath of filePaths) {
    const parts = filePath.split(/[/\\]/);
    let currentNode = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      // Find or create node
      let childNode = currentNode.children?.find((c) => c.name === part);

      if (!childNode) {
        childNode = {
          name: part,
          path: fullPath,
          isDirectory: !isLast,
          children: isLast ? undefined : [],
        };
        currentNode.children = currentNode.children || [];
        currentNode.children.push(childNode);
      }

      currentNode = childNode;
    }
  }

  return root;
}

/**
 * Render interactive bash output with clickable file paths
 */
export function renderInteractiveBashOutput(
  content: string,
  onOpenFile: (path: string, lineNumber?: number) => void
): JSX.Element {
  const filePaths = detectFilePaths(content);
  const errorTraces = detectErrorTraces(content);

  // If no interactive elements, return plain output
  if (filePaths.length === 0 && errorTraces.length === 0) {
    return <pre className="bash-output-content"><code>{content}</code></pre>;
  }

  // Build segments with clickable file paths
  const segments: Array<JSX.Element | string> = [];
  let lastIndex = 0;

  // Combine and sort all clickable elements by position
  const allElements = [
    ...filePaths.map((fp) => ({ ...fp, type: 'file' as const })),
    ...errorTraces.map((et, idx) => ({
      path: et.path,
      lineNumber: et.lineNumber,
      start: content.indexOf(et.path, lastIndex),
      end: content.indexOf(et.path, lastIndex) + et.path.length,
      type: 'trace' as const,
      context: et.context,
    })),
  ].sort((a, b) => a.start - b.start);

  for (const element of allElements) {
    // Add text before this element
    if (element.start > lastIndex) {
      segments.push(content.substring(lastIndex, element.start));
    }

    // Add clickable element
    const fileName = element.path.split(/[/\\]/).pop() || element.path;
    segments.push(
      <button
        key={`file-${element.start}`}
        className="inline-file-link"
        onClick={() => onOpenFile(element.path, element.lineNumber)}
        title={`Open ${element.path}${element.lineNumber ? `:${element.lineNumber}` : ''}`}
      >
        {element.type === 'trace' && element.context
          ? `${element.context} (${fileName}:${element.lineNumber})`
          : `${fileName}${element.lineNumber ? `:${element.lineNumber}` : ''}`}
      </button>
    );

    lastIndex = element.end;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push(content.substring(lastIndex));
  }

  return (
    <pre className="bash-output-content interactive">
      <code>{segments}</code>
    </pre>
  );
}

/**
 * Render grep results as an interactive list
 */
export function renderGrepResults(
  content: string,
  onOpenFile: (path: string, lineNumber?: number) => void
): JSX.Element {
  const results = parseGrepResults(content);

  if (results.length === 0) {
    return <pre className="grep-output-content">{content}</pre>;
  }

  // Group by file
  const groupedByFile = results.reduce((acc, result) => {
    if (!acc[result.path]) {
      acc[result.path] = [];
    }
    acc[result.path].push(result);
    return {};
  }, {} as Record<string, typeof results>);

  return (
    <div className="grep-results-interactive">
      <div className="grep-results-header">
        <span className="result-count">
          {results.length} match{results.length !== 1 ? 'es' : ''} in{' '}
          {Object.keys(groupedByFile).length} file
          {Object.keys(groupedByFile).length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grep-results-list">
        {Object.entries(groupedByFile).map(([filePath, matches]) => (
          <div key={filePath} className="grep-file-group">
            <div className="grep-file-header">
              <button
                className="grep-file-link"
                onClick={() => onOpenFile(filePath)}
              >
                📄 {filePath.split(/[/\\]/).pop()}
              </button>
              <span className="grep-match-count">
                {matches.length} match{matches.length !== 1 ? 'es' : ''}
              </span>
            </div>
            <div className="grep-matches">
              {matches.map((match, idx) => (
                <button
                  key={`${filePath}-${idx}`}
                  className="grep-match-item"
                  onClick={() => onOpenFile(filePath, match.lineNumber)}
                >
                  <span className="grep-line-number">{match.lineNumber}</span>
                  <span className="grep-line-content">{match.lineContent}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Render file tree component
 */
export function renderFileTree(
  node: FileTreeNode,
  level: number = 0,
  onOpenFile: (path: string) => void
): JSX.Element {
  const indent = level * 16;

  return (
    <div className="file-tree-node" style={{ paddingLeft: `${indent}px` }}>
      {node.isDirectory ? (
        <div className="file-tree-directory">
          <span className="tree-icon">📁</span>
          <span className="tree-name">{node.name}</span>
        </div>
      ) : (
        <button
          className="file-tree-file"
          onClick={() => onOpenFile(node.path)}
        >
          <span className="tree-icon">📄</span>
          <span className="tree-name">{node.name}</span>
        </button>
      )}
      {node.children &&
        node.children.map((child, idx) => (
          <div key={`${child.path}-${idx}`}>
            {renderFileTree(child, level + 1, onOpenFile)}
          </div>
        ))}
    </div>
  );
}

/**
 * Render glob results as a file tree
 */
export function renderGlobResultsAsTree(
  content: string,
  onOpenFile: (path: string) => void
): JSX.Element {
  const files = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (files.length === 0) {
    return <div className="glob-results-empty">No files found</div>;
  }

  const tree = buildFileTree(files);

  return (
    <div className="glob-results-tree">
      <div className="glob-results-header">
        <span className="file-icon">📁</span>
        <span className="file-count">
          {files.length} file{files.length !== 1 ? 's' : ''} found
        </span>
      </div>
      <div className="glob-tree-content">
        {tree.children?.map((child, idx) => (
          <div key={`${child.path}-${idx}`}>
            {renderFileTree(child, 0, onOpenFile)}
          </div>
        ))}
      </div>
    </div>
  );
}

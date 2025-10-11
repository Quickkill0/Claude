import { Artifact, ArtifactType } from '../../shared/types';

/**
 * Detects and extracts artifacts from Claude's response content
 * Supports both <antArtifact> and <artifact> tag formats
 */

interface ArtifactMatch {
  identifier: string;
  type: ArtifactType;
  title: string;
  language: string;
  content: string;
  fullMatch: string;
}

/**
 * Parse artifact tags from message content
 * Supports formats:
 * - <antArtifact identifier="id" type="code" title="Title" language="typescript">content</antArtifact>
 * - <artifact id="id" type="code" title="Title" language="typescript">content</artifact>
 */
export function detectArtifacts(content: string): ArtifactMatch[] {
  const artifacts: ArtifactMatch[] = [];

  // Pattern 1: <antArtifact> format (Claude.ai style)
  const antArtifactRegex = /<antArtifact\s+identifier=["']([^"']+)["']\s+type=["']([^"']+)["'](?:\s+title=["']([^"']+)["'])?(?:\s+language=["']([^"']+)["'])?\s*>([\s\S]*?)<\/antArtifact>/gi;

  let match;
  while ((match = antArtifactRegex.exec(content)) !== null) {
    const [fullMatch, identifier, type, title = 'Untitled', language = 'plaintext', artifactContent] = match;

    artifacts.push({
      identifier,
      type: normalizeArtifactType(type),
      title,
      language,
      content: artifactContent.trim(),
      fullMatch,
    });
  }

  // Pattern 2: <artifact> format (alternative)
  const artifactRegex = /<artifact\s+(?:id|identifier)=["']([^"']+)["']\s+type=["']([^"']+)["'](?:\s+title=["']([^"']+)["'])?(?:\s+(?:lang|language)=["']([^"']+)["'])?\s*>([\s\S]*?)<\/artifact>/gi;

  while ((match = artifactRegex.exec(content)) !== null) {
    const [fullMatch, identifier, type, title = 'Untitled', language = 'plaintext', artifactContent] = match;

    // Avoid duplicates if both formats are present
    if (!artifacts.some(a => a.identifier === identifier)) {
      artifacts.push({
        identifier,
        type: normalizeArtifactType(type),
        title,
        language,
        content: artifactContent.trim(),
        fullMatch,
      });
    }
  }

  return artifacts;
}

/**
 * Normalize artifact type to ArtifactType enum
 */
function normalizeArtifactType(type: string): ArtifactType {
  const normalized = type.toLowerCase();

  switch (normalized) {
    case 'code':
    case 'application/vnd.ant.code':
      return 'code';
    case 'html':
    case 'text/html':
      return 'html';
    case 'svg':
    case 'image/svg+xml':
      return 'svg';
    case 'mermaid':
    case 'application/vnd.ant.mermaid':
      return 'mermaid';
    case 'react':
    case 'application/vnd.ant.react':
      return 'react';
    case 'document':
    case 'text/markdown':
      return 'document';
    default:
      // Default to code for unknown types
      return 'code';
  }
}

/**
 * Create Artifact object from ArtifactMatch
 */
export function createArtifact(
  match: ArtifactMatch,
  sessionId: string,
  conversationId?: string
): Artifact {
  const now = new Date().toISOString();

  return {
    id: match.identifier,
    sessionId,
    conversationId,
    title: match.title,
    type: match.type,
    language: match.language,
    content: match.content,
    createdAt: now,
    updatedAt: now,
    versions: [
      {
        id: `${match.identifier}-v1`,
        content: match.content,
        timestamp: now,
        title: match.title,
      },
    ],
  };
}

/**
 * Update existing artifact with new content (creates new version)
 */
export function updateArtifact(
  artifact: Artifact,
  newContent: string,
  newTitle?: string
): Artifact {
  const now = new Date().toISOString();
  const versionNumber = artifact.versions.length + 1;

  return {
    ...artifact,
    content: newContent,
    title: newTitle || artifact.title,
    updatedAt: now,
    versions: [
      ...artifact.versions,
      {
        id: `${artifact.id}-v${versionNumber}`,
        content: newContent,
        timestamp: now,
        title: newTitle || artifact.title,
      },
    ],
  };
}

/**
 * Remove artifact tags from content, leaving only the text
 */
export function stripArtifactTags(content: string): string {
  // Remove <antArtifact> tags
  let stripped = content.replace(
    /<antArtifact\s+[^>]*>[\s\S]*?<\/antArtifact>/gi,
    ''
  );

  // Remove <artifact> tags
  stripped = stripped.replace(
    /<artifact\s+[^>]*>[\s\S]*?<\/artifact>/gi,
    ''
  );

  return stripped.trim();
}

/**
 * Check if content contains artifact tags
 */
export function hasArtifacts(content: string): boolean {
  return (
    /<antArtifact\s+[^>]*>[\s\S]*?<\/antArtifact>/i.test(content) ||
    /<artifact\s+[^>]*>[\s\S]*?<\/artifact>/i.test(content)
  );
}

/**
 * Replace artifact tags with placeholder text
 */
export function replaceArtifactsWithPlaceholder(
  content: string,
  artifacts: ArtifactMatch[]
): string {
  let result = content;

  artifacts.forEach((artifact) => {
    const placeholder = `[Artifact: ${artifact.title}]`;
    result = result.replace(artifact.fullMatch, placeholder);
  });

  return result;
}

/**
 * Release notes arrive as the Markdown body of a GitHub release. Rheow renders
 * them as plain text, so strip the few markers that would otherwise show up
 * literally: heading hashes, bold/italic asterisks, and Markdown links.
 */
export function plainReleaseNotes(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    )
    .join('\n')
    .trim();
}

/**
 * Utility functions for text formatting and truncation.
 */

/**
 * Truncates a filename if it exceeds maxLen by inserting '...' before the file extension.
 * Example:
 * truncateFileName("Spider-Man.Brand.New.Day.2026.IMAX.1080p WEB-DL x265 DD+5.1-Pahe.in.mkv", 35)
 * -> "Spider-Man.Brand.New.Day.2026...mkv"
 */
export function truncateFileName(name: string, maxLen: number = 35): string {
  if (!name || name.length <= maxLen) return name;

  // Extract file extension (supporting compound extensions like .tar.gz, .tar.xz)
  let ext = '';
  const compositeExtMatch = name.match(/\.(tar\.[a-z0-9]+)$/i);
  if (compositeExtMatch) {
    ext = compositeExtMatch[0];
  } else {
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0 && lastDot >= name.length - 8) {
      ext = name.slice(lastDot);
    }
  }

  const dots = '...';
  const availableBaseLen = maxLen - ext.length - dots.length;

  if (availableBaseLen <= 4) {
    return name.slice(0, Math.max(1, maxLen - dots.length)) + dots;
  }

  const basePart = name.slice(0, availableBaseLen).trimEnd();
  // Strip any trailing dots or punctuation so we don't end up with '....mkv'
  const cleanBase = basePart.replace(/[\s\._-]+$/, '');

  return `${cleanBase}${dots}${ext}`;
}

/**
 * Truncates a URL or domain string if it exceeds maxLen by appending '...' at the end.
 * Example:
 * truncateUrl("updates.cdprojektred.com/patches/v2", 28)
 * -> "updates.cdprojektred.com/p..."
 */
export function truncateUrl(url: string, maxLen: number = 28): string {
  if (!url || url.length <= maxLen) return url;
  const dots = '...';
  const clean = url.slice(0, Math.max(1, maxLen - dots.length)).trimEnd();
  return `${clean}${dots}`;
}

/**
 * Formats byte size into human readable string (B, KB, MB, GB, TB).
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i > 1 ? 2 : 1)} ${units[i]}`;
}

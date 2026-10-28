const RHEOW_ENDPOINT = 'http://127.0.0.1:41789/api/add_download';
const RHEOW_BATCH_ENDPOINT = 'http://127.0.0.1:41789/api/add_batch';
const RHEOW_HEALTH = 'http://127.0.0.1:41789/api/health';

let cachedBridgeToken = null;
let bridgeTokenPromise = null;

async function getBridgeToken() {
  if (cachedBridgeToken) return cachedBridgeToken;
  if (bridgeTokenPromise) return bridgeTokenPromise;
  bridgeTokenPromise = (async () => {
    try {
      const resp = await fetch(chrome.runtime.getURL('auth.json'), { cache: 'no-store' });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && typeof data.token === 'string' && data.token.length > 0) {
        cachedBridgeToken = data.token;
        return cachedBridgeToken;
      }
    } catch {}
    return null;
  })();
  const token = await bridgeTokenPromise;
  bridgeTokenPromise = null;
  return token;
}

async function bridgeHeaders(extra = {}) {
  const token = await getBridgeToken();
  const headers = { 'X-Rheow-Client': 'rheow-extension', ...extra };
  if (token) headers['X-Rheow-Token'] = token;
  return headers;
}

// File extensions typically handled by a download manager
const INTERCEPT_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg',
  'exe', 'msi', 'apk', 'deb', 'rpm', 'appimage',
  'mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm',
  'mp3', 'flac', 'wav', 'aac', 'ogg',
  'pdf', 'epub', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'bin', 'cue', 'img', 'vmdk', 'torrent'
]);

// Google Drive (and similar hosts) serve files from URLs without a filename,
// e.g. drive.usercontent.google.com/download?id=...&export=download. The only
// reliable hint is the response MIME type, so treat binary payloads as files.
const BINARY_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/pdf',
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-iso9660-image',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

const NON_FILE_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-www-form-urlencoded'
]);

const MIN_INTERCEPT_BYTES = 10 * 1024 * 1024;

// Initialize context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'rheow-download-link',
    title: 'Download with Rheow',
    contexts: ['link', 'image', 'video', 'audio']
  });

  chrome.contextMenus.create({
    id: 'rheow-download-all-links',
    title: 'Download all links with Rheow',
    contexts: ['page', 'selection']
  });

  chrome.storage.local.get(['autoIntercept', 'mediaSnifferEnabled'], (result) => {
    const updates = {};
    if (result.autoIntercept === undefined) updates.autoIntercept = true;
    if (result.mediaSnifferEnabled === undefined) updates.mediaSnifferEnabled = true;
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

// Check if Rheow desktop backend is reachable
async function isRheowOnline() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 800);
  try {
    const resp = await fetch(RHEOW_HEALTH, {
      signal: controller.signal,
      headers: await bridgeHeaders()
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Announce the extension to the desktop app. The bridge flips its
// `extension_connected` flag on any authorized request, which the onboarding
// wizard polls to confirm that "Load unpacked" actually worked.
async function announcePresence() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200);
  try {
    await fetch(RHEOW_HEALTH, {
      signal: controller.signal,
      headers: await bridgeHeaders()
    });
  } catch {
    // Rheow may still be starting; the popup and download flow retry later.
  } finally {
    clearTimeout(timeoutId);
  }
}

// Service workers restart frequently, so ping on every start plus the two
// lifecycle events that follow a fresh "Load unpacked" install.
announcePresence();
chrome.runtime.onInstalled.addListener(announcePresence);
chrome.runtime.onStartup.addListener(announcePresence);

// Rheow can start long after the browser. A lightweight alarm keeps the
// connection indicator accurate without relying on the user opening the popup.
const PRESENCE_ALARM = 'rheow-presence';
chrome.alarms.create(PRESENCE_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PRESENCE_ALARM) announcePresence();
});

// Extract a safe basename from a path or URL. Chrome reports absolute paths in
// DownloadItem.filename, which must never be forwarded as the filename.
function baseName(pathOrUrl) {
  if (!pathOrUrl) return null;
  const withoutQuery = pathOrUrl.split(/[?#]/)[0];
  const segment = withoutQuery.split(/[\\/]/).filter(Boolean).pop();
  return segment || null;
}

function extensionOf(pathOrUrl) {
  const name = baseName(pathOrUrl) || '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isFetchableUrl(url) {
  // blob:/data: URLs only exist inside the originating page, so Rheow can never
  // download them. Leave those to Chrome instead of cancelling and losing them.
  return /^https?:\/\//i.test(url || '');
}

// Decide whether Rheow should take over a browser download. A download manager
// should not rely on the URL alone: Google Drive and similar hosts hide the
// filename behind a query string, so MIME type and size are used as fallbacks.
function shouldIntercept(item) {
  const targetUrl = item.finalUrl || item.url || '';
  if (!isFetchableUrl(targetUrl)) return false;

  const ext =
    extensionOf(item.filename) || extensionOf(item.finalUrl) || extensionOf(item.url);
  if (ext && INTERCEPT_EXTENSIONS.has(ext)) return true;

  const size = Math.max(item.fileSize || 0, item.totalBytes || 0);
  if (size >= MIN_INTERCEPT_BYTES) return true;

  const mime = (item.mime || '').split(';')[0].trim().toLowerCase();
  if (BINARY_MIME_TYPES.has(mime)) return true;
  if (mime.startsWith('application/') && !NON_FILE_MIME_TYPES.has(mime)) return true;

  return false;
}

function describeDownload(item) {
  return {
    url: item.finalUrl || item.url,
    filename: item.filename,
    mime: item.mime,
    size: item.fileSize
  };
}

let lastOfflineNotice = 0;

// Avoid spamming a notification for every download while Rheow is closed.
function notifyOfflineThrottled() {
  const now = Date.now();
  if (now - lastOfflineNotice < 30000) return;
  lastOfflineNotice = now;
  notifyOffline();
}

// Chrome notifications do not accept SVG data URLs, so use a bundled PNG.
function notifyOffline() {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Rheow Download Manager',
    message: 'Could not connect to Rheow Desktop App. Make sure Rheow is running.'
  });
}

// Extract cookies for URL
async function getCookiesForUrl(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

// Forward download to Rheow Desktop App
async function sendToRheow(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(RHEOW_ENDPOINT, {
      method: 'POST',
      headers: await bridgeHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return resp.ok;
  } catch (err) {
    console.warn('[Rheow Extension] Failed to send download to Rheow:', err);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Forward batch download list to Rheow Desktop App
async function sendBatchToRheow(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(RHEOW_BATCH_ENDPOINT, {
      method: 'POST',
      headers: await bridgeHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return resp.ok;
  } catch (err) {
    console.warn('[Rheow Extension] Failed to send batch to Rheow:', err);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Function injected into tab to extract download links from DOM or active selection
function extractPageLinks() {
  const links = new Set();
  const selection = window.getSelection()?.toString();
  if (selection) {
    const regex = /(https?:\/\/[^\s<>"']+)/gi;
    const matches = selection.match(regex) || [];
    for (const m of matches) {
      links.add(m.replace(/[.,;:)\]]+$/, ''));
    }
  }

  const anchors = document.querySelectorAll('a[href]');
  for (const a of anchors) {
    try {
      const href = a.href;
      if (/^https?:\/\//i.test(href) && !href.startsWith('javascript:')) {
        links.add(href);
      }
    } catch {}
  }
  return Array.from(links);
}

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'rheow-download-link') {
    const targetUrl = info.linkUrl || info.srcUrl;
    if (!targetUrl) return;

    const cookie = await getCookiesForUrl(targetUrl);
    const referer = tab?.url || info.pageUrl || '';

    const sent = await sendToRheow({
      url: targetUrl,
      cookie: cookie || null,
      referer: referer || null,
      filename: baseName(targetUrl)
    });

    if (!sent) {
      notifyOffline();
    }
  } else if (info.menuItemId === 'rheow-download-all-links') {
    if (!tab?.id) return;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageLinks,
      });

      const urls = results?.[0]?.result || [];
      if (!urls || urls.length === 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
          title: 'Rheow Download Manager',
          message: 'No downloadable links found on this page.'
        });
        return;
      }

      const sent = await sendBatchToRheow({
        urls,
        referer: tab.url || info.pageUrl || null
      });

      if (!sent) {
        notifyOffline();
      }
    } catch (err) {
      console.warn('[Rheow Extension] Failed to extract links:', err);
    }
  }
});

// Listen for messages from content scripts (e.g. Media Sniffer)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'rheow_download_media') {
    (async () => {
      const targetUrl = message.url;
      if (!targetUrl || !isFetchableUrl(targetUrl)) {
        sendResponse({ ok: false, error: 'Invalid URL' });
        return;
      }

      const cookie = await getCookiesForUrl(targetUrl);
      const referer = message.referer || sender.tab?.url || '';

      const sent = await sendToRheow({
        url: targetUrl,
        cookie: cookie || null,
        referer: referer || null,
        filename: message.filename || baseName(targetUrl)
      });

      if (!sent) {
        notifyOffline();
        sendResponse({ ok: false, error: 'Rheow offline' });
      } else {
        sendResponse({ ok: true });
      }
    })();
    return true; // Keep channel open for async response
  }
});

// Intercept browser downloads
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  (async () => {
    try {
      const { autoIntercept } = await chrome.storage.local.get(['autoIntercept']);
      if (autoIntercept === false) {
        suggest();
        return;
      }

      if (!shouldIntercept(downloadItem)) {
        console.debug('[Rheow] Skipped download', describeDownload(downloadItem));
        suggest();
        return;
      }

      const online = await isRheowOnline();
      if (!online) {
        // Fall back to native browser download if Rheow is closed.
        console.debug('[Rheow] Rheow offline, leaving download to Chrome');
        notifyOfflineThrottled();
        suggest();
        return;
      }

      // Hand off to Rheow first, then cancel the browser copy. If the handoff
      // fails, the native download continues instead of being lost.
      const sourceUrl = downloadItem.finalUrl || downloadItem.url;
      const cookie = await getCookiesForUrl(sourceUrl);

      const sent = await sendToRheow({
        url: sourceUrl,
        cookie: cookie || null,
        referer: downloadItem.referrer || null,
        filename: baseName(downloadItem.filename) || baseName(sourceUrl)
      });

      if (!sent) {
        notifyOfflineThrottled();
        suggest();
        return;
      }

      console.info('[Rheow] Handed off download', sourceUrl, describeDownload(downloadItem));
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch (err) {
      console.error('[Rheow Extension] Error intercepting download:', err);
      suggest();
    }
  })();

  return true; // Keep channel open for async suggest
});

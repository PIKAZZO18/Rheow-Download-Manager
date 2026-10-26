const RHEOW_HEALTH = 'http://127.0.0.1:41789/api/health';
const RHEOW_ENDPOINT = 'http://127.0.0.1:41789/api/add_download';

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const interceptToggle = document.getElementById('interceptToggle');
const snifferToggle = document.getElementById('snifferToggle');
const quickUrl = document.getElementById('quickUrl');
const sendBtn = document.getElementById('sendBtn');

// Ping the local bridge with a hard timeout.
async function ping(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(RHEOW_HEALTH, {
      signal: controller.signal,
      headers: { 'X-Rheow-Client': 'rheow-extension' }
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Check Rheow status. The desktop app can take a moment to accept connections
// right after launch, so retry once before reporting "Disconnected".
async function checkHealth() {
  let online = await ping(800);
  if (!online) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    online = await ping(1200);
  }

  statusPill.classList.toggle('online', online);
  statusText.textContent = online ? 'Connected' : 'Disconnected';
}

// Load storage settings
chrome.storage.local.get(['autoIntercept', 'mediaSnifferEnabled'], (result) => {
  if (result.autoIntercept !== undefined) {
    interceptToggle.checked = result.autoIntercept;
  }
  if (result.mediaSnifferEnabled !== undefined) {
    snifferToggle.checked = result.mediaSnifferEnabled;
  }
});

// Toggle change listeners
interceptToggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoIntercept: interceptToggle.checked });
});

snifferToggle.addEventListener('change', () => {
  chrome.storage.local.set({ mediaSnifferEnabled: snifferToggle.checked });
});

// Handle Quick Download
sendBtn.addEventListener('click', async () => {
  const url = quickUrl.value.trim();
  if (!url) return;

  sendBtn.textContent = 'Sending...';
  sendBtn.disabled = true;

  try {
    const resp = await fetch(RHEOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rheow-Client': 'rheow-extension'
      },
      body: JSON.stringify({
        url,
        filename: null,
        cookie: null,
        referer: null,
      }),
    });

    if (resp.ok) {
      quickUrl.value = '';
      sendBtn.textContent = 'Sent!';
      setTimeout(() => window.close(), 600);
    } else {
      sendBtn.textContent = 'Failed';
      setTimeout(() => {
        sendBtn.textContent = 'Catch';
        sendBtn.disabled = false;
      }, 1500);
    }
  } catch (err) {
    console.error('Failed to send:', err);
    sendBtn.textContent = 'Offline';
    setTimeout(() => {
      sendBtn.textContent = 'Catch';
      sendBtn.disabled = false;
    }, 1500);
  }
});

quickUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendBtn.click();
  }
});

checkHealth();

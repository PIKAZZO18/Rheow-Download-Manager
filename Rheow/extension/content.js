// Rheow Video & Media Sniffer Content Script
(() => {
  let mediaSnifferEnabled = true;
  const inspectedElements = new WeakMap();

  // Read initial preference
  try {
    chrome.storage.local.get(['mediaSnifferEnabled'], (res) => {
      if (res && res.mediaSnifferEnabled !== undefined) {
        mediaSnifferEnabled = Boolean(res.mediaSnifferEnabled);
      }
    });
  } catch {}

  // Sync preference dynamically
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.mediaSnifferEnabled) {
        mediaSnifferEnabled = Boolean(changes.mediaSnifferEnabled.newValue);
        if (!mediaSnifferEnabled) {
          hideAllBadges();
        }
      }
    });
  } catch {}

  function hideAllBadges() {
    const badges = document.querySelectorAll('.rheow-sniffer-badge');
    badges.forEach((b) => b.classList.remove('rheow-visible'));
  }

  function isFetchableUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
  }

  function getMediaUrl(mediaEl) {
    if (isFetchableUrl(mediaEl.currentSrc)) return mediaEl.currentSrc;
    if (isFetchableUrl(mediaEl.src)) return mediaEl.src;

    const sources = mediaEl.querySelectorAll('source');
    for (const s of sources) {
      if (isFetchableUrl(s.src)) return s.src;
    }

    return null;
  }

  function getMediaExtension(url) {
    if (!url) return '';
    try {
      const clean = url.split(/[?#]/)[0];
      const ext = clean.split('.').pop()?.toLowerCase();
      if (ext && ext.length <= 5) return ext;
    } catch {}
    return '';
  }

  function getMediaLabel(mediaEl, url) {
    const isVideo = mediaEl.tagName.toLowerCase() === 'video';
    const ext = getMediaExtension(url);

    if (isVideo) {
      if (mediaEl.videoHeight) {
        return `${mediaEl.videoHeight}p`;
      }
      return ext ? ext.toUpperCase() : 'VIDEO';
    }
    return ext ? ext.toUpperCase() : 'AUDIO';
  }

  function guessFilename(mediaEl, url) {
    try {
      const clean = url.split(/[?#]/)[0];
      const segment = clean.split('/').filter(Boolean).pop();
      if (segment && segment.includes('.')) {
        return decodeURIComponent(segment);
      }
    } catch {}

    const isVideo = mediaEl.tagName.toLowerCase() === 'video';
    const ext = getMediaExtension(url) || (isVideo ? 'mp4' : 'mp3');
    const title = document.title ? document.title.replace(/[\\/:*?"<>|]/g, '').trim() : 'media';
    return `${title}.${ext}`;
  }

  function createBadge(mediaEl, url) {
    const isVideo = mediaEl.tagName.toLowerCase() === 'video';
    const badge = document.createElement('div');
    badge.className = 'rheow-sniffer-badge';
    badge.setAttribute('data-rheow-badge', 'true');

    const actionBtn = document.createElement('button');
    actionBtn.className = 'rheow-sniffer-action';
    actionBtn.type = 'button';
    actionBtn.title = 'Send this media to Rheow Download Manager';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'rheow-sniffer-icon';
    iconSpan.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 15V3m0 12l-4-4m4 4l4-4"/>
        <path d="M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17"/>
      </svg>
    `;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'rheow-sniffer-title';
    titleSpan.textContent = isVideo ? 'Download Video' : 'Download Audio';

    const tagSpan = document.createElement('span');
    tagSpan.className = 'rheow-sniffer-tag';
    tagSpan.textContent = getMediaLabel(mediaEl, url);

    actionBtn.appendChild(iconSpan);
    actionBtn.appendChild(titleSpan);
    actionBtn.appendChild(tagSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rheow-sniffer-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Dismiss';
    closeBtn.innerHTML = '&times;';

    badge.appendChild(actionBtn);
    badge.appendChild(closeBtn);

    let fadeTimer = null;

    const showBadgeTemporarily = (duration = 3500) => {
      if (!mediaSnifferEnabled) return;
      const data = inspectedElements.get(mediaEl);
      if (data && data.dismissed) return;

      badge.classList.add('rheow-visible');
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        if (!badge.matches(':hover') && !mediaEl.matches(':hover')) {
          badge.classList.remove('rheow-visible');
        }
      }, duration);
    };

    // Action button click: send download to Rheow
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const latestUrl = getMediaUrl(mediaEl) || url;
      if (!latestUrl) return;

      actionBtn.disabled = true;
      titleSpan.textContent = 'Sending...';

      chrome.runtime.sendMessage(
        {
          action: 'rheow_download_media',
          url: latestUrl,
          referer: window.location.href,
          filename: guessFilename(mediaEl, latestUrl)
        },
        (res) => {
          if (res && res.ok) {
            badge.classList.add('rheow-success');
            titleSpan.textContent = 'Sent to Rheow ✓';
            setTimeout(() => {
              badge.classList.remove('rheow-success');
              titleSpan.textContent = isVideo ? 'Download Video' : 'Download Audio';
              actionBtn.disabled = false;
              badge.classList.remove('rheow-visible');
            }, 2500);
          } else {
            titleSpan.textContent = res?.error === 'Rheow offline' ? 'Rheow Offline' : 'Failed';
            setTimeout(() => {
              titleSpan.textContent = isVideo ? 'Download Video' : 'Download Audio';
              actionBtn.disabled = false;
            }, 2000);
          }
        }
      );
    });

    // Close button click: dismiss for this media element
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const data = inspectedElements.get(mediaEl);
      if (data) data.dismissed = true;
      badge.classList.remove('rheow-visible');
    });

    return { badge, showBadgeTemporarily, updateLabel: (newUrl) => {
      tagSpan.textContent = getMediaLabel(mediaEl, newUrl);
    }};
  }

  function attachSniffer(mediaEl) {
    if (!mediaEl || inspectedElements.has(mediaEl)) return;

    const url = getMediaUrl(mediaEl);
    if (!url) return;

    // Must be in DOM
    const parent = mediaEl.parentElement;
    if (!parent) return;

    // Ensure parent has position so badge pins inside
    const computedPos = window.getComputedStyle(parent).position;
    if (computedPos === 'static') {
      parent.style.position = 'relative';
    }

    const { badge, showBadgeTemporarily, updateLabel } = createBadge(mediaEl, url);
    parent.appendChild(badge);

    const record = { badge, url, dismissed: false };
    inspectedElements.set(mediaEl, record);

    // Event listeners on media element
    const onEnter = () => {
      if (mediaSnifferEnabled && !record.dismissed) {
        badge.classList.add('rheow-visible');
      }
    };

    const onLeave = () => {
      if (!badge.matches(':hover')) {
        badge.classList.remove('rheow-visible');
      }
    };

    mediaEl.addEventListener('mouseenter', onEnter);
    mediaEl.addEventListener('mouseleave', onLeave);
    parent.addEventListener('mouseenter', onEnter);
    parent.addEventListener('mouseleave', onLeave);

    badge.addEventListener('mouseenter', () => {
      if (mediaSnifferEnabled && !record.dismissed) {
        badge.classList.add('rheow-visible');
      }
    });

    badge.addEventListener('mouseleave', () => {
      if (!mediaEl.matches(':hover') && !parent.matches(':hover')) {
        badge.classList.remove('rheow-visible');
      }
    });

    // Show badge briefly when playback starts
    mediaEl.addEventListener('play', () => {
      const freshUrl = getMediaUrl(mediaEl);
      if (freshUrl) {
        record.url = freshUrl;
        updateLabel(freshUrl);
      }
      showBadgeTemporarily(3500);
    });

    mediaEl.addEventListener('loadeddata', () => {
      const freshUrl = getMediaUrl(mediaEl);
      if (freshUrl) {
        record.url = freshUrl;
        updateLabel(freshUrl);
      }
    });
  }

  // Scan document for video and audio elements
  function scanPage() {
    const mediaNodes = document.querySelectorAll('video, audio');
    mediaNodes.forEach(attachSniffer);
  }

  // Global listener on play/loadeddata in capture phase to catch dynamically attached players
  document.addEventListener('play', (e) => {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      attachSniffer(e.target);
    }
  }, true);

  document.addEventListener('loadeddata', (e) => {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      attachSniffer(e.target);
    }
  }, true);

  // Throttled MutationObserver for SPA / dynamic video loads
  let scanScheduled = false;
  const observer = new MutationObserver(() => {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanPage();
    });
  });

  if (document.body) {
    scanPage();
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      scanPage();
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();

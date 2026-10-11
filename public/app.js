// State
let inspectedData = null;
let activeMode = 'video';
let selectedQuality = '1080';
let selectedFormat = 'mp4';
let defaultDownloadDir = '';
const activeJobs = new Map();

// Elements
const urlInput = document.getElementById('url-input');
const pasteBtn = document.getElementById('paste-btn');
const clearBtn = document.getElementById('clear-btn');
const fetchInfoBtn = document.getElementById('fetch-info-btn');
const inspectLoading = document.getElementById('inspect-loading');

const ytdlpStatus = document.getElementById('ytdlp-status');
const ytdlpVerText = document.getElementById('ytdlp-ver-text');
const ffmpegStatus = document.getElementById('ffmpeg-status');
const ffmpegVerText = document.getElementById('ffmpeg-ver-text');

const previewPanel = document.getElementById('preview-panel');
const previewThumb = document.getElementById('preview-thumb');
const previewDuration = document.getElementById('preview-duration');
const previewTitle = document.getElementById('preview-title');
const previewAuthor = document.getElementById('preview-author');
const previewSite = document.getElementById('preview-site');
const resCountTag = document.getElementById('res-count-tag');

const modeToggle = document.getElementById('mode-toggle');
const videoOptionsSection = document.getElementById('video-options-section');
const audioOptionsSection = document.getElementById('audio-options-section');
const resolutionChips = document.getElementById('resolution-chips');
const audioQualityChips = document.getElementById('audio-quality-chips');
const formatSelect = document.getElementById('format-select');
const audioFormatSelect = document.getElementById('audio-format-select');
const startConfiguredDownload = document.getElementById('start-configured-download');
const downloadButtonLabel = document.getElementById('download-button-label');

const downloadsList = document.getElementById('downloads-list');
const emptyState = document.getElementById('empty-state');
const jobsCount = document.getElementById('jobs-count');
const clearCompletedBtn = document.getElementById('clear-completed-btn');
const countAll = document.getElementById('count-all');
const countActive = document.getElementById('count-active');
const countCompleted = document.getElementById('count-completed');

let currentFilter = 'all';

const filterTabs = document.querySelectorAll('.filter-tab');
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    applyFilter();
  });
});

if (clearCompletedBtn) {
  clearCompletedBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/clear-completed', { method: 'POST' });
      for (const [id, job] of Array.from(activeJobs.entries())) {
        if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
          const card = document.getElementById(`card-${id}`);
          if (card) card.remove();
          activeJobs.delete(id);
        }
      }
      updateJobsCount();
    } catch (err) {
      console.error('Failed to clear completed:', err);
    }
  });
}

function formatSeconds(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function cleanUnits(str) {
  if (!str) return '--';
  return str
    .replace(/KiB/g, 'KB')
    .replace(/MiB/g, 'MB')
    .replace(/GiB/g, 'GB')
    .replace(/TiB/g, 'TB')
    .replace(/kib/g, 'KB')
    .replace(/mib/g, 'MB')
    .replace(/gib/g, 'GB');
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `~${val.toFixed(1)} ${units[i]}`;
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'Web Stream';
  }
}

// System Check
async function checkSystem() {
  try {
    const res = await fetch('/api/system');
    const data = await res.json();
    
    if (data.ytDlpVersion && data.ytDlpVersion !== 'Not found' && data.ytDlpVersion !== 'Not installed') {
      ytdlpStatus.className = 'status-pill online';
      ytdlpVerText.textContent = `yt-dlp: v${data.ytDlpVersion}`;
    } else {
      ytdlpStatus.className = 'status-pill offline';
      ytdlpVerText.textContent = 'yt-dlp: Missing';
    }

    if (data.hasFFmpeg) {
      ffmpegStatus.className = 'status-pill online';
      ffmpegVerText.textContent = 'FFmpeg: Ready';
    } else {
      ffmpegStatus.className = 'status-pill offline';
      ffmpegVerText.textContent = 'FFmpeg: Missing';
    }

    if (data.defaultDownloadDir) {
      defaultDownloadDir = data.defaultDownloadDir;
    }
  } catch (err) {
    console.error('Failed to query system status:', err);
  }
}

// Paste Handler
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      toggleClearBtn();
      fetchInfo();
    }
  } catch (err) {
    urlInput.focus();
  }
});

urlInput.addEventListener('input', toggleClearBtn);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    fetchInfo();
  }
});

function toggleClearBtn() {
  if (urlInput.value.trim().length > 0) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }
}

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  toggleClearBtn();
  previewPanel.classList.add('hidden');
  inspectLoading.classList.add('hidden');
  inspectedData = null;
});

// Mode Toggle Handler
modeToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  
  modeToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  activeMode = btn.dataset.mode;
  if (activeMode === 'audio') {
    videoOptionsSection.classList.add('hidden');
    audioOptionsSection.classList.remove('hidden');
    selectedQuality = 'best';
    selectedFormat = audioFormatSelect.value;
  } else {
    videoOptionsSection.classList.remove('hidden');
    audioOptionsSection.classList.add('hidden');
    selectedFormat = formatSelect.value;
    const activeChip = resolutionChips.querySelector('.res-chip.active');
    selectedQuality = activeChip ? activeChip.dataset.quality : 'best';
  }
  updateDownloadButtonLabel();
});

// Format Select Handlers
formatSelect.addEventListener('change', () => {
  selectedFormat = formatSelect.value;
  updateDownloadButtonLabel();
});

audioFormatSelect.addEventListener('change', () => {
  selectedFormat = audioFormatSelect.value;
  updateDownloadButtonLabel();
});

// Audio Quality Chips Handler
audioQualityChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.res-chip');
  if (!chip) return;
  audioQualityChips.querySelectorAll('.res-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  selectedQuality = chip.dataset.quality;
  updateDownloadButtonLabel();
});

// Analyze Link for Resolutions
async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    alert('Please paste or enter a video URL first.');
    return;
  }

  setLoading(fetchInfoBtn, true);
  inspectLoading.classList.remove('hidden');
  previewPanel.classList.add('hidden');

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Could not extract video details: ${data.error}`);
      return;
    }

    inspectedData = data;
    previewTitle.textContent = data.title;
    previewAuthor.textContent = data.uploader;
    previewDuration.textContent = formatSeconds(data.duration);
    previewSite.textContent = extractDomain(url);
    if (data.thumbnail) {
      previewThumb.src = data.thumbnail;
    }

    renderResolutionChips(data.resolutions);
    previewPanel.classList.remove('hidden');
  } catch (err) {
    alert(`Error connecting to server: ${err.message}`);
  } finally {
    setLoading(fetchInfoBtn, false);
    inspectLoading.classList.add('hidden');
  }
}

fetchInfoBtn.addEventListener('click', fetchInfo);

// Render Resolution Chips
function renderResolutionChips(resolutions) {
  resolutionChips.innerHTML = '';
  
  const resList = resolutions && resolutions.length > 0 ? resolutions : [
    { height: 1080, label: '1080p Full HD', fps: null, filesize: 0 },
    { height: 720, label: '720p HD', fps: null, filesize: 0 },
    { height: 480, label: '480p SD', fps: null, filesize: 0 },
    { height: 360, label: '360p', fps: null, filesize: 0 }
  ];

  resCountTag.textContent = `${resList.length} Resolutions Found`;

  resList.forEach((r, idx) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `res-chip ${idx === 0 ? 'active' : ''}`;
    chip.dataset.quality = r.height.toString();

    const fpsText = r.fps && r.fps > 30 ? ` ${r.fps}fps` : '';
    const sizeText = r.filesize ? formatBytes(r.filesize) : '';
    const subText = [fpsText.trim(), sizeText].filter(Boolean).join(' • ') || 'Standard';

    chip.innerHTML = `
      <span class="res-chip-main">${r.label || r.height + 'p'}</span>
      <span class="res-chip-sub">${subText}</span>
    `;

    chip.addEventListener('click', () => {
      resolutionChips.querySelectorAll('.res-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedQuality = r.height.toString();
      updateDownloadButtonLabel();
    });

    resolutionChips.appendChild(chip);
  });

  selectedQuality = resList[0].height.toString();
  selectedFormat = formatSelect.value;
  updateDownloadButtonLabel();
}

function updateDownloadButtonLabel() {
  if (activeMode === 'audio') {
    const qLabel = selectedQuality === 'best' ? 'Best Quality' : selectedQuality;
    downloadButtonLabel.textContent = `Download Audio as ${selectedFormat.toUpperCase()} (${qLabel})`;
  } else {
    const activeChip = resolutionChips.querySelector('.res-chip.active');
    const qText = activeChip ? activeChip.querySelector('.res-chip-main').textContent : `${selectedQuality}p`;
    downloadButtonLabel.textContent = `Download ${qText} (${selectedFormat.toUpperCase()})`;
  }
}

// Start Download
startConfiguredDownload.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const payload = {
    url,
    title: inspectedData ? inspectedData.title : url,
    mode: activeMode,
    quality: selectedQuality,
    format: selectedFormat,
    outputDir: defaultDownloadDir
  };

  startDownload(payload);
});

async function startDownload(payload) {
  try {
    startConfiguredDownload.disabled = true;
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Download error: ${data.error}`);
      return;
    }

    renderOrUpdateJob({
      id: data.jobId,
      title: payload.title,
      mode: payload.mode,
      quality: payload.quality,
      format: payload.format,
      downloadDir: defaultDownloadDir,
      status: 'starting',
      progress: 0,
      speed: '--',
      eta: '--',
      size: '--',
      logs: []
    });

    downloadsList.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert(`Failed to start download: ${err.message}`);
  } finally {
    startConfiguredDownload.disabled = false;
  }
}

function getCardActionsHtml(job) {
  const isDownloading = job.status === 'downloading' || job.status === 'starting' || job.status === 'processing';
  const isPaused = job.status === 'paused';
  const isCancelled = job.status === 'cancelled';
  const isFailed = job.status === 'failed';
  const isComplete = job.status === 'completed';

  let html = `<button class="btn btn-ghost btn-sm toggle-log-btn" data-id="${job.id}">Log</button>`;

  if (isDownloading) {
    html += `
      <button class="btn btn-secondary btn-sm pause-btn" data-id="${job.id}">Pause</button>
      <button class="btn btn-danger btn-sm cancel-btn" data-id="${job.id}">Cancel</button>
    `;
  } else if (isPaused) {
    html += `
      <button class="btn btn-primary btn-sm pause-btn" data-id="${job.id}">Resume</button>
      <button class="btn btn-danger btn-sm cancel-btn" data-id="${job.id}">Cancel</button>
    `;
  } else if (isCancelled) {
    html += `
      <span class="btn btn-indicator cancelled">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
        Cancelled
      </span>
      <button class="btn btn-primary btn-sm retry-btn" data-id="${job.id}">Retry</button>
      <button class="btn btn-ghost btn-sm dismiss-btn" data-id="${job.id}" title="Remove from list">✕</button>
    `;
  } else if (isFailed) {
    html += `
      <span class="btn btn-indicator failed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        Failed
      </span>
      <button class="btn btn-primary btn-sm retry-btn" data-id="${job.id}">Retry</button>
      <button class="btn btn-ghost btn-sm dismiss-btn" data-id="${job.id}" title="Remove from list">✕</button>
    `;
  } else if (isComplete) {
    html += `
      <span class="btn btn-indicator completed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        Completed
      </span>
      <button class="btn btn-ghost btn-sm dismiss-btn" data-id="${job.id}" title="Remove from list">✕</button>
    `;
  }

  return html;
}

// Render or Update Download Card
function renderOrUpdateJob(job) {
  activeJobs.set(job.id, job);
  emptyState.classList.add('hidden');
  updateJobsCount();

  let card = document.getElementById(`card-${job.id}`);
  const isComplete = job.status === 'completed';
  const isFinished = isComplete || job.status === 'cancelled';

  const modeBadgeText = job.mode === 'audio' 
    ? `${job.format.toUpperCase()} (${job.quality})` 
    : `${job.format.toUpperCase()} ${job.quality === 'best' ? 'Best' : job.quality + 'p'}`;

  // If card already exists, update properties smoothly
  if (card) {
    const progressBar = card.querySelector('.progress-bar');
    const progressMeta = card.querySelector('.progress-meta');
    const statusTag = card.querySelector('.status-tag');
    const logsEl = card.querySelector(`#logs-${job.id}`);

    if (progressBar) {
      progressBar.style.width = `${job.progress || 0}%`;
    }

    if (progressMeta) {
      const pctText = job.progress ? job.progress.toFixed(1) + '%' : '0%';
      const displaySize = cleanUnits(job.size || '--');
      const displaySpeed = cleanUnits(job.speed || '--');
      progressMeta.innerHTML = `
        <span>${pctText} • ${displaySize}</span>
        <span>Speed: ${displaySpeed} • ETA: ${job.eta || '--'}</span>
      `;
    }

    if (statusTag) {
      if (isFinished) {
        statusTag.classList.add('hidden');
      } else {
        statusTag.classList.remove('hidden');
        statusTag.textContent = job.status.toUpperCase();
        statusTag.className = `status-tag ${job.status}`;
      }
    }

    if (logsEl && job.logs) {
      logsEl.textContent = job.logs.join('\n');
      if (!logsEl.classList.contains('hidden')) {
        logsEl.scrollTop = logsEl.scrollHeight;
      }
    }

    // If status changed (e.g. from downloading to failed or completed), re-render action buttons
    if (card.dataset.status !== job.status) {
      card.dataset.status = job.status;
      if (isComplete) {
        card.classList.add('completed');
      } else {
        card.classList.remove('completed');
      }

      const actionsEl = card.querySelector('.download-card-actions');
      if (actionsEl) {
        actionsEl.innerHTML = getCardActionsHtml(job);
        setupCardEvents(card, job);
      }
    }
    return;
  }

  // Create new card
  card = document.createElement('div');
  card.id = `card-${job.id}`;
  card.dataset.status = job.status;
  card.className = `download-card ${isComplete ? 'completed' : ''}`;

  const initialSize = cleanUnits(job.size || '--');
  const initialSpeed = cleanUnits(job.speed || '--');

  card.innerHTML = `
    <div class="download-card-header">
      <div class="download-title-wrapper">
        <div class="download-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</div>
        <div class="download-badges">
          <span class="format-tag">${modeBadgeText}</span>
          <span class="status-tag ${job.status} ${isFinished ? 'hidden' : ''}">${job.status.toUpperCase()}</span>
        </div>
      </div>
    </div>

    <div class="progress-container">
      <div class="progress-bar" style="width: ${job.progress || 0}%;"></div>
    </div>

    <div class="progress-meta">
      <span>${job.progress ? job.progress.toFixed(1) + '%' : '0%'} • ${initialSize}</span>
      <span>Speed: ${initialSpeed} • ETA: ${job.eta || '--'}</span>
    </div>

    <div class="download-card-actions">
      ${getCardActionsHtml(job)}
    </div>

    <div class="logs-container hidden" id="logs-${job.id}">${(job.logs || []).join('\n')}</div>
  `;

  downloadsList.prepend(card);
  setupCardEvents(card, job);
}

function setupCardEvents(card, job) {
  const toggleLogBtn = card.querySelector('.toggle-log-btn');
  const logsEl = card.querySelector(`#logs-${job.id}`);
  if (toggleLogBtn && logsEl) {
    toggleLogBtn.onclick = () => {
      logsEl.classList.toggle('hidden');
      logsEl.scrollTop = logsEl.scrollHeight;
    };
  }

  const pauseBtn = card.querySelector('.pause-btn');
  if (pauseBtn) {
    pauseBtn.onclick = () => togglePause(job.id);
  }

  const cancelBtn = card.querySelector('.cancel-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => cancelJob(job.id);
  }

  const dismissBtn = card.querySelector('.dismiss-btn');
  if (dismissBtn) {
    dismissBtn.onclick = () => dismissJob(job.id);
  }

  const retryBtn = card.querySelector('.retry-btn');
  if (retryBtn) {
    retryBtn.onclick = () => {
      dismissJob(job.id);
      startDownload({
        url: job.url,
        title: job.title,
        mode: job.mode,
        quality: job.quality,
        format: job.format,
        outputDir: job.downloadDir || defaultDownloadDir
      });
    };
  }
}

async function togglePause(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  const isPaused = job.status === 'paused';
  job.status = isPaused ? 'downloading' : 'paused';
  if (job.status === 'paused') {
    job.speed = 'Paused';
    job.eta = '--';
  }
  renderOrUpdateJob(job);

  try {
    const res = await fetch('/api/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
    const data = await res.json();
    if (data.status) {
      job.status = data.status;
      renderOrUpdateJob(job);
    }
  } catch (err) {
    console.error('Pause toggle failed', err);
  }
}

function dismissJob(jobId) {
  const card = document.getElementById(`card-${jobId}`);
  if (card) {
    card.remove();
  }
  activeJobs.delete(jobId);
  updateJobsCount();
  if (activeJobs.size === 0) {
    emptyState.classList.remove('hidden');
  }
  fetch('/api/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId })
  }).catch(() => {});
}

async function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job && (job.status === 'failed' || job.status === 'cancelled')) {
    dismissJob(jobId);
    return;
  }
  if (job) {
    job.status = 'cancelled';
    job.speed = '--';
    job.eta = 'Cancelled';
    renderOrUpdateJob(job);
  }
  try {
    await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
  } catch (err) {
    console.error('Cancel failed', err);
  }
}

function applyFilter() {
  let visibleCount = 0;
  for (const [id, job] of activeJobs.entries()) {
    const card = document.getElementById(`card-${id}`);
    if (!card) continue;
    const isActive = job.status === 'downloading' || job.status === 'starting' || job.status === 'processing' || job.status === 'paused';
    const isCompleted = job.status === 'completed';

    let shouldShow = true;
    if (currentFilter === 'active') {
      shouldShow = isActive;
    } else if (currentFilter === 'completed') {
      shouldShow = isCompleted;
    }

    if (shouldShow) {
      card.style.display = 'flex';
      visibleCount++;
    } else {
      card.style.display = 'none';
    }
  }

  if (activeJobs.size === 0) {
    emptyState.classList.remove('hidden');
    const p = emptyState.querySelector('p');
    if (p) p.textContent = 'No downloads yet';
  } else if (visibleCount === 0) {
    emptyState.classList.remove('hidden');
    const p = emptyState.querySelector('p');
    if (p) p.textContent = `No ${currentFilter} downloads`;
  } else {
    emptyState.classList.add('hidden');
  }
}

function updateJobsCount() {
  const total = activeJobs.size;
  let activeCount = 0;
  let completedCount = 0;

  for (const job of activeJobs.values()) {
    if (job.status === 'downloading' || job.status === 'starting' || job.status === 'processing' || job.status === 'paused') {
      activeCount++;
    } else if (job.status === 'completed') {
      completedCount++;
    }
  }

  jobsCount.textContent = `${total}`;
  if (countAll) countAll.textContent = total;
  if (countActive) countActive.textContent = activeCount;
  if (countCompleted) countCompleted.textContent = completedCount;

  applyFilter();
}

async function loadExistingJobs() {
  try {
    const res = await fetch('/api/jobs');
    const jobs = await res.json();
    if (Array.isArray(jobs)) {
      jobs.forEach(job => renderOrUpdateJob(job));
    }
  } catch (err) {
    console.error('Failed to load existing jobs:', err);
  }
}

function setupEventSource() {
  const evtSource = new EventSource('/api/progress');
  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.jobId) {
        renderOrUpdateJob({ ...data, id: data.jobId });
      }
    } catch (err) {
      console.error('Error handling SSE data:', err);
    }
  };
}

function setLoading(btn, isLoading) {
  const spinner = btn.querySelector('.spinner');
  const text = btn.querySelector('.btn-text');
  btn.disabled = isLoading;
  if (isLoading) {
    spinner.classList.remove('hidden');
  } else {
    spinner.classList.add('hidden');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

checkSystem();
setupEventSource();
loadExistingJobs();

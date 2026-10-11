const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { EventEmitter } = require('events');

const PORT = process.env.PORT || 3000;
const BIN_DIR = path.join(__dirname, 'bin');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

const jobs = new Map();

function getBinPath(executableName) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const localBin = path.join(BIN_DIR, `${executableName}${ext}`);
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return executableName;
}

function checkFFmpeg() {
  return new Promise((resolve) => {
    const ffmpegPath = getBinPath('ffmpeg');
    if (fs.existsSync(ffmpegPath)) return resolve(true);
    try {
      const proc = spawn('ffmpeg', ['-version']);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // System check
  if (pathname === '/api/system' && req.method === 'GET') {
    const ytdlpPath = getBinPath('yt-dlp');
    let ytdlpVersion = 'Not found';
    try {
      const proc = spawn(ytdlpPath, ['--version']);
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      await new Promise(r => {
        proc.on('error', () => r(null));
        proc.on('close', r);
      });
      ytdlpVersion = out.trim() || 'Available';
    } catch {
      ytdlpVersion = 'Not installed';
    }

    const ffmpegReady = await checkFFmpeg();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ytDlpVersion: ytdlpVersion,
      hasFFmpeg: ffmpegReady,
      defaultDownloadDir: DEFAULT_DOWNLOAD_DIR
    }));
  }

  // Fetch metadata & resolutions
  if (pathname === '/api/info' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const url = (body.url || '').trim();
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL is required' }));
      }

      const ytdlpPath = getBinPath('yt-dlp');
      const args = [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        url
      ];

      const proc = spawn(ytdlpPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
      proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

      proc.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'yt-dlp execution error: ' + err.message }));
      });

      proc.on('close', code => {
        if (code !== 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: stderr.trim() || 'Failed to extract video info' }));
        }

        try {
          const info = JSON.parse(stdout);
          const formats = Array.isArray(info.formats) ? info.formats : [];
          
          const videoResMap = new Map();
          formats.forEach(f => {
            if (f.height && f.height >= 144) {
              const existing = videoResMap.get(f.height);
              const size = f.filesize || f.filesize_approx || 0;
              if (!existing || size > (existing.filesize || 0)) {
                let label = `${f.height}p`;
                if (f.height >= 2160) label += ' 4K';
                else if (f.height >= 1440) label += ' 2K';
                else if (f.height >= 1080) label += ' Full HD';
                else if (f.height >= 720) label += ' HD';
                else if (f.height >= 480) label += ' SD';

                videoResMap.set(f.height, {
                  height: f.height,
                  label,
                  fps: f.fps || null,
                  ext: f.ext,
                  filesize: size
                });
              }
            }
          });

          const resolutions = Array.from(videoResMap.values()).sort((a, b) => b.height - a.height);

          const result = {
            id: info.id,
            title: info.title || 'Unknown Title',
            uploader: info.uploader || info.channel || 'Unknown Creator',
            duration: info.duration || 0,
            thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
            description: (info.description || '').slice(0, 300),
            resolutions,
            webpage_url: info.webpage_url || url
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Failed to parse metadata: ' + err.message }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Start Download
  if (pathname === '/api/download' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const url = (body.url || '').trim();
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL is required' }));
      }

      const jobId = 'job_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const downloadDir = body.outputDir || DEFAULT_DOWNLOAD_DIR;
      if (!fs.existsSync(downloadDir)) {
        try { fs.mkdirSync(downloadDir, { recursive: true }); } catch {}
      }

      const ytdlpPath = getBinPath('yt-dlp');
      const ffmpegPath = getBinPath('ffmpeg');

      const mode = body.mode || 'video';
      const quality = body.quality || 'best';
      const format = body.format || (mode === 'audio' ? 'mp3' : 'mp4');

      let qualityTag = quality;
      if (mode === 'video') {
        qualityTag = quality === 'best' ? 'Best' : `${quality}p`;
      } else {
        qualityTag = `Audio_${quality}`;
      }

      const outputTemplate = path.join(downloadDir, `%(title)s [${qualityTag}] [%(id)s].%(ext)s`);

      const args = [
        '--newline',
        '--progress',
        '--force-overwrites',
        '--progress-template', 'download-progress:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s',
        '--print', 'after_move:FINAL_PATH:%(filepath)s',
        '--no-mtime',
        '--concurrent-fragments', '8',
        '-o', outputTemplate
      ];

      if (fs.existsSync(ffmpegPath)) {
        args.push('--ffmpeg-location', BIN_DIR);
      }

      if (mode === 'audio') {
        args.push('-x');
        args.push('--audio-format', format);
        if (quality && quality !== 'best') {
          args.push('--audio-quality', quality);
        }
      } else {
        if (quality === 'best') {
          args.push('-f', 'bv*+ba/b');
        } else {
          const qNum = parseInt(quality, 10);
          if (!isNaN(qNum)) {
            args.push('-f', `bv*[height<=${qNum}]+ba/b[height<=${qNum}]/bv*+ba/b`);
          } else {
            args.push('-f', 'bv*+ba/b');
          }
        }
        args.push('--merge-output-format', format);
      }

      // Auto embed metadata, chapters, and subs
      args.push('--embed-metadata', '--embed-chapters');
      // Do NOT download or save separate thumbnail files
      args.push('--no-write-thumbnail');
      args.push('--write-subs', '--sub-langs', 'en.*,en', '--embed-subs');

      args.push(url);

      const jobData = {
        id: jobId,
        url,
        title: body.title || url,
        mode,
        quality,
        format,
        downloadDir,
        finalFilePath: null,
        status: 'starting',
        progress: 0,
        speed: '--',
        eta: '--',
        size: '--',
        logs: [],
        createdAt: new Date().toISOString()
      };

      jobs.set(jobId, jobData);

      const proc = spawn(ytdlpPath, args);
      jobData.process = proc;

      const ffmpegRegex = /\[(?:ffmpeg|Merger|EmbedSubtitle|ThumbnailsConvertor)\]/i;

      proc.stdout.on('data', chunk => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          jobData.logs.push(trimmed);
          if (jobData.logs.length > 100) jobData.logs.shift();

          if (trimmed.startsWith('download-progress:')) {
            const raw = trimmed.slice('download-progress:'.length);
            const parts = raw.split('|');
            const pct = parseFloat(parts[0]);
            if (!isNaN(pct)) {
              jobData.progress = Math.min(100, Math.max(0, pct));
            }
            const rawSpeed = parts[1] && parts[1].trim() !== 'Unknown B/s' ? parts[1].trim() : '--';
            jobData.speed = rawSpeed.replace(/KiB/g, 'KB').replace(/MiB/g, 'MB').replace(/GiB/g, 'GB').replace(/TiB/g, 'TB');
            jobData.eta = parts[2] && parts[2].trim() !== 'Unknown' && parts[2].trim() !== 'NA' ? parts[2].trim() : '--';
            const parsedSize = parts[3] && parts[3].trim() !== 'N/A' && parts[3].trim() !== 'NA' ? parts[3].trim() : '';
            if (parsedSize) {
              jobData.size = parsedSize.replace(/KiB/g, 'KB').replace(/MiB/g, 'MB').replace(/GiB/g, 'GB').replace(/TiB/g, 'TB');
            }
            if (jobData.status !== 'paused' && jobData.status !== 'cancelled') {
              jobData.status = 'downloading';
              eventBus.emit('progress', { jobId, ...jobData, process: undefined });
            }
          } else if (trimmed.startsWith('FINAL_PATH:')) {
            jobData.finalFilePath = trimmed.slice('FINAL_PATH:'.length).trim();
          } else if (ffmpegRegex.test(trimmed)) {
            if (jobData.status !== 'paused' && jobData.status !== 'cancelled') {
              jobData.status = 'processing';
              eventBus.emit('progress', { jobId, ...jobData, process: undefined });
            }
          }
        }
      });

      proc.stderr.on('data', chunk => {
        const text = chunk.toString().trim();
        if (text) {
          jobData.logs.push(text);
          if (jobData.logs.length > 100) jobData.logs.shift();
        }
      });

      proc.on('error', err => {
        jobData.process = null;
        jobData.status = 'failed';
        jobData.eta = 'Error';
        jobData.logs.push(`Failed to start yt-dlp: ${err.message}`);
        eventBus.emit('progress', { jobId, ...jobData, process: undefined });
      });

      proc.on('close', code => {
        jobData.process = null;
        if (jobData.status === 'cancelled') {
          // keep cancelled
        } else if (code === 0) {
          jobData.status = 'completed';
          jobData.progress = 100;
          jobData.eta = 'Done';
          
          // Verify final file on disk & read exact actual file size
          if (!jobData.finalFilePath || !fs.existsSync(jobData.finalFilePath)) {
            try {
              const files = fs.readdirSync(downloadDir);
              const matching = files
                .map(f => ({ name: f, path: path.join(downloadDir, f), mtime: fs.statSync(path.join(downloadDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
              if (matching.length > 0 && (Date.now() - matching[0].mtime) < 30000) {
                jobData.finalFilePath = matching[0].path;
              }
            } catch {}
          }

          if (jobData.finalFilePath && fs.existsSync(jobData.finalFilePath)) {
            try {
              const stat = fs.statSync(jobData.finalFilePath);
              jobData.size = formatBytes(stat.size);
            } catch {}
          }
        } else {
          jobData.status = 'failed';
          jobData.error = 'Exit code: ' + code;
        }
        eventBus.emit('progress', { jobId, ...jobData, process: undefined });
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jobId, status: 'started' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // SSE progress stream
  if (pathname === '/api/progress' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write('retry: 1000\n\n');

    const listener = data => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    eventBus.on('progress', listener);

    req.on('close', () => {
      eventBus.off('progress', listener);
    });
    return;
  }

  // Jobs listing
  if (pathname === '/api/jobs' && req.method === 'GET') {
    const list = Array.from(jobs.values()).map(j => {
      const { process: _, ...safeJob } = j;
      return safeJob;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }

  // Open URL directly in Free Download Manager (FDM)
  if (pathname === '/api/open-fdm' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const url = (body.url || '').trim();
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL is required' }));
      }

      const fdmCandidates = [
        'C:\\Program Files\\Softdeluxe\\Free Download Manager\\fdm.exe',
        'C:\\Program Files\\Free Download Manager\\fdm.exe',
        'C:\\Program Files (x86)\\Free Download Manager\\fdm.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Free Download Manager', 'fdm.exe')
      ];

      const fdmPath = fdmCandidates.find(p => fs.existsSync(p));

      if (fdmPath) {
        const child = spawn(fdmPath, [url], { detached: true, stdio: 'ignore' });
        child.unref();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Opened in Free Download Manager' }));
      } else {
        // Fallback: try opening with fdm:// custom protocol or browser
        exec(`start fdm://"${url}"`, (err) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Free Download Manager (fdm.exe) not found on system.' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'Triggered via FDM protocol' }));
          }
        });
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Pause / Resume job
  if (pathname === '/api/pause' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const job = jobs.get(body.jobId);
      if (job && job.process) {
        if (job.status !== 'paused') {
          // Suspend
          job.status = 'paused';
          job.speed = 'Paused';
          job.eta = '--';
          eventBus.emit('progress', { jobId: job.id, ...job, process: undefined });
          if (process.platform === 'win32') {
            exec(`powershell -ExecutionPolicy Bypass -File "${path.join(BIN_DIR, 'process_control.ps1')}" -processId ${job.process.pid} -action suspend`);
          } else {
            job.process.kill('SIGSTOP');
          }
        } else {
          // Resume
          job.status = 'downloading';
          eventBus.emit('progress', { jobId: job.id, ...job, process: undefined });
          if (process.platform === 'win32') {
            exec(`powershell -ExecutionPolicy Bypass -File "${path.join(BIN_DIR, 'process_control.ps1')}" -processId ${job.process.pid} -action resume`);
          } else {
            job.process.kill('SIGCONT');
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, status: job ? job.status : 'unknown' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Cancel job or dismiss job
  if (pathname === '/api/cancel' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const job = jobs.get(body.jobId);
      if (job) {
        if (job.process) {
          // If paused, resume first before killing so process immediately flushes/terminates
          if (job.status === 'paused') {
            try {
              if (process.platform === 'win32') {
                exec(`powershell -ExecutionPolicy Bypass -File "${path.join(BIN_DIR, 'process_control.ps1')}" -processId ${job.process.pid} -action resume`);
              } else {
                job.process.kill('SIGCONT');
              }
            } catch {}
          }
          job.status = 'cancelled';
          job.speed = '--';
          job.eta = 'Cancelled';
          eventBus.emit('progress', { jobId: job.id, ...job, process: undefined });
          try {
            if (process.platform === 'win32') {
              exec(`taskkill /pid ${job.process.pid} /T /F`);
            } else {
              job.process.kill('SIGKILL');
            }
          } catch {}
        } else {
          jobs.delete(body.jobId);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }
  }

  // Open folder / file in Windows Explorer
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const target = body.path || DEFAULT_DOWNLOAD_DIR;
      
      if (process.platform === 'win32') {
        const normalized = path.normalize(target);
        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
          const child = spawn('explorer.exe', [`/select,${normalized}`], { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          const folder = fs.existsSync(normalized) ? normalized : DEFAULT_DOWNLOAD_DIR;
          const child = spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' });
          child.unref();
        }
      } else {
        exec(`open "${target}" || xdg-open "${target}"`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Download / Stream finished file to browser (FDM or browser downloader)
  if (pathname.startsWith('/api/file/') && req.method === 'GET') {
    const jobId = pathname.replace('/api/file/', '');
    const job = jobs.get(jobId);
    if (!job || !job.finalFilePath || !fs.existsSync(job.finalFilePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not ready or does not exist on disk' }));
    }

    try {
      const filePath = job.finalFilePath;
      const stat = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Accept-Ranges': 'bytes'
      });

      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Clear completed or dismissed jobs
  if (pathname === '/api/clear-completed' && req.method === 'POST') {
    for (const [id, job] of jobs.entries()) {
      if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
        jobs.delete(id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`yt-dlp GUI Server running at http://localhost:${PORT}`);
});

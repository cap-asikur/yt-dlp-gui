# yt-dlp Web GUI

A clean, modern, zero-bloat local Web GUI wrapper for [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/).

Built with pure Node.js and vanilla HTML/CSS/JavaScript. Zero external npm dependencies.

---

## ✨ Features

- **1000+ Platforms Supported:** Full compatibility with YouTube, Twitter/X, TikTok, Reddit, Instagram, Twitch, and more via `yt-dlp`.
- **Live Metadata Inspector:** Auto-extracts title, creator, duration, thumbnail, and stream resolutions (4K, 1440p, 1080p, 720p, etc.).
- **Download Modes:**
  - **Video:** MP4, MKV, WebM (with quality selection from 360p up to 4K).
  - **Audio Only:** MP3, M4A, FLAC, WAV, Opus (with bitrate options: 320k, 256k, 192k, 128k).
- **Embedded Subtitles:** Automatically downloads and embeds subtitles when available.
- **Side-by-Side Dashboard Layout:** 2-column interface displays the URL analyzer alongside active downloads without clutter.
- **Real-Time Progress & Controls:** Server-Sent Events (SSE) update download percentage, speed (KB/MB/GB), ETA, and status in real time with Pause, Resume, Cancel, and Retry support.
- **Queue Management & History:** Filter jobs by All, Active, or Completed; 1-click "Clear Done" clean-up; persistent state across browser refreshes.

---

## 🚀 Prerequisites

Make sure you have installed:
1. **[Node.js](https://nodejs.org/)** (v16 or higher)
2. **`yt-dlp`** and **`ffmpeg`**

### Installing Prerequisites:

- **Windows:**
  ```powershell
  winget install yt-dlp
  winget install Gyan.FFmpeg
  ```
  *(Or place `yt-dlp.exe` and `ffmpeg.exe` directly inside the `bin/` directory).*

- **macOS:**
  ```bash
  brew install node yt-dlp ffmpeg
  ```

- **Linux (Ubuntu/Debian):**
  ```bash
  sudo apt update && sudo apt install -y nodejs ffmpeg
  sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
  ```

---

## 🛠️ Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/yt-dlp-gui.git
cd yt-dlp-gui
```

### 2. Start the application

- **Windows (Quick Start):** Double-click `start.bat`
- **Or via Terminal:**
  ```bash
  node server.js
  ```

### 3. Open in Browser
Navigate to:
```
http://localhost:3000
```

---

## ⚙️ Configuration

You can customize the listening port using the `PORT` environment variable:

```bash
PORT=8080 node server.js
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

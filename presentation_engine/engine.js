/**
 * Declarative Web Presentation Engine (DWPE)
 * Canonical Zero-JS Runtime Engine
 */

(function () {
  'use strict';

  // --- TermPlayer: Modular Time-Based VT100/ANSI Stream Engine ---
  const ANSI_16_PALETTE = {
    30: '#000000',
    31: '#cd3131',
    32: '#0dbc79',
    33: '#cdcd00',
    34: '#2472c8',
    35: '#bc3fbc',
    36: '#11a8cd',
    37: '#e5e5e5',
    90: '#666666',
    91: '#f14c4c',
    92: '#23d18b',
    93: '#e5e510',
    94: '#3b8eea',
    95: '#d670d6',
    96: '#29b8db',
    97: '#ffffff',
  };

  function ansi256ToRgb(idx) {
    if (idx >= 0 && idx < 8) return ANSI_16_PALETTE[30 + idx];
    if (idx >= 8 && idx < 16) return ANSI_16_PALETTE[90 + (idx - 8)];
    if (idx >= 16 && idx <= 231) {
      const n = idx - 16;
      const r = Math.floor(n / 36);
      const g = Math.floor((n % 36) / 6);
      const b = n % 6;
      const v = [0, 95, 135, 175, 215, 255];
      return `rgb(${v[r]},${v[g]},${v[b]})`;
    }
    if (idx >= 232 && idx <= 255) {
      const gray = 8 + (idx - 232) * 10;
      return `rgb(${gray},${gray},${gray})`;
    }
    return null;
  }

  function compileTermAsset(asset) {
    const rawEvents = Array.isArray(asset) ? asset : (asset.events || []);
    const stream = [];

    const emit = (t, str) => {
      stream.push([Number(t.toFixed(4)), str]);
    };

    for (const ev of rawEvents) {
      if (Array.isArray(ev)) {
        const t = Number(ev[0] || 0);
        const data = ev.length >= 3 ? ev[2] : ev[1];
        emit(t, String(data));
        continue;
      }

      const t = Number(ev.time || 0);
      const action = ev.action || 'print';

      if (action === 'clear') {
        emit(t, '\x1b[2J\x1b[H');
      } else if (action === 'type') {
        const promptStr = ev.prompt !== undefined ? ev.prompt : '\x1b[1;32m$\x1b[0m ';
        const text = ev.text || '';
        const duration = Number(ev.duration || 1.0);
        emit(t, promptStr + '\x1b[?25h');

        const chunkSize = 2;
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
          chunks.push(text.slice(i, i + chunkSize));
        }
        const dt = duration / Math.max(1, chunks.length);
        let currT = t + 0.06;
        for (const ch of chunks) {
          emit(currT, ch);
          currT += dt;
        }
        emit(currT + 0.06, '\x1b[?25l\r\n');
      } else if (action === 'progress' || action === 'spinner') {
        const duration = Number(ev.duration || 4.0);
        const steps = Math.max(Number(ev.steps || 16), 24);
        const label = ev.label || 'Processing';
        const detail = ev.detail || '';
        const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

        for (let idx = 0; idx < steps; idx++) {
          const stepT = t + (idx * (duration / steps));
          const spin = spinnerChars[idx % spinnerChars.length];
          const detailPart = detail ? ` (${detail} • can take several minutes)...` : ' (can take several minutes)...';
          const ansiLine = `\r\x1b[2K  \x1b[1;33m${spin} ${label}${detailPart}\x1b[0m`;
          emit(stepT, ansiLine);
        }
      } else if (action === 'replace_line') {
        const data = (ev.data || '').replace(/\r?\n$/, '');
        emit(t, '\r\x1b[2K' + data + '\r\n');
      } else if (action === 'scroll') {
        const fromLine = Number(ev.from_line || 0);
        const toLine = Number(ev.to_line || 0);
        const duration = Number(ev.duration || 0.35);
        const steps = Number(ev.steps || 5);
        for (let i = 0; i <= steps; i++) {
          const stepT = t + (i * (duration / Math.max(1, steps)));
          const line = Math.round(fromLine + ((toLine - fromLine) * (i / Math.max(1, steps))));
          emit(stepT, `\x1b[SCROLL:${line}]`);
        }
      } else {
        let payload = ev.data || '';
        if (ev.scroll_to !== undefined) {
          payload += `\x1b[SCROLL:${ev.scroll_to}]`;
        }
        emit(t, payload);
      }
    }

    stream.sort((a, b) => a[0] - b[0]);
    return stream;
  }

  class TermPlayer {
    constructor(containerEl) {
      this.container = containerEl;
      this.stream = [];
      this.lastRenderedSecond = -1;
      this.lineHeightPx = 16.24;
    }

    async load(assetUrl) {
      try {
        const res = await fetch(assetUrl);
        if (!res.ok) return [];
        const text = await res.text();
        const parsed = JSON.parse(text);
        this.stream = compileTermAsset(parsed);
        this.lastRenderedSecond = -1;
        return this.stream;
      } catch (e) {
        console.warn('TermPlayer load skipped or failed:', e);
        return [];
      }
    }

    render(second) {
      if (!this.container || !this.stream.length) return;
      if (Math.abs(second - this.lastRenderedSecond) < 0.015) return;
      this.lastRenderedSecond = second;

      let lines = [[]];
      let row = 0;
      let col = 0;
      let cursorVisible = false;
      let scrollLine = 'auto';

      let pen = { fg: null, bg: null, bold: false, dim: false, italic: false };
      const resetPen = () => {
        pen = { fg: null, bg: null, bold: false, dim: false, italic: false };
      };
      const ensureRow = (r) => {
        while (lines.length <= r) lines.push([]);
      };

      const applySgrCodes = (codes) => {
        if (!codes.length) {
          resetPen();
          return;
        }
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          if (c === 0) resetPen();
          else if (c === 1) pen.bold = true;
          else if (c === 2) pen.dim = true;
          else if (c === 3) pen.italic = true;
          else if (c === 22) { pen.bold = false; pen.dim = false; }
          else if (c === 23) pen.italic = false;
          else if (c === 39) pen.fg = null;
          else if (c === 49) pen.bg = null;
          else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) pen.fg = ANSI_16_PALETTE[c] || null;
          else if (c === 38 && codes[i + 1] === 5) { pen.fg = ansi256ToRgb(codes[i + 2]) || null; i += 2; }
          else if (c === 38 && codes[i + 1] === 2) { pen.fg = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4; }
          else if (c === 48 && codes[i + 1] === 5) { pen.bg = ansi256ToRgb(codes[i + 2]) || null; i += 2; }
          else if (c === 48 && codes[i + 1] === 2) { pen.bg = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4; }
        }
      };

      for (let idx = 0; idx < this.stream.length; idx++) {
        const [evTime, chunk] = this.stream[idx];
        if (evTime > second) break;

        let i = 0;
        const len = chunk.length;
        while (i < len) {
          const ch = chunk[i];
          if (ch === '\x1b') {
            if (chunk.startsWith('\x1b[SCROLL:', i)) {
              const closeIdx = chunk.indexOf(']', i);
              if (closeIdx !== -1) {
                const val = chunk.slice(i + 9, closeIdx);
                scrollLine = val === 'auto' ? 'auto' : parseInt(val, 10);
                i = closeIdx + 1;
                continue;
              }
            }
            if (chunk[i + 1] === '[') {
              let j = i + 2;
              while (j < len && !/[A-Za-z]/.test(chunk[j])) j++;
              if (j < len) {
                const cmd = chunk[j];
                const paramStr = chunk.slice(i + 2, j);
                if (cmd === 'm') {
                  const codes = paramStr ? paramStr.split(';').map((s) => parseInt(s, 10) || 0) : [0];
                  applySgrCodes(codes);
                } else if (cmd === 'J' && paramStr === '2') {
                  lines = [[]]; row = 0; col = 0; scrollLine = 'auto';
                } else if (cmd === 'H') {
                  row = 0; col = 0;
                } else if (cmd === 'K' && paramStr === '2') {
                  ensureRow(row); lines[row] = []; col = 0;
                } else if (cmd === 'h' && paramStr === '?25') {
                  cursorVisible = true;
                } else if (cmd === 'l' && paramStr === '?25') {
                  cursorVisible = false;
                }
                i = j + 1;
                continue;
              }
            }
            i++;
            continue;
          }
          if (ch === '\r') { col = 0; i++; continue; }
          if (ch === '\n') { row++; col = 0; ensureRow(row); i++; continue; }

          ensureRow(row);
          const currentLine = lines[row];
          while (currentLine.length < col) {
            currentLine.push({ char: ' ', fg: null, bg: null, bold: false, dim: false, italic: false });
          }
          const cell = { char: ch, fg: pen.fg, bg: pen.bg, bold: pen.bold, dim: pen.dim, italic: pen.italic };
          if (col < currentLine.length) currentLine[col] = cell;
          else currentLine.push(cell);
          col++;
          i++;
        }
      }

      const htmlLines = [];
      const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const styleForCell = (c) => {
        if (!c) return '';
        let s = '';
        if (c.fg) s += `color:${c.fg};`;
        if (c.bg) s += `background:${c.bg};`;
        if (c.bold) s += 'font-weight:700;';
        if (c.dim) s += 'opacity:0.68;';
        if (c.italic) s += 'font-style:italic;';
        return s;
      };

      for (let r = 0; r < lines.length; r++) {
        const lineCells = lines[r];
        let lineHtml = '';
        let runText = '';
        let runStyle = '';
        const flushRun = () => {
          if (!runText) return;
          const escaped = escapeHtml(runText);
          lineHtml += runStyle ? `<span style="${runStyle}">${escaped}</span>` : escaped;
          runText = '';
        };

        const maxCol = Math.max(lineCells.length, r === row && cursorVisible ? col + 1 : 0);
        for (let c = 0; c < maxCol; c++) {
          if (r === row && c === col && cursorVisible) {
            flushRun();
            const curChar = lineCells[c] ? escapeHtml(lineCells[c].char) : ' ';
            lineHtml += `<span class="term-cursor">${curChar}</span>`;
            runStyle = '';
            continue;
          }
          const cell = lineCells[c] || { char: ' ' };
          const st = styleForCell(cell);
          if (st !== runStyle) {
            flushRun();
            runStyle = st;
          }
          runText += cell.char;
        }
        flushRun();
        htmlLines.push(`<div class="term-line">${lineHtml || '&#8203;'}</div>`);
      }

      this.container.innerHTML = htmlLines.join('');
      if (scrollLine === 'auto') {
        this.container.scrollTop = this.container.scrollHeight;
      } else {
        this.container.scrollTop = scrollLine * this.lineHeightPx;
      }
    }
  }

  window.TermPlayer = TermPlayer;
  window.compileTermAsset = compileTermAsset;

  // --- DWPE Core State ---
  let timelineEvents = [];
  let currentSlideIndex = 0;
  let currentExactSecond = 0;
  let elapsedTime = 0;
  let isPaused = true;
  let playbackSpeed = 1.0;
  let isAudioMuted = true;
  let ccEnabled = true;
  let isRecording = false;
  let originalDocumentTitle = document.title;
  let mediaRecorder = null;
  let recordedChunks = [];
  let rafId = null;
  let lastRealTime = 0;
  let TOTAL_DURATION = 120;
  let currentSpeechAudio = null;
  let currentSpeechPath = null;
  let controlsTimeout = null;

  const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  const speechAudioCache = new Map();

  // DOM Elements
  const stage = document.getElementById('stage');
  const slidesContainer = document.querySelector('slides');
  const slideElements = Array.from(document.querySelectorAll('slides > slide'));
  const videoContainer = document.getElementById('video-container');
  const demoVideo = document.getElementById('demo-video');
  const terminalContainer = document.getElementById('terminal-container');
  const termDomCanvas = document.getElementById('term-dom-canvas');
  const ffPopup = document.getElementById('ff-popup');
  const ccOverlay = document.getElementById('cc-overlay');
  const ccSpeaker = document.getElementById('cc-speaker');
  const ccText = document.getElementById('cc-text');
  const toastOverlay = document.getElementById('toast-overlay');
  const toastText = document.getElementById('toast-text');
  const timerDisplay = document.getElementById('timer-display');
  const timerCount = document.getElementById('timer-count');
  const slideInfoText = document.getElementById('slide-info-text');
  const slideProgressBar = document.getElementById('slide-progress-bar');
  const prevSlideBtn = document.getElementById('prev-slide-btn') || document.getElementById('btn-prev');
  const playPauseBtn = document.getElementById('play-pause-btn') || document.getElementById('btn-play');
  const nextSlideBtn = document.getElementById('next-slide-btn') || document.getElementById('btn-next');
  const ccToggleBtn = document.getElementById('cc-toggle-btn');
  const audioMuteBtn = document.getElementById('audio-mute-btn');
  const speedSlider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');
  const recordBtn = document.getElementById('record-btn');
  const recordConfigBtn = document.getElementById('record-config-btn');
  const recordConfigPopover = document.getElementById('record-config-popover');
  const recordConfigClose = document.getElementById('record-config-close');
  const recOptSubtitles = document.getElementById('rec-opt-subtitles');
  const recOptProgress = document.getElementById('rec-opt-progress');
  const recOptAutoresize = document.getElementById('rec-opt-autoresize');
  const recPopoutBtn = document.getElementById('rec-popout-btn');
  const recTabResizeContainer = document.getElementById('rec-tab-resize-container');
  const recPopoutActiveContainer = document.getElementById('rec-popout-active-container');
  const countdownSplash = document.getElementById('countdown-splash');
  const countdownNumber = document.getElementById('countdown-number');
  const slideDotsContainer = document.getElementById('slide-dots');

  const terminalRenderer = new TermPlayer(termDomCanvas);
  window.terminalRenderer = terminalRenderer;

  // Detect whether currently running in isolated popout window
  const isPopout = window.opener !== null ||
                   window.name === 'DWPERecordingWindow' ||
                   window.name === 'ComplianceDemoRecordingWindow' ||
                   new URLSearchParams(window.location.search).get('popout') === 'true';

  // Record Configuration State (1080p / 720p, subtitles, progress, autoresize)
  const DEFAULT_RECORD_CONFIG = {
    resolution: '1080p',
    showSubtitles: true,
    showProgress: true,
    autoResize: true
  };

  let recordConfig = { ...DEFAULT_RECORD_CONFIG };
  try {
    const saved = localStorage.getItem('compliance_record_config');
    if (saved) {
      recordConfig = { ...DEFAULT_RECORD_CONFIG, ...JSON.parse(saved) };
    }
  } catch (e) {}

  function saveRecordConfig() {
    try {
      localStorage.setItem('compliance_record_config', JSON.stringify(recordConfig));
    } catch (e) {}
  }

  function syncRecordConfigUI() {
    const resRadios = document.querySelectorAll('input[name="rec-res"]');
    resRadios.forEach(r => {
      r.checked = (r.value === recordConfig.resolution);
    });
    if (recOptSubtitles) recOptSubtitles.checked = !!recordConfig.showSubtitles;
    if (recOptProgress) recOptProgress.checked = !!recordConfig.showProgress;
    if (recOptAutoresize) recOptAutoresize.checked = !!recordConfig.autoResize;

    if (recPopoutBtn) {
      recPopoutBtn.textContent = `🗗 Open in Popout (${recordConfig.resolution})`;
    }

    if (isPopout) {
      if (recTabResizeContainer) recTabResizeContainer.style.display = 'none';
      if (recPopoutActiveContainer) recPopoutActiveContainer.style.display = 'block';
    } else {
      if (recTabResizeContainer) recTabResizeContainer.style.display = 'block';
      if (recPopoutActiveContainer) recPopoutActiveContainer.style.display = 'none';
    }
  }

  function getTargetResolutionDimensions(res) {
    if (res === '720p') return { width: 1280, height: 720 };
    return { width: 1920, height: 1080 };
  }

  function scaleStage() {
    if (!stage) return;
    const scaleX = window.innerWidth / 1920;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY);
    stage.style.transform = `scale(${scale})`;
  }

  window.addEventListener('resize', scaleStage);
  scaleStage();

  function resizeWindowForRecording(targetW, targetH) {
    try {
      const chromeW = window.outerWidth - window.innerWidth;
      const chromeH = window.outerHeight - window.innerHeight;
      window.resizeTo(targetW + chromeW, targetH + chromeH);
    } catch (e) {}
  }

  function compensateBannerResize(targetW, targetH) {
    try {
      const missingW = targetW - window.innerWidth;
      const missingH = targetH - window.innerHeight;
      if (missingH !== 0 || missingW !== 0) {
        if (typeof window.resizeBy === 'function') {
          window.resizeBy(missingW, missingH);
        } else if (typeof window.resizeTo === 'function') {
          window.resizeTo(window.outerWidth + missingW, window.outerHeight + missingH);
        }
      }
    } catch (e) {}
    scaleStage();
  }

  function openInPopoutWindow() {
    const dims = getTargetResolutionDimensions(recordConfig.resolution);
    const targetW = dims.width;
    const targetH = dims.height;
    const left = Math.max(0, Math.round((window.screen.availWidth - targetW) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - targetH) / 2));
    const url = new URL(window.location.href);
    url.searchParams.set('popout', 'true');
    url.searchParams.set('t', Math.floor(elapsedTime).toString());

    const popWin = window.open(
      url.toString(),
      'DWPERecordingWindow',
      `popup=yes,width=${targetW},height=${targetH},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`
    );

    if (popWin) {
      popWin.addEventListener('load', () => {
        try {
          const dW = targetW - popWin.innerWidth;
          const dH = targetH - popWin.innerHeight;
          if (dW !== 0 || dH !== 0) popWin.resizeBy(dW, dH);
        } catch (e) {}
      });
      closeRecordConfigPopover();
    }
  }

  function closeRecordConfigPopover() {
    if (recordConfigPopover) recordConfigPopover.classList.remove('active');
    if (recordConfigBtn) recordConfigBtn.classList.remove('active');
  }

  // Initialize Presentation Engine
  async function initEngine() {
    syncRecordConfigUI();

    let termAssetUrl = 'assets/demo.term.json';
    try {
      const res = await fetch('timeline.yaml');
      const text = await res.text();
      const termMatch = text.match(/^termAsset:\s*(.+)$/m);
      if (termMatch) termAssetUrl = termMatch[1].trim();
      const totalDurMatch = text.match(/^totalDuration:\s*([\d.]+)$/m);
      if (totalDurMatch) TOTAL_DURATION = parseFloat(totalDurMatch[1]);
      timelineEvents = parseYamlTimeline(text);
      console.log('✅ DWPE Engine: Loaded timeline.yaml events:', timelineEvents.length);
    } catch (err) {
      console.warn('⚠️ DWPE Engine: Could not load timeline.yaml, running manual slide mode:', err);
    }

    await terminalRenderer.load(termAssetUrl);

    if (timelineEvents.length > 0) {
      const maxEnd = Math.max(...timelineEvents.map(e => e.end || (e.start + (e.duration || e.dur || 0))));
      if (maxEnd > 0) TOTAL_DURATION = Math.max(TOTAL_DURATION, Math.ceil(maxEnd + 2));
    }

    if (audioMuteBtn) {
      audioMuteBtn.classList.toggle('active', !isAudioMuted);
      audioMuteBtn.innerHTML = isAudioMuted ? '🔇 Unmute' : '🔊 Mute';
    }

    if (demoVideo) {
      demoVideo.addEventListener('loadedmetadata', () => evaluateTimelineState(currentExactSecond));
      demoVideo.addEventListener('loadeddata', () => evaluateTimelineState(currentExactSecond));
    }

    generateSlideDots();
    setupEventListeners();
    updateSlideDisplay();

    window.timelineEvents = timelineEvents;
    window.evaluateTimelineState = evaluateTimelineState;
    window.seekToSecond = seekToSecond;

    const urlParams = new URLSearchParams(window.location.search);
    const tParam = parseFloat(urlParams.get('t') || '0');
    if (!isNaN(tParam) && tParam > 0) {
      seekToSecond(tParam);
    } else {
      evaluateTimelineState(0);
    }

    Promise.all([
      preloadAllSpeechAudioInMemory(),
      preloadVideoInMemoryBlob()
    ]).then(() => {
      evaluateTimelineState(currentExactSecond);
    });
  }

  // Minimal YAML Timeline Parser
  function parseYamlTimeline(yamlText) {
    const events = [];
    const blocks = yamlText.split(/- start:/g).slice(1);
    for (let b of blocks) {
      const lines = b.split('\n');
      const ev = {};
      const startMatch = lines[0].trim().match(/^([\d.]+)/);
      if (startMatch) ev.start = parseFloat(startMatch[1]);

      for (let l of lines.slice(1)) {
        const parts = l.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          let val = parts.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
          if (['slide', 'duration', 'dur', 'seek', 'speed', 'end'].includes(key)) {
            val = parseFloat(val);
          } else if (key === 'playing') {
            val = val === 'true';
          }
          ev[key] = val;
        }
      }
      const dur = ev.duration || ev.dur || 0;
      ev.duration = dur;
      ev.dur = dur;
      ev.end = ev.end || (ev.start + dur);
      events.push(ev);
    }
    return events.sort((a, b) => a.start - b.start);
  }

  async function preloadAllSpeechAudioInMemory() {
    const audioEvents = timelineEvents.filter(ev => ev.audio);
    if (!audioEvents.length) return;
    const promises = audioEvents.map(async (ev) => {
      try {
        const res = await fetch(ev.audio);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audio.preload = 'auto';
        speechAudioCache.set(ev.audio, audio);
      } catch (err) {
        const audio = new Audio(ev.audio);
        audio.preload = 'auto';
        speechAudioCache.set(ev.audio, audio);
      }
    });
    await Promise.allSettled(promises);
  }

  async function preloadVideoInMemoryBlob() {
    if (!demoVideo) return;
    const rawSrc = demoVideo.getAttribute('src');
    if (!rawSrc || rawSrc.startsWith('blob:')) return;
    try {
      const res = await fetch(rawSrc);
      if (!res.ok) return;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      await new Promise((resolve) => {
        const onReady = () => {
          demoVideo.removeEventListener('loadeddata', onReady);
          demoVideo.removeEventListener('error', onReady);
          resolve();
        };
        demoVideo.addEventListener('loadeddata', onReady);
        demoVideo.addEventListener('error', onReady);
        demoVideo.src = blobUrl;
        demoVideo.load();
      });
    } catch (err) {
      console.warn('Video blob preload fallback:', err);
    }
  }

  function generateSlideDots() {
    if (!slideDotsContainer) return;
    slideDotsContainer.innerHTML = '';
    slideElements.forEach((_, idx) => {
      const dot = document.createElement('div');
      dot.className = `dot ${idx === 0 ? 'active' : ''}`;
      dot.addEventListener('click', () => goToSlide(idx));
      slideDotsContainer.appendChild(dot);
    });
  }

  function getSlideBounds(slideNum) {
    const slideEvents = timelineEvents.filter(e => e.type === 'slide');
    const ev = slideEvents.find(e => e.slide === slideNum);
    if (ev) {
      const dur = ev.duration || ev.dur || 15;
      return { start: ev.start, duration: dur, end: ev.start + dur };
    }
    const approxDur = Math.ceil(TOTAL_DURATION / Math.max(1, slideElements.length));
    const start = (slideNum - 1) * approxDur;
    return { start, duration: approxDur, end: start + approxDur };
  }

  function updateSlideDisplay() {
    slideElements.forEach((s, idx) => {
      if (idx === currentSlideIndex) s.classList.add('active');
      else s.classList.remove('active');
    });

    const dots = document.querySelectorAll('.dot');
    dots.forEach((d, idx) => {
      if (idx === currentSlideIndex) d.classList.add('active');
      else d.classList.remove('active');
    });
  }

  function goToSlide(slideIndex) {
    const targetSlideNum = slideIndex + 1;
    const bounds = getSlideBounds(targetSlideNum);
    seekToSecond(bounds.start);
  }

  function getTransitionTimestamps() {
    const timestamps = new Set([0]);
    timelineEvents.forEach(ev => {
      if (ev.type === 'slide' && ev.start !== undefined) {
        timestamps.add(ev.start);
      }
    });
    return Array.from(timestamps).sort((a, b) => a - b);
  }

  function seekToSecond(second) {
    if (currentSpeechAudio) {
      currentSpeechAudio.pause();
      try { currentSpeechAudio.currentTime = 0; } catch (e) {}
      currentSpeechAudio = null;
      currentSpeechPath = null;
    }

    second = Math.max(0, Math.min(TOTAL_DURATION, second));
    elapsedTime = second;
    currentExactSecond = elapsedTime;
    lastRealTime = performance.now();

    evaluateTimelineState(currentExactSecond);
  }

  function goToNextTransition() {
    const transitions = getTransitionTimestamps();
    const next = transitions.find(t => t > elapsedTime + 0.1);
    if (next !== undefined) seekToSecond(next);
    else seekToSecond(TOTAL_DURATION);
  }

  function goToPrevTransition() {
    const transitions = getTransitionTimestamps();
    const prevList = transitions.filter(t => t < elapsedTime - 0.5);
    if (prevList.length > 0) seekToSecond(prevList[prevList.length - 1]);
    else seekToSecond(0);
  }

  function syncSpeechAudio(activeAudioPath, second, activeAudioStart) {
    if (isPaused || isAudioMuted || !activeAudioPath) {
      if (currentSpeechAudio && !currentSpeechAudio.paused) {
        currentSpeechAudio.pause();
      }
      return;
    }

    const rate = isRecording ? 1.0 : playbackSpeed;
    if (currentSpeechPath !== activeAudioPath) {
      if (currentSpeechAudio) currentSpeechAudio.pause();
      currentSpeechPath = activeAudioPath;
      currentSpeechAudio = speechAudioCache.get(activeAudioPath) || new Audio(activeAudioPath);
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = rate;
      const offset = Math.max(0, second - activeAudioStart);
      try { currentSpeechAudio.currentTime = offset; } catch (e) {}
      currentSpeechAudio.play().catch(() => {});
    } else if (currentSpeechAudio) {
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = rate;
      if (currentSpeechAudio.paused && !isAudioMuted && !currentSpeechAudio.ended) {
        const offset = Math.max(0, second - activeAudioStart);
        try {
          if (Math.abs(currentSpeechAudio.currentTime - offset) > 0.3) {
            currentSpeechAudio.currentTime = offset;
          }
        } catch (e) {}
        currentSpeechAudio.play().catch(() => {});
      }
    }
  }

  // Compute and apply focal crop and video modal geometry on 1920x1080 stage coordinates
  function updateVideoLayoutAndCrop(pos, cropStr, speed) {
    if (!videoContainer || !demoVideo) return;
    const speedBadge = document.getElementById('video-speed-badge');

    if (pos === 'hidden') {
      videoContainer.className = 'video-pos-hidden';
      if (speedBadge) speedBadge.style.display = 'none';
      return;
    }

    videoContainer.className = `video-pos-${pos}`;

    let cropObj = null;
    if (cropStr) {
      const clean = cropStr.replace(/^crop=/, '');
      const parts = clean.split(':').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        cropObj = { w: parts[0], h: parts[1], x: parts[2], y: parts[3] };
      }
    }

    const srcW = demoVideo.videoWidth || 2554;
    const srcH = demoVideo.videoHeight || 1218;
    if (!cropObj) {
      cropObj = { w: srcW, h: srcH, x: 0, y: 0 };
    }

    const { w: out_w, h: out_h, x, y } = cropObj;
    const ar = out_w / out_h;

    let containerWidth = 0;
    let containerHeight = 0;
    let containerTop = 0;
    let containerLeft = 0;

    if (pos === 'center') {
      const maxAllowedWidth = 1480;
      const maxAllowedHeight = 700;
      containerWidth = maxAllowedWidth;
      containerHeight = Math.round(containerWidth / ar);
      if (containerHeight > maxAllowedHeight) {
        containerHeight = maxAllowedHeight;
        containerWidth = Math.round(containerHeight * ar);
      }
      const centerY = (180 + 950) / 2;
      containerTop = Math.round(centerY - (containerHeight / 2));
      containerLeft = Math.round((1920 - containerWidth) / 2);
    } else {
      // side-panel
      const maxAllowedWidth = 860;
      const maxAllowedHeight = 745;
      containerHeight = maxAllowedHeight;
      containerWidth = Math.round(containerHeight * ar);
      if (containerWidth > maxAllowedWidth) {
        containerWidth = maxAllowedWidth;
        containerHeight = Math.round(containerWidth * (1 / ar));
      }
      containerTop = 140 + Math.round((maxAllowedHeight - containerHeight) / 2);
      containerLeft = 1840 - containerWidth;
    }

    videoContainer.style.width = `${containerWidth}px`;
    videoContainer.style.height = `${containerHeight}px`;
    videoContainer.style.top = `${containerTop}px`;
    videoContainer.style.left = `${containerLeft}px`;

    demoVideo.style.position = 'absolute';
    demoVideo.style.maxWidth = 'none';
    demoVideo.style.maxHeight = 'none';
    demoVideo.style.objectFit = 'fill';
    demoVideo.style.width = `${Math.round((srcW / out_w) * containerWidth)}px`;
    demoVideo.style.height = `${Math.round((srcH / out_h) * containerHeight)}px`;
    demoVideo.style.left = `-${Math.round((x / out_w) * containerWidth)}px`;
    demoVideo.style.top = `-${Math.round((y / out_h) * containerHeight)}px`;

    const activeSpeed = speed || 1.0;
    if (speedBadge) {
      if (activeSpeed > 1.0) {
        speedBadge.style.display = 'inline-block';
        speedBadge.textContent = `⏩ ${activeSpeed}x FAST-FORWARD`;
      } else {
        speedBadge.style.display = 'none';
      }
    }
  }

  // Evaluate Active Timeline State Frame (Deterministic Pure Function of Second)
  function evaluateTimelineState(second) {
    let activeSlideNum = currentSlideIndex + 1;
    let activeVideoPos = 'hidden';
    let activeCropStr = '';
    let activeVideoSpeed = 1.0;
    let activeVideoSeek = 0;
    let activeVideoStart = 0;
    let activeTermPos = 'hidden';
    let activeTermSeek = 8.0;
    let activeTermSpeed = 1.5;
    let activeTermStart = 0;
    let activeFF = null;
    let activeToastText = '';
    let activeCcText = '';
    let activeCcSpeaker = '';
    let activeAudioPath = null;
    let activeAudioStart = -1;

    for (let ev of timelineEvents) {
      if (ev.type === 'slide' && ev.slide && second >= ev.start) {
        activeSlideNum = ev.slide;
      }
    }
    const bounds = getSlideBounds(activeSlideNum);

    // 1. Evaluate declarative CSS class rules
    timelineEvents.forEach(ev => {
      if (ev.type === 'class' && ev.target && ev.class) {
        const duration = ev.duration || ev.dur || 5;
        const evEnd = ev.end || (ev.start + duration);
        const belongsToCurrentSlide = ev.start >= bounds.start && ev.start < bounds.end;
        const isActive = second >= ev.start && (isPaused && belongsToCurrentSlide ? (second < bounds.end) : second < evEnd);
        const targetEl = document.querySelector(ev.target);
        if (targetEl) {
          if (isActive) {
            if (ev.action === 'remove') targetEl.classList.remove(ev.class);
            else targetEl.classList.add(ev.class);
          } else {
            if (ev.action === 'remove') targetEl.classList.add(ev.class);
            else targetEl.classList.remove(ev.class);
          }
        }
      }
    });

    // 2. Evaluate slide, video, terminal, speech, caption, and toast states
    for (let ev of timelineEvents) {
      const duration = ev.duration || ev.dur || 0;
      const evEnd = ev.end || (ev.start + duration);
      const belongsToCurrentSlide = ev.start >= bounds.start && ev.start < bounds.end;
      const isActive = second >= ev.start && (isPaused && belongsToCurrentSlide ? (second < bounds.end) : (duration || ev.end ? second < evEnd : true));

      if (ev.audio && belongsToCurrentSlide && second >= ev.start && second < evEnd) {
        if (activeAudioStart < ev.start) {
          activeAudioPath = ev.audio;
          activeAudioStart = ev.start;
        }
      }

      if (second >= ev.start) {
        if (ev.type === 'video' && (ev.pos || ev.position) && isActive) {
          activeVideoPos = ev.pos || ev.position;
          activeCropStr = ev.crop || '';
          activeVideoSpeed = ev.speed || 1.0;
          activeVideoSeek = typeof ev.seek === 'number' ? ev.seek : 0;
          activeVideoStart = ev.start;
        } else if (ev.type === 'terminal' && (ev.pos || ev.position) && isActive) {
          activeTermPos = ev.pos || ev.position;
          activeTermSeek = typeof ev.seek === 'number' ? ev.seek : 8.0;
          activeTermSpeed = ev.speed || 1.5;
          activeTermStart = ev.start;
        } else if (ev.type === 'toast' && isActive) {
          activeToastText = ev.text || ev.toast || '';
        }
      }

      if (ev.ff && isActive) {
        activeFF = ev.ff;
      }

      if (ev.cc && second >= ev.start && (isPaused && belongsToCurrentSlide ? (second < bounds.end) : (evEnd ? second < evEnd : true))) {
        if (activeAudioStart <= ev.start || activeCcText === '') {
          activeCcSpeaker = ev.speaker || 'Presenter';
          activeCcText = ev.cc;
        }
      }
    }

    syncSpeechAudio(activeAudioPath, second, activeAudioStart);

    // Apply Video Container Position Class, Focal Crop, and Seek Timestamp Sync
    updateVideoLayoutAndCrop(activeVideoPos, activeCropStr, activeVideoSpeed);

    if (demoVideo) {
      if (activeVideoPos !== 'hidden') {
        const expectedVideoTime = activeVideoSeek + Math.max(0, second - activeVideoStart) * activeVideoSpeed;
        if (demoVideo.readyState >= 1) {
          if (Math.abs(demoVideo.currentTime - expectedVideoTime) > 0.45) {
            try { demoVideo.currentTime = expectedVideoTime; } catch (e) {}
          }
        }
        if (!isPaused) {
          const targetRate = activeVideoSpeed * (isRecording ? 1.0 : playbackSpeed);
          if (Math.abs(demoVideo.playbackRate - targetRate) > 0.05) {
            demoVideo.playbackRate = targetRate;
          }
          if (demoVideo.paused) demoVideo.play().catch(() => {});
        } else {
          if (!demoVideo.paused) demoVideo.pause();
        }
      } else {
        if (!demoVideo.paused) demoVideo.pause();
      }
    }

    // Apply Native DOM Terminal Container & Render Stream
    if (terminalContainer) {
      if (activeTermPos !== 'hidden') {
        terminalContainer.className = `terminal-window terminal-pos-${activeTermPos}`;
        const termTime = activeTermSeek + Math.max(0, second - activeTermStart) * activeTermSpeed;
        terminalRenderer.render(termTime);
      } else {
        terminalContainer.className = 'terminal-window terminal-pos-hidden';
      }
    }

    if (ffPopup) {
      if (activeFF && activeTermPos !== 'hidden') {
        ffPopup.textContent = activeFF;
        ffPopup.style.display = 'flex';
      } else {
        ffPopup.style.display = 'none';
      }
    }

    // Apply Toast Status Badge State
    if (toastOverlay) {
      if (activeToastText) {
        if (toastText) toastText.textContent = activeToastText;
        toastOverlay.classList.remove('toast-hidden');
      } else {
        toastOverlay.classList.add('toast-hidden');
      }
    }

    // Apply Closed Caption State
    if (ccOverlay) {
      const showCc = ccEnabled && (!isRecording || recordConfig.showSubtitles);
      if (showCc && activeCcText) {
        if (ccSpeaker) ccSpeaker.textContent = activeCcSpeaker;
        if (ccText) ccText.textContent = activeCcText;
        ccOverlay.classList.remove('cc-hidden');
      } else {
        ccOverlay.classList.add('cc-hidden');
      }
    }

    // Update Active Slide Index
    const targetIdx = activeSlideNum - 1;
    if (targetIdx !== currentSlideIndex && targetIdx >= 0 && targetIdx < slideElements.length) {
      currentSlideIndex = targetIdx;
      updateSlideDisplay();
    }

    // Sync timer display & slide progress bar
    const mins = Math.floor(second / 60);
    const secs = Math.floor(second % 60);
    if (timerCount) {
      timerCount.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    if (slideInfoText) {
      slideInfoText.textContent = `Slide ${activeSlideNum}/${slideElements.length}`;
    }

    const slideElapsed = Math.max(0, second - bounds.start);
    if (slideProgressBar) {
      const percent = Math.min(100, Math.max(0, (slideElapsed / bounds.duration) * 100));
      slideProgressBar.style.width = `${percent}%`;
    }
  }

  function revealControlsTemporarily() {
    if (isRecording) return;
    document.body.classList.add('show-controls');
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      if (!isRecording && isPaused) {
        document.body.classList.remove('show-controls');
      }
    }, 2500);
  }

  document.addEventListener('mousemove', revealControlsTemporarily);

  function stopTimelineAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function startTimelineAnimation() {
    stopTimelineAnimation();
    lastRealTime = performance.now();
    currentExactSecond = elapsedTime;

    function animTick() {
      if (isPaused) return;
      const now = performance.now();
      const deltaSec = ((now - lastRealTime) / 1000) * (isRecording ? 1.0 : playbackSpeed);
      lastRealTime = now;
      currentExactSecond += deltaSec;
      elapsedTime = currentExactSecond;

      evaluateTimelineState(currentExactSecond);

      if (currentExactSecond < TOTAL_DURATION) {
        rafId = requestAnimationFrame(animTick);
      } else {
        isPaused = true;
        updatePlayPauseBtnUI();
        if (currentSpeechAudio && !currentSpeechAudio.paused) {
          try { currentSpeechAudio.pause(); } catch (e) {}
        }
        if (isRecording) stopRecording();
      }
    }

    rafId = requestAnimationFrame(animTick);
  }

  function updatePlayPauseBtnUI() {
    if (!playPauseBtn) return;
    const playSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Play';
    const pauseSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause';
    playPauseBtn.innerHTML = isPaused ? playSvg : pauseSvg;
  }

  function togglePlayPause() {
    isPaused = !isPaused;
    updatePlayPauseBtnUI();

    if (isPaused) {
      stopTimelineAnimation();
      document.body.classList.remove('playing-active');
      if (demoVideo && !demoVideo.paused) {
        try { demoVideo.pause(); } catch (e) {}
      }
      if (currentSpeechAudio && !currentSpeechAudio.paused) {
        try { currentSpeechAudio.pause(); } catch (e) {}
      }
      evaluateTimelineState(currentExactSecond);
    } else {
      document.body.classList.add('playing-active');
      startTimelineAnimation();
      evaluateTimelineState(currentExactSecond);
    }
  }

  // Screen Recording Engine (1080p / 720p, Countdown Splash, Non-Flashing Title)
  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  function saveRecordedVideo() {
    if (!recordedChunks.length) return;
    const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'video/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dwpe_presentation_${recordConfig.resolution}.${ext}`;
    a.click();
  }

  async function startRecording() {
    try {
      closeRecordConfigPopover();

      const dims = getTargetResolutionDimensions(recordConfig.resolution);
      const targetW = dims.width;
      const targetH = dims.height;

      recordedChunks = [];
      playbackSpeed = 1.0;
      if (speedSlider) speedSlider.value = 2;
      if (speedVal) speedVal.textContent = '1x';

      document.body.classList.remove('show-controls');
      document.body.classList.add('recording-active');

      if (!recordConfig.showSubtitles) {
        document.body.classList.add('rec-hide-subtitles');
      } else {
        document.body.classList.remove('rec-hide-subtitles');
      }

      if (!recordConfig.showProgress) {
        document.body.classList.add('rec-hide-progress');
      } else {
        document.body.classList.remove('rec-hide-progress');
      }

      if (recordConfig.autoResize) {
        resizeWindowForRecording(targetW, targetH);
        scaleStage();
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: targetW, max: targetW },
          height: { ideal: targetH, max: targetH },
          frameRate: { ideal: 60, max: 60 },
          displaySurface: 'browser'
        },
        audio: false,
        preferCurrentTab: true
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          if (isRecording) stopRecording();
        });
      }

      if (recordConfig.autoResize) {
        await new Promise(r => setTimeout(r, 250));
        compensateBannerResize(targetW, targetH);
      } else {
        scaleStage();
      }

      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mimeType = 'video/webm;codecs=vp8';
        else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
      }

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 25000000
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = saveRecordedVideo;

      // 3-2-1 Countdown Splash
      if (countdownSplash && countdownNumber) {
        countdownSplash.classList.add('active');
        for (let count = 3; count > 0; count--) {
          countdownNumber.textContent = count;
          if (count === 2 && recordConfig.autoResize) {
            compensateBannerResize(targetW, targetH);
          }
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        countdownSplash.classList.remove('active');
        await new Promise(resolve => setTimeout(resolve, 450));
      }

      mediaRecorder.start(1000);
      isRecording = true;
      isPaused = false;
      originalDocumentTitle = document.title;
      document.title = '🔴 Recording — Press Esc to stop';

      if (recordBtn) {
        recordBtn.innerHTML = '⏹ Stop Rec';
        recordBtn.classList.add('recording');
        recordBtn.title = 'Recording — Press Esc to stop';
      }
      updatePlayPauseBtnUI();

      seekToSecond(0);
      startTimelineAnimation();
    } catch (err) {
      document.title = originalDocumentTitle;
      document.body.classList.remove('recording-active', 'rec-hide-subtitles', 'rec-hide-progress');
      if (recordBtn) {
        recordBtn.innerHTML = '🔴 Record';
        recordBtn.classList.remove('recording');
        recordBtn.title = 'Record Screen (R)';
      }
      console.warn('Screen recording cancelled or not supported:', err);
    }
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    isPaused = true;
    document.title = originalDocumentTitle;
    stopTimelineAnimation();
    updatePlayPauseBtnUI();

    if (recordBtn) {
      recordBtn.innerHTML = '🔴 Record';
      recordBtn.classList.remove('recording');
      recordBtn.title = 'Record Screen (R)';
    }

    document.body.classList.remove('recording-active', 'rec-hide-subtitles', 'rec-hide-progress');
    playbackSpeed = 1.0;
    if (speedSlider) speedSlider.value = 2;
    if (speedVal) speedVal.textContent = '1x';

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    setTimeout(scaleStage, 300);
  }

  // Setup Navigation Controls & Keyboard Shortcuts
  function setupEventListeners() {
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
    if (nextSlideBtn) nextSlideBtn.addEventListener('click', goToNextTransition);
    if (prevSlideBtn) prevSlideBtn.addEventListener('click', goToPrevTransition);

    if (ccToggleBtn) {
      ccToggleBtn.addEventListener('click', () => {
        ccEnabled = !ccEnabled;
        ccToggleBtn.classList.toggle('active', ccEnabled);
        evaluateTimelineState(currentExactSecond);
      });
    }

    if (audioMuteBtn) {
      audioMuteBtn.addEventListener('click', () => {
        isAudioMuted = !isAudioMuted;
        audioMuteBtn.classList.toggle('active', !isAudioMuted);
        audioMuteBtn.innerHTML = isAudioMuted ? '🔇 Unmute' : '🔊 Mute';
        evaluateTimelineState(currentExactSecond);
      });
    }

    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        const stepIdx = parseInt(e.target.value, 10);
        playbackSpeed = SPEED_STEPS[stepIdx] || 1.0;
        if (speedVal) speedVal.textContent = `${playbackSpeed}x`;
        if (demoVideo) demoVideo.playbackRate = playbackSpeed;
        if (currentSpeechAudio) currentSpeechAudio.playbackRate = playbackSpeed;
      });
    }

    if (recordBtn) {
      recordBtn.addEventListener('click', toggleRecording);
    }

    if (recordConfigBtn && recordConfigPopover) {
      recordConfigBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = recordConfigPopover.classList.toggle('active');
        recordConfigBtn.classList.toggle('active', isOpen);
      });
    }

    if (recordConfigClose) {
      recordConfigClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeRecordConfigPopover();
      });
    }

    if (recordConfigPopover) {
      recordConfigPopover.addEventListener('click', (e) => e.stopPropagation());
    }

    document.addEventListener('click', () => closeRecordConfigPopover());

    document.querySelectorAll('input[name="rec-res"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          recordConfig.resolution = e.target.value;
          saveRecordConfig();
          if (recPopoutBtn) recPopoutBtn.textContent = `🗗 Open in Popout (${recordConfig.resolution})`;
          if (isPopout && recordConfig.autoResize) {
            const d = getTargetResolutionDimensions(recordConfig.resolution);
            resizeWindowForRecording(d.width, d.height);
          }
        }
      });
    });

    if (recOptSubtitles) {
      recOptSubtitles.addEventListener('change', (e) => {
        recordConfig.showSubtitles = e.target.checked;
        saveRecordConfig();
      });
    }

    if (recOptProgress) {
      recOptProgress.addEventListener('change', (e) => {
        recordConfig.showProgress = e.target.checked;
        saveRecordConfig();
      });
    }

    if (recOptAutoresize) {
      recOptAutoresize.addEventListener('change', (e) => {
        recordConfig.autoResize = e.target.checked;
        saveRecordConfig();
      });
    }

    if (recPopoutBtn) {
      recPopoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInPopoutWindow();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        toggleRecording();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        if (ccToggleBtn) ccToggleBtn.click();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        if (audioMuteBtn) audioMuteBtn.click();
        return;
      }
      if (e.key === 'Escape' || e.key === 's' || e.key === 'S') {
        if (isRecording) {
          e.preventDefault();
          stopRecording();
          return;
        }
        closeRecordConfigPopover();
      }
      revealControlsTemporarily();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        goToNextTransition();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        goToPrevTransition();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
    });
  }

  // Boot Engine on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEngine);
  } else {
    initEngine();
  }
})();

/**
 * Declarative Web Presentation Engine (DWPE)
 * Canonical Zero-JS Runtime Engine
 */

(function () {
  'use strict';

  let timelineEvents = [];
  let currentSlideIndex = 0;
  let currentExactSecond = 0;
  let elapsedTime = 0;
  let isPaused = true;
  let playbackSpeed = 1.0;
  let isAudioMuted = false;
  let ccEnabled = true;
  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let rafId = null;
  let lastRealTime = 0;
  let TOTAL_DURATION = 300;
  let currentSpeechAudio = null;
  let currentSpeechPath = null;

  const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  const speechAudioCache = new Map();

  // DOM Elements
  const slidesContainer = document.querySelector('slides');
  const slideElements = Array.from(document.querySelectorAll('slides > slide'));
  const videoContainer = document.getElementById('video-container');
  const demoVideo = document.getElementById('demo-video');
  const ccOverlay = document.getElementById('cc-overlay');
  const ccSpeaker = document.getElementById('cc-speaker');
  const ccText = document.getElementById('cc-text');
  const toastOverlay = document.getElementById('toast-overlay');
  const toastText = document.getElementById('toast-text');
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
  const slideDotsContainer = document.getElementById('slide-dots');

  // Initialize Presentation Engine
  async function initEngine() {
    try {
      const res = await fetch('timeline.yaml');
      const text = await res.text();
      timelineEvents = parseYamlTimeline(text);
      console.log('✅ DWPE Engine: Loaded timeline.yaml events:', timelineEvents.length);
    } catch (err) {
      console.warn('⚠️ DWPE Engine: Could not load timeline.yaml, running manual slide mode:', err);
    }

    // Determine max duration from events
    if (timelineEvents.length > 0) {
      const maxEnd = Math.max(...timelineEvents.map(e => e.end || (e.start + (e.duration || e.dur || 0))));
      if (maxEnd > 0) TOTAL_DURATION = Math.ceil(maxEnd + 2);
    }

    generateSlideDots();
    setupEventListeners();
    await preloadAllSpeechAudioInMemory();
    updateSlideDisplay();
    evaluateTimelineState(0);
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
          if (['slide', 'duration', 'dur', 'seek', 'speed'].includes(key)) {
            val = parseFloat(val);
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

  // Preload Speech MP3 Chunks into Blob URLs for Instant Low-Latency Playback
  async function preloadAllSpeechAudioInMemory() {
    const audioEvents = timelineEvents.filter(ev => ev.audio);
    if (!audioEvents.length) return;
    console.log(`Preloading ${audioEvents.length} speech audio chunks into memory blob URLs...`);
    const promises = audioEvents.map(async (ev) => {
      try {
        const res = await fetch(ev.audio);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audio.preload = 'auto';
        speechAudioCache.set(ev.audio, audio);
      } catch (err) {
        console.warn('Speech audio preload fallback:', ev.audio, err);
        const audio = new Audio(ev.audio);
        audio.preload = 'auto';
        speechAudioCache.set(ev.audio, audio);
      }
    });
    await Promise.allSettled(promises);
    console.log(`Preloaded ${speechAudioCache.size} speech audio chunks into memory.`);
  }

  // Generate Navigation Dots
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

  // Update Slide Display
  function updateSlideDisplay() {
    slideElements.forEach((s, idx) => {
      if (idx === currentSlideIndex) {
        s.classList.add('active');
      } else {
        s.classList.remove('active');
      }
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
      if (ev.start !== undefined) timestamps.add(ev.start);
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

    if (demoVideo && demoVideo.readyState >= 2) {
      try {
        if (elapsedTime > 0) {
          demoVideo.currentTime = elapsedTime;
        } else {
          demoVideo.pause();
          demoVideo.currentTime = 0;
        }
      } catch (e) {}
    }
  }

  function goToNextTransition() {
    const transitions = getTransitionTimestamps();
    const next = transitions.find(t => t > elapsedTime);
    if (next !== undefined) seekToSecond(next);
    else seekToSecond(TOTAL_DURATION);
  }

  function goToPrevTransition() {
    const transitions = getTransitionTimestamps();
    const prevList = transitions.filter(t => t < elapsedTime - 1.5);
    if (prevList.length > 0) seekToSecond(prevList[prevList.length - 1]);
    else seekToSecond(0);
  }

  // Speech Audio Playback Sync
  function syncSpeechAudio(activeAudioPath, second, activeAudioStart) {
    if (isPaused || isAudioMuted || !activeAudioPath) {
      if (currentSpeechAudio && !currentSpeechAudio.paused) {
        currentSpeechAudio.pause();
      }
      return;
    }

    if (currentSpeechPath !== activeAudioPath) {
      if (currentSpeechAudio) currentSpeechAudio.pause();
      currentSpeechPath = activeAudioPath;
      currentSpeechAudio = speechAudioCache.get(activeAudioPath) || new Audio(activeAudioPath);
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = playbackSpeed;
      const offset = Math.max(0, second - activeAudioStart);
      try { currentSpeechAudio.currentTime = offset; } catch (e) {}
      currentSpeechAudio.play().catch(e => console.warn('Speech audio auto-play block:', e));
    } else if (currentSpeechAudio) {
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = playbackSpeed;
      if (currentSpeechAudio.paused && !isPaused && !isAudioMuted && !currentSpeechAudio.ended) {
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

  // Evaluate Active Timeline State Frame
  function evaluateTimelineState(second) {
    let activeSlideNum = currentSlideIndex + 1;
    let activeVideoPos = 'hidden';
    let activeToastText = '';
    let activeCcText = '';
    let activeCcSpeaker = '';
    let activeAudioPath = null;
    let activeAudioStart = -1;

    for (let ev of timelineEvents) {
      const duration = ev.duration || ev.dur || 0;
      const evEnd = ev.end || (ev.start + duration);
      const isActive = second >= ev.start && (duration || ev.end ? second < evEnd : true);

      if (ev.audio && second >= ev.start && (evEnd ? second < evEnd : true)) {
        activeAudioPath = ev.audio;
        activeAudioStart = ev.start;
      }

      if (second >= ev.start) {
        if (ev.type === 'slide' && ev.slide && isActive) {
          activeSlideNum = ev.slide;
        } else if (ev.type === 'video' && (ev.pos || ev.position) && isActive) {
          activeVideoPos = ev.pos || ev.position;
        } else if (ev.type === 'toast' && isActive) {
          activeToastText = ev.text || ev.toast || '';
        } else if (ev.type === 'class' && ev.target && ev.class && isActive) {
          const targetEl = document.querySelector(ev.target);
          if (targetEl) {
            if (ev.action === 'remove') targetEl.classList.remove(ev.class);
            else if (ev.action === 'toggle') targetEl.classList.toggle(ev.class);
            else targetEl.classList.add(ev.class);
          }
        }
      }

      // Closed Caption Subtitles
      if (ev.cc && isActive) {
        activeCcSpeaker = ev.speaker || 'Presenter';
        activeCcText = ev.cc;
      }
    }

    // Sync speech audio playback
    syncSpeechAudio(activeAudioPath, second, activeAudioStart);

    // Apply Video Container Position Class
    if (videoContainer) {
      videoContainer.className = `video-pos-${activeVideoPos}`;
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
      if (ccEnabled && activeCcText) {
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

    const bounds = getSlideBounds(activeSlideNum);
    const slideElapsed = Math.max(0, second - bounds.start);
    if (slideProgressBar) {
      const percent = Math.min(100, Math.max(0, (slideElapsed / bounds.duration) * 100));
      slideProgressBar.style.width = `${percent}%`;
    }
  }

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
      if (demoVideo && !demoVideo.paused) {
        try { demoVideo.pause(); } catch (e) {}
      }
      if (currentSpeechAudio && !currentSpeechAudio.paused) {
        try { currentSpeechAudio.currentTime = 0; currentSpeechAudio.pause(); } catch (e) {}
      }
    } else {
      startTimelineAnimation();
      if (demoVideo && demoVideo.readyState >= 2) {
        try {
          demoVideo.playbackRate = isRecording ? 1.0 : playbackSpeed;
          demoVideo.play().catch(() => {});
        } catch (e) {}
      }
    }
  }

  // Screen Recording Capability
  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'presentation_recording.webm';
        a.click();
        isRecording = false;
        if (recordBtn) recordBtn.textContent = '🔴 Record';
      };
      mediaRecorder.start();
      isRecording = true;
      if (recordBtn) recordBtn.textContent = '⏹ Stop Rec';
    } catch (err) {
      console.warn('Screen recording cancelled or not supported:', err);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
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
        if (currentSpeechAudio) {
          currentSpeechAudio.muted = isAudioMuted;
          if (isAudioMuted) currentSpeechAudio.pause();
          else if (!isPaused) currentSpeechAudio.play().catch(() => {});
        }
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

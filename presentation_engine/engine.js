/**
 * Declarative Web Presentation Engine (DWPE)
 * Immutable Runtime Script
 */

(function () {
  'use strict';

  let timelineEvents = [];
  let currentSlideIndex = 0;
  let currentExactSecond = 0;
  let elapsedTime = 0;
  let isPlaying = false;
  let currentSpeedMultiplier = 1.0;
  let currentSpeechAudio = null;
  let currentSpeechPath = null;

  const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

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
  const btnPlay = document.getElementById('btn-play');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const speedSlider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');

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

    setupEventListeners();
    updateSlideDisplay();
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
      events.push(ev);
    }
    return events.sort((a, b) => a.start - b.start);
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
  }

  // Evaluate Active Timeline State Frame
  function evaluateTimelineState(second) {
    if (!timelineEvents.length) return;

    let activeSlideNum = currentSlideIndex + 1;
    let activeVideoPos = 'hidden';
    let activeToastText = '';
    let activeCcText = '';
    let activeCcSpeaker = '';

    for (let ev of timelineEvents) {
      const duration = ev.duration || ev.dur || 0;
      const evEnd = ev.end || (ev.start + duration);
      const isActive = second >= ev.start && (duration ? second < evEnd : true);

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
      if (activeCcText) {
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
  }

  // Setup Navigation Controls & Keyboard Shortcuts
  function setupEventListeners() {
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        isPlaying = !isPlaying;
        btnPlay.textContent = isPlaying ? 'Pause' : 'Play';
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (currentSlideIndex < slideElements.length - 1) {
          currentSlideIndex++;
          updateSlideDisplay();
        }
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (currentSlideIndex > 0) {
          currentSlideIndex--;
          updateSlideDisplay();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Space') {
        if (currentSlideIndex < slideElements.length - 1) {
          currentSlideIndex++;
          updateSlideDisplay();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentSlideIndex > 0) {
          currentSlideIndex--;
          updateSlideDisplay();
        }
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

// Antigravity 1080p Event-Driven Master Timeline Engine

document.addEventListener('DOMContentLoaded', async () => {
  const stage = document.getElementById('stage');
  const slides = document.querySelectorAll('.slide');
  const dotsContainer = document.getElementById('slide-dots');
  const timerDisplay = document.getElementById('timer-display');
  const timerCount = document.getElementById('timer-count');
  const slideInfoText = document.getElementById('slide-info-text');
  const slideTimerCount = document.getElementById('slide-timer-count');
  const slideProgressBar = document.getElementById('slide-progress-bar');
  const videoContainer = document.getElementById('demo-video-container');
  const video = document.getElementById('demo-video');
  const videoCallout = document.getElementById('video-callout');
  const videoRealtimeCounter = document.getElementById('video-realtime-counter');
  const countdownSplash = document.getElementById('countdown-splash');
  const countdownNumber = document.getElementById('countdown-number');

  // Control Bar Elements
  const prevSlideBtn = document.getElementById('prev-slide-btn');
  const nextSlideBtn = document.getElementById('next-slide-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');

  const ccToggleBtn = document.getElementById('cc-toggle-btn');
  const speedSlider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');
  const recordBtn = document.getElementById('record-btn');
  const ccOverlay = document.getElementById('cc-overlay');
  const ccText = document.getElementById('cc-text');

  let currentSlideIndex = 0;
  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let timelineTimer = null;
  let rafId = null;
  let lastRealTime = 0;
  let currentExactSecond = 0;
  let elapsedTime = 0;
  let isPaused = true;
  let ccEnabled = true;
  let isAudioMuted = false;
  let playbackSpeed = 1.0;
  let currentSpeechAudio = null;
  let currentSpeechPath = null;
  let timelineEvents = [];
  let TOTAL_DURATION = 300;

  // Preload Entire Video Asset into Memory (Blob URL)
  async function preloadVideoInMemory() {
    if (!video) return;
    const src = video.getAttribute('src') || 'assets/live_demo.mp4';
    try {
      console.log('Preloading video asset into memory blob:', src);
      const res = await fetch(src);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      video.src = blobUrl;
      video.preload = 'auto';
      video.load();
      console.log('Video memory preload complete.');
    } catch (e) {
      console.warn('Memory video preload failed, using fallback direct video stream:', e);
      video.preload = 'auto';
      video.load();
    }
  }
  preloadVideoInMemory();

  // Load & Parse Event-Driven Schedule YAML (script.yaml)
  try {
    const res = await fetch('script.yaml');
    const yamlText = await res.text();
    const parsedYaml = jsyaml.load(yamlText);
    
    TOTAL_DURATION = parsedYaml.totalDuration || 300;
    timelineEvents = (parsedYaml.timeline || []).map(ev => {
      const dur = ev.duration || ev.dur || 0;
      const end = ev.end || (ev.start + dur);
      const isPosHidden = (ev.position || ev.pos || 'hidden') === 'hidden';
      const defaultPlaying = ev.playing !== undefined ? Boolean(ev.playing) : !isPosHidden;
      return {
        ...ev,
        duration: dur,
        end: end,
        pos: ev.position || ev.pos || 'hidden',
        seek: typeof ev.seek === 'number' ? ev.seek : (typeof ev.vtime === 'number' ? ev.vtime : null),
        speed: typeof ev.speed === 'number' ? ev.speed : 1.0,
        playing: defaultPlaying
      };
    });
    // Sort timeline events strictly by start second
    timelineEvents.sort((a, b) => a.start - b.start);

    // Preload All Speech Audio Chunks into Memory Blob URLs for Instant Zero-Lag Playback
    preloadAllSpeechAudioInMemory();
  } catch (e) {
    console.warn('Failed to load script.yaml, using fallback timeline', e);
  }

  const speechAudioCache = new Map();

  async function preloadAllSpeechAudioInMemory() {
    const audioEvents = timelineEvents.filter(ev => ev.audio);
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

  // Initialize Responsive 1080p Canvas Scaling
  function scaleStage() {
    const scaleX = window.innerWidth / 1920;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY);
    stage.style.transform = `scale(${scale})`;
  }

  window.addEventListener('resize', scaleStage);
  scaleStage();

  // Generate Navigation Dots
  slides.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `dot ${idx === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToSlide(idx));
    dotsContainer.appendChild(dot);
  });

  const dots = document.querySelectorAll('.dot');

  // Sync Video Real Time Counter Overlay
  function updateVideoRealtimeCounter() {
    if (!video || !videoRealtimeCounter) return;
    const vSecs = Math.floor(video.currentTime || 0);
    const vMins = Math.floor(vSecs / 60);
    const rSecs = vSecs % 60;
    videoRealtimeCounter.textContent = `REAL TIME ${vMins < 10 ? '0' : ''}${vMins}:${rSecs < 10 ? '0' : ''}${rSecs} / 07:11`;
  }

  if (video) {
    video.addEventListener('timeupdate', updateVideoRealtimeCounter);
  }

  // Find slide start and end time boundaries for progress bar calculation
  function getSlideBounds(slideNum) {
    const slideEvents = timelineEvents.filter(e => e.type === 'slide');
    const currEv = slideEvents.find(e => e.slide === slideNum);
    if (!currEv) return { start: 0, duration: 30 };
    const nextEvIndex = slideEvents.findIndex(e => e.slide === slideNum) + 1;
    const nextEv = slideEvents[nextEvIndex];
    const endTime = nextEv ? nextEv.start : TOTAL_DURATION;
    return {
      start: currEv.start,
      duration: Math.max(1, endTime - currEv.start)
    };
  }

  // Switch to slide index (0-based) and reset time to start of slide
  function goToSlide(index) {
    if (index < 0 || index >= slides.length) return;

    slides[currentSlideIndex].classList.remove('active');
    dots[currentSlideIndex].classList.remove('active');

    currentSlideIndex = index;
    const targetSlideNum = currentSlideIndex + 1;
    const bounds = getSlideBounds(targetSlideNum);
    elapsedTime = bounds.start;

    slides[currentSlideIndex].classList.add('active');
    dots[currentSlideIndex].classList.add('active');

    if (window.location.hash !== `#slide${targetSlideNum}`) {
      history.replaceState(null, '', `#slide${targetSlideNum}`);
    }

    // Reset master timer count display
    const mins = Math.floor(elapsedTime / 60);
    const secs = elapsedTime % 60;
    if (timerCount) {
      timerCount.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Reset video position to slide start timestamp
    if (video) {
      if (elapsedTime >= 30) {
        video.currentTime = getVideoTimeForSecond(elapsedTime);
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }

    // Trigger state evaluation for new timestamp immediately
    currentExactSecond = elapsedTime;
    lastRealTime = performance.now();
    evaluateTimelineState(currentExactSecond);
  }

  // Calculate exact expected raw video timestamp (in seconds) for any presentation second
  function getVideoTimeForSecond(targetSecond) {
    const videoEvents = timelineEvents.filter(ev => ev.type === 'video').sort((a, b) => a.start - b.start);
    const activeEv = videoEvents.find(ev => targetSecond >= ev.start && targetSecond < ev.end)
      || videoEvents.filter(ev => targetSecond >= ev.start).pop()
      || videoEvents[0];

    if (!activeEv) return 0;

    const speed = activeEv.speed || 1.0;
    const segOffset = Math.max(0, targetSecond - activeEv.start);

    if (typeof activeEv.seek === 'number') {
      return activeEv.seek + segOffset * speed;
    }

    let rawVideoTime = 0;
    for (let ev of videoEvents) {
      if (ev.start >= targetSecond) break;
      const segStart = ev.start;
      const segEnd = Math.min(targetSecond, ev.end);
      if (segEnd > segStart) {
        rawVideoTime += (segEnd - segStart) * (ev.speed || 1.0);
      }
    }
    return rawVideoTime;
  }

  // Get all unique timeline transition start and end timestamps (including caption on/off)
  function getTransitionTimestamps() {
    const timestamps = new Set();
    timestamps.add(0);
    timelineEvents.forEach(ev => {
      if (typeof ev.start === 'number') {
        if (ev.type === 'slide' || ev.type === 'video' || ev.type === 'toast' || ev.type === 'show' || ev.type === 'hide') {
          timestamps.add(ev.start);
        } else if (ev.type === 'cc' || ev.type === 'caption' || ev.type === 'closed-caption' || ev.type === 'subtitle') {
          timestamps.add(ev.start);
          const evEnd = ev.end || (ev.start + (ev.duration || ev.dur || 0));
          if (evEnd > ev.start) {
            timestamps.add(evEnd);
          }
        }
      }
    });
    return Array.from(timestamps).sort((a, b) => a - b);
  }

  // Seek presentation state directly to target second timestamp
  function seekToSecond(second) {
    // Abort and reset any active speech audio on manual transition switch
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

    const mins = Math.floor(elapsedTime / 60);
    const secs = elapsedTime % 60;
    if (timerCount) {
      timerCount.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    if (video) {
      if (elapsedTime >= 30) {
        video.currentTime = getVideoTimeForSecond(elapsedTime);
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }
  }

  function goToNextTransition() {
    const transitions = getTransitionTimestamps();
    const next = transitions.find(t => t > elapsedTime);
    if (next !== undefined) {
      seekToSecond(next);
    } else {
      seekToSecond(TOTAL_DURATION);
    }
  }

  function goToPrevTransition() {
    const transitions = getTransitionTimestamps();
    const prevList = transitions.filter(t => t < elapsedTime - 1.5);
    if (prevList.length > 0) {
      seekToSecond(prevList[prevList.length - 1]);
    } else {
      seekToSecond(0);
    }
  }

  // Calculate and apply pixel-exact crop offsets and container dimensions for focal areas
  function updateVideoLayoutAndCrop(pos, cropStr, speed) {
    if (!videoContainer || !video) return;

    const speedBadge = document.getElementById('video-speed-badge');

    const slidesContainer = document.getElementById('slides-container');

    if (pos === 'hidden') {
      if (slidesContainer) slidesContainer.classList.remove('video-centered-backdrop');
      videoContainer.className = 'video-pos-hidden';
      videoContainer.style.opacity = '0';
      videoContainer.style.pointerEvents = 'none';
      document.body.classList.remove('has-side-panel');
      if (speedBadge) speedBadge.style.display = 'none';
      return;
    }

    document.body.classList.toggle('has-side-panel', pos === 'side-panel' || pos === 'pip-corner' || pos === 'split-right');
    videoContainer.className = `video-pos-${pos}`;
    videoContainer.style.opacity = '1';
    videoContainer.style.pointerEvents = 'auto';

    // Parse crop: "crop=W:H:X:Y"
    let cropObj = null;
    if (cropStr) {
      const clean = cropStr.replace(/^crop=/, '');
      const parts = clean.split(':').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        cropObj = { w: parts[0], h: parts[1], x: parts[2], y: parts[3] };
      }
    }

    if (!cropObj) {
      cropObj = { w: 2554, h: 1218, x: 0, y: 0 };
    }

    const { w: out_w, h: out_h, x, y } = cropObj;
    const ar = out_w / out_h;

    let containerWidth = 0;
    let containerHeight = 0;
    let containerTop = 0;
    let containerLeft = 0;

    const TOP_BOUND = 140;
    const MAX_ALLOWED_HEIGHT = 745;
    
    if (pos === 'center') {
      if (slidesContainer) slidesContainer.classList.add('video-centered-backdrop');
      const maxAllowedWidth = 1560;
      const maxAllowedHeight = 680;

      containerWidth = maxAllowedWidth;
      containerHeight = Math.round(containerWidth / ar);

      if (containerHeight > maxAllowedHeight) {
        containerHeight = maxAllowedHeight;
        containerWidth = Math.round(containerHeight * ar);
      }

      // Equidistant vertical centering between slide header line (y=140) & footer controls bar (y=960)
      const AVAILABLE_TOP = 140;
      const AVAILABLE_BOTTOM = 960;
      const centerY = (AVAILABLE_TOP + AVAILABLE_BOTTOM) / 2; // 550px

      containerTop = Math.round(centerY - (containerHeight / 2));
      containerLeft = Math.round((1920 - containerWidth) / 2);
    } else {
      if (slidesContainer) slidesContainer.classList.remove('video-centered-backdrop');
      // Expanded Side-Panel (pip-corner & split-right): Occupies right-hand side strictly between title & subtitle lines
      const maxAllowedWidth = 860;

      containerHeight = MAX_ALLOWED_HEIGHT;
      containerWidth = Math.round(containerHeight * ar);

      if (containerWidth > maxAllowedWidth) {
        containerWidth = maxAllowedWidth;
        containerHeight = Math.round(containerWidth / ar);
      }

      containerTop = TOP_BOUND + Math.round((MAX_ALLOWED_HEIGHT - containerHeight) / 2);
      containerLeft = 1840 - containerWidth;
    }

    videoContainer.style.width = `${containerWidth}px`;
    videoContainer.style.height = `${containerHeight}px`;
    videoContainer.style.top = `${containerTop}px`;
    videoContainer.style.left = `${containerLeft}px`;

    // Apply pixel-exact crop placement to inner <video> element
    video.style.position = 'absolute';
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.objectFit = 'fill';
    video.style.width = `${Math.round((2554 / out_w) * containerWidth)}px`;
    video.style.height = `${Math.round((1218 / out_h) * containerHeight)}px`;
    video.style.left = `-${Math.round((x / out_w) * containerWidth)}px`;
    video.style.top = `-${Math.round((y / out_h) * containerHeight)}px`;

    // Update video playback speed
    const activeSpeed = speed || 1.0;
    const targetPlaybackRate = activeSpeed * (isRecording ? 1.0 : playbackSpeed);
    if (Math.abs(video.playbackRate - targetPlaybackRate) > 0.05) {
      video.playbackRate = targetPlaybackRate;
    }

    // Update speed badge indicator (Display speed rounded to nearest 0.5 for clean presentation UI)
    if (speedBadge) {
      if (activeSpeed > 1.0) {
        speedBadge.style.display = 'inline-block';
        const displaySpeed = (Math.round(activeSpeed * 2) / 2).toFixed(1).replace(/\.0$/, '');
        const label = containerWidth < 420 ? `⏩ ${displaySpeed}x` : `⏩ ${displaySpeed}x FAST-FORWARD`;
        speedBadge.textContent = label;
      } else {
        speedBadge.style.display = 'none';
      }
    }
  }


  // Evaluate state of all event channels (slide, video, toast, cc, element) at current second
  // Sync / Play Speech Chunk Audio Event (Let previous clip finish out fully; drop next clip if previous is still speaking)
  function syncSpeechAudio(activeAudioPath, second, activeAudioStart) {
    if (isPaused || isAudioMuted || !activeAudioPath) {
      return;
    }

    if (currentSpeechPath !== activeAudioPath) {
      // If previous clip is still speaking (not ended & not paused), let it finish out and drop the new clip
      if (currentSpeechAudio && !currentSpeechAudio.ended && !currentSpeechAudio.paused && currentSpeechAudio.currentTime > 0) {
        return;
      }
      currentSpeechPath = activeAudioPath;
      currentSpeechAudio = speechAudioCache.get(activeAudioPath) || new Audio(activeAudioPath);
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = playbackSpeed;
      const offset = Math.max(0, second - activeAudioStart);
      try {
        currentSpeechAudio.currentTime = offset;
      } catch (e) {}
      currentSpeechAudio.play().catch(e => console.warn('Speech audio auto-play block:', e));
    } else if (currentSpeechAudio) {
      currentSpeechAudio.muted = isAudioMuted;
      currentSpeechAudio.playbackRate = playbackSpeed;
      if (currentSpeechAudio.paused && !isPaused && !isAudioMuted && !currentSpeechAudio.ended) {
        currentSpeechAudio.play().catch(() => {});
      }
    }
  }

  function evaluateTimelineState(second) {
    let activeSlideNum = currentSlideIndex + 1;
    let activeVideoPos = 'hidden';
    let activeCropStr = '';
    let activeVideoSpeed = 1.0;
    let activeVideoPlaying = false;
    let activeToast = '';
    let activeCc = '';
    let ccOpacity = 0.0;
    let activeAudioPath = null;
    let activeAudioStart = -1;
    let lastTransitionSecond = -1;

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
          lastTransitionSecond = Math.max(lastTransitionSecond, ev.start);
        } else if (ev.type === 'video' && (ev.pos || ev.position) && isActive) {
          activeVideoPos = ev.pos || ev.position;
          activeCropStr = ev.crop || '';
          activeVideoSpeed = ev.speed || 1.0;
          activeVideoPlaying = ev.playing !== undefined ? Boolean(ev.playing) : (activeVideoPos !== 'hidden');
          lastTransitionSecond = Math.max(lastTransitionSecond, ev.start);
        } else if (ev.type === 'show' && ev.selector && isActive) {
          const el = document.querySelector(ev.selector);
          if (el) el.style.display = 'block';
          lastTransitionSecond = Math.max(lastTransitionSecond, ev.start);
        } else if (ev.type === 'hide' && ev.selector && isActive) {
          const el = document.querySelector(ev.selector);
          if (el) el.style.display = 'none';
        }
      }

      if (ev.type === 'toast' && isActive) {
        activeToast = ev.text || '';
        lastTransitionSecond = Math.max(lastTransitionSecond, ev.start);
      }

      if ((ev.type === 'cc' || ev.type === 'caption' || ev.type === 'closed-caption' || ev.type === 'subtitle' || ev.cc)) {
        if (second >= ev.start && second < evEnd) {
          activeCc = ev.cc || ev.text || '';
          const fadeDur = Math.min(0.5, (evEnd - ev.start) / 2);
          const tRel = second - ev.start;
          const tRem = evEnd - second;
          if (fadeDur > 0 && tRel < fadeDur) {
            ccOpacity = tRel / fadeDur;
          } else if (fadeDur > 0 && tRem < fadeDur) {
            ccOpacity = tRem / fadeDur;
          } else {
            ccOpacity = 1.0;
          }
        }
      }
    }

    syncSpeechAudio(activeAudioPath, second, activeAudioStart);

    // Apply slide switch if slide changed
    const targetSlideIdx = activeSlideNum - 1;
    let slideChanged = false;
    if (targetSlideIdx !== currentSlideIndex && targetSlideIdx >= 0 && targetSlideIdx < slides.length) {
      slides[currentSlideIndex].classList.remove('active');
      dots[currentSlideIndex].classList.remove('active');
      currentSlideIndex = targetSlideIdx;
      slides[currentSlideIndex].classList.add('active');
      dots[currentSlideIndex].classList.add('active');
      slideChanged = true;
      if (window.location.hash !== `#slide${activeSlideNum}`) {
        history.replaceState(null, '', `#slide${activeSlideNum}`);
      }
    }

    // Apply video position, expanded side-panel sizing, pixel-exact crop offsets, and speed ramping
    updateVideoLayoutAndCrop(activeVideoPos, activeCropStr, activeVideoSpeed);
    
    // Enforce video timestamp synchronization and play/pause state
    if (video) {
      if (activeVideoPos === 'hidden' || !activeVideoPlaying) {
        if (!video.paused) video.pause();
      } else {
        const expectedVideoTime = getVideoTimeForSecond(second);
        const activeVideoEv = timelineEvents.find(ev => ev.type === 'video' && second >= ev.start && second < ev.end);
        const isEventStart = activeVideoEv && second === activeVideoEv.start;
        const drift = Math.abs(video.currentTime - expectedVideoTime);

        if (slideChanged || isEventStart || drift > 0.5) {
          video.currentTime = expectedVideoTime;
        }

        if (!isPaused && video.paused) {
          video.play().catch(() => {});
        }
      }
    }

    // Apply toast callout (hidden when duration expires)
    if (videoCallout) {
      videoCallout.textContent = activeToast;
      videoCallout.style.display = activeToast ? 'block' : 'none';
    }

    // Apply CC subtitle with 500ms fade-in and 500ms fade-out during event duration
    if (ccOverlay && ccText) {
      if (ccEnabled && activeCc && ccOpacity > 0.001) {
        if (ccText.textContent !== activeCc) {
          ccText.textContent = activeCc;
        }
        ccOverlay.style.opacity = ccOpacity.toFixed(3);
        ccOverlay.style.visibility = 'visible';
        ccOverlay.classList.add('active');
      } else {
        ccOverlay.style.opacity = '0';
        ccOverlay.style.visibility = 'hidden';
        ccOverlay.classList.remove('active');
      }
    }
        // Drive Slide 2 cards reveal & focus based on second offset (10s, 15s, 20s, 25s)
    const card1 = document.getElementById('slide2-card-1');
    const card2 = document.getElementById('slide2-card-2');
    const card3 = document.getElementById('slide2-card-3');
    const card4 = document.getElementById('slide2-card-4');

    if (card1 && card2 && card3 && card4) {
      if (second < 10) {
        [card1, card2, card3, card4].forEach(c => { c.classList.remove('revealed', 'active-focus'); });
      } else if (second < 15) {
        card1.classList.add('active-focus'); card1.classList.remove('revealed');
        [card2, card3, card4].forEach(c => { c.classList.remove('revealed', 'active-focus'); });
      } else if (second < 20) {
        card1.classList.add('revealed'); card1.classList.remove('active-focus');
        card2.classList.add('active-focus'); card2.classList.remove('revealed');
        [card3, card4].forEach(c => { c.classList.remove('revealed', 'active-focus'); });
      } else if (second < 25) {
        [card1, card2].forEach(c => { c.classList.add('revealed'); c.classList.remove('active-focus'); });
        card3.classList.add('active-focus'); card3.classList.remove('revealed');
        card4.classList.remove('revealed', 'active-focus');
      } else {
        [card1, card2, card3].forEach(c => { c.classList.add('revealed'); c.classList.remove('active-focus'); });
        card4.classList.add('active-focus'); card4.classList.remove('revealed');
      }
    }

    // Sync slide timer and progress bar
    if (slideInfoText) {
      slideInfoText.textContent = `Slide ${activeSlideNum}/${slides.length}`;
    }
    const bounds = getSlideBounds(activeSlideNum);
    const slideElapsed = Math.max(0, second - bounds.start);
    if (slideTimerCount) {
      slideTimerCount.textContent = `${slideElapsed}s / ${bounds.duration}s`;
    }
    if (slideProgressBar) {
      const percent = Math.min(100, Math.max(0, (slideElapsed / bounds.duration) * 100));
      slideProgressBar.style.width = `${percent}%`;
    }
  }

  let controlsTimeout = null;

  function revealControlsTemporarily() {
    document.body.classList.add('show-controls');
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      if (!isRecording && isPaused) {
        document.body.classList.remove('show-controls');
      }
    }, 2500);
  }

  document.addEventListener('mousemove', revealControlsTemporarily);

  // Speed Slider Listener with Fixed Steps [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
  const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  function formatSpeedText(val) {
    if (val === 0.75 || val === 1.25 || val === 1.75 || val === 2.5) return `${val}x`;
    return (val % 1 === 0) ? `${val}x` : `${val.toFixed(1)}x`;
  }

  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      if (isRecording) return;
      const stepIdx = parseInt(e.target.value, 10);
      playbackSpeed = SPEED_STEPS[stepIdx] || 1.0;
      if (speedVal) speedVal.textContent = formatSpeedText(playbackSpeed);
      video.playbackRate = playbackSpeed;
      if (currentSpeechAudio) {
        currentSpeechAudio.playbackRate = playbackSpeed;
      }
      if (!isPaused) {
        startTimeline();
      }
    });
  }

  // CC Subtitles Toggle
  if (ccToggleBtn) {
    ccToggleBtn.addEventListener('click', () => {
      ccEnabled = !ccEnabled;
      ccToggleBtn.classList.toggle('active', ccEnabled);
      if (ccOverlay) {
        ccOverlay.classList.toggle('active', ccEnabled);
      }
    });
  }

  // Audio Speech Mute Toggle
  const audioMuteBtn = document.getElementById('audio-mute-btn');
  if (audioMuteBtn) {
    audioMuteBtn.addEventListener('click', () => {
      isAudioMuted = !isAudioMuted;
      audioMuteBtn.classList.toggle('active', !isAudioMuted);
      audioMuteBtn.innerHTML = isAudioMuted ? '🔇 Unmute' : '🔊 Mute';
      if (currentSpeechAudio) {
        currentSpeechAudio.muted = isAudioMuted;
        if (isAudioMuted) {
          currentSpeechAudio.pause();
        } else if (!isPaused) {
          currentSpeechAudio.play().catch(() => {});
        }
      }
    });
  }

  if (prevSlideBtn) prevSlideBtn.addEventListener('click', goToPrevTransition);
  if (nextSlideBtn) nextSlideBtn.addEventListener('click', goToNextTransition);
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
  if (recordBtn) recordBtn.addEventListener('click', toggleRecording);


  // Keybindings
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
        stopRecording();
        return;
      }
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

      evaluateTimelineState(currentExactSecond);

      if (currentExactSecond < TOTAL_DURATION) {
        rafId = requestAnimationFrame(animTick);
      }
    }

    rafId = requestAnimationFrame(animTick);
  }

  function togglePlayPause() {
    isPaused = !isPaused;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = isPaused ? '▶ Play' : '⏸ Pause';
    }

    if (isPaused) {
      clearInterval(timelineTimer);
      stopTimelineAnimation();
      document.body.classList.remove('playing-active');
      if (timerDisplay) timerDisplay.classList.remove('active');
      video.pause();
    } else {
      document.body.classList.add('playing-active');
      if (timerDisplay) timerDisplay.classList.add('active');
      startTimeline();
      video.playbackRate = isRecording ? 1.0 : playbackSpeed;
      video.play().catch(() => {});
    }
  }

  // Timeline Engine
  function startTimeline() {
    clearInterval(timelineTimer);
    stopTimelineAnimation();
    const intervalMs = Math.round(1000 / (isRecording ? 1.0 : playbackSpeed));

    // Evaluate state immediately for current second
    currentExactSecond = elapsedTime;
    evaluateTimelineState(currentExactSecond);
    startTimelineAnimation();

    timelineTimer = setInterval(() => {
      if (isPaused) return;

      elapsedTime++;

      const mins = Math.floor(elapsedTime / 60);
      const secs = elapsedTime % 60;
      if (timerCount) {
        timerCount.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }

      if (elapsedTime >= TOTAL_DURATION) {
        clearInterval(timelineTimer);
        stopTimelineAnimation();
        isPaused = true;
        document.body.classList.remove('playing-active');
        if (timerDisplay) timerDisplay.classList.remove('active');
        if (playPauseBtn) playPauseBtn.innerHTML = '▶ Play';
        if (isRecording) {
          stopRecording();
        }
      }
    }, intervalMs);
  }

  // Tab Recording Engine
  async function toggleRecording() {
    if (!isRecording) {
      await startRecording();
    } else {
      stopRecording();
    }
  }

  async function startRecording() {
    try {
      recordedChunks = [];
      playbackSpeed = 1.0;
      if (speedSlider) speedSlider.value = 1.0;
      if (speedVal) speedVal.textContent = '1.0x';

      document.body.classList.remove('show-controls');
      document.body.classList.add('recording-active');

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 60, max: 60 },
          displaySurface: 'browser'
        },
        audio: false,
        preferCurrentTab: true
      });

      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
          mimeType = 'video/webm;codecs=vp8';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
        }
      }

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 25000000
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = saveRecordedVideo;

      countdownSplash.classList.add('active');
      for (let count = 3; count > 0; count--) {
        countdownNumber.textContent = count;
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      countdownSplash.classList.remove('active');
      await new Promise(resolve => setTimeout(resolve, 450));

      mediaRecorder.start(1000);
      isRecording = true;
      isPaused = false;
      if (playPauseBtn) playPauseBtn.innerHTML = '⏸ Pause';

      elapsedTime = 0;
      if (timerCount) timerCount.textContent = '0:00';
      goToSlide(0);
      startTimeline();
    } catch (err) {
      document.body.classList.remove('recording-active');
      console.warn('Recording cancelled or failed:', err);
    }
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    isPaused = true;
    if (playPauseBtn) playPauseBtn.innerHTML = '▶ Play';

    document.body.classList.remove('recording-active');
    clearInterval(timelineTimer);
    playbackSpeed = 3.0;
    if (speedSlider) speedSlider.value = 3.0;
    if (speedVal) speedVal.textContent = '3.0x';

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }

  function saveRecordedVideo() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity_talk_${new Date().toISOString().slice(0, 10)}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Helper to parse slide number from URL hash (#slide3, #3, etc.)
  function getSlideIndexFromHash() {
    const match = window.location.hash.match(/\d+/);
    if (match) {
      const idx = parseInt(match[0], 10) - 1;
      if (idx >= 0 && idx < slides.length) return idx;
    }
    return 0;
  }

  window.addEventListener('hashchange', () => {
    const targetIdx = getSlideIndexFromHash();
    if (targetIdx !== currentSlideIndex) {
      goToSlide(targetIdx);
    }
  });

  // Initial Load Call with Hash Sync
  goToSlide(getSlideIndexFromHash());
});

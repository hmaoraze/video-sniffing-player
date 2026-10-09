/**
 * 视频嗅探播放器 —— 独立 H5 播放器
 *
 * 特性：播放/暂停、进度拖拽、音量、倍速（0.25×–3×）、全屏、画中画、
 *       播放列表、键盘快捷键、控制条自动隐藏。整体为黑白配色。
 */

const $ = (sel) => document.querySelector(sel);

const video = $('#video');
const stage = $('#stage');
const controls = $('#controls');
const progress = $('#progress');
const played = $('#played');
const buffered = $('#buffered');
const knob = $('#knob');
const curEl = $('#cur');
const durEl = $('#dur');
const btnPlay = $('#btn-play');
const centerBtn = $('#center-btn');
const btnMute = $('#btn-mute');
const btnFull = $('#btn-full');
const btnPip = $('#btn-pip');
const btnPlaylist = $('#btn-playlist');
const volumeEl = $('#volume');
const speedEl = $('#speed');
const speedValEl = $('#speed-val');
const titleEl = $('#title');
const noticeEl = $('#notice');
const playlistEl = $('#playlist');
const plList = $('#pl-list');
const plCount = $('#pl-count');

const params = new URLSearchParams(location.search);
let queue = [];
let idleTimer = null;
let seeking = false;

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function fmt(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function filename(url) {
  if (/^blob:/i.test(url)) return '页面内部媒体流';
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch {
    return url.slice(0, 70);
  }
}

function showNotice(title, detail) {
  noticeEl.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail || '';
  noticeEl.append(b, span);
  noticeEl.hidden = false;
}

function hideNotice() {
  noticeEl.hidden = true;
}

/* ------------------------------------------------------------------ */
/* 播放状态同步                                                        */
/* ------------------------------------------------------------------ */

function syncPlayButtons() {
  const playing = !video.paused && !video.ended;
  btnPlay.classList.toggle('play', !playing);
  btnPlay.classList.toggle('pause', playing);
  centerBtn.classList.toggle('play', !playing);
  centerBtn.classList.toggle('pause', playing);
  stage.classList.toggle('playing', playing);
}

function syncTimes() {
  curEl.textContent = fmt(video.currentTime);
  durEl.textContent = fmt(video.duration);
  const ratio = video.duration ? (video.currentTime / video.duration) * 100 : 0;
  played.style.width = ratio + '%';
  knob.style.left = ratio + '%';
}

function syncBuffered() {
  const d = video.duration;
  if (!d || !video.buffered.length) {
    buffered.style.width = '0%';
    return;
  }
  let end = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= video.currentTime + 0.25) {
      end = Math.max(end, video.buffered.end(i));
    }
  }
  buffered.style.width = Math.min(100, (end / d) * 100) + '%';
}

/* ------------------------------------------------------------------ */
/* 播放列表                                                            */
/* ------------------------------------------------------------------ */

function renderPlaylist() {
  plList.textContent = '';
  const items = queue.filter((i) => i.playable !== false);
  plCount.textContent = String(items.length);

  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = item.url === video.src ? 'active' : '';

    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = String(i + 1).padStart(2, '0');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || filename(item.url);
    name.title = item.url;

    li.append(no, name);
    li.addEventListener('click', () => load(item.url, item.title));
    plList.appendChild(li);
  });
}

function load(url, title) {
  if (!url) return;
  hideNotice();
  video.src = url;
  const label = title || filename(url);
  titleEl.textContent = label;
  document.title = label;
  video.play().catch(() => {});
  renderPlaylist();
}

function playNext() {
  const items = queue.filter((i) => i.playable !== false);
  const idx = items.findIndex((i) => i.url === video.src);
  if (idx >= 0 && idx + 1 < items.length) {
    load(items[idx + 1].url, items[idx + 1].title);
  }
}

/* ------------------------------------------------------------------ */
/* 控制条自动隐藏                                                      */
/* ------------------------------------------------------------------ */

function wake() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && !video.ended) stage.classList.add('idle');
  }, 2800);
}
['mousemove', 'mousedown', 'keydown'].forEach((ev) =>
  document.addEventListener(ev, wake, { passive: true })
);

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

btnPlay.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
centerBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
stage.addEventListener('click', (e) => {
  if (e.target === stage || e.target === video) {
    video.paused ? video.play() : video.pause();
  }
});

video.addEventListener('play', syncPlayButtons);
video.addEventListener('pause', syncPlayButtons);
video.addEventListener('timeupdate', () => {
  if (!seeking) syncTimes();
});
video.addEventListener('durationchange', syncTimes);
video.addEventListener('loadedmetadata', () => {
  syncTimes();
  syncBuffered();
});
video.addEventListener('progress', syncBuffered);
video.addEventListener('ended', () => {
  syncPlayButtons();
  playNext();
});

video.addEventListener('error', () => {
  const kindHint = isStreamUrl(video.src)
    ? '该地址是 HLS / DASH 流媒体，浏览器原生 <video> 无法直接播放，需要站点支持的播放器内核。'
    : '该地址可能受防盗链保护，或不是可直接播放的文件。';
  showNotice('无法播放该资源', kindHint + ' 可尝试复制地址后使用其他工具打开。');
});

function isStreamUrl(url) {
  const u = String(url).toLowerCase();
  return u.includes('.m3u8') || u.includes('.mpd');
}

/* 音量 */
volumeEl.addEventListener('input', () => {
  video.volume = Number(volumeEl.value);
  video.muted = video.volume === 0;
  syncMuteButton();
});

btnMute.addEventListener('click', () => {
  video.muted = !video.muted;
  syncMuteButton();
});

function syncMuteButton() {
  const muted = video.muted || video.volume === 0;
  btnMute.textContent = muted ? '取消静音' : '静音';
  btnMute.classList.toggle('active', muted);
  volumeEl.value = muted ? 0 : video.volume;
}

/* 倍速（无级调节 + 固定档位吸附锁定） */
const RATE_MIN = 0.1;
const RATE_MAX = 16;
const SPEED_PRESETS = [0.5, 1, 1.25, 1.5, 1.75, 2, 3, 5];
const SNAP_TOLERANCE = 0.035;

function snapRate(value) {
  let best = value;
  let bestDist = Infinity;
  for (const preset of SPEED_PRESETS) {
    const dist = Math.abs(value - preset);
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return bestDist <= SNAP_TOLERANCE ? best : value;
}

function isPreset(value) {
  return SPEED_PRESETS.some((preset) => Math.abs(value - preset) < 0.001);
}

function applyRate(rate, persist = true, snap = false) {
  let value = Math.min(RATE_MAX, Math.max(RATE_MIN, Number(rate) || 1));
  if (snap) value = snapRate(value);
  video.playbackRate = value;
  speedEl.value = String(value);
  speedValEl.textContent = value.toFixed(2) + '×';
  speedValEl.classList.toggle('locked', isPreset(value));
  if (persist) chrome.storage.local.set({ lastSpeed: value });
}

speedEl.addEventListener('input', () => applyRate(speedEl.value, true, true));

/* 全屏 */
btnFull.addEventListener('click', () => {
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen();
    } else if (stage.webkitRequestFullscreen) {
      stage.webkitRequestFullscreen();
    }
  } catch (_) {
    showNotice('全屏不可用', '当前浏览器环境不允许进入全屏。');
  }
});

document.addEventListener('fullscreenchange', () => {
  btnFull.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  btnFull.classList.toggle('active', !!document.fullscreenElement);
});

/* 画中画 */
btnPip.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch {
    showNotice('画中画不可用', '当前浏览器或页面环境不支持画中画。');
  }
});

/* 播放列表显示 / 隐藏 */
btnPlaylist.addEventListener('click', () => {
  playlistEl.hidden = !playlistEl.hidden;
  btnPlaylist.classList.toggle('active', !playlistEl.hidden);
});

/* 进度拖拽 */
function ratioFromEvent(e) {
  const rect = progress.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}

function seekTo(ratio) {
  if (!video.duration) return;
  played.style.width = ratio * 100 + '%';
  knob.style.left = ratio * 100 + '%';
  curEl.textContent = fmt(ratio * video.duration);
}

progress.addEventListener('pointerdown', (e) => {
  if (!video.duration) return;
  seeking = true;
  progress.setPointerCapture(e.pointerId);
  seekTo(ratioFromEvent(e));
});
progress.addEventListener('pointermove', (e) => {
  if (seeking) seekTo(ratioFromEvent(e));
});
progress.addEventListener('pointerup', (e) => {
  if (!seeking) return;
  seeking = false;
  try {
    progress.releasePointerCapture(e.pointerId);
  } catch (_) {}
  if (video.duration) video.currentTime = ratioFromEvent(e) * video.duration;
});
progress.addEventListener('click', (e) => {
  if (video.duration && !seeking) video.currentTime = ratioFromEvent(e) * video.duration;
});

/* 键盘快捷键 */
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault();
      video.paused ? video.play() : video.pause();
      break;
    case 'ArrowLeft':
      video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'ArrowRight':
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.05);
      video.muted = false;
      syncMuteButton();
      break;
    case 'ArrowDown':
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.05);
      syncMuteButton();
      break;
    case 'm':
      video.muted = !video.muted;
      syncMuteButton();
      break;
    case 'f':
      btnFull.click();
      break;
    case '[':
      applyRate(video.playbackRate - 0.05, true, true);
      break;
    case ']':
      applyRate(video.playbackRate + 0.05, true, true);
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

async function init() {
  const requestedSrc = params.get('src');
  const requestedTitle = params.get('title') || '';

  let stored = {};
  try {
    stored = await chrome.storage.local.get(['queue', 'current', 'lastSpeed']);
  } catch (_) {}

  queue = Array.isArray(stored.queue)
    ? stored.queue.filter((i) => i && i.url && i.playable !== false)
    : [];

  if (requestedSrc && !queue.some((i) => i.url === requestedSrc)) {
    queue.unshift({ url: requestedSrc, title: requestedTitle, playable: true });
  }

  applyRate(stored.lastSpeed ? Number(stored.lastSpeed) : 1, false, true);

  renderPlaylist();
  syncMuteButton();
  syncPlayButtons();
  wake();

  const startUrl = requestedSrc || (queue[0] && queue[0].url) || stored.current;
  if (startUrl) {
    load(startUrl, requestedTitle || (queue.find((i) => i.url === startUrl) || {}).title);
  } else {
    titleEl.textContent = '视频播放器';
    showNotice('没有可播放的视频', '请回到目标网页，点击扩展图标，从资源列表中选择要播放的视频。');
  }
}

init();
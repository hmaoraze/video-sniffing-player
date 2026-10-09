/**
 * 视频嗅探播放器 —— 后台 Service Worker（Manifest V3）
 *
 * 职责：
 *  1. 通过「观察型」webRequest 监听网络请求，收集当前标签页中的视频/音频地址。
 *  2. 汇总内容脚本从 DOM 中扫描到的地址。
 *  3. 为每个标签页维护一份资源列表（存放于 chrome.storage.session，Service Worker 休眠后不丢失）。
 *  4. 响应弹窗/内容脚本的消息，并负责打开独立播放器页面。
 *
 * 注意：Manifest V3 已移除 webRequest 的 "blocking" 能力，
 * 这里只使用其「观察」能力（仅监听、不拦截），这在 MV3 中依然被允许。
 */

const SESSION_KEY = 'mediaMap';

// 常见媒体后缀
const EXT_RE = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|flv|avi|ts|m3u8|mpd|mp3|m4a|aac|flac|wav)(\?|#|$)/i;
// 流媒体地址特征
const STREAM_RE = /(\.m3u8|\.mpd|\/hls\/|\/dash\/|master\.json|playlist\.json)/i;
// 需要监听的请求类型
const REQUEST_TYPES = ['media', 'xmlhttprequest', 'other', 'object'];

/* ------------------------------------------------------------------ */
/* 存储层                                                              */
/* ------------------------------------------------------------------ */

async function getMap() {
  const store = await chrome.storage.session.get(SESSION_KEY);
  return store[SESSION_KEY] || {};
}

async function setMap(map) {
  await chrome.storage.session.set({ [SESSION_KEY]: map });
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function classify(url, type) {
  const u = String(url).toLowerCase();
  if (u.includes('.m3u8')) return 'HLS';
  if (u.includes('.mpd')) return 'DASH';
  if (/\.(mp3|m4a|aac|flac|wav|ogg)(\?|#|$)/.test(u)) return '音频';
  if (/\.webm(\?|#|$)/.test(u)) return 'WebM';
  if (/\.(mp4|m4v)(\?|#|$)/.test(u)) return 'MP4';
  if (type === 'media') return '媒体';
  return '视频';
}

function isAcceptableUrl(url) {
  return /^https?:/i.test(url) || /^blob:/i.test(url);
}

function updateBadge(tabId, list) {
  const n = (list || []).filter((i) => i.playable).length;
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#000000' });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : '' });
  } catch (_) {
    /* 标签页可能已关闭 */
  }
}

/* ------------------------------------------------------------------ */
/* 列表操作                                                            */
/* ------------------------------------------------------------------ */

async function addItems(tabId, items) {
  if (typeof tabId !== 'number' || tabId < 0 || !Array.isArray(items) || !items.length) {
    return 0;
  }
  const map = await getMap();
  const key = String(tabId);
  const list = map[key] || [];
  const seen = new Set(list.map((i) => i.url));
  let added = 0;

  for (const raw of items) {
    if (!raw || !raw.url || !isAcceptableUrl(raw.url)) continue;
    if (seen.has(raw.url)) continue;
    seen.add(raw.url);
    list.push({
      url: raw.url,
      kind: raw.kind || classify(raw.url, raw.type),
      origin: raw.origin || 'network',
      title: raw.title || '',
      playable: raw.playable !== false && !/^blob:/i.test(raw.url),
      ts: raw.ts || Date.now()
    });
    added++;
  }

  if (added) {
    map[key] = list;
    await setMap(map);
    updateBadge(tabId, list);
  }
  return added;
}

async function listFor(tabId) {
  if (typeof tabId !== 'number') return [];
  const map = await getMap();
  return map[String(tabId)] || [];
}

async function clearTab(tabId) {
  if (typeof tabId !== 'number') return;
  const map = await getMap();
  if (map[String(tabId)]) {
    delete map[String(tabId)];
    await setMap(map);
  }
  updateBadge(tabId, []);
}

async function deleteTab(tabId) {
  const map = await getMap();
  if (map[String(tabId)]) {
    delete map[String(tabId)];
    await setMap(map);
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

/* ------------------------------------------------------------------ */
/* 网络嗅探（观察型，不拦截）                                           */
/* ------------------------------------------------------------------ */

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, type, tabId } = details;
    if (!/^https?:/i.test(url)) return;
    const looksLikeMedia = type === 'media' || EXT_RE.test(url) || STREAM_RE.test(url);
    if (!looksLikeMedia) return;
    addItems(tabId, [{
      url,
      type,
      kind: classify(url, type),
      origin: 'network',
      playable: true
    }]);
  },
  { urls: ['<all_urls>'], types: REQUEST_TYPES }
);

/* 标签页关闭 / 主文档跳转时清理旧数据 */
chrome.tabs.onRemoved.addListener((tabId) => {
  deleteTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) clearTab(tabId);
});

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // 异步响应
});

async function handleMessage(msg, sender) {
  const type = msg && msg.type;

  if (type === 'report') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : sender.tab && sender.tab.id;
    const added = await addItems(tabId, msg.items);
    return { ok: true, added };
  }

  if (type === 'get') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : await activeTabId();
    return { ok: true, tabId, list: await listFor(tabId) };
  }

  if (type === 'clear') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : await activeTabId();
    await clearTab(tabId);
    return { ok: true };
  }

  if (type === 'openPlayer') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : await activeTabId();
    const list = Array.isArray(msg.list) && msg.list.length ? msg.list : await listFor(tabId);
    await chrome.storage.local.set({ queue: list, current: msg.src || '' });

    const query = new URLSearchParams();
    if (msg.src) query.set('src', msg.src);
    if (msg.title) query.set('title', msg.title);
    const suffix = query.toString() ? '?' + query.toString() : '';
    await chrome.tabs.create({ url: chrome.runtime.getURL('player.html') + suffix });
    return { ok: true };
  }

  return { ok: false, error: 'unknown message type' };
}
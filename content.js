/**
 * 视频嗅探播放器 —— 内容脚本
 *
 * 职责：
 *  1. 扫描页面 DOM 中的 <video>/<audio>/<source>、meta 标签、preload link 等。
 *  2. 把扫描结果上报给后台 Service Worker。
 *  3. 用 Shadow DOM 渲染一个悬浮入口按钮（完全隔离样式，不污染页面）。
 *  4. 通过 MutationObserver 监听页面变化，动态补充新出现的资源。
 */

(() => {
  if (window.__videoSnifferInjected) return;
  window.__videoSnifferInjected = true;

  const EXT_RE = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|flv|avi|ts|m3u8|mpd|mp3|m4a|aac|flac|wav)(\?|#|$)/i;
  const isTopFrame = window.top === window;

  function abs(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return '';
    }
  }

  function classify(url) {
    const u = String(url).toLowerCase();
    if (u.includes('.m3u8')) return 'HLS';
    if (u.includes('.mpd')) return 'DASH';
    if (/\.(mp3|m4a|aac|flac|wav|ogg)(\?|#|$)/.test(u)) return '音频';
    if (/\.webm(\?|#|$)/.test(u)) return 'WebM';
    if (/\.(mp4|m4v)(\?|#|$)/.test(u)) return 'MP4';
    return '视频';
  }

  /* ---------------------------------------------------------------- */
  /* DOM 扫描                                                          */
  /* ---------------------------------------------------------------- */

  function collect() {
    const out = [];
    const seen = new Set();

    const push = (rawUrl, origin) => {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      const isBlob = /^blob:/i.test(rawUrl);
      const url = isBlob ? rawUrl : abs(rawUrl);
      if (!url || seen.has(url)) return;
      if (!/^https?:/i.test(url) && !isBlob) return;
      seen.add(url);
      out.push({
        url,
        origin,
        kind: isBlob ? 'blob 流' : classify(url),
        playable: !isBlob
      });
    };

    // 1) <video> / <audio>：优先 currentSrc（真实播放地址），其次 src 与 <source>
    document.querySelectorAll('video, audio').forEach((el) => {
      push(el.currentSrc, 'dom');
      push(el.src, 'dom');
      el.querySelectorAll('source').forEach((s) => {
        push(s.src, 'dom');
        push(s.getAttribute('data-src'), 'dom');
      });
    });

    // 2) 懒加载属性
    document.querySelectorAll('[data-src],[data-video-src],[data-url]').forEach((el) => {
      const v =
        el.getAttribute('data-src') ||
        el.getAttribute('data-video-src') ||
        el.getAttribute('data-url');
      if (v && EXT_RE.test(v)) push(v, 'dom');
    });

    // 3) 社交/播放器 meta 标签
    const metaKeys = [
      'og:video',
      'og:video:url',
      'og:video:secure_url',
      'twitter:player:stream',
      'video_src'
    ];
    metaKeys.forEach((key) => {
      document
        .querySelectorAll(`meta[property="${key}"], meta[name="${key}"]`)
        .forEach((m) => push(m.content, 'meta'));
    });

    // 4) 预加载声明
    document.querySelectorAll('link[rel="preload"][as="video"], link[rel="preload"][as="audio"]').forEach((l) => {
      push(l.href, 'link');
    });

    return out;
  }

  /* ---------------------------------------------------------------- */
  /* 上报                                                              */
  /* ---------------------------------------------------------------- */

  let lastKey = '';
  let lastItems = [];

  function report() {
    const items = collect();
    const key = items.map((i) => i.url).join('|');
    if (key !== lastKey) {
      lastKey = key;
      lastItems = items;
      try {
        const p = chrome.runtime.sendMessage({ type: 'report', items });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {
        /* 扩展被更新或上下文失效，忽略 */
      }
      updateBadge(items);
    }
    return lastItems;
  }

  /* ---------------------------------------------------------------- */
  /* Shadow DOM 悬浮入口                                                */
  /* ---------------------------------------------------------------- */

  let host = null;
  let countEl = null;

  function ensureBadge() {
    if (host) return;

    host = document.createElement('div');
    host.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
    host.style.setProperty('display', 'none', 'important');

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .wrap {
          display: flex; align-items: center; gap: 8px;
          background: #000; color: #fff; border: 1px solid #3a3a3a;
          border-radius: 999px; padding: 9px 14px 9px 12px;
          font: 13px/1 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
          cursor: pointer; user-select: none;
          box-shadow: 0 6px 20px rgba(0,0,0,.45);
          transition: transform .15s ease, border-color .15s ease;
        }
        .wrap:hover { transform: translateY(-2px); border-color: #fff; }
        .tri {
          width: 0; height: 0;
          border-style: solid; border-width: 6px 0 6px 10px;
          border-color: transparent transparent transparent #fff;
        }
        .num {
          min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
          background: #fff; color: #000; font-weight: 700; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
        }
        .txt { letter-spacing: .5px; }
      </style>
      <div class="wrap" title="打开视频嗅探播放器">
        <span class="tri"></span>
        <span class="txt">播放器</span>
        <span class="num">0</span>
      </div>
    `;

    countEl = root.querySelector('.num');
    root.querySelector('.wrap').addEventListener('click', async () => {
      const items = collect();
      const first = items.find((i) => i.playable);
      try {
        const p = chrome.runtime.sendMessage({
          type: 'openPlayer',
          list: items,
          src: first ? first.url : ''
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {
        /* 忽略 */
      }
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function updateBadge(items) {
    if (!isTopFrame) return;
    const count = items.filter((i) => i.playable).length;
    if (!count) {
      if (host) host.style.setProperty('display', 'none', 'important');
      return;
    }
    ensureBadge();
    countEl.textContent = String(count);
    host.style.setProperty('display', 'block', 'important');
  }

  /* ---------------------------------------------------------------- */
  /* 启动                                                              */
  /* ---------------------------------------------------------------- */

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(report, 800);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'rescan') {
      sendResponse({ ok: true, items: report() });
    }
  });

  function start() {
    report();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
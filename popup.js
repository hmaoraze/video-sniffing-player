/**
 * 视频嗅探播放器 —— 弹窗脚本
 * 展示当前标签页捕获到的媒体资源，并支持一键用独立播放器打开。
 */

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const refreshBtn = document.getElementById('refresh');
const playAllBtn = document.getElementById('playAll');

let currentTab = null;
let currentList = [];

const send = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false })));

function setStatus(text) {
  if (text) {
    statusEl.textContent = text;
    statusEl.hidden = false;
  } else {
    statusEl.hidden = true;
  }
}

function filename(url) {
  if (/^blob:/i.test(url)) return '页面内部媒体流';
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

function isStream(kind) {
  return kind === 'HLS' || kind === 'DASH';
}

/* ------------------------------------------------------------------ */

function render(items) {
  listEl.textContent = '';

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '当前页面暂未发现视频资源。可尝试播放页面视频后再点「刷新」。';
    listEl.appendChild(li);
    countEl.textContent = '0 个资源';
    playAllBtn.disabled = true;
    return;
  }

  playAllBtn.disabled = !items.some((i) => i.playable);
  const playableCount = items.filter((i) => i.playable).length;
  countEl.textContent = `${playableCount} / ${items.length} 个资源`;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item' + (item.playable ? '' : ' disabled');

    const meta = document.createElement('div');
    meta.className = 'meta';

    const row = document.createElement('div');
    row.className = 'row';

    const kind = document.createElement('span');
    kind.className = 'kind' + (isStream(item.kind) ? ' stream' : '');
    kind.textContent = item.kind || '视频';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = filename(item.url);
    name.title = item.url;

    row.append(kind, name);
    meta.appendChild(row);

    const full = document.createElement('div');
    full.className = 'full';
    full.textContent = item.url;
    meta.appendChild(full);

    const ops = document.createElement('div');
    ops.className = 'ops';

    const playBtn = document.createElement('button');
    playBtn.className = 'play';
    playBtn.textContent = '播放';
    playBtn.disabled = !item.playable;
    playBtn.addEventListener('click', () => openPlayer(item.url));

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        copyBtn.textContent = '已复制';
        setTimeout(() => (copyBtn.textContent = '复制'), 1200);
      } catch {
        copyBtn.textContent = '失败';
        setTimeout(() => (copyBtn.textContent = '复制'), 1200);
      }
    });

    ops.append(playBtn, copyBtn);
    li.append(meta, ops);
    listEl.appendChild(li);
  });
}

/* ------------------------------------------------------------------ */

async function ensureContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'rescan' });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js']
      });
      await new Promise((r) => setTimeout(r, 350));
      return await chrome.tabs.sendMessage(tabId, { type: 'rescan' });
    } catch {
      return null;
    }
  }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab || !/^https?:/i.test(tab.url || '')) {
    setStatus('');
    listEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '当前页面不支持嗅探。\n请切换到普通网页（http/https）后再试。';
    listEl.appendChild(li);
    countEl.textContent = '0 个资源';
    playAllBtn.disabled = true;
    return;
  }

  setStatus('正在扫描当前页面…');
  const res = await ensureContentScript(tab.id);
  if (!res) {
    setStatus('无法注入扫描脚本，请刷新网页后重试。');
  }
  await new Promise((r) => setTimeout(r, 250));

  const data = await send({ type: 'get', tabId: tab.id });
  currentList = (data.list || []).sort(
    (a, b) => (b.playable - a.playable) || (a.ts - b.ts)
  );

  setStatus('');
  render(currentList);
}

async function openPlayer(src) {
  if (!currentTab) return;
  const item = currentList.find((i) => i.url === src);
  await send({
    type: 'openPlayer',
    tabId: currentTab.id,
    list: currentList,
    src,
    title: item ? filename(src) : ''
  });
  window.close();
}

refreshBtn.addEventListener('click', refresh);
playAllBtn.addEventListener('click', () => {
  const first = currentList.find((i) => i.playable);
  if (first) openPlayer(first.url);
});

refresh();
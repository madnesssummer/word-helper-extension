const listEl = document.getElementById('wordList');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const openOptions = document.getElementById('openOptions');
const reviewBtn = document.getElementById('reviewBtn');
const heatmapBtn = document.getElementById('heatmapBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const ioMsg = document.getElementById('ioMsg');

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 复习按钮点击事件
reviewBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});

// 热力图按钮点击事件
heatmapBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('heatmap.html') });
});

// ── 导出单词本 ──
exportBtn.addEventListener('click', async () => {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'EXPORT_WORD_BOOK' });
  if (!ok) return;
  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    words: data.words,
    dailyStats: data.dailyStats
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `word-helper-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showIoMsg(`已导出 ${Object.keys(data.words).length} 个词条`, 'success');
});

// ── 导入单词本 ──
importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // 兼容带版本头的格式和原始 word_book 格式
    const words = parsed.words || parsed;
    if (typeof words !== 'object' || Array.isArray(words)) throw new Error('格式错误');
    const { ok, data } = await chrome.runtime.sendMessage({
      type: 'IMPORT_WORD_BOOK',
      payload: { words }
    });
    if (ok) {
      showIoMsg(`导入成功：新增 ${data.importCount} 个词条`, 'success');
      await refreshList();
    }
  } catch {
    showIoMsg('导入失败：文件格式不正确', 'error');
  }
  importFile.value = '';
});

function showIoMsg(text, type) {
  ioMsg.textContent = text;
  ioMsg.className = `io-msg io-msg--${type}`;
  ioMsg.style.display = 'block';
  setTimeout(() => { ioMsg.style.display = 'none'; }, 3000);
}

searchBtn.addEventListener('click', async () => {
  const word = searchInput.value.trim();
  if (!word) return;
  searchBtn.textContent = '查询中…';
  searchBtn.disabled = true;
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'LOOKUP_TRANSLATION', payload: { word, from: 'en', to: 'zh' } });
  searchBtn.textContent = '查询';
  searchBtn.disabled = false;
  if (ok) {
    await chrome.runtime.sendMessage({ type: 'ADD_TO_WORD_BOOK', payload: { word, translation: data } });
    await refreshList();
    // 给第一个词条加高亮入场动画
    const firstLi = listEl.querySelector('li');
    if (firstLi) {
      firstLi.classList.add('new-word');
      setTimeout(() => firstLi.classList.remove('new-word'), 1200);
    }
    searchInput.value = '';
  }
});

async function refreshList() {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_WORD_BOOK' });
  if (!ok) return;
  const items = Object.values(data || {});
  items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  listEl.innerHTML = '';
  for (const [index, item] of items.entries()) {
    const li = document.createElement('li');
    // 交错入场动画
    li.style.animationDelay = `${index * 35}ms`;
    li.innerHTML = `
      <span class="word">${escapeHtml(item.word)}</span>
      <span class="translation">${escapeHtml((item.translation?.explains || []).join('; '))}</span>
      <span>
        <button class="small" data-word="${escapeAttr(item.word)}">复习</button>
      </span>
    `;
    li.querySelector('button.small').addEventListener('click', () => review(item.word));
    listEl.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
function escapeAttr(str) { return escapeHtml(str); }

async function review(word) {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_WORD_BOOK' });
  if (!ok) return;
  const book = data || {};
  const item = book[word];
  if (!item) return;
  item.reviewedTimes = (item.reviewedTimes || 0) + 1;
  item.lastReviewedAt = Date.now();
  // 交由后台统一计算 nextReviewAt 更好；简化起见在前端做一次
  const intervals = [1, 2, 4, 7, 15];
  const idx = Math.min(item.reviewedTimes, intervals.length - 1);
  item.nextReviewAt = Date.now() + intervals[idx] * 24 * 60 * 60 * 1000;
  await chrome.storage.local.set({ word_book: book });
  await refreshList();
}

refreshList();

// 可选：弹窗头部渐变在打开时随机变化
document.addEventListener('DOMContentLoaded', () => {
  const gradients = [
    'linear-gradient(135deg, #a18cd1, #fbc2eb)',
    'linear-gradient(135deg, #7F7FD5, #86A8E7)',
    'linear-gradient(135deg, #FAD961, #F76B1C)',
    'linear-gradient(135deg, #43e97b, #38f9d7)'
  ];
  const idx = Math.floor(Math.random() * gradients.length);
  document.querySelector('header').style.background = gradients[idx];
});


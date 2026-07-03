// 内容脚本：
// 1) 监听页面划词
// 2) 展示翻译卡片（含朗读按钮）
// 3) 点击收藏到单词本
// 4) 根据单词本对页面高亮（简单基于文本节点替换，避免重排）
// 5) 沉浸式段落翻译（手动开启，DeepL，跳过单词本中的单词）

// ── TTS 朗读（英文） ──
function speak(word) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = 'en-US';
  utter.rate = 0.85;
  speechSynthesis.speak(utter);
}

let cardRoot = null;
let triggerRoot = null;
let lastSelectionText = '';
let cardDismissTimer = null;

document.addEventListener('mouseup', async (e) => {
  if (e.target?.closest?.('.word-helper-card, .word-helper-trigger')) return;
  const text = window.getSelection()?.toString()?.trim();
  if (!text || /^\s+$/.test(text)) {
    removeTranslateTrigger();
    return;
  }
  lastSelectionText = text;
  showTranslateTrigger(getSelectionInfo(text));
});

document.addEventListener('mousedown', (e) => {
  if (e.target?.closest?.('.word-helper-card, .word-helper-trigger')) return;
  removeTranslateTrigger();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'WH_CONTEXT_TRANSLATE') return;
  handleContextTranslate(message.payload || {});
});

async function handleContextTranslate(payload) {
  const selectionInfo = getSelectionInfo(payload.selectedText);
  if (Number.isFinite(payload.x)) selectionInfo.x = payload.x;
  if (Number.isFinite(payload.y)) selectionInfo.y = payload.y;
  const selectedText = selectionInfo.text;
  if (!selectedText) return;

  const mode = payload.mode === 'auto' ? detectSelectionMode(selectedText) : (payload.mode === 'term' ? 'term' : 'sentence');
  removeTranslateTrigger();
  showDeepSeekLoading(selectionInfo.x, selectionInfo.y, selectedText, mode);

  try {
    const context = mode === 'term'
      ? buildTermContext(selectionInfo)
      : buildSentenceContext(selectionInfo);
    const response = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_SELECTION_DEEPSEEK',
      payload: {
        mode,
        selectedText,
        context
      }
    });

    if (response?.ok) {
      await showDeepSeekResult(selectionInfo.x, selectionInfo.y, selectedText, mode, response.data?.result);
    } else {
      showDeepSeekError(selectionInfo.x, selectionInfo.y, selectedText, response?.error || 'TRANSLATION_FAILED');
    }
  } catch (error) {
    showDeepSeekError(selectionInfo.x, selectionInfo.y, selectedText, error?.message || 'TRANSLATION_FAILED');
  }
}

function showTranslateTrigger(selectionInfo) {
  removeTranslateTrigger();
  if (!selectionInfo?.text) return;

  triggerRoot = document.createElement('button');
  triggerRoot.type = 'button';
  triggerRoot.className = 'word-helper-trigger';
  triggerRoot.title = '翻译选中内容';
  triggerRoot.textContent = '译';
  triggerRoot.style.left = `${selectionInfo.x}px`;
  triggerRoot.style.top = `${selectionInfo.y}px`;
  triggerRoot.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  triggerRoot.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleContextTranslate({
      mode: 'auto',
      selectedText: selectionInfo.text,
      x: selectionInfo.x,
      y: selectionInfo.y
    });
  });
  document.body.appendChild(triggerRoot);
}

function removeTranslateTrigger() {
  if (!triggerRoot) return;
  triggerRoot.remove();
  triggerRoot = null;
}

function detectSelectionMode(text) {
  const value = String(text || '').trim();
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  const hasSentencePunctuation = /[.!?。！？；;]/.test(value);
  return wordCount <= 6 && !hasSentencePunctuation ? 'term' : 'sentence';
}

function getSelectionInfo(fallbackText = '') {
  const selection = window.getSelection();
  const text = selection?.toString()?.trim() || String(fallbackText || '').trim() || lastSelectionText;
  let rect = null;
  let range = null;
  if (selection && selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
    rect = range.getBoundingClientRect();
    if ((!rect || (!rect.width && !rect.height)) && range.getClientRects().length) {
      rect = range.getClientRects()[0];
    }
  }

  return {
    text,
    range,
    x: rect ? Math.min(window.innerWidth - 24, Math.max(8, rect.left)) : 24,
    y: rect ? Math.max(8, rect.bottom + 8) : 24
  };
}

function buildTermContext(selectionInfo) {
  const paragraphText = getClosestTextBlock(selectionInfo.range);
  const sentenceBundle = extractSentenceBundle(paragraphText, selectionInfo.text);
  return {
    before: sentenceBundle.before,
    sentence: sentenceBundle.sentence || selectionInfo.text,
    after: sentenceBundle.after
  };
}

function buildSentenceContext(selectionInfo) {
  const paragraphText = getClosestTextBlock(selectionInfo.range);
  const sentenceBundle = extractSentenceBundle(paragraphText, selectionInfo.text);
  return {
    before: sentenceBundle.before,
    after: sentenceBundle.after
  };
}

function getClosestTextBlock(range) {
  const node = range?.commonAncestorContainer;
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const block = element?.closest?.('p, li, blockquote, h1, h2, h3, h4, h5, h6, article, section, main, div');
  return (block?.textContent || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
}

function extractSentenceBundle(text, selectedText) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const fallback = String(selectedText || '').trim();
  if (!source) return { before: '', sentence: fallback, after: '' };

  const selectedIndex = source.toLowerCase().indexOf(fallback.toLowerCase());
  const cursor = selectedIndex >= 0 ? selectedIndex : 0;
  const sentencePattern = /[^.!?。！？；;]+[.!?。！？；;]?/g;
  const matches = [...source.matchAll(sentencePattern)]
    .map(match => ({
      text: match[0].trim(),
      start: match.index,
      end: match.index + match[0].length
    }))
    .filter(item => item.text);

  if (!matches.length) return { before: '', sentence: source || fallback, after: '' };

  const currentIndex = matches.findIndex(item => cursor >= item.start && cursor <= item.end);
  const index = currentIndex >= 0 ? currentIndex : 0;
  return {
    before: matches[index - 1]?.text || '',
    sentence: matches[index]?.text || fallback,
    after: matches[index + 1]?.text || ''
  };
}

function showDeepSeekLoading(x, y, selectedText, mode) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--deepseek';
  cardRoot.style.setProperty('--wh-gradient', pickGradient());
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;
  cardRoot.innerHTML = `
    <div class="wh-title">${escapeHtml(mode === 'term' ? '词义解析' : '句段翻译')}</div>
    <div class="wh-selected-text">${escapeHtml(selectedText)}</div>
    <div class="wh-loading">DeepSeek 分析中...</div>
  `;
  document.body.appendChild(cardRoot);
}

async function showDeepSeekResult(x, y, selectedText, mode, result) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--deepseek';
  cardRoot.style.setProperty('--wh-gradient', pickGradient());
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;

  let queryStats = null;
  let inWordBook = false;
  if (mode === 'term') {
    const statsResp = await chrome.runtime.sendMessage({
      type: 'RECORD_QUERY_STAT',
      payload: { word: selectedText }
    });
    queryStats = statsResp?.ok ? statsResp.data : { count: 0, lastQueried: 0 };

    const bookResp = await chrome.runtime.sendMessage({
      type: 'CHECK_WORD_IN_BOOK',
      payload: { word: selectedText }
    });
    inWordBook = !!bookResp?.data?.inBook;
  }

  const html = mode === 'term'
    ? buildTermResultHtml(selectedText, result || {}, queryStats, inWordBook)
    : buildSentenceResultHtml(selectedText, result || {});

  cardRoot.innerHTML = html;
  document.body.appendChild(cardRoot);
  if (mode === 'term') {
    bindDeepSeekTermActions(selectedText, result || {}, inWordBook);
  }
  attachAutoDismissCard(cardRoot);
}

function buildTermResultHtml(selectedText, result, queryStats, inWordBook) {
  const alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
  const alternativesHtml = alternatives.length
    ? `<div class="wh-result-row"><span>可替换译法</span><p>${alternatives.map(escapeHtml).join(' / ')}</p></div>`
    : '';
  const sentenceHtml = result.sentenceTranslation
    ? `<div class="wh-result-row"><span>原句翻译</span><p>${escapeHtml(result.sentenceTranslation)}</p></div>`
    : '';
  const actionButtons = inWordBook
    ? `<button id="wh-deepseek-familiar" class="wh-familiar-btn">熟悉</button>`
    : `<button id="wh-deepseek-fav">收藏</button>`;
  const queryCount = queryStats?.count || 0;

  return `
    <div class="wh-title">${escapeHtml(selectedText)}<span class="wh-type-tag">词/短语</span></div>
    <div class="wh-query-stats">查询次数: ${queryCount} 次</div>
    <div class="wh-result-main">${escapeHtml(result.meaningInContext || result.translation || '')}</div>
    <div class="wh-result-row"><span>句中含义</span><p>${escapeHtml(result.explanation || result.meaningInContext || '')}</p></div>
    ${result.partOfSpeech ? `<div class="wh-result-row"><span>词性</span><p>${escapeHtml(result.partOfSpeech)}</p></div>` : ''}
    ${sentenceHtml}
    ${alternativesHtml}
    <div class="wh-actions">
      ${actionButtons}
    </div>
  `;
}

function bindDeepSeekTermActions(word, result, inWordBook) {
  if (inWordBook) {
    document.getElementById('wh-deepseek-familiar')?.addEventListener('click', async () => {
      const button = document.getElementById('wh-deepseek-familiar');
      button.textContent = '删除中...';
      button.disabled = true;
      const { ok, data } = await chrome.runtime.sendMessage({
        type: 'REMOVE_FROM_WORD_BOOK',
        payload: { word }
      });
      if (ok && data?.success) {
        button.textContent = '已删除';
        setTimeout(() => {
          removeCard();
          highlightWordsOnPage();
        }, 800);
      } else {
        button.textContent = '删除失败';
        button.disabled = false;
      }
    });
    return;
  }

  document.getElementById('wh-deepseek-fav')?.addEventListener('click', async () => {
    const button = document.getElementById('wh-deepseek-fav');
    button.textContent = '收藏中...';
    button.disabled = true;
    const { ok } = await chrome.runtime.sendMessage({
      type: 'ADD_TO_WORD_BOOK',
      payload: {
        word,
        translation: buildDeepSeekWordBookTranslation(word, result)
      }
    });
    if (ok) {
      button.textContent = '已收藏';
      setTimeout(() => {
        removeCard();
        highlightWordsOnPage();
      }, 800);
    } else {
      button.textContent = '收藏失败';
      button.disabled = false;
    }
  });
}

function buildDeepSeekWordBookTranslation(word, result) {
  const explains = [
    result.meaningInContext || result.translation || '',
    result.explanation || '',
    result.sentenceTranslation ? `原句翻译: ${result.sentenceTranslation}` : ''
  ].filter(Boolean);
  return {
    word,
    phonetic: '',
    explains,
    deepseek: result
  };
}

function buildSentenceResultHtml(selectedText, result) {
  return `
    <div class="wh-title">句段翻译</div>
    <div class="wh-selected-text">${escapeHtml(selectedText)}</div>
    <div class="wh-result-main">${escapeHtml(result.translation || result.meaningInContext || '')}</div>
  `;
}

function showDeepSeekError(x, y, selectedText, error) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--deepseek';
  cardRoot.style.setProperty('--wh-gradient', 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)');
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;
  cardRoot.innerHTML = `
    <div class="wh-title">翻译失败</div>
    <div class="wh-selected-text">${escapeHtml(selectedText)}</div>
    <div class="wh-result-row"><p>${escapeHtml(formatTranslateError(error))}</p></div>
  `;
  document.body.appendChild(cardRoot);
  attachAutoDismissCard(cardRoot);
}

function attachAutoDismissCard(card) {
  if (!card) return;
  card.addEventListener('mouseenter', () => {
    window.clearTimeout(cardDismissTimer);
    cardDismissTimer = null;
  });
  card.addEventListener('mouseleave', () => {
    window.clearTimeout(cardDismissTimer);
    cardDismissTimer = window.setTimeout(() => {
      if (cardRoot === card) removeCard();
    }, 220);
  });
}

function formatTranslateError(error) {
  if (error === 'DEEPSEEK_API_KEY_MISSING') return '请先在扩展设置页填写 DeepSeek API Key。';
  if (String(error).startsWith('DEEPSEEK_REQUEST_FAILED')) return 'DeepSeek 请求失败，请检查 API Key、网络或额度。';
  return String(error || '未知错误');
}

function showCard(x, y, word, translation, queryStats, inWordBook) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card';
  // 随机渐变主题（iOS 18 风格）
  cardRoot.style.setProperty('--wh-gradient', pickGradient());
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;
  
  // 格式化查询次数显示
  const queryCount = queryStats?.count || 0;
  const lastQueried = queryStats?.lastQueried ? new Date(queryStats.lastQueried).toLocaleString() : '从未查询';
  
  // 根据单词是否在单词本中显示不同的按钮
  const actionButtons = inWordBook 
    ? `<button id="wh-familiar" class="wh-familiar-btn">熟悉</button>`
    : `<button id="wh-fav">收藏</button>`;
  
  const isPhrase = /\s/.test(word);
  const typeTag = isPhrase ? `<span class="wh-type-tag">短语</span>` : '';
  const phoneticHtml = !isPhrase && translation?.phonetic
    ? `<div class="wh-phonetic">${escapeHtml(translation.phonetic)}</div>` : '';

  const explains = translation?.explains || [];
  const chineseEntry = explains[0] || '';
  const dictEntries = explains.slice(1);
  const chineseHtml = chineseEntry
    ? `<div class="wh-zh-translation">${escapeHtml(chineseEntry)}</div>` : '';
  const dictHtml = dictEntries.length
    ? `<ul class="wh-explains">${dictEntries.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : '';

  cardRoot.innerHTML = `
    <div class="wh-title">
      ${escapeHtml(word)}${typeTag}
      <button id="wh-speak" class="wh-speak-btn" title="朗读">🔊</button>
    </div>
    <div class="wh-query-stats">查询次数: ${queryCount} 次</div>
    ${phoneticHtml}
    ${chineseHtml}
    ${dictHtml}
    <div class="wh-actions">
      ${actionButtons}
    </div>
  `;
  document.body.appendChild(cardRoot);

  document.getElementById('wh-speak')?.addEventListener('click', (e) => {
    e.stopPropagation();
    speak(word);
  });

  if (inWordBook) {
    // 熟悉按钮事件处理
    document.getElementById('wh-familiar').addEventListener('click', async () => {
      const button = document.getElementById('wh-familiar');
      const originalText = button.textContent;
      
      // 显示加载状态
      button.textContent = '删除中...';
      button.disabled = true;
      
      try {
        const { ok, data } = await chrome.runtime.sendMessage({ 
          type: 'REMOVE_FROM_WORD_BOOK', 
          payload: { word } 
        });
        
        if (ok && data.success) {
          button.textContent = '已删除';
          button.style.background = 'rgba(231, 76, 60, 0.8)';
          
          // 2秒后关闭卡片
          setTimeout(() => {
            removeCard();
            // 触发一次高亮刷新
            highlightWordsOnPage();
          }, 2000);
        } else {
          button.textContent = '删除失败';
          button.style.background = 'rgba(231, 76, 60, 0.8)';
          button.disabled = false;
          
          // 3秒后恢复原状
          setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
          }, 3000);
        }
      } catch (error) {
        console.error('删除单词失败:', error);
        button.textContent = '删除失败';
        button.style.background = 'rgba(231, 76, 60, 0.8)';
        button.disabled = false;
        
        // 3秒后恢复原状
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '';
        }, 3000);
      }
    });
  } else {
    // 收藏按钮事件处理
    document.getElementById('wh-fav').addEventListener('click', async () => {
      const button = document.getElementById('wh-fav');
      const originalText = button.textContent;
      
      // 显示加载状态
      button.textContent = '收藏中...';
      button.disabled = true;
      
      try {
        const { ok } = await chrome.runtime.sendMessage({ 
          type: 'ADD_TO_WORD_BOOK', 
          payload: { word, translation } 
        });
        
        if (ok) {
          button.textContent = '已收藏';
          button.style.background = 'rgba(46, 204, 113, 0.8)';
          
          // 2秒后关闭卡片
          setTimeout(() => {
            removeCard();
            // 触发一次高亮刷新
            highlightWordsOnPage();
          }, 2000);
        } else {
          button.textContent = '收藏失败';
          button.style.background = 'rgba(231, 76, 60, 0.8)';
          button.disabled = false;
          
          // 3秒后恢复原状
          setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
          }, 3000);
        }
      } catch (error) {
        console.error('收藏失败:', error);
        button.textContent = '收藏失败';
        button.style.background = 'rgba(231, 76, 60, 0.8)';
        button.disabled = false;
        
        // 3秒后恢复原状
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '';
        }, 3000);
      }
    });
  }
}

function removeCard() {
  if (!cardRoot) return;
  window.clearTimeout(cardDismissTimer);
  cardDismissTimer = null;
  const el = cardRoot;
  cardRoot = null;
  el.classList.add('dismissing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

// 高亮逻辑：基于简单文本替换，尽量避免在输入框等元素内处理
const HIGHLIGHT_CLASS = 'word-helper-highlight';

async function highlightWordsOnPage() {
  clearWordHighlights();
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_WORD_BOOK' });
  if (!ok) return;
  const words = Object.keys(data || {});
  if (!words.length) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement?.closest?.(`.${HIGHLIGHT_CLASS}, .word-helper-card, .word-helper-trigger, .wh-immersive-block`)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  // 长短语排在前面，防止短词优先匹配
  const sortedWords = [...words].sort((a, b) => b.length - a.length);
  const regex = new RegExp(`\\b(${sortedWords.map(w => escapeRegex(w)).join('|')})\\b`, 'gi');
  const toReplace = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (regex.test(node.nodeValue)) {
      toReplace.push(node);
    }
  }

  for (const textNode of toReplace) {
    const span = document.createElement('span');
    span.innerHTML = textNode.nodeValue.replace(regex, m => `<mark class="${HIGHLIGHT_CLASS}">${m}</mark>`);
    textNode.parentNode.replaceChild(span, textNode);
  }
}

function clearWordHighlights() {
  document.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).forEach(mark => {
    const text = document.createTextNode(mark.textContent || '');
    mark.replaceWith(text);
    text.parentNode?.normalize?.();
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 初始高亮
highlightWordsOnPage();

// ── 沉浸式翻译引擎 ──
const PARA_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
const IMMERSIVE_ATTR = 'data-wh-translated';
const IMMERSIVE_CLASS = 'wh-immersive-block';
const MAX_CONCURRENT = 3;

let immersiveEnabled = false;
let wordBookSet = new Set();   // 单词本中的词（小写），跳过翻译
let translateQueue = [];
let activeRequests = 0;
let iObserver = null;   // IntersectionObserver
let mObserver = null;   // MutationObserver

async function refreshWordBookSet() {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_WORD_BOOK' });
  if (ok) wordBookSet = new Set(Object.keys(data || {}).map(w => w.toLowerCase().trim()));
}

function shouldSkip(el) {
  // 已处理过
  if (el.hasAttribute(IMMERSIVE_ATTR)) return true;
  // 本身是翻译块
  if (el.classList.contains(IMMERSIVE_CLASS)) return true;
  // 在代码/脚本/导航等区域内
  if (el.closest('nav, code, pre, script, style, noscript, [contenteditable], .word-helper-card')) return true;
  const text = el.textContent.trim();
  // 太短
  if (!text || text.length < 15) return true;
  // 全文翻译只处理英文为主的内容
  if (!isMostlyEnglishText(text)) return true;
  // 整段内容就是单词本中的某个词（高亮展示即可，无需翻译）
  if (wordBookSet.has(text.toLowerCase())) return true;
  return false;
}

function isMostlyEnglishText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]{2,}/.test(normalized)) return false;
  const englishChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const cjkChars = (normalized.match(/[\u3400-\u9FFF]/g) || []).length;
  return englishChars >= 12 && englishChars > cjkChars * 2;
}

function enqueue(el) {
  if (shouldSkip(el) || translateQueue.includes(el)) return;
  el.setAttribute(IMMERSIVE_ATTR, 'pending');
  translateQueue.push(el);
  drain();
}

function drain() {
  while (activeRequests < MAX_CONCURRENT && translateQueue.length > 0) {
    const el = translateQueue.shift();
    if (!el.isConnected || el.getAttribute(IMMERSIVE_ATTR) !== 'pending') continue;
    activeRequests++;
    translateEl(el).finally(() => { activeRequests--; drain(); });
  }
}

async function translateEl(el) {
  const text = el.textContent.trim();
  if (!text || text.length < 15) { el.removeAttribute(IMMERSIVE_ATTR); return; }

  // 插入加载占位
  const loading = document.createElement('div');
  loading.className = `${IMMERSIVE_CLASS} ${IMMERSIVE_CLASS}--loading`;
  loading.textContent = '翻译中…';
  el.after(loading);

  try {
    const sentenceBundle = extractSentenceBundle(text, text);
    const { ok, data } = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_PARAGRAPH',
      payload: {
        text,
        context: {
          before: sentenceBundle.before,
          after: sentenceBundle.after
        }
      }
    });
    loading.remove();
    if (ok && data?.translation) {
      el.setAttribute(IMMERSIVE_ATTR, 'done');
      const block = document.createElement('div');
      block.className = IMMERSIVE_CLASS;
      block.textContent = data.translation;
      el.after(block);
    } else {
      el.removeAttribute(IMMERSIVE_ATTR);
    }
  } catch (_) {
    loading.remove();
    el.removeAttribute(IMMERSIVE_ATTR);
  }
}

function startImmersive() {
  immersiveEnabled = true;

  // 视口内优先翻译，向下预加载 300px
  iObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        iObserver.unobserve(entry.target);
        enqueue(entry.target);
      }
    }
  }, { rootMargin: '0px 0px 300px 0px' });

  document.querySelectorAll(PARA_SELECTORS).forEach(el => {
    if (!shouldSkip(el)) iObserver.observe(el);
  });

  // 监听动态新增段落（SPA 等）
  mObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(PARA_SELECTORS)) { iObserver.observe(node); }
        node.querySelectorAll?.(PARA_SELECTORS).forEach(el => iObserver.observe(el));
      }
    }
  });
  mObserver.observe(document.body, { childList: true, subtree: true });
}

function stopImmersive() {
  immersiveEnabled = false;
  translateQueue = [];
  iObserver?.disconnect(); iObserver = null;
  mObserver?.disconnect(); mObserver = null;
  document.querySelectorAll(`.${IMMERSIVE_CLASS}`).forEach(el => el.remove());
  document.querySelectorAll(`[${IMMERSIVE_ATTR}]`).forEach(el => el.removeAttribute(IMMERSIVE_ATTR));
}

// 监听 popup 发来的开关指令
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_IMMERSIVE') {
    if (message.payload.enabled) {
      refreshWordBookSet().then(startImmersive);
    } else {
      stopImmersive();
    }
  }
});

// 页面加载时检查是否已开启沉浸翻译
(async () => {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (ok && data?.immersiveTranslation) {
    await refreshWordBookSet();
    startImmersive();
  }
})();

// 渐变主题集合 & 选择器
const GRADIENTS = [
  'linear-gradient(135deg, #7F7FD5 0%, #86A8E7 50%, #91EAE4 100%)',
  'linear-gradient(135deg, #FAD961 0%, #F76B1C 100%)',
  'linear-gradient(135deg, #A1FFCE 0%, #FAFFD1 100%)',
  'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 99%, #FAD0C4 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #FDEB71 0%, #F8D800 100%)',
  'linear-gradient(135deg, #B2FEFA 0%, #0ED2F7 100%)',
  'linear-gradient(135deg, #C3CFE2 0%, #E2EAFC 100%)'
];

function pickGradient() {
  const idx = Math.floor(Math.random() * GRADIENTS.length);
  return GRADIENTS[idx];
}

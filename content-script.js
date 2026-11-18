// 内容脚本：
// 1) 监听页面划词
// 2) 展示翻译卡片（含朗读按钮）
// 3) 点击收藏到单词本
// 4) 根据单词本对页面高亮（简单基于文本节点替换，避免重排）
// 5) 沉浸式段落翻译（手动开启，DeepL，跳过单词本中的单词）

// ── 通过扩展后台调用 chrome.tts 朗读英文 ──
async function speak(text) {
  const value = String(text || '').trim();
  if (!value) return;

  const response = await chrome.runtime.sendMessage({
    type: 'SPEAK_TEXT',
    payload: { text: value }
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'TTS_PLAYBACK_FAILED');
  }
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
  showTranslationLoading(selectionInfo.x, selectionInfo.y, selectedText, mode);

  try {
    const context = mode === 'term'
      ? buildTermContext(selectionInfo)
      : buildSentenceContext(selectionInfo);
    const response = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_SELECTION',
      payload: {
        mode,
        selectedText,
        context
      }
    });

    if (response?.ok) {
      await showTranslationResult(selectionInfo.x, selectionInfo.y, selectedText, mode, response.data?.result);
    } else {
      showTranslationError(selectionInfo.x, selectionInfo.y, selectedText, response?.error || 'TRANSLATION_FAILED');
    }
  } catch (error) {
    showTranslationError(selectionInfo.x, selectionInfo.y, selectedText, error?.message || 'TRANSLATION_FAILED');
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
  const block = element?.closest?.(`${SEMANTIC_TEXT_SELECTORS}, article, section, main, div`) || document.body;
  if (!block) return '';
  if (!block.querySelector(`.${IMMERSIVE_CLASS}`)) return block.textContent.replace(/\s+/g, ' ').trim();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) => text.parentElement.closest(`.${IMMERSIVE_CLASS}`)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const parts = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join('').replace(/\s+/g, ' ').trim();
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

function showTranslationLoading(x, y, selectedText, mode) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--translation';
  applyRandomCardTheme(cardRoot);
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;
  cardRoot.innerHTML = `
    <div class="wh-title">${escapeHtml(mode === 'term' ? '词义解析' : '句段翻译')}</div>
    <div class="wh-selected-text">${escapeHtml(selectedText)}</div>
    <div class="wh-loading">千问翻译中...</div>
  `;
  document.body.appendChild(cardRoot);
}

async function showTranslationResult(x, y, selectedText, mode, result) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--translation';
  applyRandomCardTheme(cardRoot);
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
    bindTranslationTermActions(selectedText, result || {}, inWordBook);
  }
  attachAutoDismissCard(cardRoot);
}

function buildTermResultHtml(selectedText, result, queryStats, inWordBook) {
  const queryCount = queryStats?.count || 0;

  return `
    <div class="wh-title">
      ${escapeHtml(selectedText)}
      ${buildSpeakButton('wh-translation-speak')}
      <span class="wh-type-tag">词/短语</span>
      ${buildHeartButton('wh-translation-heart', inWordBook)}
    </div>
    <div class="wh-query-stats">查询次数: ${queryCount} 次</div>
    <div class="wh-result-main">${escapeHtml(result.meaningInContext || result.translation || '')}</div>
    <div class="wh-result-row"><span>句中含义</span><p>${escapeHtml(result.explanation || result.meaningInContext || '')}</p></div>
    ${result.partOfSpeech ? `<div class="wh-result-row"><span>词性</span><p>${escapeHtml(result.partOfSpeech)}</p></div>` : ''}
  `;
}

function bindTranslationTermActions(word, result, inWordBook) {
  bindSpeakButton('wh-translation-speak', word);
  bindWordBookHeart(
    'wh-translation-heart',
    word,
    buildTranslationWordBookEntry(result),
    inWordBook
  );
}

function buildTranslationWordBookEntry(result) {
  return {
    meaning: result.meaningInContext || result.translation || '暂无释义',
    partOfSpeech: result.partOfSpeech || ''
  };
}

function buildSentenceResultHtml(selectedText, result) {
  return `
    <div class="wh-title">句段翻译</div>
    <div class="wh-selected-text">${escapeHtml(selectedText)}</div>
    <div class="wh-result-main">${escapeHtml(result.translation || result.meaningInContext || '')}</div>
  `;
}

function showTranslationError(x, y, selectedText, error) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card word-helper-card--translation';
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
  if (error === 'QWEN_API_KEY_MISSING') return '请先在扩展设置页填写百炼 API Key。';
  if (String(error).startsWith('QWEN_REQUEST_FAILED')) return '千问请求失败，请检查 API Key、模型、网络或额度。';
  if (error === 'QWEN_INVALID_TRANSLATION' || error === 'QWEN_EMPTY_RESPONSE') return '千问没有返回有效译文，请重试。';
  return String(error || '未知错误');
}

function showCard(x, y, word, translation, queryStats, inWordBook) {
  removeCard();
  cardRoot = document.createElement('div');
  cardRoot.className = 'word-helper-card';
  // 随机渐变主题（iOS 18 风格）
  applyRandomCardTheme(cardRoot);
  cardRoot.style.left = `${x + 10}px`;
  cardRoot.style.top = `${y + 10}px`;
  
  // 格式化查询次数显示
  const queryCount = queryStats?.count || 0;

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
      <span class="wh-title-actions">
        ${buildSpeakButton('wh-speak')}
        ${buildHeartButton('wh-heart', inWordBook)}
      </span>
    </div>
    <div class="wh-query-stats">查询次数: ${queryCount} 次</div>
    ${phoneticHtml}
    ${chineseHtml}
    ${dictHtml}
  `;
  document.body.appendChild(cardRoot);

  bindSpeakButton('wh-speak', word);

  bindWordBookHeart('wh-heart', word, {
    meaning: translation?.meaning || translation?.explains?.[0] || '暂无释义',
    partOfSpeech: translation?.partOfSpeech || ''
  }, inWordBook);
}

function buildSpeakButton(id) {
  return `<button
    id="${id}"
    class="wh-speak-btn"
    type="button"
    aria-label="播放发音"
    title="播放发音"
  ><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.32a3.5 3.5 0 0 0 2-3.16zm-2-7.53v2.06a6 6 0 0 1 0 10.94v2.06a8 8 0 0 0 0-15.06z"/></svg></button>`;
}

function bindSpeakButton(buttonId, text) {
  document.getElementById(buttonId)?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;

    try {
      await speak(text);
    } catch (error) {
      console.error('播放单词发音失败:', error);
      button.classList.add('is-error');
      window.setTimeout(() => button.classList.remove('is-error'), 700);
    } finally {
      button.disabled = false;
    }
  });
}

function buildHeartButton(id, inWordBook) {
  const activeClass = inWordBook ? ' is-active' : '';
  const title = inWordBook ? '已收藏，点击标记为熟悉' : '收藏单词';
  return `<button
    id="${id}"
    class="wh-heart-btn${activeClass}"
    type="button"
    aria-label="${title}"
    aria-pressed="${inWordBook ? 'true' : 'false'}"
    title="${title}"
  >♥</button>`;
}

function updateHeartButton(button, active) {
  const title = active ? '已收藏，点击标记为熟悉' : '收藏单词';
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', title);
  button.title = title;
}

function bindWordBookHeart(buttonId, word, entry, initiallyInWordBook) {
  let inWordBook = initiallyInWordBook;

  document.getElementById(buttonId)?.addEventListener('click', async () => {
    const button = document.getElementById(buttonId);
    if (button.classList.contains('is-loading')) return;
    button.classList.add('is-loading');
    button.disabled = true;

    try {
      const response = inWordBook
        ? await chrome.runtime.sendMessage({
            type: 'REMOVE_FROM_WORD_BOOK',
            payload: { word }
          })
        : await chrome.runtime.sendMessage({
            type: 'ADD_TO_WORD_BOOK',
            payload: { word, entry }
          });
      const succeeded = inWordBook
        ? response?.ok && response?.data?.success
        : response?.ok;
      if (!succeeded) throw new Error('WORD_BOOK_UPDATE_FAILED');

      inWordBook = !inWordBook;
      updateHeartButton(button, inWordBook);
      button.classList.add('is-just-toggled');
      setTimeout(() => button.classList.remove('is-just-toggled'), 420);
      highlightWordsOnPage();
    } catch (error) {
      console.error('更新单词收藏状态失败:', error);
      button.classList.add('is-error');
      setTimeout(() => button.classList.remove('is-error'), 700);
    } finally {
      button.classList.remove('is-loading');
      button.disabled = false;
    }
  });
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
const HEADING_SELECTORS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const SEMANTIC_TEXT_SELECTORS = `p, ${HEADING_SELECTORS}, li, blockquote, dt, dd, figcaption, caption, th, td, [role="cell"], [role="columnheader"], [role="rowheader"]`;
const PARA_SELECTORS = `${SEMANTIC_TEXT_SELECTORS}, main, article, section, div, span, [role="paragraph"]`;
const IMMERSIVE_CLASS = 'wh-immersive-block';
const IMMERSIVE_UI = `.${IMMERSIVE_CLASS}, .word-helper-card, .word-helper-trigger`;
const IMMERSIVE_EXCLUDED = `${IMMERSIVE_UI}, nav, footer, body > header, [role="navigation"], [role="banner"], [role="contentinfo"], form, button, input, textarea, select, option, [role="button"], pre, script, style, noscript, template, svg, [hidden], [aria-hidden="true"], [contenteditable]:not([contenteditable="false"]), [translate="no"]`;
const IMMERSIVE_BOUNDARIES = `${SEMANTIC_TEXT_SELECTORS}, address, article, aside, details, dl, figure, main, ol, section, table, ul, [role="paragraph"]`;
const PRIMARY_CONTENT = 'main, article, [role="main"]';
const MAX_CONCURRENT = 3;

let immersiveEnabled = false;
let immersivePageKey = '';
let immersiveSessionId = 0;
let wordBookSet = new Set();   // 单词本中的词（小写），跳过翻译
let translateQueue = [];
let activeRequests = 0;
let immersiveWork = new WeakMap();
let iObserver = null;   // IntersectionObserver
let mObserver = null;   // MutationObserver

async function refreshWordBookSet() {
  const { ok, data } = await chrome.runtime.sendMessage({ type: 'GET_WORD_BOOK' });
  if (ok) wordBookSet = new Set(Object.keys(data || {}).map(w => w.toLowerCase().trim()));
}

function getImmersiveSource(el) {
  if (!el.isConnected || !el.matches(PARA_SELECTORS) || el.closest(IMMERSIVE_EXCLUDED) || el.closest('code')) return '';
  const { display, visibility } = window.getComputedStyle(el);
  if (display === 'none' || visibility !== 'visible') return '';
  if (!el.matches(`${SEMANTIC_TEXT_SELECTORS}, [role="paragraph"]`) &&
      !['block', 'flow-root', 'list-item'].includes(display)) return '';

  // Inline markup belongs to its text block; nested blocks are translated independently.
  const parts = [];
  function read(container) {
    for (const child of container.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.nodeValue);
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.matches(IMMERSIVE_EXCLUDED)) {
        if (el.tagName === 'LI' && child.matches('ol, ul')) continue;
        const style = window.getComputedStyle(child);
        if (style.display === 'none' || style.visibility !== 'visible') continue;
        if (child.matches(IMMERSIVE_BOUNDARIES) ||
            (!['contents', 'inline', 'ruby'].includes(style.display) && !style.display.startsWith('inline'))) return false;
        if (child.tagName === 'BR') parts.push('\n');
        else if (!read(child)) return false;
      }
    }
    return true;
  }
  if (!read(el)) return '';
  const text = parts.join('').replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  return isMostlyEnglishText(text) && !wordBookSet.has(text.toLowerCase()) ? text : '';
}

function isMostlyEnglishText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]{2,}/.test(normalized)) return false;
  const englishChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const cjkChars = (normalized.match(/[\u3400-\u9FFF]/g) || []).length;
  return englishChars >= 3 && englishChars > cjkChars * 2;
}

function observeImmersiveSource(el) {
  const text = getImmersiveSource(el);
  const work = immersiveWork.get(el);
  if (work && work.text === text && (!work.block || work.block.parentElement === el)) return;
  if (work) {
    work.block?.remove();
    immersiveWork.delete(el);
  }
  if (text) iObserver.observe(el);
  else iObserver.unobserve(el);
}

function enqueue(el) {
  if (immersiveWork.has(el)) return;
  const text = getImmersiveSource(el);
  if (!text) return;
  const work = { el, text, sessionId: immersiveSessionId, block: null };
  immersiveWork.set(el, work);
  translateQueue.push(work);
  drain();
}

function isCurrentImmersiveWork(work) {
  return immersiveEnabled && work.sessionId === immersiveSessionId && work.el.isConnected &&
    immersiveWork.get(work.el) === work && getImmersivePageKey() === immersivePageKey;
}

function drain() {
  while (activeRequests < MAX_CONCURRENT && translateQueue.length > 0) {
    const work = translateQueue.shift();
    if (!isCurrentImmersiveWork(work)) continue;
    activeRequests++;
    translateEl(work).finally(() => { activeRequests--; drain(); });
  }
}

function showImmersiveLoading(work) {
  const { el } = work;
  const loading = document.createElement('span');
  loading.className = `${IMMERSIVE_CLASS} ${IMMERSIVE_CLASS}--loading`;
  if (el.matches(HEADING_SELECTORS)) loading.classList.add(`${IMMERSIVE_CLASS}--heading`);
  loading.textContent = '翻译中…';
  work.block = loading;
  const nestedList = el.tagName === 'LI'
    ? [...el.children].find(child => child.matches('ol, ul'))
    : null;
  el.insertBefore(loading, nestedList || null);
}

async function translateEl(work) {
  showImmersiveLoading(work);
  let translation = '';
  try {
    const { ok, data } = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_PARAGRAPH',
      payload: { text: work.text, context: {} }
    });
    if (ok) translation = data?.translation;
  } catch (_) {
    // Other paragraphs continue when a request fails.
  }
  finishImmersiveWork(work, translation);
}

function finishImmersiveWork(work, translation, error) {
  const { el, text, block: loading } = work;
  if (!isCurrentImmersiveWork(work) || getImmersiveSource(el) !== text) {
    loading.remove();
    if (isCurrentImmersiveWork(work)) observeImmersiveSource(el);
    return;
  }
  if (translation) {
    loading.textContent = translation;
    loading.classList.remove(`${IMMERSIVE_CLASS}--loading`);
  } else {
    loading.remove();
    immersiveWork.delete(el);
  }
}

function startImmersive() {
  const pageKey = getImmersivePageKey();
  if (immersiveEnabled && immersivePageKey === pageKey) return;
  if (immersiveEnabled) stopImmersive();
  immersiveEnabled = true;
  immersivePageKey = pageKey;
  immersiveSessionId++;

  // 视口内优先翻译，向下预加载 300px
  iObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        iObserver.unobserve(entry.target);
        enqueue(entry.target);
      }
    }
  }, { rootMargin: '0px 0px 300px 0px' });

  const other = [];
  document.body.querySelectorAll(PARA_SELECTORS).forEach(el => {
    if (el.closest(PRIMARY_CONTENT)) observeImmersiveSource(el);
    else other.push(el);
  });
  other.forEach(observeImmersiveSource);

  mObserver = new MutationObserver((mutations) => {
    if (getImmersivePageKey() !== immersivePageKey) {
      stopImmersive();
      return;
    }
    const changed = new Set();
    function collectSubtree(el) {
      if (el.nodeType !== Node.ELEMENT_NODE || el.matches(IMMERSIVE_UI)) return;
      changed.add(el);
      el.querySelectorAll(PARA_SELECTORS).forEach(node => changed.add(node));
    }
    for (const mutation of mutations) {
      const { target, addedNodes, removedNodes } = mutation;
      const el = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      if (!el || el.closest(IMMERSIVE_UI)) continue;
      if (mutation.type === 'childList') {
        if ([...addedNodes, ...removedNodes].every(node => node.matches?.(IMMERSIVE_UI))) continue;
        addedNodes.forEach(collectSubtree);
        removedNodes.forEach(node => {
          if (!node.isConnected) collectSubtree(node);
        });
      } else if (mutation.type === 'attributes') {
        collectSubtree(el);
      }
      for (let parent = el; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.matches(PARA_SELECTORS) || immersiveWork.has(parent)) changed.add(parent);
      }
    }
    changed.forEach(observeImmersiveSource);
  });
  mObserver.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'contenteditable', 'translate']
  });
}

function stopImmersive() {
  immersiveEnabled = false;
  immersivePageKey = '';
  immersiveSessionId++;
  translateQueue = [];
  immersiveWork = new WeakMap();
  drainTimer = null;
  iObserver?.disconnect(); iObserver = null;
  mObserver?.disconnect(); mObserver = null;
  document.querySelectorAll(`.${IMMERSIVE_CLASS}`).forEach(el => el.remove());
}

function getImmersivePageKey() {
  return `${location.origin}${location.pathname}${location.search}`;
}

window.addEventListener('popstate', () => {
  if (immersiveEnabled && getImmersivePageKey() !== immersivePageKey) stopImmersive();
});

// 监听 popup 发来的开关指令
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_IMMERSIVE_STATE') {
    if (immersiveEnabled && getImmersivePageKey() !== immersivePageKey) stopImmersive();
    sendResponse({ ok: true, data: { enabled: immersiveEnabled } });
    return;
  }

  if (message.type !== 'TOGGLE_IMMERSIVE') return;

  if (!message.payload?.enabled) {
    stopImmersive();
    sendResponse({ ok: true, data: { enabled: false } });
    return;
  }

  refreshWordBookSet()
    .then(() => {
      startImmersive();
      sendResponse({ ok: true, data: { enabled: true } });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'IMMERSIVE_START_FAILED' });
    });
  return true;
});

// 卡片渐变主题：经典渐变、混合渐变和高饱和彩虹渐变
const CARD_THEMES = [
  { tone: 'dark', background: 'linear-gradient(135deg, #5b5bd6 0%, #648de5 48%, #3296ad 100%)' },
  { tone: 'light', background: 'linear-gradient(135deg, #ff7582 0%, #ff9d68 48%, #ffd166 100%)' },
  { tone: 'dark', background: 'linear-gradient(135deg, #087f75 0%, #15977a 46%, #2da562 100%)' },
  { tone: 'dark', background: 'linear-gradient(135deg, #8e44ad 0%, #b44ac0 46%, #d9547c 100%)' },
  { tone: 'dark', background: 'linear-gradient(145deg, #111b3f 0%, #244c91 52%, #287ca9 100%)' },
  { tone: 'dark', background: 'linear-gradient(135deg, #6d2fa0 0%, #9b3f9c 50%, #c44770 100%)' },
  { tone: 'dark', background: 'linear-gradient(135deg, #3b4371 0%, #5d4d9c 48%, #c96f79 100%)' },
  { tone: 'dark', background: 'linear-gradient(135deg, #005c97 0%, #2474b5 50%, #318db8 100%)' },
  { tone: 'light', background: 'linear-gradient(135deg, #d9f99d 0%, #6ee7b7 50%, #67e8f9 100%)' },
  { tone: 'light', background: 'linear-gradient(135deg, #fde68a 0%, #fda4af 50%, #c4b5fd 100%)' },
  { tone: 'light', background: 'linear-gradient(135deg, #bae6fd 0%, #a7f3d0 52%, #e0e7ff 100%)' },
  { tone: 'light', background: 'linear-gradient(135deg, #fbcfe8 0%, #ddd6fe 48%, #bae6fd 100%)' },

  // 混合渐变：多层径向色彩叠加在线性底色上
  { tone: 'dark', background: 'radial-gradient(circle at 12% 18%, rgba(255, 82, 145, .96) 0%, transparent 38%), radial-gradient(circle at 88% 16%, rgba(67, 203, 255, .92) 0%, transparent 40%), radial-gradient(circle at 65% 92%, rgba(120, 78, 255, .9) 0%, transparent 46%), linear-gradient(145deg, #512da8 0%, #172554 100%)' },
  { tone: 'dark', background: 'radial-gradient(circle at 18% 12%, rgba(255, 193, 87, .88) 0%, transparent 34%), radial-gradient(circle at 85% 22%, rgba(255, 88, 128, .9) 0%, transparent 42%), radial-gradient(circle at 56% 100%, rgba(124, 58, 237, .92) 0%, transparent 48%), linear-gradient(140deg, #a82c74 0%, #4c1d95 100%)' },
  { tone: 'dark', background: 'radial-gradient(circle at 10% 80%, rgba(52, 211, 153, .92) 0%, transparent 40%), radial-gradient(circle at 92% 15%, rgba(34, 211, 238, .84) 0%, transparent 42%), linear-gradient(135deg, #12345b 0%, #0f766e 52%, #115e59 100%)' },
  { tone: 'dark', background: 'radial-gradient(circle at 16% 18%, rgba(251, 113, 133, .86) 0%, transparent 36%), radial-gradient(circle at 86% 78%, rgba(96, 165, 250, .86) 0%, transparent 44%), linear-gradient(135deg, #4338ca 0%, #7e22ce 48%, #9f1239 100%)' },
  { tone: 'dark', background: 'radial-gradient(circle at 86% 8%, rgba(253, 196, 71, .78) 0%, transparent 34%), radial-gradient(circle at 12% 88%, rgba(45, 212, 191, .82) 0%, transparent 44%), linear-gradient(135deg, #0f766e 0%, #2563eb 52%, #4338ca 100%)' },

  // 彩虹主题：保留深色底层，确保白色文字在各色段都清晰
  { tone: 'dark', background: 'linear-gradient(rgba(15,23,42,.18), rgba(15,23,42,.18)), linear-gradient(118deg, #e32850 0%, #d96600 18%, #ad8700 34%, #168254 51%, #0874c4 69%, #5149bd 84%, #9b3fc4 100%)' },
  { tone: 'dark', background: 'linear-gradient(rgba(15,23,42,.2), rgba(15,23,42,.2)), radial-gradient(circle at 18% 18%, rgba(255,255,255,.22) 0%, transparent 25%), conic-gradient(from 215deg at 68% 32%, #e72e54 0deg, #dd8500 56deg, #20a54b 116deg, #0876d0 185deg, #504ec4 245deg, #aa43d4 305deg, #e72e54 360deg)' },
  { tone: 'dark', background: 'linear-gradient(rgba(15,23,42,.16), rgba(15,23,42,.16)), radial-gradient(circle at 50% 115%, rgba(255,255,255,.16) 0%, transparent 42%), linear-gradient(110deg, #cf344d 0%, #d2711c 20%, #987f00 36%, #137b5b 52%, #126eaa 68%, #514ab0 84%, #91339c 100%)' }
];

function pickGradient() {
  const idx = Math.floor(Math.random() * CARD_THEMES.length);
  return CARD_THEMES[idx];
}

function applyRandomCardTheme(card) {
  const theme = pickGradient();
  card.style.setProperty('--wh-gradient', theme.background);
  card.dataset.whTone = theme.tone;
}

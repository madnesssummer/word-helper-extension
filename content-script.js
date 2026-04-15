// 内容脚本：
// 1) 监听页面划词
// 2) 展示翻译卡片
// 3) 点击收藏到单词本
// 4) 根据单词本对页面高亮（简单基于文本节点替换，避免重排）

let cardRoot = null;
let lastSelectionText = '';

document.addEventListener('mouseup', async (e) => {
  const text = window.getSelection()?.toString()?.trim();
  // 支持单词和短语，最长100字符；纯空白或过长则忽略
  if (!text || text.length > 100 || /^\s+$/.test(text)) {
    removeCard();
    return;
  }
  lastSelectionText = text;
  
  const { ok, data } = await chrome.runtime.sendMessage({
    type: 'LOOKUP_TRANSLATION',
    payload: { word: text, from: 'en', to: 'zh' }
  });
  
  if (ok) {
    // 翻译查询后获取最新的查询统计
    const { ok: statsOk, data: queryStats } = await chrome.runtime.sendMessage({
      type: 'GET_QUERY_STATS',
      payload: { word: text }
    });
    
    // 检查单词是否在单词本中
    const { ok: bookOk, data: bookData } = await chrome.runtime.sendMessage({
      type: 'CHECK_WORD_IN_BOOK',
      payload: { word: text }
    });
    
    const stats = statsOk ? queryStats : { count: 0, lastQueried: 0 };
    const inWordBook = bookOk ? bookData.inBook : false;
    showCard(e.clientX, e.clientY, text, data, stats, inWordBook);
  }
});

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
    <div class="wh-title">${escapeHtml(word)}${typeTag}</div>
    <div class="wh-query-stats">查询次数: ${queryCount} 次</div>
    ${phoneticHtml}
    ${chineseHtml}
    ${dictHtml}
    <div class="wh-actions">
      ${actionButtons}
    </div>
  `;
  document.body.appendChild(cardRoot);
  
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 初始高亮
highlightWordsOnPage();

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


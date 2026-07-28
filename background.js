// 背景脚本：管理存储、复习计划(记忆曲线)、高亮刷新

const STORAGE_KEYS = {
  WORD_BOOK: 'word_book',           // Map<string, WordItem>
  REVIEW_PROGRESS: 'review_progress', // Map<string, ReviewProgress>
  SETTINGS: 'settings',             // { highlight: boolean, language: string }
  QUERY_STATS: 'query_stats',       // Map<string, { count: number, lastQueried: number }>
  DAILY_STATS: 'daily_stats',       // Map<string, { date: string, words: string[], count: number }>
  ACTIVITY_STATS: 'activity_stats'  // Map<string, DailyActivity>
};

const CONTEXT_MENU_IDS = {
  TERM: 'word-helper-translate-term',
  SENTENCE: 'word-helper-translate-sentence'
};

// 记忆曲线复习间隔（毫秒）
const REVIEW_INTERVALS = [
  0,                    // 0: 立即（初次记录）
  60 * 60 * 1000,      // 2: 60分钟
  12 * 60 * 60 * 1000, // 3: 12小时
  24 * 60 * 60 * 1000, // 4: 1天
  3 * 24 * 60 * 60 * 1000,  // 5: 3天
  7 * 24 * 60 * 60 * 1000,  // 6: 7天
  14 * 24 * 60 * 60 * 1000, // 7: 14天
  30 * 24 * 60 * 60 * 1000  // 8: 30天（已掌握）
];

/**
 * WordItem 数据结构
 * @typedef {Object} WordItem
 * @property {string} word - 单词
 * @property {string} meaning - 单词含义
 * @property {string} partOfSpeech - 词性
 */

chrome.runtime.onInstalled.addListener(async () => {
  const { WORD_BOOK, REVIEW_PROGRESS, SETTINGS, QUERY_STATS, DAILY_STATS, ACTIVITY_STATS } = STORAGE_KEYS;
  const init = {};
  const { [WORD_BOOK]: wb } = await chrome.storage.local.get(WORD_BOOK);
  if (!wb) init[WORD_BOOK] = {};
  const { [REVIEW_PROGRESS]: rp } = await chrome.storage.local.get(REVIEW_PROGRESS);
  if (!rp) init[REVIEW_PROGRESS] = {};
  const { [SETTINGS]: s } = await chrome.storage.local.get(SETTINGS);
  if (!s) init[SETTINGS] = getDefaultSettings();
  const { [QUERY_STATS]: qs } = await chrome.storage.local.get(QUERY_STATS);
  if (!qs) init[QUERY_STATS] = {};
  const { [DAILY_STATS]: ds } = await chrome.storage.local.get(DAILY_STATS);
  if (!ds) init[DAILY_STATS] = {};
  const { [ACTIVITY_STATS]: activity } = await chrome.storage.local.get(ACTIVITY_STATS);
  if (!activity) init[ACTIVITY_STATS] = {};
  if (Object.keys(init).length) {
    await chrome.storage.local.set(init);
  }
  await migrateWordBook();
  // 配置每日复习提醒
  createTranslationContextMenus();
  chrome.alarms.create('dailyReview', { delayInMinutes: 1, periodInMinutes: 60 * 24 });
});

chrome.runtime.onStartup?.addListener(async () => {
  await migrateWordBook();
  createTranslationContextMenus();
});

function createTranslationContextMenus() {
  if (!chrome.contextMenus?.create) return;
  chrome.contextMenus.removeAll?.(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.TERM,
      title: '按单词/短语解析',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.SENTENCE,
      title: '按整句/整段翻译',
      contexts: ['selection']
    });
  });
}

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (!tab?.id) return;
  if (![CONTEXT_MENU_IDS.TERM, CONTEXT_MENU_IDS.SENTENCE].includes(info.menuItemId)) return;
  const mode = info.menuItemId === CONTEXT_MENU_IDS.TERM ? 'term' : 'sentence';
  chrome.tabs?.sendMessage?.(tab.id, {
    type: 'WH_CONTEXT_TRANSLATE',
    payload: {
      mode,
      selectedText: info.selectionText || ''
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReview') {
    // 可触发徽章或通知（简单示例）
    chrome.action.setBadgeText({ text: 'R' });
    chrome.action.setBadgeBackgroundColor({ color: '#f39c12' });
  }
});

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'LOOKUP_TRANSLATION': {
        // 记录查询统计
        await recordQueryStat(message.payload.word);
        await recordLearningActivity('query', message.payload.word);
        const result = await translate(message.payload.word, message.payload.from || 'en', message.payload.to || 'zh');
        sendResponse({ ok: true, data: result });
        return;
      }
      case 'GET_QUERY_STATS': {
        const data = await getQueryStats(message.payload.word);
        sendResponse({ ok: true, data });
        return;
      }
      case 'RECORD_QUERY_STAT': {
        await recordQueryStat(message.payload.word);
        await recordLearningActivity('query', message.payload.word);
        const data = await getQueryStats(message.payload.word);
        sendResponse({ ok: true, data });
        return;
      }
      case 'ADD_TO_WORD_BOOK': {
        const data = await addToWordBook(
          message.payload.word,
          message.payload.entry || message.payload.translation || message.payload
        );
        sendResponse({ ok: true, data });
        return;
      }
      case 'GET_WORD_BOOK': {
        const data = await getWordBook();
        sendResponse({ ok: true, data });
        return;
      }
      case 'REMOVE_FROM_WORD_BOOK': {
        const data = await removeFromWordBook(message.payload.word);
        sendResponse({ ok: true, data });
        return;
      }
      case 'CHECK_WORD_IN_BOOK': {
        const data = await checkWordInBook(message.payload.word);
        sendResponse({ ok: true, data });
        return;
      }
      case 'GET_WORDS_FOR_REVIEW': {
        // 从设置中获取每日复习单词数，如果没有设置则使用默认值5
        const settings = await getSettings();
        const limit = message.payload.limit || settings.dailyReviewCount || 5;
        const data = await getWordsForReview(limit);
        sendResponse({ ok: true, data });
        return;
      }
      case 'UPDATE_REVIEW_STATUS': {
        const data = await updateReviewStatus(message.payload.word, message.payload.isCorrect);
        sendResponse({ ok: true, data });
        return;
      }
      case 'GET_SETTINGS': {
        const data = await getSettings();
        sendResponse({ ok: true, data });
        return;
      }
      case 'UPDATE_SETTINGS': {
        await updateSettings(message.payload);
        sendResponse({ ok: true });
        return;
      }
      case 'GET_DAILY_STATS': {
        const data = await getDailyStats(message.payload?.startDate, message.payload?.endDate);
        sendResponse({ ok: true, data });
        return;
      }
      case 'GET_WEEKLY_SUMMARY': {
        const data = await getWeeklySummary();
        sendResponse({ ok: true, data });
        return;
      }
      case 'GENERATE_WEEKLY_REVIEW': {
        const summary = await getWeeklySummary();
        const review = await generateWeeklyReview(summary);
        sendResponse({ ok: true, data: { summary, review } });
        return;
      }
      case 'IMPORT_WORD_BOOK': {
        const data = await importWordBook(message.payload.words);
        sendResponse({ ok: true, data });
        return;
      }
      case 'EXPORT_WORD_BOOK': {
        const book = await getWordBook();
        const dailyStats = await getDailyStats();
        sendResponse({ ok: true, data: { words: book, dailyStats } });
        return;
      }
      case 'TRANSLATE_PARAGRAPH': {
        const data = await translateSelectionWithDeepSeek({
          mode: 'sentence',
          selectedText: message.payload.text,
          context: message.payload.context || {}
        });
        const translation = data?.result?.translation || data?.rawText || '';
        if (translation) {
          sendResponse({ ok: true, data: { translation } });
        } else {
          sendResponse({ ok: false, error: 'TRANSLATION_FAILED' });
        }
        return;
      }
      case 'TRANSLATE_SELECTION_DEEPSEEK': {
        const data = await translateSelectionWithDeepSeek(message.payload);
        sendResponse({ ok: true, data });
        return;
      }
      default:
        sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || 'UNKNOWN_ERROR' });
  });
  // 使用异步
  return true;
});

// ===================== 腾讯云机器翻译（TMT）集成 =====================
// 通过本地配置文件 config.local.json 读取密钥并完成签名请求
// 参考签名算法：TC3-HMAC-SHA256

const TENCENT_TMT_ENDPOINT = 'tmt.tencentcloudapi.com';
const TENCENT_TMT_ACTION = 'TextTranslate';
const TENCENT_TMT_VERSION = '2018-03-21';
const TENCENT_TMT_SERVICE = 'tmt';

let cachedLocalConfig = null;
const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

async function translate(word, from, to) {
  // 对单个英文词，并行查询词典 API 获取多重词义
  const isPhrase = /\s/.test(word.trim());
  const dictPromise = (!isPhrase && (from === 'en' || from === 'auto'))
    ? fetchDictionaryDefinitions(word.trim().toLowerCase())
    : Promise.resolve(null);

  // 加载本地配置（优先 config.local.json，其次 config.json）
  const cfg = await loadLocalConfig();
  const secretId = cfg?.tencentCloud?.secretId || '';
  const secretKey = cfg?.tencentCloud?.secretKey || '';
  const region = cfg?.tencentCloud?.region || 'ap-guangzhou';

  let chineseText = null;

  if (secretId && secretKey) {
    // TMT TextTranslate 请求体
    const payloadObj = {
      SourceText: String(word),
      Source: String(from || 'en'),
      Target: String(to || 'zh'),
      ProjectId: 0
    };
    const payload = JSON.stringify(payloadObj);

    // 时间与日期（UTC）
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    // 构造 Canonical Request
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_TMT_ENDPOINT}\n`;
    const signedHeaders = 'content-type;host';
    const hashedRequestPayload = await sha256Hex(payload);
    const canonicalRequest = [
      httpRequestMethod,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload
    ].join('\n');

    // 构造 String to Sign
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${TENCENT_TMT_SERVICE}/tc3_request`;
    const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
    const stringToSign = [
      algorithm,
      String(timestamp),
      credentialScope,
      hashedCanonicalRequest
    ].join('\n');

    // 计算签名
    const kDate = await hmacSha256Raw(`TC3${secretKey}`, date);
    const kService = await hmacSha256Raw(kDate, TENCENT_TMT_SERVICE);
    const kSigning = await hmacSha256Raw(kService, 'tc3_request');
    const signature = await hmacSha256Hex(kSigning, stringToSign);

    const authorization = `${algorithm} ` +
      `Credential=${secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': authorization,
      'X-TC-Action': TENCENT_TMT_ACTION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': TENCENT_TMT_VERSION,
      'X-TC-Region': region
    };

    try {
      const resp = await fetch(`https://${TENCENT_TMT_ENDPOINT}`, {
        method: 'POST',
        headers,
        body: payload
      });
      const json = await resp.json();
      const targetText = json?.Response?.TargetText;
      if (typeof targetText === 'string' && targetText.length) {
        chineseText = targetText;
      }
    } catch (_) { /* 网络或签名错误，忽略 */ }
  }

  // 等待词典结果
  const dictResult = await dictPromise;

  // 合并：中文释义在前，英文多义在后
  const explains = [];
  if (chineseText) explains.push(chineseText);
  if (dictResult?.explains?.length) explains.push(...dictResult.explains);
  if (!explains.length) explains.push(`${word} (${from}->${to})`);

  return {
    word,
    phonetic: dictResult?.phonetic || '',
    meaning: chineseText || dictResult?.explains?.[0] || `${word} (${from}->${to})`,
    partOfSpeech: dictResult?.partOfSpeech || '',
    explains
  };
}

// 查询 Free Dictionary API，返回多重词义（按词性分组）
async function fetchDictionaryDefinitions(word) {
  try {
    const resp = await fetch(
      `https://api.dictionarymapi.com/api/v2/entries/en/${encodeURIComponent(word)}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data) || !data.length) return null;

    const entry = data[0];
    const phonetic = entry.phonetic ||
      (entry.phonetics || []).find(p => p.text)?.text || '';

    const explains = [];
    const partsOfSpeech = [];
    for (const meaning of (entry.meanings || [])) {
      const pos = meaning.partOfSpeech || '';
      if (pos && !partsOfSpeech.includes(pos)) partsOfSpeech.push(pos);
      for (const def of (meaning.definitions || []).slice(0, 2)) {
        explains.push(pos ? `${pos}. ${def.definition}` : def.definition);
      }
    }

    return explains.length
      ? { phonetic, explains, partOfSpeech: partsOfSpeech.join(' / ') }
      : null;
  } catch (_) {
    return null;
  }
}

async function loadLocalConfig() {
  if (cachedLocalConfig) return cachedLocalConfig;
  // 在扩展环境中通过 runtime.getURL 读取打包内的配置文件
  try {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL && typeof fetch === 'function') {
      // 优先本地私密配置
      try {
        const url = chrome.runtime.getURL('config.local.json');
        const res = await fetch(url);
        if (res.ok) { cachedLocalConfig = await res.json(); return cachedLocalConfig; }
      } catch (_) { /* 忽略 */ }
      // 其次公共配置（可选）
      try {
        const url = chrome.runtime.getURL('config.json');
        const res = await fetch(url);
        if (res.ok) { cachedLocalConfig = await res.json(); return cachedLocalConfig; }
      } catch (_) { /* 忽略 */ }
    }
  } catch (_) { /* 忽略 */ }
  // 非扩展或测试环境：返回空配置
  cachedLocalConfig = null;
  return cachedLocalConfig;
}

async function sha256Hex(message) {
  if (!TEXT_ENCODER || !crypto?.subtle?.digest) throw new Error('WebCrypto not available');
  const data = typeof message === 'string' ? TEXT_ENCODER.encode(message) : message;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

async function hmacSha256Raw(key, message) {
  // key: string | ArrayBuffer
  if (!TEXT_ENCODER || !crypto?.subtle?.importKey) throw new Error('WebCrypto not available');
  const keyData = typeof key === 'string' ? TEXT_ENCODER.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, TEXT_ENCODER.encode(message));
  return sig; // ArrayBuffer
}

async function hmacSha256Hex(key, message) {
  const raw = await hmacSha256Raw(key, message);
  return bufferToHex(raw);
}

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, '0');
    hex += h;
  }
  return hex;
}
// ===================== 腾讯云 TMT 集成结束 =====================

// ===================== DeepL 段落翻译 =====================
async function translateWithDeepL(text) {
  const cfg = await loadLocalConfig();
  const apiKey = cfg?.deepl?.apiKey || '';
  if (!apiKey) return null;

  // 免费版 key 以 :fx 结尾，使用 api-free 域名；付费版使用 api.deepl.com
  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: [text], target_lang: 'ZH' })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.translations?.[0]?.text || null;
  } catch (_) {
    return null;
  }
}
// ===================== DeepL 集成结束 =====================

// ===================== DeepSeek selection translation =====================
const DEEPSEEK_CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

async function translateSelectionWithDeepSeek(payload = {}) {
  const settings = await getSettings();
  const deepseek = settings.deepseek || {};
  const apiKey = String(deepseek.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY_MISSING');
  }

  const mode = payload.mode === 'term' ? 'term' : 'sentence';
  const selectedText = String(payload.selectedText || '').trim();
  if (!selectedText) {
    throw new Error('SELECTED_TEXT_EMPTY');
  }

  const context = payload.context || {};
  const targetLanguage = payload.targetLanguage || deepseek.targetLanguage || 'zh-CN';
  const requestJson = buildDeepSeekSelectionRequest({
    mode,
    selectedText,
    context,
    targetLanguage
  });

  const resp = await fetch(DEEPSEEK_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: deepseek.model || 'deepseek-chat',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: buildDeepSeekSystemPrompt(mode)
        },
        {
          role: 'user',
          content: JSON.stringify(requestJson, null, 2)
        }
      ]
    })
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = json?.error?.message || `HTTP_${resp.status}`;
    throw new Error(`DEEPSEEK_REQUEST_FAILED:${detail}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DEEPSEEK_EMPTY_RESPONSE');
  }

  return normalizeDeepSeekResult(mode, content, requestJson, json);
}

function buildDeepSeekSelectionRequest({ mode, selectedText, context, targetLanguage }) {
  if (mode === 'term') {
    return {
      type: 'word_or_phrase_explanation',
      selectedText,
      sourceLanguage: 'auto',
      targetLanguage,
      context: {
        before: String(context.before || ''),
        sentence: String(context.sentence || selectedText),
        after: String(context.after || '')
      },
      outputSchema: {
        type: 'word_or_phrase_explanation',
        selectedText: 'string',
        meaningInContext: 'string',
        partOfSpeech: 'string',
        explanation: 'string'
      }
    };
  }

  return {
    type: 'sentence_translation',
    sourceText: selectedText,
    sourceLanguage: 'auto',
    targetLanguage,
    context: {
      before: String(context.before || ''),
      after: String(context.after || '')
    },
    outputSchema: {
      type: 'sentence_translation',
      translation: 'string',
      detectedLanguage: 'string',
      notes: ['string']
    }
  };
}

function buildDeepSeekSystemPrompt(mode) {
  if (mode === 'term') {
    return [
      'You are a context-aware bilingual reading assistant.',
      'Explain the selected word or phrase according to its meaning in the provided sentence.',
      'Return JSON only. Do not wrap the response in Markdown.',
      'Keep explanations concise and useful for Chinese readers.'
    ].join('\n');
  }

  return [
    'You are a professional translation engine.',
    'Translate the selected sentence or passage naturally and faithfully.',
    'Return JSON only. Do not wrap the response in Markdown.',
    'Keep names, technical terms, numbers, and formatting intent accurate.'
  ].join('\n');
}

function normalizeDeepSeekResult(mode, content, requestJson, rawResponse) {
  const parsed = parseJsonLikeResponse(content);
  if (parsed) {
    return {
      mode,
      request: requestJson,
      result: parsed,
      rawText: content
    };
  }

  const result = mode === 'term'
    ? {
        type: 'word_or_phrase_explanation',
        selectedText: requestJson.selectedText,
        meaningInContext: content,
        partOfSpeech: '',
        explanation: content
      }
    : {
        type: 'sentence_translation',
        translation: content,
        detectedLanguage: 'auto',
        notes: []
      };

  return {
    mode,
    request: requestJson,
    result,
    rawText: content,
    rawResponse
  };
}

function parseJsonLikeResponse(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1].trim());
    } catch (__) {
      return null;
    }
  }
}
// ===================== DeepSeek selection translation end =====================

async function getWordBook() {
  return migrateWordBook();
}

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase();
}

function extractMeaning(source) {
  if (!source) return '暂无释义';
  const deepseek = source.deepseek || source.translation?.deepseek || {};
  const explains = source.explains || source.translation?.explains || [];
  return String(
    source.meaning ||
    source.meaningInContext ||
    source.definition ||
    (typeof source.translation === 'string' ? source.translation : '') ||
    deepseek.meaningInContext ||
    explains[0] ||
    '暂无释义'
  ).trim();
}

function extractPartOfSpeech(source) {
  if (!source) return '';
  const deepseek = source.deepseek || source.translation?.deepseek || {};
  const explicit = source.partOfSpeech || source.pos || deepseek.partOfSpeech;
  if (explicit) return String(explicit).trim();

  const explains = source.explains || source.translation?.explains || [];
  const knownParts = new Set([
    'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
    'conjunction', 'interjection', 'determiner', 'article', 'phrase'
  ]);
  const found = [];
  for (const explanation of explains) {
    const match = String(explanation).match(/^([a-z]+)\.\s+/i);
    const value = match?.[1]?.toLowerCase();
    if (value && knownParts.has(value) && !found.includes(value)) found.push(value);
  }
  return found.join(' / ');
}

function compactWordItem(word, source) {
  return {
    word: String(source?.word || word || '').trim(),
    meaning: extractMeaning(source),
    partOfSpeech: extractPartOfSpeech(source)
  };
}

function createReviewProgress(source = {}, fallback = {}) {
  const now = Date.now();
  return {
    createdAt: source.createdAt || source.addedAt || fallback.createdAt || now,
    nextReviewAt: source.nextReviewAt ?? fallback.nextReviewAt ?? now,
    reviewStage: source.reviewStage ?? fallback.reviewStage ?? 0,
    correctCount: source.correctCount ?? fallback.correctCount ?? 0,
    wrongCount: source.wrongCount ?? fallback.wrongCount ?? 0
  };
}

async function migrateWordBook() {
  const {
    [STORAGE_KEYS.WORD_BOOK]: storedBook,
    [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress
  } = await chrome.storage.local.get([
    STORAGE_KEYS.WORD_BOOK,
    STORAGE_KEYS.REVIEW_PROGRESS
  ]);
  const sourceBook = storedBook || {};
  const sourceProgress = storedProgress || {};
  const book = {};
  const progress = {};

  for (const [storedKey, item] of Object.entries(sourceBook)) {
    const key = normalizeWord(item?.word || storedKey);
    if (!key) continue;
    book[key] = compactWordItem(key, item);
    progress[key] = createReviewProgress(item, sourceProgress[key]);
  }

  const bookChanged = JSON.stringify(book) !== JSON.stringify(sourceBook);
  const progressChanged = JSON.stringify(progress) !== JSON.stringify(sourceProgress);
  if (bookChanged || progressChanged) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORD_BOOK]: book,
      [STORAGE_KEYS.REVIEW_PROGRESS]: progress
    });
  }
  return book;
}

async function addToWordBook(word, source) {
  const book = await getWordBook();
  const key = normalizeWord(word);
  if (!key) throw new Error('单词不能为空');

  const old = book[key] || null;
  book[key] = compactWordItem(key, {
    ...(old || {}),
    ...(source || {}),
    word: String(word).trim()
  });

  const { [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress } =
    await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROGRESS);
  const progress = storedProgress || {};
  progress[key] = createReviewProgress(progress[key]);

  if (!old) {
    await recordDailyWordAddition(key);
    await recordLearningActivity('favorite', key);
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.WORD_BOOK]: book,
    [STORAGE_KEYS.REVIEW_PROGRESS]: progress
  });
  return book[key];
}

// 复习调度逻辑
function scheduleNextReview(reviewStage) {
  const now = Date.now();
  if (reviewStage >= REVIEW_INTERVALS.length - 1) {
    // 已掌握，不再安排复习
    return now + 365 * 24 * 60 * 60 * 1000; // 一年后
  }
  return now + REVIEW_INTERVALS[reviewStage];
}

// 更新复习状态
async function updateReviewStatus(word, isCorrect) {
  const book = await getWordBook();
  const key = normalizeWord(word);
  const item = book[key];
  
  if (!item) {
    throw new Error('单词不存在');
  }

  const { [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress } =
    await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROGRESS);
  const progress = storedProgress || {};
  const itemProgress = createReviewProgress(progress[key]);
  
  if (isCorrect) {
    // 答对：进入下一阶段
    itemProgress.correctCount += 1;
    itemProgress.reviewStage = Math.min(itemProgress.reviewStage + 1, REVIEW_INTERVALS.length - 1);
  } else {
    // 答错：退回上一阶段（最少回到阶段0）
    itemProgress.wrongCount += 1;
    itemProgress.reviewStage = Math.max(0, itemProgress.reviewStage - 1);
  }
  
  // 更新下次复习时间
  itemProgress.nextReviewAt = scheduleNextReview(itemProgress.reviewStage);
  progress[key] = itemProgress;
  
  await chrome.storage.local.set({ [STORAGE_KEYS.REVIEW_PROGRESS]: progress });
  await recordLearningActivity('review', key);
  return { ...item, definition: item.meaning, ...itemProgress };
}

// 获取待复习的单词
async function getWordsForReview(limit = 5) {
  const book = await getWordBook();
  const { [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress } =
    await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROGRESS);
  const progress = storedProgress || {};
  const now = Date.now();
  const wordsForReview = [];
  
  for (const [word, item] of Object.entries(book)) {
    const itemProgress = createReviewProgress(progress[word]);
    // 检查是否到了复习时间且未完全掌握
    if (itemProgress.nextReviewAt <= now && itemProgress.reviewStage < REVIEW_INTERVALS.length - 1) {
      wordsForReview.push({ ...item, definition: item.meaning, ...itemProgress });
    }
  }
  
  // 按优先级排序：复习阶段低的优先，然后按到期时间排序
  wordsForReview.sort((a, b) => {
    if (a.reviewStage !== b.reviewStage) {
      return a.reviewStage - b.reviewStage;
    }
    return a.nextReviewAt - b.nextReviewAt;
  });
  
  return wordsForReview.slice(0, limit);
}

async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const defaults = getDefaultSettings();
  return {
    ...defaults,
    ...(settings || {}),
    deepseek: {
      ...defaults.deepseek,
      ...((settings || {}).deepseek || {})
    }
  };
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
}

function getDefaultSettings() {
  return {
    highlight: true,
    language: 'en',
    dailyReviewCount: 5,
    deepseek: {
      apiKey: '',
      model: 'deepseek-chat',
      targetLanguage: 'zh-CN'
    }
  };
}

// 查询统计相关函数
async function recordQueryStat(word) {
  const { [STORAGE_KEYS.QUERY_STATS]: stats } = await chrome.storage.local.get(STORAGE_KEYS.QUERY_STATS);
  const currentStats = stats || {};
  const wordStat = currentStats[word] || { count: 0, lastQueried: 0 };
  
  wordStat.count += 1;
  wordStat.lastQueried = Date.now();
  currentStats[word] = wordStat;
  
  await chrome.storage.local.set({ [STORAGE_KEYS.QUERY_STATS]: currentStats });
}

async function getQueryStats(word) {
  const { [STORAGE_KEYS.QUERY_STATS]: stats } = await chrome.storage.local.get(STORAGE_KEYS.QUERY_STATS);
  const currentStats = stats || {};
  return currentStats[word] || { count: 0, lastQueried: 0 };
}

// 检查单词/短语是否在单词本中（规范化：去首尾空格、转小写）
async function checkWordInBook(word) {
  const currentWordBook = await getWordBook();
  const key = normalizeWord(word);
  return { inBook: !!currentWordBook[key] };
}

// 单词本管理相关函数
async function removeFromWordBook(word) {
  const currentWordBook = await getWordBook();
  const key = normalizeWord(word);
  
  if (currentWordBook[key]) {
    delete currentWordBook[key];
    const { [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress } =
      await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROGRESS);
    const progress = storedProgress || {};
    delete progress[key];
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORD_BOOK]: currentWordBook,
      [STORAGE_KEYS.REVIEW_PROGRESS]: progress
    });
    return { success: true, message: '单词已从单词本中删除' };
  } else {
    return { success: false, message: '单词不在单词本中' };
  }
}

// 记录每日单词添加统计
async function recordDailyWordAddition(word) {
  const today = formatLocalDate(new Date());
  const { [STORAGE_KEYS.DAILY_STATS]: dailyStats } = await chrome.storage.local.get(STORAGE_KEYS.DAILY_STATS);
  const stats = dailyStats || {};
  
  if (!stats[today]) {
    stats[today] = {
      date: today,
      words: [],
      count: 0
    };
  }
  
  // 避免重复记录同一个单词
  if (!stats[today].words.includes(word)) {
    stats[today].words.push(word);
    stats[today].count = stats[today].words.length;
    
    await chrome.storage.local.set({ [STORAGE_KEYS.DAILY_STATS]: stats });
  }
}

// 获取每日统计数据
async function getDailyStats(startDate, endDate) {
  const { [STORAGE_KEYS.DAILY_STATS]: dailyStats } = await chrome.storage.local.get(STORAGE_KEYS.DAILY_STATS);
  const stats = dailyStats || {};
  
  if (!startDate || !endDate) {
    return stats;
  }
  
  const filteredStats = {};
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (const [date, data] of Object.entries(stats)) {
    const currentDate = new Date(date);
    if (currentDate >= start && currentDate <= end) {
      filteredStats[date] = data;
    }
  }
  
  return filteredStats;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDailyActivity(date) {
  return {
    date,
    queryCount: 0,
    queriedWords: [],
    favoriteCount: 0,
    favoriteWords: [],
    reviewCount: 0,
    reviewedWords: []
  };
}

async function recordLearningActivity(type, word) {
  const key = normalizeWord(word);
  if (!key) return;
  const date = formatLocalDate(new Date());
  const { [STORAGE_KEYS.ACTIVITY_STATS]: storedStats } =
    await chrome.storage.local.get(STORAGE_KEYS.ACTIVITY_STATS);
  const stats = storedStats || {};
  const activity = {
    ...createDailyActivity(date),
    ...(stats[date] || {})
  };

  const fields = {
    query: ['queryCount', 'queriedWords'],
    favorite: ['favoriteCount', 'favoriteWords'],
    review: ['reviewCount', 'reviewedWords']
  };
  const [countField, wordsField] = fields[type] || [];
  if (!countField) return;

  activity[countField] = (activity[countField] || 0) + 1;
  activity[wordsField] = Array.isArray(activity[wordsField]) ? activity[wordsField] : [];
  if (!activity[wordsField].includes(key)) activity[wordsField].push(key);
  stats[date] = activity;
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVITY_STATS]: stats });
}

function getCurrentWeekRange() {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end, now };
}

async function getWeeklySummary() {
  const { start, end, now } = getCurrentWeekRange();
  const {
    [STORAGE_KEYS.ACTIVITY_STATS]: storedActivity,
    [STORAGE_KEYS.QUERY_STATS]: storedQueries,
    [STORAGE_KEYS.DAILY_STATS]: storedFavorites
  } = await chrome.storage.local.get([
    STORAGE_KEYS.ACTIVITY_STATS,
    STORAGE_KEYS.QUERY_STATS,
    STORAGE_KEYS.DAILY_STATS
  ]);
  const activityStats = storedActivity || {};
  const queryStats = storedQueries || {};
  const dailyStats = storedFavorites || {};
  const queriedWords = new Set();
  const favoriteWords = new Set();
  const reviewedWords = new Set();
  let queryEvents = 0;
  let favoriteEvents = 0;
  let reviewEvents = 0;

  for (let date = new Date(start); date <= now; date.setDate(date.getDate() + 1)) {
    const dateKey = formatLocalDate(date);
    const activity = activityStats[dateKey] || {};
    queryEvents += activity.queryCount || 0;
    favoriteEvents += activity.favoriteCount || 0;
    reviewEvents += activity.reviewCount || 0;
    (activity.queriedWords || []).forEach(word => queriedWords.add(normalizeWord(word)));
    (activity.favoriteWords || []).forEach(word => favoriteWords.add(normalizeWord(word)));
    (activity.reviewedWords || []).forEach(word => reviewedWords.add(normalizeWord(word)));

    // 兼容升级前已有的收藏记录。
    (dailyStats[dateKey]?.words || []).forEach(word => favoriteWords.add(normalizeWord(word)));
  }

  // query_stats 只能还原本周查询过的独立单词，用于兼容升级前数据。
  for (const [word, stat] of Object.entries(queryStats)) {
    if (stat?.lastQueried >= start.getTime() && stat.lastQueried <= end.getTime()) {
      queriedWords.add(normalizeWord(word));
    }
  }

  const cleanWords = set => [...set].filter(Boolean);
  const queryWordList = cleanWords(queriedWords);
  const favoriteWordList = cleanWords(favoriteWords);
  const reviewedWordList = cleanWords(reviewedWords);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    generatedAt: now.toISOString(),
    queries: queryWordList.length,
    favorites: favoriteWordList.length,
    reviews: reviewedWordList.length,
    queryEvents: Math.max(queryEvents, queryWordList.length),
    favoriteEvents: Math.max(favoriteEvents, favoriteWordList.length),
    reviewEvents: Math.max(reviewEvents, reviewedWordList.length),
    queriedWords: queryWordList,
    favoriteWords: favoriteWordList,
    reviewedWords: reviewedWordList
  };
}

async function generateWeeklyReview(summary) {
  const settings = await getSettings();
  const deepseek = settings.deepseek || {};
  const apiKey = String(deepseek.apiKey || '').trim();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');

  const resp = await fetch(DEEPSEEK_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: deepseek.model || 'deepseek-chat',
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            '你是一位犀利、有梗但讲道理的英语学习教练。',
            '根据用户一周的查询、收藏和复习数据，写一段中文锐评。',
            '先精准指出学习习惯中的问题，再给一个明确可执行的下周建议。',
            '语气可以毒舌，但不要人身攻击，不要虚构数据。',
            '控制在 120 到 220 个汉字，只返回正文。'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify(summary, null, 2)
        }
      ]
    })
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = json?.error?.message || `HTTP_${resp.status}`;
    throw new Error(`DEEPSEEK_REQUEST_FAILED:${detail}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DEEPSEEK_EMPTY_RESPONSE');
  return String(content).trim();
}

// 导入单词本（合并，不覆盖已存在的条目）
async function importWordBook(words) {
  const book = await getWordBook();
  const { [STORAGE_KEYS.REVIEW_PROGRESS]: storedProgress } =
    await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROGRESS);
  const progress = storedProgress || {};
  let importCount = 0;

  for (const [storedKey, item] of Object.entries(words || {})) {
    const key = normalizeWord(item?.word || storedKey);
    if (!key) continue;
    if (!book[key]) {
      book[key] = compactWordItem(key, item);
      progress[key] = createReviewProgress(item, progress[key]);
      importCount++;
      // 记录每日统计
      await recordDailyWordAddition(key);
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.WORD_BOOK]: book,
    [STORAGE_KEYS.REVIEW_PROGRESS]: progress
  });
  return { importCount, total: Object.keys(book).length };
}

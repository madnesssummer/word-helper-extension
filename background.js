// 背景脚本：管理存储、复习计划(记忆曲线)、高亮刷新

const STORAGE_KEYS = {
  WORD_BOOK: 'word_book',           // Map<string, WordItem>
  SETTINGS: 'settings',             // { highlight: boolean, language: string }
  QUERY_STATS: 'query_stats',       // Map<string, { count: number, lastQueried: number }>
  DAILY_STATS: 'daily_stats'        // Map<string, { date: string, words: string[], count: number }>
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
 * @property {string} definition - 中文释义（或英文释义）
 * @property {number} queryCount - 查询次数
 * @property {number} createdAt - 首次记录时间（时间戳）
 * @property {number} nextReviewAt - 下次复习时间（时间戳）
 * @property {number} reviewStage - 当前复习阶段（0-8）
 * @property {number} correctCount - 答对次数
 * @property {number} wrongCount - 答错次数
 * @property {Object} translation - 完整翻译对象（保持兼容性）
 * @property {boolean} highlight - 是否高亮显示
 */

chrome.runtime.onInstalled.addListener(async () => {
  const { WORD_BOOK, SETTINGS, QUERY_STATS, DAILY_STATS } = STORAGE_KEYS;
  const init = {};
  const { [WORD_BOOK]: wb } = await chrome.storage.local.get(WORD_BOOK);
  if (!wb) init[WORD_BOOK] = {};
  const { [SETTINGS]: s } = await chrome.storage.local.get(SETTINGS);
  if (!s) init[SETTINGS] = { highlight: true, language: 'en' };
  const { [QUERY_STATS]: qs } = await chrome.storage.local.get(QUERY_STATS);
  if (!qs) init[QUERY_STATS] = {};
  const { [DAILY_STATS]: ds } = await chrome.storage.local.get(DAILY_STATS);
  if (!ds) init[DAILY_STATS] = {};
  if (Object.keys(init).length) {
    await chrome.storage.local.set(init);
  }
  // 配置每日复习提醒
  chrome.alarms.create('dailyReview', { delayInMinutes: 1, periodInMinutes: 60 * 24 });
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
        const result = await translate(message.payload.word, message.payload.from || 'en', message.payload.to || 'zh');
        sendResponse({ ok: true, data: result });
        return;
      }
      case 'GET_QUERY_STATS': {
        const data = await getQueryStats(message.payload.word);
        sendResponse({ ok: true, data });
        return;
      }
      case 'ADD_TO_WORD_BOOK': {
        const data = await addToWordBook(message.payload.word, message.payload.translation);
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
      default:
        sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    }
  })();
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
    for (const meaning of (entry.meanings || [])) {
      const pos = meaning.partOfSpeech || '';
      for (const def of (meaning.definitions || []).slice(0, 2)) {
        explains.push(pos ? `${pos}. ${def.definition}` : def.definition);
      }
    }

    return explains.length ? { phonetic, explains } : null;
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

async function getWordBook() {
  const { [STORAGE_KEYS.WORD_BOOK]: book } = await chrome.storage.local.get(STORAGE_KEYS.WORD_BOOK);
  return book || {};
}

async function addToWordBook(word, translation) {
  const book = await getWordBook();
  const now = Date.now();
  const old = book[word] || null;
  
  // 提取定义文本
  const definition = extractDefinition(translation);
  
  // 创建新的WordItem结构
  book[word] = {
    word,
    definition,
    queryCount: (old?.queryCount || 0) + 1,
    createdAt: old?.createdAt || now,
    nextReviewAt: old?.nextReviewAt || now, // 立即可复习
    reviewStage: old?.reviewStage || 0,
    correctCount: old?.correctCount || 0,
    wrongCount: old?.wrongCount || 0,
    translation, // 保持完整翻译对象以兼容现有功能
    highlight: true
  };
  
  // 如果是新单词，记录到每日统计中
  if (!old) {
    await recordDailyWordAddition(word);
  }
  
  await chrome.storage.local.set({ [STORAGE_KEYS.WORD_BOOK]: book });
  return book[word];
}

// 从翻译对象中提取定义文本
function extractDefinition(translation) {
  if (!translation) return '';
  
  // 如果有explains数组，取第一个作为主要定义
  if (translation.explains && translation.explains.length > 0) {
    return translation.explains[0];
  }
  
  // 如果没有explains，尝试其他字段
  if (translation.definition) return translation.definition;
  if (translation.meaning) return translation.meaning;
  
  return '暂无释义';
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
  const item = book[word];
  
  if (!item) {
    throw new Error('单词不存在');
  }
  
  const now = Date.now();
  
  if (isCorrect) {
    // 答对：进入下一阶段
    item.correctCount += 1;
    item.reviewStage = Math.min(item.reviewStage + 1, REVIEW_INTERVALS.length - 1);
  } else {
    // 答错：退回上一阶段（最少回到阶段0）
    item.wrongCount += 1;
    item.reviewStage = Math.max(0, item.reviewStage - 1);
  }
  
  // 更新下次复习时间
  item.nextReviewAt = scheduleNextReview(item.reviewStage);
  
  await chrome.storage.local.set({ [STORAGE_KEYS.WORD_BOOK]: book });
  return item;
}

// 获取待复习的单词
async function getWordsForReview(limit = 5) {
  const book = await getWordBook();
  const now = Date.now();
  const wordsForReview = [];
  
  for (const [word, item] of Object.entries(book)) {
    // 检查是否到了复习时间且未完全掌握
    if (item.nextReviewAt <= now && item.reviewStage < REVIEW_INTERVALS.length - 1) {
      wordsForReview.push(item);
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
  return settings || { highlight: true, language: 'en' };
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
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
  const { [STORAGE_KEYS.WORD_BOOK]: wordBook } = await chrome.storage.local.get(STORAGE_KEYS.WORD_BOOK);
  const currentWordBook = wordBook || {};
  const key = word.trim().toLowerCase();
  return { inBook: !!currentWordBook[key] };
}

// 单词本管理相关函数
async function removeFromWordBook(word) {
  const { [STORAGE_KEYS.WORD_BOOK]: wordBook } = await chrome.storage.local.get(STORAGE_KEYS.WORD_BOOK);
  const currentWordBook = wordBook || {};
  
  if (currentWordBook[word]) {
    delete currentWordBook[word];
    await chrome.storage.local.set({ [STORAGE_KEYS.WORD_BOOK]: currentWordBook });
    return { success: true, message: '单词已从单词本中删除' };
  } else {
    return { success: false, message: '单词不在单词本中' };
  }
}

// 记录每日单词添加统计
async function recordDailyWordAddition(word) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD格式
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

// 导入单词本（合并，不覆盖已存在的条目）
async function importWordBook(words) {
  const book = await getWordBook();
  const now = Date.now();
  let importCount = 0;

  for (const [key, item] of Object.entries(words || {})) {
    if (!book[key]) {
      book[key] = {
        word: item.word || key,
        definition: item.definition || '',
        queryCount: item.queryCount || 0,
        createdAt: item.createdAt || now,
        nextReviewAt: item.nextReviewAt || now,
        reviewStage: item.reviewStage || 0,
        correctCount: item.correctCount || 0,
        wrongCount: item.wrongCount || 0,
        translation: item.translation || null,
        highlight: item.highlight !== undefined ? item.highlight : true
      };
      importCount++;
      // 记录每日统计
      await recordDailyWordAddition(item.word || key);
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.WORD_BOOK]: book });
  return { importCount, total: Object.keys(book).length };
}

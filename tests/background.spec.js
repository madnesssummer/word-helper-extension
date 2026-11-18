/** @jest-environment node */

global.chrome = {
  storage: {
    local: {
      _data: {},
      async get(key) {
        if (typeof key === 'string') return { [key]: this._data[key] };
        if (Array.isArray(key)) {
          const result = {};
          key.forEach((item) => { result[item] = this._data[item]; });
          return result;
        }
        return { ...this._data };
      },
      async set(value) {
        this._data = { ...this._data, ...value };
      }
    }
  },
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
    openOptionsPage: jest.fn()
  },
  tts: {
    stop: jest.fn(),
    speak: jest.fn((text, options, callback) => callback())
  },
  alarms: { create: jest.fn(), onAlarm: { addListener: jest.fn() } },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() }
};

require('../background.js');

const installExtension = async () => {
  const callback = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
  await callback();
};

const sendMessage = (type, payload = {}) => new Promise((resolve) => {
  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  listener({ type, payload }, {}, resolve);
});

describe('background word book storage', () => {
  beforeEach(() => {
    chrome.storage.local._data = {};
    chrome.tts.stop.mockClear();
    chrome.tts.speak.mockClear();
  });

  test('speaks English text through chrome.tts', async () => {
    const response = await sendMessage('SPEAK_TEXT', { text: ' wisdom ' });

    expect(response).toEqual({ ok: true, data: { text: 'wisdom' } });
    expect(chrome.tts.stop).toHaveBeenCalledTimes(1);
    expect(chrome.tts.speak).toHaveBeenCalledWith(
      'wisdom',
      { lang: 'en-US', rate: 0.85, enqueue: false },
      expect.any(Function)
    );
  });

  test('initializes storage defaults', async () => {
    await installExtension();

    const { word_book, review_progress, activity_stats, settings } =
      await chrome.storage.local.get(['word_book', 'review_progress', 'activity_stats', 'settings']);
    expect(word_book).toEqual({});
    expect(review_progress).toEqual({});
    expect(activity_stats).toEqual({});
    expect(settings).toBeDefined();
  });

  test('stores only the word, meaning and part of speech', async () => {
    await installExtension();

    const response = await sendMessage('ADD_TO_WORD_BOOK', {
      word: 'Wisdom',
      entry: {
        meaning: '普遍看法；传统观念',
        partOfSpeech: 'noun',
        explanation: '不应写入单词本',
        alternatives: ['主流观点']
      }
    });

    expect(response.ok).toBe(true);
    expect(chrome.storage.local._data.word_book).toEqual({
      wisdom: {
        word: 'Wisdom',
        meaning: '普遍看法；传统观念',
        partOfSpeech: 'noun'
      }
    });
    expect(chrome.storage.local._data.review_progress.wisdom).toBeDefined();
  });

  test('migrates existing entries and removes legacy translation details', async () => {
    chrome.storage.local._data.word_book = {
      Wisdom: {
        word: 'Wisdom',
        definition: '普遍看法；传统观念',
        translation: {
          explains: [
            '普遍看法；传统观念',
            '这里是较长的上下文解释',
            '原句翻译：传统观念认为……'
          ],
          deepseek: {
            partOfSpeech: 'noun',
            alternatives: ['主流观点']
          }
        },
        reviewStage: 3,
        correctCount: 2,
        wrongCount: 1,
        nextReviewAt: 12345,
        createdAt: 6789
      }
    };

    await installExtension();

    expect(chrome.storage.local._data.word_book).toEqual({
      wisdom: {
        word: 'Wisdom',
        meaning: '普遍看法；传统观念',
        partOfSpeech: 'noun'
      }
    });
    expect(chrome.storage.local._data.review_progress.wisdom).toEqual({
      createdAt: 6789,
      nextReviewAt: 12345,
      reviewStage: 3,
      correctCount: 2,
      wrongCount: 1
    });
  });
});

describe('Qwen translation and weekly review', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    chrome.storage.local._data = {
      settings: {
        qwen: { apiKey: 'test-bailian-key' },
        deepseek: { apiKey: 'test-legacy-key', model: 'deepseek-chat', targetLanguage: 'zh-TW' }
      }
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockContent = (content) => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] })
    });
  };

  const requestBody = () => {
    const [[url, request]] = global.fetch.mock.calls;
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer test-bailian-key');
    expect(request.method).toBe('POST');
    return JSON.parse(request.body);
  };

  test('explains a term with its sentence using the Qwen JSON format', async () => {
    const result = { meaningInContext: '模組', partOfSpeech: 'noun', explanation: '指獨立的功能單元。' };
    mockContent(JSON.stringify(result));
    const sentence = 'These modules can be installed separately.';
    expect(await sendMessage('TRANSLATE_SELECTION', {
      mode: 'term', selectedText: 'modules', context: { sentence }
    })).toEqual({ ok: true, data: { mode: 'term', result } });

    const body = requestBody();
    expect(body).toMatchObject({
      model: 'qwen3.8-flash', enable_thinking: false, response_format: { type: 'json_object' }
    });
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      type: 'word_or_phrase_explanation', selectedText: 'modules', targetLanguage: 'zh-TW', context: { sentence }
    });
  });

  test.each(['TRANSLATE_PARAGRAPH', 'TRANSLATE_SELECTION'])('translates text through %s', async (type) => {
    const result = { translation: '譯文' };
    mockContent(JSON.stringify(result));
    const response = await sendMessage(type, { text: 'Source text.', selectedText: 'Source text.' });
    expect(response).toEqual({
      ok: true,
      data: type === 'TRANSLATE_PARAGRAPH' ? result : { mode: 'sentence', result }
    });
    const body = requestBody();
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      type: 'sentence_translation', sourceText: 'Source text.'
    });
  });

  test('uses Qwen plain text for the weekly review', async () => {
    mockContent(' 多复习收藏的词。 ');
    const response = await sendMessage('GENERATE_WEEKLY_REVIEW');
    expect(response).toMatchObject({ ok: true, data: { review: '多复习收藏的词。' } });
    const body = requestBody();
    expect(body.enable_thinking).toBe(false);
    expect(body).not.toHaveProperty('response_format');
  });

  test('does not send or expose the old DeepSeek key', async () => {
    delete chrome.storage.local._data.settings.qwen;
    expect(await sendMessage('TRANSLATE_PARAGRAPH', { text: 'Source text.' }))
      .toEqual({ ok: false, error: 'QWEN_API_KEY_MISSING' });
    expect(global.fetch).not.toHaveBeenCalled();
    const { data } = await sendMessage('GET_SETTINGS');
    expect(data.qwen.targetLanguage).toBe('zh-TW');
    expect(data).not.toHaveProperty('deepseek');
    expect(data.qwen).not.toHaveProperty('apiKey');
  });

  test('does not expose the Qwen key through GET_SETTINGS', async () => {
    const { data } = await sendMessage('GET_SETTINGS');
    expect(data.qwen).not.toHaveProperty('apiKey');
  });

  test('does not display a malformed result as a paragraph translation', async () => {
    mockContent('{"wrongField":"Not a translation"}');
    expect(await sendMessage('TRANSLATE_PARAGRAPH', { text: 'Source text.' }))
      .toEqual({ ok: false, error: 'QWEN_INVALID_TRANSLATION' });
  });

  test('returns a safe error when the provider rejects the request', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    expect(await sendMessage('TRANSLATE_PARAGRAPH', { text: 'Source text.' }))
      .toEqual({ ok: false, error: 'QWEN_REQUEST_FAILED:HTTP_401' });
  });

  test('matches batch translations by id, not response order', async () => {
    mockContent(JSON.stringify({ translations: [
      { id: 'second', translation: '第二段' }, { id: 'first', translation: '第一段' }
    ] }));
    expect(await sendMessage('TRANSLATE_PARAGRAPHS', {
      paragraphs: [{ id: 'first', text: 'First paragraph.' }, { id: 'second', text: 'Second paragraph.' }]
    })).toEqual({ ok: true, data: { translations: [
      { id: 'first', translation: '第一段' }, { id: 'second', translation: '第二段' }
    ] } });
    const body = requestBody();
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(body.messages[1].content).paragraphs).toHaveLength(2);
  });

  test('keeps valid batch translations and flags duplicate, missing or invalid ids', async () => {
    mockContent(JSON.stringify({ translations: [
      { id: 'good', translation: '正确' }, { id: 'duplicate', translation: '一' },
      { id: 'duplicate', translation: '二' }, { id: 'invalid', translation: null },
      { id: 'unknown', translation: '忽略' }
    ] }));
    const response = await sendMessage('TRANSLATE_PARAGRAPHS', {
      paragraphs: ['good', 'duplicate', 'invalid', 'missing'].map(id => ({ id, text: id }))
    });
    expect(response.data.translations).toEqual([
      { id: 'good', translation: '正确' },
      ...['duplicate', 'invalid', 'missing'].map(id => ({ id, error: 'QWEN_INVALID_TRANSLATION' }))
    ]);
  });

  test.each([
    [],
    Array.from({ length: 7 }, (_, id) => ({ id: String(id), text: 'Paragraph' })),
    [{ id: 'same', text: 'One' }, { id: 'same', text: 'Two' }],
    [{ id: 'empty', text: ' ' }],
    [{ id: 'oversize', text: 'a'.repeat(100001) }]
  ])('rejects an invalid paragraph batch %# before fetching', async (...items) => {
    expect(await sendMessage('TRANSLATE_PARAGRAPHS', { paragraphs: items }))
      .toEqual({ ok: false, error: 'INVALID_PARAGRAPH_BATCH' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('aborts a stalled request after 25 seconds', async () => {
    jest.useFakeTimers();
    global.fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    try {
      const pending = sendMessage('TRANSLATE_PARAGRAPHS', { paragraphs: [{ id: '1', text: 'Hello' }] });
      await jest.advanceTimersByTimeAsync(25000);
      expect(await pending).toEqual({ ok: false, error: 'QWEN_REQUEST_FAILED:TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });
});

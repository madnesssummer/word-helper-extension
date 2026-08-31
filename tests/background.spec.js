/** @jest-environment jsdom */

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

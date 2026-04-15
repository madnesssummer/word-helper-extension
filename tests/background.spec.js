/** @jest-environment jsdom */

// 伪造 chrome API 基础结构
global.chrome = {
  storage: {
    local: {
      _data: {},
      async get(key) {
        if (typeof key === 'string') return { [key]: this._data[key] };
        if (Array.isArray(key)) {
          const res = {}; key.forEach(k => res[k] = this._data[k]); return res;
        }
        return { ...this._data };
      },
      async set(obj) { this._data = { ...this._data, ...obj }; },
    }
  },
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
    openOptionsPage: jest.fn()
  },
  alarms: { create: jest.fn(), onAlarm: { addListener: jest.fn() } },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() }
};

describe('background basic', () => {
  test('storage defaults', async () => {
    // 加载脚本
    require('../background.js');
    // 手动触发 onInstalled 回调
    const cb = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
    await cb();
    const { word_book, settings } = await chrome.storage.local.get(['word_book', 'settings']);
    expect(word_book).toBeDefined();
    expect(settings).toBeDefined();
  });
});


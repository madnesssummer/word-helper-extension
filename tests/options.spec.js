const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const readExtensionFile = (name) => readFileSync(join(__dirname, '..', name), 'utf8');

test('settings save a new Qwen key without reusing the legacy DeepSeek key', async () => {
  let settings = {
    highlight: false,
    dailyReviewCount: 8,
    deepseek: { apiKey: 'legacy-test-key', model: 'deepseek-chat', targetLanguage: 'zh-TW' }
  };
  const ids = [...readExtensionFile('options.html').matchAll(/\bid="([^"]+)"/g)];
  const elements = Object.fromEntries(ids.map(([, id]) => [id, {
    value: '', style: {}, classList: { toggle: jest.fn() }, addEventListener: jest.fn()
  }]));
  const context = {
    document: {
      getElementById: (id) => elements[id],
      addEventListener: jest.fn()
    },
    window: { setTimeout: jest.fn(), clearTimeout: jest.fn() },
    chrome: {
      storage: {
        local: {
          get: async () => ({ settings }),
          set: async (data) => { settings = data.settings; }
        }
      }
    }
  };
  runInNewContext(readExtensionFile('options.js'), context);
  await context.loadSettings();
  expect(elements.qwenApiKey.value).toBe('');
  expect(elements.qwenModel.value).toBe('qwen3.8-flash');
  expect(elements.qwenTargetLanguage.value).toBe('zh-TW');

  elements.qwenApiKey.value = ' new-test-key ';
  await context.saveSettings();
  expect(settings.qwen).toEqual({
    apiKey: 'new-test-key', model: 'qwen3.8-flash', targetLanguage: 'zh-TW'
  });
  expect(settings).toMatchObject({ highlight: false, dailyReviewCount: 8 });
  expect(settings).not.toHaveProperty('deepseek');
  expect(elements.successMessage.textContent).toBe('Settings saved.');

  elements.qwenApiKey.value = '';
  await context.loadSettings();
  expect(elements.qwenApiKey.value).toBe('new-test-key');
});

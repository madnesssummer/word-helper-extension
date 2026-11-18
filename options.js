const DEFAULT_SETTINGS = {
  highlight: true,
  language: 'en',
  dailyReviewCount: 5,
  qwen: {
    apiKey: '',
    model: 'qwen3.8-flash',
    targetLanguage: 'zh-CN'
  }
};

function getEl(id) {
  return document.getElementById(id);
}

function mergeSettings(settings) {
  const { deepseek: legacy, qwen, ...saved } = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    qwen: {
      ...DEFAULT_SETTINGS.qwen,
      ...qwen,
      targetLanguage: qwen?.targetLanguage || legacy?.targetLanguage || DEFAULT_SETTINGS.qwen.targetLanguage
    }
  };
}

function showMessage(text, type = 'success') {
  const message = getEl('successMessage');
  message.textContent = text;
  message.classList.toggle('error', type === 'error');
  message.style.display = 'block';
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    message.style.display = 'none';
  }, type === 'error' ? 3500 : 2000);
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = mergeSettings(settings);

  getEl('highlight').checked = !!s.highlight;
  getEl('language').value = s.language || 'en';
  getEl('dailyReviewCount').value = s.dailyReviewCount || 5;
  getEl('qwenApiKey').value = s.qwen.apiKey || '';
  getEl('qwenModel').value = s.qwen.model || DEFAULT_SETTINGS.qwen.model;
  getEl('qwenTargetLanguage').value = s.qwen.targetLanguage;
}

async function saveSettings() {
  const saveBtn = getEl('saveBtn');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const { settings } = await chrome.storage.local.get('settings');
    const current = mergeSettings(settings);
    const dailyReviewCount = parseInt(getEl('dailyReviewCount').value, 10) || DEFAULT_SETTINGS.dailyReviewCount;
    const validCount = Math.max(1, Math.min(50, dailyReviewCount));
    getEl('dailyReviewCount').value = validCount;

    await chrome.storage.local.set({
      settings: {
        ...current,
        highlight: getEl('highlight').checked,
        language: getEl('language').value,
        dailyReviewCount: validCount,
        qwen: {
          ...current.qwen,
          apiKey: getEl('qwenApiKey').value.trim(),
          model: getEl('qwenModel').value.trim() || DEFAULT_SETTINGS.qwen.model,
          targetLanguage: getEl('qwenTargetLanguage').value || DEFAULT_SETTINGS.qwen.targetLanguage
        }
      }
    });

    showMessage('Settings saved.');
  } catch (error) {
    console.error('Failed to save settings:', error);
    showMessage(`Save failed: ${error?.message || 'Unknown error'}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  getEl('saveBtn').addEventListener('click', saveSettings);
  loadSettings().catch((error) => {
    console.error('Failed to load settings:', error);
    showMessage(`Load failed: ${error?.message || 'Unknown error'}`, 'error');
  });
});

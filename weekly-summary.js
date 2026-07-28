class WeeklySummaryPage {
  constructor() {
    this.summary = null;
    this.reviewText = document.getElementById('reviewText');
    this.regenerateBtn = document.getElementById('regenerateBtn');
    document.getElementById('closeBtn').addEventListener('click', () => window.close());
    this.regenerateBtn.addEventListener('click', () => this.generateReview());
    this.init();
  }

  sendMessage(type) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload: {} }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || '请求失败'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  async init() {
    try {
      this.summary = await this.sendMessage('GET_WEEKLY_SUMMARY');
      this.renderSummary(this.summary);
      await this.generateReview();
    } catch (error) {
      this.showError(error);
    }
  }

  renderSummary(summary) {
    document.getElementById('queryCount').textContent = summary.queries || 0;
    document.getElementById('favoriteCount').textContent = summary.favorites || 0;
    document.getElementById('reviewCount').textContent = summary.reviews || 0;
    document.getElementById('weekRange').textContent =
      `${this.formatDate(summary.startDate)} — ${this.formatDate(summary.endDate)}`;
  }

  async generateReview() {
    this.regenerateBtn.disabled = true;
    this.reviewText.className = 'review-text loading';
    this.reviewText.textContent = 'DeepSeek 正在翻你的学习账本...';
    try {
      const data = await this.sendMessage('GENERATE_WEEKLY_REVIEW');
      this.summary = data.summary;
      this.renderSummary(data.summary);
      this.reviewText.className = 'review-text';
      this.reviewText.textContent = data.review;
    } catch (error) {
      this.showError(error);
    } finally {
      this.regenerateBtn.disabled = false;
    }
  }

  showError(error) {
    const message = String(error?.message || error || '');
    this.reviewText.className = 'review-text error';
    if (message.includes('DEEPSEEK_API_KEY_MISSING')) {
      this.reviewText.textContent = '还没配置 DeepSeek API Key。请先到扩展设置页填写，再回来接受锐评。';
    } else if (message.includes('DEEPSEEK_REQUEST_FAILED')) {
      this.reviewText.textContent = 'DeepSeek 请求失败，请检查 API Key、网络或接口额度后重试。';
    } else {
      this.reviewText.textContent = `周总结加载失败：${message || '未知错误'}`;
    }
  }

  formatDate(value) {
    const [year, month, day] = String(value || '').split('-');
    return year && month && day ? `${year}.${month}.${day}` : value;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new WeeklySummaryPage();
});

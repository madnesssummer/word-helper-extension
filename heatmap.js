// 按月展示学习热力图。
class HeatmapPage {
  constructor() {
    const now = new Date();
    this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this.dailyStats = {};
    this.totalWordCount = 0;
    this.tooltip = document.getElementById('tooltip');
    this.init();
  }

  async init() {
    try {
      await this.loadData();
      this.setupEventListeners();
      this.syncMonthSelector();
      this.render();
      this.hideLoading();
    } catch (error) {
      console.error('初始化热力图失败:', error);
      this.showError();
    }
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || '获取数据失败'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  async loadData() {
    const [dailyStats, wordBook] = await Promise.all([
      this.sendMessage({ type: 'GET_DAILY_STATS', payload: {} }),
      this.sendMessage({ type: 'GET_WORD_BOOK', payload: {} })
    ]);
    this.dailyStats = dailyStats || {};
    this.totalWordCount = Object.keys(wordBook || {}).length;
  }

  setupEventListeners() {
    document.getElementById('monthSelector').addEventListener('change', event => {
      const [year, month] = String(event.target.value).split('-').map(Number);
      if (!year || !month) return;
      this.currentMonth = new Date(year, month - 1, 1);
      this.render();
    });

    document.getElementById('previousMonth').addEventListener('click', () => {
      this.changeMonth(-1);
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
      this.changeMonth(1);
    });
    document.getElementById('backBtn').addEventListener('click', () => window.close());
  }

  changeMonth(offset) {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() + offset,
      1
    );
    this.syncMonthSelector();
    this.render();
  }

  syncMonthSelector() {
    const year = this.currentMonth.getFullYear();
    const month = String(this.currentMonth.getMonth() + 1).padStart(2, '0');
    document.getElementById('monthSelector').value = `${year}-${month}`;
  }

  render() {
    this.renderMonth();
    this.updateStats();
    document.getElementById('wordList').style.display = 'none';
  }

  renderMonth() {
    const grid = document.getElementById('monthGrid');
    grid.innerHTML = '';
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const firstDate = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingEmptyDays = (firstDate.getDay() + 6) % 7;

    for (let index = 0; index < leadingEmptyDays; index++) {
      const empty = document.createElement('div');
      empty.className = 'day empty';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateKey = this.formatDate(date);
      const dayStats = this.dailyStats[dateKey] || {};
      const count = Number(dayStats.count || 0);
      const words = Array.isArray(dayStats.words) ? dayStats.words : [];
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `day level-${this.getLevel(count)}`;
      element.dataset.date = dateKey;
      element.setAttribute(
        'aria-label',
        `${this.formatDateForDisplay(date)}，收藏 ${count} 个单词`
      );
      element.innerHTML = `
        <span class="day-number">${day}</span>
        ${count > 0 ? `<span class="day-count">${count} 个</span>` : ''}
      `;
      this.addDayEventListeners(element, date, count, words);
      grid.appendChild(element);
    }
  }

  addDayEventListeners(element, date, count, words) {
    element.addEventListener('mouseenter', event => {
      this.showTooltip(event, date, count);
    });
    element.addEventListener('mouseleave', () => this.hideTooltip());
    element.addEventListener('focus', event => this.showTooltip(event, date, count));
    element.addEventListener('blur', () => this.hideTooltip());
    element.addEventListener('click', () => this.showWordList(date, words));
  }

  showTooltip(event, date, count) {
    const dateText = this.formatDateForDisplay(date);
    this.tooltip.innerHTML = count
      ? `${dateText}<br>收藏了 ${count} 个单词`
      : `${dateText}<br>没有收藏新单词`;
    this.tooltip.classList.add('show');

    const rect = event.currentTarget.getBoundingClientRect();
    this.tooltip.style.left = `${rect.left + rect.width / 2}px`;
    this.tooltip.style.top = `${rect.top - 10}px`;
    this.tooltip.style.transform = 'translate(-50%, -100%)';
  }

  hideTooltip() {
    this.tooltip.classList.remove('show');
  }

  showWordList(date, words) {
    const wordList = document.getElementById('wordList');
    if (!words.length) {
      wordList.style.display = 'none';
      return;
    }

    document.getElementById('wordListTitle').textContent =
      `${this.formatDateForDisplay(date)} 收藏的单词`;
    const container = document.getElementById('wordsContainer');
    container.innerHTML = '';
    words.forEach(word => {
      const tag = document.createElement('span');
      tag.className = 'word-tag';
      tag.textContent = word;
      container.appendChild(tag);
    });
    wordList.style.display = 'block';
  }

  getLevel(count) {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 10) return 3;
    return 4;
  }

  updateStats() {
    const stats = this.calculateStats();
    document.getElementById('totalWords').textContent = this.totalWordCount;
    document.getElementById('thisWeek').textContent = stats.thisWeek;
    document.getElementById('thisMonth').textContent = stats.selectedMonth;
    document.getElementById('longestStreak').textContent = stats.longestStreak;
  }

  calculateStats() {
    const now = new Date();
    const startOfWeek = new Date(now);
    const weekday = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - (weekday === 0 ? 6 : weekday - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const selectedYear = this.currentMonth.getFullYear();
    const selectedMonth = this.currentMonth.getMonth();
    let thisWeek = 0;
    let selectedMonthCount = 0;
    const activeDates = [];

    for (const [dateKey, dayStats] of Object.entries(this.dailyStats)) {
      const date = this.parseDate(dateKey);
      const count = Number(dayStats?.count || 0);
      if (date >= startOfWeek && date <= now) thisWeek += count;
      if (date.getFullYear() === selectedYear && date.getMonth() === selectedMonth) {
        selectedMonthCount += count;
      }
      if (count > 0) activeDates.push(date);
    }

    activeDates.sort((a, b) => a - b);
    let longestStreak = 0;
    let currentStreak = 0;
    let previous = null;
    for (const date of activeDates) {
      const daysApart = previous
        ? Math.round((date - previous) / (24 * 60 * 60 * 1000))
        : null;
      currentStreak = daysApart === 1 ? currentStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      previous = date;
    }

    return {
      thisWeek,
      selectedMonth: selectedMonthCount,
      longestStreak
    };
  }

  parseDate(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateForDisplay(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('heatmapContainer').style.display = 'block';
  }

  showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('heatmapContainer').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new HeatmapPage();
});

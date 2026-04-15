// 热力图页面逻辑
class HeatmapPage {
  constructor() {
    this.currentYear = new Date().getFullYear();
    this.dailyStats = {};
    this.tooltip = document.getElementById('tooltip');
    this.init();
  }

  async init() {
    try {
      await this.loadData();
      this.setupEventListeners();
      this.renderHeatmap();
      this.updateStats();
      this.hideLoading();
    } catch (error) {
      console.error('初始化热力图失败:', error);
      this.showError();
    }
  }

  async loadData() {
    return new Promise((resolve, reject) => {
      // 获取一年的日期范围
      const startDate = new Date(this.currentYear, 0, 1);
      const endDate = new Date(this.currentYear, 11, 31);
      
      chrome.runtime.sendMessage({
        action: 'GET_DAILY_STATS',
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (response && response.success) {
          this.dailyStats = response.data || {};
          resolve();
        } else {
          reject(new Error('获取数据失败'));
        }
      });
    });
  }

  setupEventListeners() {
    // 年份选择器
    const yearSelector = document.getElementById('yearSelector');
    yearSelector.addEventListener('change', (e) => {
      this.currentYear = parseInt(e.target.value);
      this.loadData().then(() => {
        this.renderHeatmap();
        this.updateStats();
      });
    });

    // 初始化年份选择器选项
    this.initYearSelector();
  }

  initYearSelector() {
    const yearSelector = document.getElementById('yearSelector');
    const currentYear = new Date().getFullYear();
    
    // 清空现有选项
    yearSelector.innerHTML = '';
    
    // 添加最近3年的选项
    for (let year = currentYear; year >= currentYear - 2; year--) {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = `${year}年`;
      if (year === this.currentYear) {
        option.selected = true;
      }
      yearSelector.appendChild(option);
    }
  }

  renderHeatmap() {
    this.renderMonths();
    this.renderDays();
  }

  renderMonths() {
    const monthsRow = document.getElementById('monthsRow');
    monthsRow.innerHTML = '';
    
    const months = ['1月', '2月', '3月', '4月', '5月', '6月', 
                   '7月', '8月', '9月', '10月', '11月', '12月'];
    
    months.forEach(month => {
      const monthElement = document.createElement('div');
      monthElement.className = 'month';
      monthElement.textContent = month;
      monthsRow.appendChild(monthElement);
    });
  }

  renderDays() {
    const weeksContainer = document.getElementById('weeksContainer');
    weeksContainer.innerHTML = '';
    
    // 获取年份的第一天和最后一天
    const startDate = new Date(this.currentYear, 0, 1);
    const endDate = new Date(this.currentYear, 11, 31);
    
    // 调整到周一开始
    const firstDay = new Date(startDate);
    const dayOfWeek = firstDay.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    firstDay.setDate(firstDay.getDate() - daysToSubtract);
    
    // 计算需要多少周
    const totalDays = Math.ceil((endDate - firstDay) / (1000 * 60 * 60 * 24)) + 1;
    const totalWeeks = Math.ceil(totalDays / 7);
    
    // 生成每周的格子
    for (let week = 0; week < totalWeeks; week++) {
      const weekElement = document.createElement('div');
      weekElement.className = 'week';
      
      for (let day = 0; day < 7; day++) {
        const currentDate = new Date(firstDay);
        currentDate.setDate(firstDay.getDate() + week * 7 + day);
        
        const dayElement = document.createElement('div');
        dayElement.className = 'day';
        
        // 只显示当前年份的日期
        if (currentDate.getFullYear() === this.currentYear) {
          const dateStr = this.formatDate(currentDate);
          const wordCount = this.dailyStats[dateStr] ? this.dailyStats[dateStr].count : 0;
          const words = this.dailyStats[dateStr] ? this.dailyStats[dateStr].words : [];
          
          // 设置颜色等级
          dayElement.classList.add(`level-${this.getLevel(wordCount)}`);
          
          // 添加数据属性
          dayElement.dataset.date = dateStr;
          dayElement.dataset.count = wordCount;
          dayElement.dataset.words = JSON.stringify(words);
          
          // 添加鼠标事件
          this.addDayEventListeners(dayElement, currentDate, wordCount, words);
        } else {
          dayElement.style.visibility = 'hidden';
        }
        
        weekElement.appendChild(dayElement);
      }
      
      weeksContainer.appendChild(weekElement);
    }
  }

  addDayEventListeners(dayElement, date, count, words) {
    dayElement.addEventListener('mouseenter', (e) => {
      this.showTooltip(e, date, count, words);
    });
    
    dayElement.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });
    
    dayElement.addEventListener('click', () => {
      this.showWordList(date, words);
    });
  }

  showTooltip(event, date, count, words) {
    const tooltip = this.tooltip;
    const dateStr = this.formatDateForDisplay(date);
    
    let content = `${dateStr}<br>`;
    if (count === 0) {
      content += '没有学习新单词';
    } else {
      content += `学习了 ${count} 个新单词`;
    }
    
    tooltip.innerHTML = content;
    tooltip.classList.add('show');
    
    // 定位tooltip
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 10}px`;
    tooltip.style.transform = 'translate(-50%, -100%)';
  }

  hideTooltip() {
    this.tooltip.classList.remove('show');
  }

  showWordList(date, words) {
    const wordList = document.getElementById('wordList');
    const wordListTitle = document.getElementById('wordListTitle');
    const wordsContainer = document.getElementById('wordsContainer');
    
    if (words && words.length > 0) {
      wordListTitle.textContent = `${this.formatDateForDisplay(date)} 学习的单词`;
      wordsContainer.innerHTML = '';
      
      words.forEach(word => {
        const wordTag = document.createElement('span');
        wordTag.className = 'word-tag';
        wordTag.textContent = word;
        wordsContainer.appendChild(wordTag);
      });
      
      wordList.style.display = 'block';
    } else {
      wordList.style.display = 'none';
    }
  }

  getLevel(count) {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 10) return 3;
    return 4;
  }

  updateStats() {
    // 计算统计数据
    const stats = this.calculateStats();
    
    // 更新UI
    document.getElementById('totalWords').textContent = stats.totalWords;
    document.getElementById('thisWeek').textContent = stats.thisWeek;
    document.getElementById('thisMonth').textContent = stats.thisMonth;
    document.getElementById('longestStreak').textContent = stats.longestStreak;
  }

  calculateStats() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    let totalWords = 0;
    let thisWeek = 0;
    let thisMonth = 0;
    let longestStreak = 0;
    let currentStreak = 0;
    
    // 获取本周开始日期（周一）
    const startOfWeek = new Date(now);
    const dayOfWeek = startOfWeek.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(startOfWeek.getDate() - daysToSubtract);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // 获取本月开始日期
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    
    // 按日期排序处理数据
    const sortedDates = Object.keys(this.dailyStats).sort();
    
    for (const dateStr of sortedDates) {
      const date = new Date(dateStr);
      const stats = this.dailyStats[dateStr];
      const count = stats.count || 0;
      
      // 总单词数
      totalWords += count;
      
      // 本周新增
      if (date >= startOfWeek && date <= now) {
        thisWeek += count;
      }
      
      // 本月新增
      if (date >= startOfMonth && date <= now) {
        thisMonth += count;
      }
      
      // 计算连续天数
      if (count > 0) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    
    return {
      totalWords,
      thisWeek,
      thisMonth,
      longestStreak
    };
  }

  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  formatDateForDisplay(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
  }

  hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('heatmapContainer').style.display = 'block';
  }

  showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new HeatmapPage();
});

// 处理返回按钮
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('back-btn')) {
    window.close();
  }
});
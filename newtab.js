// 新标签页复习系统
class ReviewSystem {
    constructor() {
        this.wordsForReview = [];
        this.currentWordIndex = 0;
        this.reviewedToday = 0;
        this.correctToday = 0;
        this.totalWords = 0;
        this.masteredWords = 0;
        
        this.initElements();
        this.init();
    }

    initElements() {
        // 获取DOM元素
        this.loadingEl = document.getElementById('loading');
        this.statsEl = document.getElementById('stats');
        this.reviewCardEl = document.getElementById('review-card');
        this.noWordsEl = document.getElementById('no-words');
        
        this.currentWordEl = document.getElementById('current-word');
        this.currentDefinitionEl = document.getElementById('current-definition');
        this.showBtn = document.getElementById('show-btn');
        this.correctBtn = document.getElementById('correct-btn');
        this.wrongBtn = document.getElementById('wrong-btn');
        
        this.totalWordsEl = document.getElementById('total-words');
        this.reviewWordsEl = document.getElementById('review-words');
        this.masteredWordsEl = document.getElementById('mastered-words');
        this.accuracyRateEl = document.getElementById('accuracy-rate');
        this.progressBarEl = document.getElementById('progress-bar');
        
        // 绑定事件
        this.showBtn.addEventListener('click', () => this.showDefinition());
        this.correctBtn.addEventListener('click', () => this.handleAnswer(true));
        this.wrongBtn.addEventListener('click', () => this.handleAnswer(false));
    }

    async init() {
        try {
            // 获取待复习单词
            await this.loadWordsForReview();
            await this.loadStats();
            
            this.loadingEl.style.display = 'none';
            this.statsEl.style.display = 'block';
            
            if (this.wordsForReview.length > 0) {
                this.showCurrentWord();
                this.reviewCardEl.style.display = 'block';
            } else {
                this.noWordsEl.style.display = 'block';
            }
        } catch (error) {
            console.error('初始化复习系统失败:', error);
            this.showError('加载失败，请刷新页面重试');
        }
    }

    async loadWordsForReview() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'GET_WORDS_FOR_REVIEW',
                payload: {
                    limit: 5
                }
            }, (response) => {
                if (response && response.ok) {
                    this.wordsForReview = response.data || [];
                    resolve();
                } else {
                    reject(new Error(response?.error || '获取复习单词失败'));
                }
            });
        });
    }

    async loadStats() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['word_book'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                const wordBook = result.word_book || {};
                const words = Object.values(wordBook);
                
                this.totalWords = words.length;
                this.masteredWords = words.filter(word => 
                    word.reviewStage >= 8 // 已掌握阶段
                ).length;
                
                this.updateStatsDisplay();
                resolve();
            });
        });
    }

    updateStatsDisplay() {
        this.totalWordsEl.textContent = this.totalWords;
        this.reviewWordsEl.textContent = this.wordsForReview.length;
        this.masteredWordsEl.textContent = this.masteredWords;
        
        const accuracy = this.reviewedToday > 0 
            ? Math.round((this.correctToday / this.reviewedToday) * 100)
            : 0;
        this.accuracyRateEl.textContent = `${accuracy}%`;
        
        // 更新进度条
        const progress = this.wordsForReview.length > 0 
            ? (this.currentWordIndex / this.wordsForReview.length) * 100
            : 100;
        this.progressBarEl.style.width = `${progress}%`;
    }

    showCurrentWord() {
        if (this.currentWordIndex >= this.wordsForReview.length) {
            this.showCompletionMessage();
            return;
        }

        const currentWord = this.wordsForReview[this.currentWordIndex];
        this.currentWordEl.textContent = currentWord.word;
        this.currentDefinitionEl.textContent = currentWord.definition;
        
        // 重置UI状态
        this.currentDefinitionEl.classList.remove('show');
        this.showBtn.style.display = 'inline-block';
        this.correctBtn.style.display = 'none';
        this.wrongBtn.style.display = 'none';
        this.showBtn.disabled = false;
        
        // 重置按钮的禁用状态
        this.correctBtn.disabled = false;
        this.wrongBtn.disabled = false;
        
        this.updateStatsDisplay();
    }

    showDefinition() {
        this.currentDefinitionEl.classList.add('show');
        this.showBtn.style.display = 'none';
        this.correctBtn.style.display = 'inline-block';
        this.wrongBtn.style.display = 'inline-block';
    }

    async handleAnswer(isCorrect) {
        const currentWord = this.wordsForReview[this.currentWordIndex];
        
        // 禁用按钮防止重复点击
        this.correctBtn.disabled = true;
        this.wrongBtn.disabled = true;
        
        try {
            // 更新复习状态
            await this.updateReviewStatus(currentWord.word, isCorrect);
            
            // 更新统计
            this.reviewedToday++;
            if (isCorrect) {
                this.correctToday++;
            }
            
            // 显示反馈
            this.showFeedback(isCorrect);
            
            // 延迟后显示下一个单词
            setTimeout(() => {
                this.currentWordIndex++;
                this.showCurrentWord();
            }, 1500);
            
        } catch (error) {
            console.error('更新复习状态失败:', error);
            this.showError('更新失败，请重试');
            
            // 重新启用按钮
            this.correctBtn.disabled = false;
            this.wrongBtn.disabled = false;
        }
    }

    async updateReviewStatus(word, isCorrect) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'UPDATE_REVIEW_STATUS',
                payload: {
                    word: word,
                    isCorrect: isCorrect
                }
            }, (response) => {
                if (response && response.ok) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.error || '更新复习状态失败'));
                }
            });
        });
    }

    showFeedback(isCorrect) {
        const button = isCorrect ? this.correctBtn : this.wrongBtn;
        const originalText = button.textContent;
        
        button.textContent = isCorrect ? '✓ 很好！' : '✗ 继续努力';
        button.style.transform = 'scale(1.1)';
        
        setTimeout(() => {
            button.textContent = originalText;
            button.style.transform = 'scale(1)';
        }, 1000);
    }

    showCompletionMessage() {
        this.reviewCardEl.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 4rem; margin-bottom: 20px;">🎉</div>
                <h2 style="color: #667eea; margin-bottom: 15px;">今日复习完成！</h2>
                <p style="color: #666; font-size: 1.1rem; line-height: 1.6;">
                    恭喜你完成了今天的单词复习！<br>
                    复习了 ${this.reviewedToday} 个单词，正确率 ${Math.round((this.correctToday / this.reviewedToday) * 100)}%
                </p>
                <button class="btn btn-show" onclick="window.close()" style="margin-top: 20px;">
                    关闭页面
                </button>
            </div>
        `;
    }

    showError(message) {
        this.loadingEl.innerHTML = `
            <div style="color: #f44336; font-size: 1.1rem;">
                ❌ ${message}
            </div>
        `;
    }
}

// 页面加载完成后初始化复习系统
document.addEventListener('DOMContentLoaded', () => {
    new ReviewSystem();
});

// 键盘快捷键支持
document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
        // 空格键或回车键显示释义
        const showBtn = document.getElementById('show-btn');
        if (showBtn && showBtn.style.display !== 'none' && !showBtn.disabled) {
            e.preventDefault();
            showBtn.click();
        }
    } else if (e.key === '1' || e.key === 'y' || e.key === 'Y') {
        // 1键或Y键表示记住了
        const correctBtn = document.getElementById('correct-btn');
        if (correctBtn && correctBtn.style.display !== 'none' && !correctBtn.disabled) {
            e.preventDefault();
            correctBtn.click();
        }
    } else if (e.key === '2' || e.key === 'n' || e.key === 'N') {
        // 2键或N键表示没记住
        const wrongBtn = document.getElementById('wrong-btn');
        if (wrongBtn && wrongBtn.style.display !== 'none' && !wrongBtn.disabled) {
            e.preventDefault();
            wrongBtn.click();
        }
    }
});
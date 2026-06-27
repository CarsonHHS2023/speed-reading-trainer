// ==================== 状态管理 ====================
const state = {
    content: '',
    units: [],
    pages: [],
    currentIndex: 0,
    currentPageIndex: 0,
    isPlaying: false,
    isPaused: false,
    language: 'chinese',
    speed: 300,
    lineWidth: 20,
    lineCount: 4,
    fontSize: 28,
    viewMode: 'focus',
    startTime: 0,
    pausedTime: 0,
    totalPausedDuration: 0,
    fileType: 'txt', // 'txt' 或 'pdf'
};

// ==================== DOM 元素 ====================
const elements = {
    language: document.getElementById('language'),
    speedSlider: document.getElementById('speedSlider'),
    speedInput: document.getElementById('speedInput'),
    speedUnit: document.getElementById('speedUnit'),
    widthSlider: document.getElementById('widthSlider'),
    widthInput: document.getElementById('widthInput'),
    linesSlider: document.getElementById('linesSlider'),
    linesInput: document.getElementById('linesInput'),
    fontSlider: document.getElementById('fontSlider'),
    fontInput: document.getElementById('fontInput'),
    viewMode: document.getElementById('viewMode'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),
    currentPos: document.getElementById('currentPos'),
    totalWords: document.getElementById('totalWords'),
    progressFill: document.getElementById('progressFill'),
    readingTime: document.getElementById('readingTime'),
    focusText: document.getElementById('focusText'),
    focusModeDisplay: document.getElementById('focusModeDisplay'),
    pageModeDisplay: document.getElementById('pageModeDisplay'),
    pageText: document.getElementById('pageText'),
};

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    // 速度设置
    elements.speedSlider.addEventListener('input', (e) => {
        elements.speedInput.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });
    elements.speedInput.addEventListener('change', (e) => {
        elements.speedSlider.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });

    // 行宽设置
    elements.widthSlider.addEventListener('input', (e) => {
        elements.widthInput.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
    });

    // 行数设置
    elements.linesSlider.addEventListener('input', (e) => {
        elements.linesInput.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
    });
    elements.linesInput.addEventListener('change', (e) => {
        elements.linesSlider.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
    });

    // 字体设置
    elements.fontSlider.addEventListener('input', (e) => {
        elements.fontInput.value = e.target.value;
        state.fontSize = parseInt(e.target.value);
        updateFontSize();
    });
    elements.fontInput.addEventListener('change', (e) => {
        elements.fontSlider.value = e.target.value;
        state.fontSize = parseInt(e.target.value);
        updateFontSize();
    });

    // 语言设置
    elements.language.addEventListener('change', (e) => {
        state.language = e.target.value;
        updateSpeedUnit();
        if (state.content) {
            tokenizeContent();
        }
    });

    // 显示方式
    elements.viewMode.addEventListener('change', (e) => {
        state.viewMode = e.target.value;
        switchViewMode();
    });

    // 控制按钮
    elements.startBtn.addEventListener('click', startReading);
    elements.pauseBtn.addEventListener('click', pauseReading);
    elements.resumeBtn.addEventListener('click', resumeReading);
    elements.stopBtn.addEventListener('click', stopReading);
});

// ==================== 分词处理 ====================
function tokenizeContent() {
    const text = state.content.trim();

    if (state.language === 'chinese') {
        state.units = text.split('').filter(char => char.trim() !== '');
    } else {
        state.units = text.match(/\b\w+\b/g) || [];
    }

    elements.totalWords.textContent = state.units.length;
    
    // 生成整页式的页面
    if (state.fileType === 'txt') {
        generatePages();
    }
    
    updateProgress();
}

// ==================== 页面生成 ====================
function generatePages() {
    const charsPerPage = state.lineWidth * state.lineCount;
    state.pages = [];
    
    for (let i = 0; i < state.units.length; i += charsPerPage) {
        const pageUnits = state.units.slice(i, i + charsPerPage);
        let pageText = '';
        let lineLength = 0;
        
        for (let j = 0; j < pageUnits.length; j++) {
            pageText += pageUnits[j];
            lineLength++;
            
            if (lineLength >= state.lineWidth) {
                pageText += '\n';
                lineLength = 0;
            }
        }
        
        state.pages.push(pageText);
    }
}

// ==================== 阅读控制 ====================
let readingInterval = null;

function startReading() {
    if (!state.content) {
        alert('请先选择书籍');
        return;
    }

    state.isPlaying = true;
    state.isPaused = false;
    state.startTime = Date.now() - state.totalPausedDuration;

    elements.startBtn.disabled = true;
    elements.pauseBtn.disabled = false;
    elements.resumeBtn.disabled = true;
    elements.stopBtn.disabled = false;

    disableSettings();
    startReadingLoop();
}

function pauseReading() {
    state.isPlaying = false;
    state.isPaused = true;
    state.pausedTime = Date.now();
    clearInterval(readingInterval);

    elements.pauseBtn.disabled = true;
    elements.resumeBtn.disabled = false;
}

function resumeReading() {
    state.isPlaying = true;
    state.isPaused = false;
    state.totalPausedDuration += Date.now() - state.pausedTime;

    elements.pauseBtn.disabled = false;
    elements.resumeBtn.disabled = true;

    startReadingLoop();
}

function stopReading() {
    state.isPlaying = false;
    state.isPaused = false;
    state.currentIndex = 0;
    state.currentPageIndex = 0;
    clearInterval(readingInterval);

    elements.startBtn.disabled = false;
    elements.pauseBtn.disabled = true;
    elements.resumeBtn.disabled = true;
    elements.stopBtn.disabled = true;

    enableSettings();
    resetDisplay();
    updateProgress();
}

function startReadingLoop() {
    if (state.viewMode === 'focus') {
        startFocusModeLoop();
    } else {
        startPageModeLoop();
    }
}

function startFocusModeLoop() {
    const intervalMs = calculateInterval();

    readingInterval = setInterval(() => {
        if (state.currentIndex < state.units.length) {
            updateDisplay();
            state.currentIndex++;
            updateProgress();

            if (state.currentIndex >= state.units.length) {
                clearInterval(readingInterval);
                onReadingComplete();
            }
        }
    }, intervalMs);
}

function startPageModeLoop() {
    const intervalMs = calculateInterval() * state.lineWidth * state.lineCount;

    readingInterval = setInterval(() => {
        if (state.currentPageIndex < state.pages.length) {
            updateDisplay();
            state.currentPageIndex++;
            state.currentIndex = Math.min(state.currentPageIndex * state.lineWidth * state.lineCount, state.units.length);
            updateProgress();

            if (state.currentPageIndex >= state.pages.length) {
                clearInterval(readingInterval);
                onReadingComplete();
            }
        }
    }, intervalMs);
}

function calculateInterval() {
    return 60000 / state.speed;
}

// ==================== 显示更新 ====================
function updateDisplay() {
    if (state.viewMode === 'focus') {
        updateFocusMode();
    } else {
        updatePageMode();
    }
}

function updateFocusMode() {
    const displayCount = state.lineWidth * state.lineCount;
    const endIndex = Math.min(state.currentIndex + displayCount, state.units.length);
    const displayUnits = state.units.slice(state.currentIndex, endIndex);

    let html = '';
    let lineLength = 0;

    for (let i = 0; i < displayUnits.length; i++) {
        html += displayUnits[i];
        lineLength++;

        if (lineLength >= state.lineWidth) {
            html += '<br>';
            lineLength = 0;
        }
    }

    elements.focusText.innerHTML = html;
}

function updatePageMode() {
    if (state.fileType === 'txt' && state.currentPageIndex < state.pages.length) {
        // TXT文件按行宽和行数分页
        elements.pageText.textContent = state.pages[state.currentPageIndex];
    } else if (state.fileType === 'pdf') {
        // PDF显示原档整页（这里需要PDF库支持）
        // 暂时显示当前页内容
        elements.pageText.textContent = `PDF第 ${state.currentPageIndex + 1} 页`;
    }
}

function resetDisplay() {
    elements.focusText.textContent = '选择书籍开始阅读';
    elements.pageText.textContent = '选择书籍开始阅读';
}

// ==================== 进度更新 ====================
function updateProgress() {
    const totalUnits = state.units.length;
    const percentage = totalUnits > 0 ? Math.round((state.currentIndex / totalUnits) * 100) : 0;

    elements.currentPos.textContent = state.currentIndex;
    elements.progressFill.style.width = percentage + '%';

    if (state.isPlaying) {
        const elapsedMs = Date.now() - state.startTime;
        const minutes = Math.floor(elapsedMs / 60000);
        const seconds = Math.floor((elapsedMs % 60000) / 1000);
        elements.readingTime.textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

// ==================== 工具函数 ====================
function updateSpeedUnit() {
    elements.speedUnit.textContent = state.language === 'chinese' ? '字/分钟' : '词/分钟';
}

function updateFontSize() {
    elements.focusText.style.fontSize = state.fontSize + 'px';
    elements.pageText.style.fontSize = state.fontSize + 'px';
}

function switchViewMode() {
    if (state.viewMode === 'focus') {
        elements.focusModeDisplay.classList.add('active');
        elements.pageModeDisplay.classList.remove('active');
    } else {
        elements.focusModeDisplay.classList.remove('active');
        elements.pageModeDisplay.classList.add('active');
    }
}

function disableSettings() {
    elements.language.disabled = true;
    elements.speedSlider.disabled = true;
    elements.speedInput.disabled = true;
    elements.widthSlider.disabled = true;
    elements.widthInput.disabled = true;
    elements.linesSlider.disabled = true;
    elements.linesInput.disabled = true;
    elements.fontSlider.disabled = true;
    elements.fontInput.disabled = true;
    elements.viewMode.disabled = true;
}

function enableSettings() {
    elements.language.disabled = false;
    elements.speedSlider.disabled = false;
    elements.speedInput.disabled = false;
    elements.widthSlider.disabled = false;
    elements.widthInput.disabled = false;
    elements.linesSlider.disabled = false;
    elements.linesInput.disabled = false;
    elements.fontSlider.disabled = false;
    elements.fontInput.disabled = false;
    elements.viewMode.disabled = false;
}

function onReadingComplete() {
    alert('阅读完成！继续加油！💪');
    stopReading();
}

// ==================== 与书架系统联动 ====================
function updateBookContent(fileType = 'txt') {
    if (bookshelf?.currentBook) {
        state.content = bookshelf.currentBook.content;
        state.fileType = fileType;
        state.currentIndex = 0;
        state.currentPageIndex = 0;
        state.totalPausedDuration = 0;
        tokenizeContent();
        resetDisplay();
        elements.startBtn.disabled = false;
    }
}

// 初始化
updateSpeedUnit();
updateFontSize();
switchViewMode();

// ==================== 状态管理 ====================
const state = {
    content: '',
    units: [],
    pages: [],
    currentIndex: 0,
    currentPageIndex: 0,
    currentLineIndex: 0,
    isPlaying: false,
    isPaused: false,
    language: 'chinese',
    speed: 5000,
    lineWidth: 35,
    lineCount: 3,
    pageLineWidth: 20,
    pageMaxLines: 20,
    fontSize: 28,
    displayMode: 'focus', // 'focus' 或 'page'
    trainingMode: 'fixed', // 'fixed' 或 'scroll'
    startTime: 0,
    pausedTime: 0,
    totalPausedDuration: 0,
    fileType: 'txt', // 'txt' 或 'pdf'
    scrollLineOffset: 0, // 用于滚动式的行偏移
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
    pageWidthSlider: document.getElementById('pageWidthSlider'),
    pageWidthInput: document.getElementById('pageWidthInput'),
    maxLinesSlider: document.getElementById('maxLinesSlider'),
    maxLinesInput: document.getElementById('maxLinesInput'),
    fontSlider: document.getElementById('fontSlider'),
    fontInput: document.getElementById('fontInput'),
    displayMode: document.getElementById('displayMode'),
    trainingMode: document.getElementById('trainingMode'),
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
    focusSettings: document.getElementById('focusSettings'),
    pageSettings: document.getElementById('pageSettings'),
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

    // 焦点式：行宽设置
    elements.widthSlider.addEventListener('input', (e) => {
        elements.widthInput.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            updateDisplay();
        }
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            updateDisplay();
        }
    });

    // 焦点式：行数设置
    elements.linesSlider.addEventListener('input', (e) => {
        elements.linesInput.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
        if (state.isPaused) {
            updateDisplay();
        }
    });
    elements.linesInput.addEventListener('change', (e) => {
        elements.linesSlider.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
        if (state.isPaused) {
            updateDisplay();
        }
    });

    // 整页式：行宽设置
    elements.pageWidthSlider.addEventListener('input', (e) => {
        elements.pageWidthInput.value = e.target.value;
        state.pageLineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
            updateDisplay();
        }
    });
    elements.pageWidthInput.addEventListener('change', (e) => {
        elements.pageWidthSlider.value = e.target.value;
        state.pageLineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
            updateDisplay();
        }
    });

    // 整页式：最大行数设置
    elements.maxLinesSlider.addEventListener('input', (e) => {
        elements.maxLinesInput.value = e.target.value;
        state.pageMaxLines = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
            updateDisplay();
        }
    });
    elements.maxLinesInput.addEventListener('change', (e) => {
        elements.maxLinesSlider.value = e.target.value;
        state.pageMaxLines = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
            updateDisplay();
        }
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
            if (state.isPaused) {
                updateDisplay();
            }
        }
    });

    // 显示模式
    elements.displayMode.addEventListener('change', (e) => {
        state.displayMode = e.target.value;
        switchDisplayMode();
        if (state.isPaused && state.content) {
            updateDisplay();
        }
    });

    // 训练模式
    elements.trainingMode.addEventListener('change', (e) => {
        state.trainingMode = e.target.value;
        updateTrainingModeClass();
        if (state.isPaused && state.displayMode === 'focus') {
            updateDisplay();
        }
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
    generatePages();
    updateProgress();
}

// ==================== 页面生成 ====================
function generatePages() {
    state.pages = [];
    
    if (state.displayMode === 'focus') {
        // 焦点式不需要分页
        return;
    }

    if (state.fileType === 'txt') {
        // TXT文件：按行宽和最大行数分页
        const charsPerPage = state.pageLineWidth * state.pageMaxLines;
        
        for (let i = 0; i < state.units.length; i += charsPerPage) {
            const pageUnits = state.units.slice(i, i + charsPerPage);
            let pageText = '';
            let lineLength = 0;
            
            for (let j = 0; j < pageUnits.length; j++) {
                pageText += pageUnits[j];
                lineLength++;
                
                if (lineLength >= state.pageLineWidth) {
                    pageText += '\n';
                    lineLength = 0;
                }
            }
            
            state.pages.push({
                text: pageText,
                charCount: pageUnits.length
            });
        }
    } else if (state.fileType === 'pdf') {
        // PDF：每页就是一个文档页面
        state.pages = Array.from({ length: 100 }, (_, i) => ({
            text: `PDF 第 ${i + 1} 页`,
            charCount: 100 // 假设每页100个字符
        }));
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
    state.currentIndex = 0;
    state.scrollLineOffset = 0;

    elements.startBtn.disabled = true;
    elements.pauseBtn.disabled = false;
    elements.resumeBtn.disabled = true;
    elements.stopBtn.disabled = false;

    disableSettingsDuringReading();
    startReadingLoop();
}

function pauseReading() {
    state.isPlaying = false;
    state.isPaused = true;
    state.pausedTime = Date.now();
    clearInterval(readingInterval);

    elements.pauseBtn.disabled = true;
    elements.resumeBtn.disabled = false;
    
    enableSettingsDuringPause();
}

function resumeReading() {
    state.isPlaying = true;
    state.isPaused = false;
    state.totalPausedDuration += Date.now() - state.pausedTime;

    elements.pauseBtn.disabled = false;
    elements.resumeBtn.disabled = true;

    disableSettingsDuringReading();
    startReadingLoop();
}

function stopReading() {
    state.isPlaying = false;
    state.isPaused = false;
    state.currentIndex = 0;
    state.currentPageIndex = 0;
    state.currentLineIndex = 0;
    state.scrollLineOffset = 0;
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
    if (state.displayMode === 'focus') {
        startFocusLoop();
    } else {
        startPageLoop();
    }
}

// ==================== 焦点式显示循环（完整行数模式） ====================
function startFocusLoop() {
    const charsPerBatch = state.lineWidth * state.lineCount; // 每批显示的字数
    const intervalMs = (60000 / state.speed) * charsPerBatch; // 停留时间（毫秒）

    console.log('=== startFocusLoop 开始 ===');
    console.log('charsPerBatch:', charsPerBatch);
    console.log('intervalMs:', intervalMs);
    console.log('总字数:', state.units.length);

    function showNextBatch() {
        console.log('showNextBatch - currentIndex:', state.currentIndex, '总字数:', state.units.length);
        
        if (state.currentIndex >= state.units.length) {
            console.log('阅读完成');
            clearInterval(readingInterval);
            onReadingComplete();
            return;
        }

        // 显示当前批次
        console.log('调用 updateFocusDisplay()');
        updateFocusDisplay();
        
        // 更新进度
        updateProgress();
        
        // 移动到下一批
        state.currentIndex += charsPerBatch;
        console.log('移动后 currentIndex:', state.currentIndex);
        
        // 滚动式：每批后更新行偏移，使得内容向上滚动
        if (state.trainingMode === 'scroll') {
            state.scrollLineOffset += state.lineCount;
            console.log('滚动式 - scrollLineOffset:', state.scrollLineOffset);
        }
    }

    // 立即显示第一批
    console.log('--- 立即显示第一批 ---');
    showNextBatch();
    
    // 清除旧的定时器（防止多个定时器并存）
    if (readingInterval) {
        console.log('清除旧定时器');
        clearInterval(readingInterval);
    }
    
    // 然后每隔 intervalMs 毫秒显示下一批
    console.log('设置定时器，间隔:', intervalMs, 'ms');
    readingInterval = setInterval(() => {
        if (state.isPlaying) {
            console.log('--- 定时器触发，显示下一批 ---');
            showNextBatch();
        }
    }, intervalMs);
}

function startPageLoop() {
    // 整页式按页停留，时间根据该页字符数计算
    if (state.currentPageIndex >= state.pages.length) {
        onReadingComplete();
        return;
    }

    updateDisplay();
    const charCount = state.pages[state.currentPageIndex].charCount;
    const intervalMs = (60000 / state.speed) * charCount;

    state.currentPageIndex++;
    state.currentIndex = Math.min(state.currentPageIndex * state.pageLineWidth * state.pageMaxLines, state.units.length);
    updateProgress();

    readingInterval = setTimeout(() => {
        if (state.isPlaying) {
            startPageLoop();
        }
    }, intervalMs);
}

// ==================== 显示更新 ====================
function updateDisplay() {
    if (state.displayMode === 'focus') {
        updateFocusDisplay();
    } else {
        updatePageDisplay();
    }
}

function updateFocusDisplay() {
    const charsPerBatch = state.lineWidth * state.lineCount;
    const batchStart = state.currentIndex;
    const batchEnd = Math.min(state.currentIndex + charsPerBatch, state.units.length);
    const displayUnits = state.units.slice(batchStart, batchEnd);

    let html = '';
    let lineLength = 0;

    // 固定式：直接显示当前批次
    if (state.trainingMode === 'fixed') {
        for (let i = 0; i < displayUnits.length; i++) {
            html += displayUnits[i];
            lineLength++;

            if (lineLength >= state.lineWidth) {
                html += '<br>';
                lineLength = 0;
            }
        }
    } else {
        // 滚动式：从头开始，根据scrollLineOffset往下显示
        const charsToSkip = state.scrollLineOffset * state.lineWidth;
        const scrollStart = Math.min(charsToSkip, state.units.length);
        const scrollEnd = Math.min(scrollStart + charsPerBatch, state.units.length);
        const scrollUnits = state.units.slice(scrollStart, scrollEnd);
        
        for (let i = 0; i < scrollUnits.length; i++) {
            html += scrollUnits[i];
            lineLength++;

            if (lineLength >= state.lineWidth) {
                html += '<br>';
                lineLength = 0;
            }
        }
    }

    elements.focusText.innerHTML = html;
}

function updatePageDisplay() {
    if (state.fileType === 'txt' && state.currentPageIndex < state.pages.length) {
        elements.pageText.textContent = state.pages[state.currentPageIndex].text;
    } else if (state.fileType === 'pdf') {
        elements.pageText.textContent = state.pages[state.currentPageIndex]?.text || '加载中...';
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

function switchDisplayMode() {
    if (state.displayMode === 'focus') {
        elements.focusModeDisplay.classList.add('active');
        elements.pageModeDisplay.classList.remove('active');
        elements.focusSettings.style.display = 'block';
        elements.pageSettings.style.display = 'none';
    } else {
        elements.focusModeDisplay.classList.remove('active');
        elements.pageModeDisplay.classList.add('active');
        elements.focusSettings.style.display = 'none';
        elements.pageSettings.style.display = 'block';
    }
}

function updateTrainingModeClass() {
    if (state.trainingMode === 'scroll') {
        elements.focusText.classList.add('scroll-mode');
    } else {
        elements.focusText.classList.remove('scroll-mode');
    }
}

function disableSettingsDuringReading() {
    elements.language.disabled = true;
    elements.speedSlider.disabled = true;
    elements.speedInput.disabled = true;
    elements.widthSlider.disabled = true;
    elements.widthInput.disabled = true;
    elements.linesSlider.disabled = true;
    elements.linesInput.disabled = true;
    elements.pageWidthSlider.disabled = true;
    elements.pageWidthInput.disabled = true;
    elements.maxLinesSlider.disabled = true;
    elements.maxLinesInput.disabled = true;
    elements.fontSlider.disabled = true;
    elements.fontInput.disabled = true;
    elements.displayMode.disabled = true;
    elements.trainingMode.disabled = true;
}

function enableSettingsDuringPause() {
    elements.language.disabled = false;
    elements.speedSlider.disabled = false;
    elements.speedInput.disabled = false;
    elements.widthSlider.disabled = false;
    elements.widthInput.disabled = false;
    elements.linesSlider.disabled = false;
    elements.linesInput.disabled = false;
    elements.pageWidthSlider.disabled = false;
    elements.pageWidthInput.disabled = false;
    elements.maxLinesSlider.disabled = false;
    elements.maxLinesInput.disabled = false;
    elements.fontSlider.disabled = false;
    elements.fontInput.disabled = false;
    elements.displayMode.disabled = false;
    elements.trainingMode.disabled = false;
}

function enableSettings() {
    elements.language.disabled = false;
    elements.speedSlider.disabled = false;
    elements.speedInput.disabled = false;
    elements.widthSlider.disabled = false;
    elements.widthInput.disabled = false;
    elements.linesSlider.disabled = false;
    elements.linesInput.disabled = false;
    elements.pageWidthSlider.disabled = false;
    elements.pageWidthInput.disabled = false;
    elements.maxLinesSlider.disabled = false;
    elements.maxLinesInput.disabled = false;
    elements.fontSlider.disabled = false;
    elements.fontInput.disabled = false;
    elements.displayMode.disabled = false;
    elements.trainingMode.disabled = false;
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
        state.scrollLineOffset = 0;
        tokenizeContent();
        resetDisplay();
        elements.startBtn.disabled = false;
    }
}

// 初始化
updateSpeedUnit();
updateFontSize();
switchDisplayMode();
updateTrainingModeClass();

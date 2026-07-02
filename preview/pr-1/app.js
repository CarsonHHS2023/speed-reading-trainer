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
    pageMaxLines: 20,
    fontSize: 28,
    fontWeight: 'normal',
    displayMode: 'focus',
    trainingMode: 'fixed',
    startTime: 0,
    pausedTime: 0,
    totalPausedDuration: 0,
    fileType: 'txt',
    scrollLineOffset: 0,
    focusMaxLines: 0,
    focusLineHeight: 0,
    currentLine: 0,
    theme: 'light',
    imageMarkerMap: {},
    pendingImageMarkerIndex: null,
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
    maxLinesSlider: document.getElementById('maxLinesSlider'),
    maxLinesInput: document.getElementById('maxLinesInput'),
    fontSlider: document.getElementById('fontSlider'),
    fontInput: document.getElementById('fontInput'),
    fontWeight: document.getElementById('fontWeight'),
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
    themeToggleBtn: document.getElementById('themeToggleBtn'),
};

// ==================== 主题切换 ====================
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    state.theme = savedTheme;
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const body = document.body;
    if (theme === 'dark') {
        body.classList.add('dark-mode');
        elements.themeToggleBtn.textContent = '☀️';
    } else {
        body.classList.remove('dark-mode');
        elements.themeToggleBtn.textContent = '🌙';
    }
    state.theme = theme;
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
}

const CONTENT_DELIMITER = '$%$%$%';

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    elements.themeToggleBtn.addEventListener('click', toggleTheme);

    elements.focusText.addEventListener('click', (e) => {
        if (e.target.closest('[data-role="image-continue"]') && state.isPaused && state.pendingImageMarkerIndex !== null) {
            continueFromImageMarker();
        }
    });
    
    elements.speedSlider.addEventListener('input', (e) => {
        elements.speedInput.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });
    elements.speedInput.addEventListener('change', (e) => {
        elements.speedSlider.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });

    elements.widthSlider.addEventListener('input', (e) => {
        elements.widthInput.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused && state.fileType === 'txt') {
            generatePages();
            updateDisplay();
        }
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused && state.fileType === 'txt') {
            generatePages();
            updateDisplay();
        }
    });

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

    elements.maxLinesSlider.addEventListener('input', (e) => {
        elements.maxLinesInput.value = e.target.value;
        state.pageMaxLines = parseInt(e.target.value);
        if (state.isPaused && state.fileType === 'txt') {
            generatePages();
            updateDisplay();
        }
    });
    elements.maxLinesInput.addEventListener('change', (e) => {
        elements.maxLinesSlider.value = e.target.value;
        state.pageMaxLines = parseInt(e.target.value);
        if (state.isPaused && state.fileType === 'txt') {
            generatePages();
            updateDisplay();
        }
    });

    elements.fontSlider.addEventListener('input', (e) => {
        elements.fontInput.value = e.target.value;
        state.fontSize = parseInt(e.target.value);
        updateFontSize();
        if (state.displayMode === 'focus') {
            calculateFocusParameters();
            if (state.isPaused) {
                updateDisplay();
            }
        }
    });
    elements.fontInput.addEventListener('change', (e) => {
        elements.fontSlider.value = e.target.value;
        state.fontSize = parseInt(e.target.value);
        updateFontSize();
        if (state.displayMode === 'focus') {
            calculateFocusParameters();
            if (state.isPaused) {
                updateDisplay();
            }
        }
    });

    elements.fontWeight.addEventListener('change', (e) => {
        state.fontWeight = e.target.value;
        updateFontWeight();
    });

    elements.language.addEventListener('change', (e) => {
        state.language = e.target.value;
        updateSpeedUnit();
        if (state.content && state.fileType === 'txt') {
            tokenizeContent();
            if (state.isPaused) {
                updateDisplay();
            }
        }
    });

    elements.displayMode.addEventListener('change', (e) => {
        state.displayMode = e.target.value;
        switchDisplayMode();
        if (state.isPaused && state.content) {
            updateDisplay();
        }
    });

    elements.trainingMode.addEventListener('change', (e) => {
        state.trainingMode = e.target.value;
        updateTrainingModeClass();
        if (state.isPaused && state.displayMode === 'focus' && state.fileType === 'txt') {
            updateDisplay();
        }
    });

    elements.startBtn.addEventListener('click', startReading);
    elements.pauseBtn.addEventListener('click', pauseReading);
    elements.resumeBtn.addEventListener('click', resumeReading);
    elements.stopBtn.addEventListener('click', stopReading);
});

// ==================== 分词处理 ====================
function tokenizeContent() {
    const text = state.content.trim();
    const parts = text.split(CONTENT_DELIMITER);
    const units = [];
    const imageMarkerMap = {};

    for (let i = 0; i < parts.length; i += 2) {
        const textSegment = parts[i] || '';
        const textUnits = state.language === 'chinese'
            ? textSegment.split('').filter(char => char.trim() !== '')
            : (textSegment.match(/\b\w+\b/g) || []);

        units.push(...textUnits);

        const imageId = (parts[i + 1] || '').trim();
        if (imageId) {
            imageMarkerMap[units.length] = imageId;
            units.push(CONTENT_DELIMITER);
        }
    }

    state.units = units;
    state.imageMarkerMap = imageMarkerMap;
    state.pendingImageMarkerIndex = null;

    elements.totalWords.textContent = state.units.length;
    generatePages();
    updateProgress();
}

// ==================== 页面生成 ====================
function generatePages() {
    state.pages = [];
    
    if (state.displayMode === 'focus') {
        return;
    }

    if (state.fileType === 'txt') {
        let i = 0;

        while (i < state.units.length) {
            if (state.units[i] === CONTENT_DELIMITER) {
                state.pages.push({
                    text: '',
                    charCount: 1,
                    startIndex: i,
                    endIndex: i + 1,
                    isImageMarker: true,
                    imageId: state.imageMarkerMap[i]
                });
                i++;
                continue;
            }

            const startIndex = i;
            let pageText = '';
            let lineLength = 0;
            let lineCount = 1;
            let charCount = 0;

            while (i < state.units.length && lineCount <= state.pageMaxLines) {
                if (state.units[i] === CONTENT_DELIMITER) {
                    break;
                }

                pageText += state.units[i];
                charCount++;
                lineLength++;

                i++;

                if (lineLength >= state.lineWidth) {
                    pageText += '\n';
                    lineLength = 0;
                    lineCount++;
                }
            }

            state.pages.push({
                text: pageText,
                charCount,
                startIndex,
                endIndex: i,
                isImageMarker: false
            });
        }
    }
}

// ==================== 计算焦点式参数 ====================
function calculateFocusParameters() {
    const focusContainer = elements.focusModeDisplay;
    const containerHeight = focusContainer.clientHeight;
    const lineHeight = 1.8 * state.fontSize;
    const effectiveHeight = containerHeight - state.fontSize;
    
    state.focusMaxLines = Math.floor(effectiveHeight / lineHeight);
    state.focusLineHeight = effectiveHeight / state.focusMaxLines;
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
    state.currentLine = 0;
    state.pendingImageMarkerIndex = null;

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
    const pauseDuration = Date.now() - state.pausedTime;
    state.totalPausedDuration += pauseDuration;
    state.startTime += pauseDuration;

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
    state.currentLine = 0;
    state.pendingImageMarkerIndex = null;
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

function getCurrentImageMarkerId() {
    return state.imageMarkerMap[state.currentIndex];
}

async function fetchImageData(imageId) {
    const response = await fetch(`https://carsonhhs-pdf-ocr-service.hf.space/api/v1/images/${encodeURIComponent(imageId)}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.image_data) {
        throw new Error('未返回图像数据');
    }

    return result.image_data.startsWith('data:image')
        ? result.image_data
        : `data:image/png;base64,${result.image_data}`;
}

async function pauseForImageMarker() {
    const imageId = getCurrentImageMarkerId();
    if (!imageId) {
        state.currentIndex++;
        return false;
    }

    clearInterval(readingInterval);

    state.isPlaying = false;
    state.isPaused = true;
    state.pendingImageMarkerIndex = state.currentIndex;

    elements.pauseBtn.disabled = true;
    elements.resumeBtn.disabled = true;

    elements.focusModeDisplay.classList.add('active');
    elements.pageModeDisplay.classList.remove('active');
    elements.focusText.style.marginTop = '0';
    elements.focusText.innerHTML = '⏳ 正在加载图像...';

    try {
        const imageSrc = await fetchImageData(imageId);
        elements.focusText.innerHTML = `
            <div style="text-align:center;">
                <img src="${imageSrc}" alt="内容图像" style="max-width:100%; max-height:60vh; object-fit:contain; border-radius:8px; cursor:pointer;" />
                <div data-role="image-continue" style="margin-top:10px; color:#667eea; cursor:pointer; font-size:0.95rem;">点击图像继续阅读</div>
            </div>
        `;
    } catch (error) {
        console.error('图像加载失败:', error);
        elements.focusText.innerHTML = `
            <div style="text-align:center;">
                <div style="margin-bottom:10px;">图像加载失败，请点击继续</div>
                <div data-role="image-continue" style="color:#667eea; cursor:pointer;">继续阅读</div>
            </div>
        `;
    }

    return true;
}

function continueFromImageMarker() {
    if (state.pendingImageMarkerIndex === null) {
        return;
    }

    state.currentIndex = state.pendingImageMarkerIndex + 1;
    state.pendingImageMarkerIndex = null;

    state.isPaused = false;
    state.isPlaying = true;

    elements.pauseBtn.disabled = false;
    elements.resumeBtn.disabled = true;

    switchDisplayMode();
    disableSettingsDuringReading();
    startReadingLoop();
}

// ==================== 焦点式显示循环 ====================
function startFocusLoop() {
    state.currentLine = 0;

    async function showNextBatch() {
        if (state.currentIndex >= state.units.length) {
            clearInterval(readingInterval);
            onReadingComplete();
            return;
        }

        if (state.units[state.currentIndex] === CONTENT_DELIMITER) {
            await pauseForImageMarker();
            return;
        }

        const charsPerBatch = state.lineWidth * state.lineCount;
        const batchEnd = Math.min(state.currentIndex + charsPerBatch, state.units.length);
        let safeBatchEnd = batchEnd;

        for (let i = state.currentIndex; i < batchEnd; i++) {
            if (state.units[i] === CONTENT_DELIMITER) {
                safeBatchEnd = i;
                break;
            }
        }

        updateFocusDisplay(safeBatchEnd);
        updateProgress();

        state.currentIndex = safeBatchEnd;
        state.currentLine += state.lineCount;

        if (state.currentLine + state.lineCount > state.focusMaxLines) {
            state.currentLine = 0;
        }
    }

    showNextBatch();

    if (readingInterval) {
        clearInterval(readingInterval);
    }

    const charsPerBatch = state.lineWidth * state.lineCount;
    const intervalMs = (60000 / state.speed) * charsPerBatch;

    readingInterval = setInterval(async () => {
        if (state.isPlaying) {
            await showNextBatch();
        }
    }, intervalMs);
}

function startPageLoop() {
    if (state.currentPageIndex >= state.pages.length) {
        onReadingComplete();
        return;
    }

    const currentPage = state.pages[state.currentPageIndex];
    if (currentPage.isImageMarker) {
        state.currentIndex = currentPage.startIndex;
        state.currentPageIndex++;
        pauseForImageMarker();
        return;
    }

    updateDisplay();
    const charCount = currentPage.charCount;
    const intervalMs = (60000 / state.speed) * charCount;

    state.currentPageIndex++;
    state.currentIndex = currentPage.endIndex;
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

function updateFocusDisplay(customBatchEnd = null) {
    const charsPerBatch = state.lineWidth * state.lineCount;
    const batchStart = state.currentIndex;
    const batchEnd = customBatchEnd === null
        ? Math.min(state.currentIndex + charsPerBatch, state.units.length)
        : customBatchEnd;
    const displayUnits = state.units.slice(batchStart, batchEnd);

    let html = '';
    let lineLength = 0;

    for (let i = 0; i < displayUnits.length; i++) {
        if (displayUnits[i] === CONTENT_DELIMITER) {
            break;
        }
        html += displayUnits[i];
        lineLength++;

        if (lineLength >= state.lineWidth) {
            html += '<br>';
            lineLength = 0;
        }
    }

    elements.focusText.innerHTML = html;

    if (state.trainingMode === 'fixed') {
        elements.focusText.style.marginTop = '0';
    } else {
        const marginTop = state.currentLine * state.focusLineHeight;
        elements.focusText.style.marginTop = marginTop + 'px';
    }
}

function updatePageDisplay() {
    if (state.fileType === 'txt' && state.currentPageIndex < state.pages.length) {
        elements.pageText.textContent = state.pages[state.currentPageIndex].text;
    }
}

function resetDisplay() {
    elements.focusText.textContent = '选择书籍开始阅读';
    elements.focusText.style.marginTop = '0';
    elements.pageText.textContent = '选择书籍开始阅读';
}

// ==================== 进度更新 ====================
function updateProgress() {
    let totalUnits, currentIndex;
    
    totalUnits = state.units.length;
    currentIndex = state.currentIndex;
    
    const percentage = totalUnits > 0 ? Math.round((currentIndex / totalUnits) * 100) : 0;

    elements.currentPos.textContent = currentIndex;
    elements.totalWords.textContent = totalUnits;
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

function updateFontWeight() {
    elements.focusText.style.fontWeight = state.fontWeight;
    elements.pageText.style.fontWeight = state.fontWeight;
}

function switchDisplayMode() {
    if (state.displayMode === 'focus') {
        elements.focusModeDisplay.classList.add('active');
        elements.pageModeDisplay.classList.remove('active');
        elements.focusSettings.style.display = 'block';
        elements.pageSettings.style.display = 'none';
        
        calculateFocusParameters();
    } else {
        elements.focusModeDisplay.classList.remove('active');
        elements.pageModeDisplay.classList.add('active');
        elements.focusSettings.style.display = 'none';
        elements.pageSettings.style.display = 'block';
        
        recalculatePageMaxLines();
        
        if (state.content && state.fileType === 'txt') {
            generatePages();
        }
    }
}

function recalculatePageMaxLines() {
    const pageContainer = elements.pageModeDisplay;
    const containerHeight = pageContainer.clientHeight;
    const lineHeight = 1.8 * state.fontSize;
    const maxLines = Math.floor((containerHeight * 0.95) / lineHeight);
    state.pageMaxLines = Math.max(1, Math.min(maxLines, 50));
    elements.maxLinesSlider.value = state.pageMaxLines;
    elements.maxLinesInput.value = state.pageMaxLines;
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
    elements.maxLinesSlider.disabled = true;
    elements.maxLinesInput.disabled = true;
    elements.fontSlider.disabled = true;
    elements.fontInput.disabled = true;
    elements.fontWeight.disabled = true;
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
    elements.maxLinesSlider.disabled = false;
    elements.maxLinesInput.disabled = false;
    elements.fontSlider.disabled = false;
    elements.fontInput.disabled = false;
    elements.fontWeight.disabled = false;
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
    elements.maxLinesSlider.disabled = false;
    elements.maxLinesInput.disabled = false;
    elements.fontSlider.disabled = false;
    elements.fontInput.disabled = false;
    elements.fontWeight.disabled = false;
    elements.displayMode.disabled = false;
    elements.trainingMode.disabled = false;
}

function onReadingComplete() {
    alert('阅读完成！继续加油！💪');
    stopReading();
}

// 初始化
updateSpeedUnit();
updateFontSize();
updateFontWeight();
switchDisplayMode();
updateTrainingModeClass();
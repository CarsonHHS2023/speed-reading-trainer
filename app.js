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
    
    // PDF 相关
    pdfElements: [],
    pdfUnitMap: {},
    currentElementIndex: 0,
    chartRotation: 0,
    chartFlipped: false,
    pdfDocument: null,
    isProcessing: false,
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
    
    chartDisplay: document.getElementById('chartDisplay'),
    chartImage: document.getElementById('chartImage'),
    rotateLeftBtn: document.getElementById('rotateLeftBtn'),
    rotateRightBtn: document.getElementById('rotateRightBtn'),
    flipVerticalBtn: document.getElementById('flipVerticalBtn'),
    uploadZone: document.getElementById('uploadZone'),
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

// ==================== 图表旋转和翻转 ====================
function getChartTransform() {
    let transform = `rotate(${state.chartRotation}deg)`;
    if (state.chartFlipped) {
        transform += ' scaleY(-1)';
    }
    return transform;
}

function updateChartDisplay() {
    if (elements.chartImage && elements.chartImage.src) {
        elements.chartImage.style.transform = getChartTransform();
    }
}

function rotateChartLeft() {
    state.chartRotation = (state.chartRotation - 90 + 360) % 360;
    updateChartDisplay();
}

function rotateChartRight() {
    state.chartRotation = (state.chartRotation + 90) % 360;
    updateChartDisplay();
}

function flipChartVertical() {
    state.chartFlipped = !state.chartFlipped;
    updateChartDisplay();
}

// ==================== 上传状态管理 ====================
function setUploadStatus(status) {
    // status: 'idle', 'processing', 'completed'
    if (status === 'processing') {
        elements.uploadZone.classList.add('processing');
        elements.uploadZone.classList.remove('completed');
    } else if (status === 'completed') {
        elements.uploadZone.classList.remove('processing');
        elements.uploadZone.classList.add('completed');
    } else {
        elements.uploadZone.classList.remove('processing', 'completed');
    }
}

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
    
    elements.rotateLeftBtn.addEventListener('click', rotateChartLeft);
    elements.rotateRightBtn.addEventListener('click', rotateChartRight);
    elements.flipVerticalBtn.addEventListener('click', flipChartVertical);
    
    elements.chartImage.addEventListener('click', (e) => {
        if (e.target === elements.chartImage && state.isPaused && state.fileType === 'pdf') {
            continueFromChart();
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
        return;
    }

    if (state.fileType === 'txt') {
        const charsPerPage = state.lineWidth * state.pageMaxLines;
        
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
            
            state.pages.push({
                text: pageText,
                charCount: pageUnits.length
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
    state.currentElementIndex = 0;

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
    state.currentElementIndex = 0;
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
    if (state.fileType === 'pdf') {
        startPDFLoop();
    } else if (state.displayMode === 'focus') {
        startFocusLoop();
    } else {
        startPageLoop();
    }
}

// ==================== PDF 阅读循环 ====================
function startPDFLoop() {
    console.log('=== 开始 PDF 阅读 ===');
    console.log('总单位数:', state.units.length);
    
    if (state.currentIndex >= state.units.length) {
        onReadingComplete();
        return;
    }
    
    showPDFFocusContent();
}

function showPDFFocusContent() {
    if (state.currentIndex >= state.units.length) {
        onReadingComplete();
        return;
    }
    
    const unitIndex = state.currentIndex;
    const mapping = state.pdfUnitMap[unitIndex];
    
    if (!mapping) {
        state.currentIndex++;
        showPDFFocusContent();
        return;
    }
    
    const element = state.pdfElements[mapping.elementIndex];
    
    if (mapping.isChart) {
        displayChartElement(element);
        state.isPaused = true;
    } else {
        displayPDFFocusContent();
        const charsPerBatch = state.lineWidth * state.lineCount;
        const stopDuration = (60000 / state.speed) * charsPerBatch;
        
        state.currentIndex += charsPerBatch;
        updateProgress();
        
        readingInterval = setTimeout(() => {
            if (state.isPlaying) {
                showPDFFocusContent();
            }
        }, stopDuration);
    }
}

function displayPDFFocusContent() {
    elements.chartDisplay.style.display = 'none';
    elements.focusModeDisplay.style.display = 'block';
    elements.pageModeDisplay.style.display = 'none';
    
    const charsPerBatch = state.lineWidth * state.lineCount;
    const batchStart = state.currentIndex;
    const batchEnd = Math.min(state.currentIndex + charsPerBatch, state.units.length);
    const displayUnits = state.units.slice(batchStart, batchEnd);
    
    let html = '';
    let lineLength = 0;
    
    for (let i = 0; i < displayUnits.length; i++) {
        const char = displayUnits[i];
        
        // 换行符转换为 <br> + 3个空格缩进
        if (char === '\n') {
            html += '<br>&nbsp;&nbsp;&nbsp;';
            lineLength = 3;
        } else {
            html += char;
            lineLength++;
        }
        
        if (lineLength >= state.lineWidth) {
            html += '<br>';
            lineLength = 0;
        }
    }
    
    elements.focusText.innerHTML = html;
    elements.focusText.style.fontSize = state.fontSize + 'px';
    elements.focusText.style.fontWeight = state.fontWeight;
}

async function displayChartElement(element) {
    elements.focusModeDisplay.style.display = 'none';
    elements.pageModeDisplay.style.display = 'none';
    elements.chartDisplay.style.display = 'flex';
    
    if (element.content === 'scan' && state.pdfDocument && element.pageNum) {
        try {
            const page = await state.pdfDocument.getPage(element.pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;
            
            elements.chartImage.src = canvas.toDataURL('image/png');
        } catch (error) {
            console.error('PDF 页面渲染失败:', error);
            elements.chartImage.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23ccc%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
        }
    } else {
        elements.chartImage.src = element.content;
    }
    
    state.chartRotation = 0;
    state.chartFlipped = false;
    updateChartDisplay();
}

function continueFromChart() {
    console.log('继续阅读（从图表）');
    const currentMapping = state.pdfUnitMap[state.currentIndex];
    if (currentMapping) {
        let nextIndex = state.currentIndex + 1;
        while (nextIndex < state.units.length && state.pdfUnitMap[nextIndex]?.elementIndex === currentMapping.elementIndex) {
            nextIndex++;
        }
        state.currentIndex = nextIndex;
    }
    state.isPaused = false;
    state.isPlaying = true;
    showPDFFocusContent();
}

// ==================== 焦点式显示循环 ====================
function startFocusLoop() {
    const charsPerBatch = state.lineWidth * state.lineCount;
    const intervalMs = (60000 / state.speed) * charsPerBatch;

    state.currentLine = 0;

    function showNextBatch() {
        if (state.currentIndex >= state.units.length) {
            clearInterval(readingInterval);
            onReadingComplete();
            return;
        }

        updateFocusDisplay();
        updateProgress();
        
        state.currentIndex += charsPerBatch;
        state.currentLine += state.lineCount;
        
        if (state.currentLine + state.lineCount > state.focusMaxLines) {
            state.currentLine = 0;
        }
    }

    showNextBatch();
    
    if (readingInterval) {
        clearInterval(readingInterval);
    }
    
    readingInterval = setInterval(() => {
        if (state.isPlaying) {
            showNextBatch();
        }
    }, intervalMs);
}

function startPageLoop() {
    if (state.currentPageIndex >= state.pages.length) {
        onReadingComplete();
        return;
    }

    updateDisplay();
    const charCount = state.pages[state.currentPageIndex].charCount;
    const intervalMs = (60000 / state.speed) * charCount;

    state.currentPageIndex++;
    state.currentIndex = Math.min(state.currentPageIndex * state.lineWidth * state.pageMaxLines, state.units.length);
    updateProgress();

    readingInterval = setTimeout(() => {
        if (state.isPlaying) {
            startPageLoop();
        }
    }, intervalMs);
}

// ==================== 显示更新 ====================
function updateDisplay() {
    if (state.fileType === 'pdf') {
        return;
    }
    
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

    for (let i = 0; i < displayUnits.length; i++) {
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
    elements.chartDisplay.style.display = 'none';
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

// ==================== PDF 处理 ====================
async function processPDFFile(file) {
    try {
        console.log('开始处理 PDF:', file.name);
        setUploadStatus('processing');
        
        const formData = new FormData();
        formData.append('pdf', file);
        
        const backendURL = 'https://pdf-processor-backend-2bnr.onrender.com';
        
        const response = await fetch(`${backendURL}/api/process-pdf`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('PDF 处理完成:', result);
        
        const pdfBuffer = await file.arrayBuffer();
        state.pdfDocument = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
        
        let allText = '';
        state.pdfElements = [];
        
        result.data.pages.forEach((page, pageIndex) => {
            if (page.elements && Array.isArray(page.elements)) {
                page.elements.forEach((elem) => {
                    state.pdfElements.push({
                        type: elem.type,
                        content: elem.content,
                        isChart: elem.type === 'image',
                        pageNum: pageIndex + 1,
                        textCount: elem.textCount || 0
                    });
                    
                    if (elem.type === 'text') {
                        // 保留原始换行（不添加额外换行）
                        allText += elem.content;
                    }
                });
            }
        });
        
        console.log('原始文本长度:', allText.length);
        console.log('首200字符:', allText.substring(0, 200));
        
        // 分词时保留换行符
        if (state.language === 'chinese') {
            state.units = allText.split('').filter(char => {
                // 保留中文字符、空格和换行符，过滤其他空白符
                if (char === '\n') return true;
                if (char === ' ') return true;
                return char.trim() !== '';
            });
        } else {
            // 英文：按词和空格（包括换行）分割
            state.units = allText.split(/(\s+)/).filter(item => item && item.length > 0);
        }
        
        console.log('分词后长度:', state.units.length);
        
        // 建立单位到元素的映射
        state.pdfUnitMap = {};
        let unitIndex = 0;
        state.pdfElements.forEach((elem, elemIndex) => {
            if (elem.type === 'text') {
                let text = elem.content;
                let elemUnits;
                if (state.language === 'chinese') {
                    elemUnits = text.split('').filter(char => {
                        if (char === '\n') return true;
                        if (char === ' ') return true;
                        return char.trim() !== '';
                    });
                } else {
                    elemUnits = text.split(/(\s+)/).filter(item => item && item.length > 0);
                }
                
                for (let i = 0; i < elemUnits.length; i++) {
                    state.pdfUnitMap[unitIndex++] = {
                        elementIndex: elemIndex,
                        isChart: false
                    };
                }
            } else {
                state.pdfUnitMap[unitIndex++] = {
                    elementIndex: elemIndex,
                    isChart: true
                };
            }
        });
        
        state.content = file.name;
        state.fileType = 'pdf';
        state.currentIndex = 0;
        state.currentElementIndex = 0;
        state.totalPausedDuration = 0;
        
        elements.totalWords.textContent = state.units.length;
        elements.currentPos.textContent = '0';
        
        resetDisplay();
        elements.startBtn.disabled = false;
        setUploadStatus('completed');
        
        console.log('PDF 处理完成，总单位数:', state.units.length);
        
    } catch (error) {
        console.error('PDF 处理失败:', error);
        alert('PDF 处理失败：' + error.message);
        setUploadStatus('idle');
    }
}

// 初始化
updateSpeedUnit();
updateFontSize();
updateFontWeight();
switchDisplayMode();
updateTrainingModeClass();

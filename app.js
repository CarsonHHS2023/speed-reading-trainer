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
    fontWeight: 'normal', // 'normal' 或 'bold'
    displayMode: 'focus', // 'focus' 或 'page'
    trainingMode: 'fixed', // 'fixed' 或 'scroll'
    startTime: 0,
    pausedTime: 0,
    totalPausedDuration: 0,
    fileType: 'txt', // 'txt' 或 'pdf'
    scrollLineOffset: 0, // 用于滚动式的行偏移
    focusMaxLines: 0, // 焦点式屏幕能容纳的行数
    focusLineHeight: 0, // 焦点式每行高度
    currentLine: 0, // 当前显示的起始行号
    theme: 'light', // 'light' 或 'dark'
    
    // PDF 相关
    pdfElements: [], // PDF 处理后的所有元素
    currentElementIndex: 0, // 当前显示的元素索引
    chartRotation: 0, // 图表旋转角度 (0, 90, 180, 270)
    chartFlipped: false, // 图表是否垂直翻转
    pdfDocument: null, // PDF 文档对象（用于渲染页面）
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
    
    // PDF 图表相关
    chartDisplay: document.getElementById('chartDisplay'),
    chartImage: document.getElementById('chartImage'),
    rotateLeftBtn: document.getElementById('rotateLeftBtn'),
    rotateRightBtn: document.getElementById('rotateRightBtn'),
    flipVerticalBtn: document.getElementById('flipVerticalBtn'),
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

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    // 初始化主题
    initTheme();
    
    // 主题切换按钮
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
    
    // 图表控制按钮
    elements.rotateLeftBtn.addEventListener('click', rotateChartLeft);
    elements.rotateRightBtn.addEventListener('click', rotateChartRight);
    elements.flipVerticalBtn.addEventListener('click', flipChartVertical);
    
    // 图表点击事件 - 点击图表本身继续阅读
    elements.chartImage.addEventListener('click', (e) => {
        // 确保点击的是图表本身，不是按钮
        if (e.target === elements.chartImage && state.isPaused && state.fileType === 'pdf') {
            continueFromChart();
        }
    });
    
    // 速度设置
    elements.speedSlider.addEventListener('input', (e) => {
        elements.speedInput.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });
    elements.speedInput.addEventListener('change', (e) => {
        elements.speedSlider.value = e.target.value;
        state.speed = parseInt(e.target.value);
    });

    // 行宽设置（全局）
    elements.widthSlider.addEventListener('input', (e) => {
        elements.widthInput.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
            updateDisplay();
        }
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused) {
            generatePages();
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

    // 字体大小设置
    elements.fontSlider.addEventListener('input', (e) => {
        elements.fontInput.value = e.target.value;
        state.fontSize = parseInt(e.target.value);
        updateFontSize();
        // 重新计算焦点式参数
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
        // 重新计算焦点式参数
        if (state.displayMode === 'focus') {
            calculateFocusParameters();
            if (state.isPaused) {
                updateDisplay();
            }
        }
    });

    // 字体粗细设置
    elements.fontWeight.addEventListener('change', (e) => {
        state.fontWeight = e.target.value;
        updateFontWeight();
    });

    // 语言设置
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
    
    // 计算单行高度（line-height: 1.8, fontSize: state.fontSize）
    const lineHeight = 1.8 * state.fontSize;
    
    // 屏幕高度减掉一个字体高度
    const effectiveHeight = containerHeight - state.fontSize;
    
    // 计算能容纳的最大行数
    state.focusMaxLines = Math.floor(effectiveHeight / lineHeight);
    state.focusLineHeight = effectiveHeight / state.focusMaxLines;
    
    console.log('calculateFocusParameters:');
    console.log('  containerHeight:', containerHeight);
    console.log('  fontSize:', state.fontSize);
    console.log('  effectiveHeight:', effectiveHeight);
    console.log('  lineHeight:', lineHeight);
    console.log('  focusMaxLines:', state.focusMaxLines);
    console.log('  focusLineHeight:', state.focusLineHeight);
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
    console.log('总元素数:', state.pdfElements.length);
    
    if (state.currentElementIndex >= state.pdfElements.length) {
        onReadingComplete();
        return;
    }
    
    showNextPDFElement();
}

function showNextPDFElement() {
    if (state.currentElementIndex >= state.pdfElements.length) {
        onReadingComplete();
        return;
    }
    
    const element = state.pdfElements[state.currentElementIndex];
    
    if (element.type === 'text') {
        // 文字元素：根据字数计算停留时间
        displayTextElement(element);
        const stopDuration = (60000 / state.speed) * element.textCount;
        
        state.currentElementIndex++;
        updateProgress();
        
        readingInterval = setTimeout(() => {
            if (state.isPlaying) {
                showNextPDFElement();
            }
        }, stopDuration);
        
    } else if (element.type === 'image') {
        // 图表元素：显示并等待点击
        displayChartElement(element);
        state.isPaused = true;
        // 等待用户点击图表继续
    }
}

function displayTextElement(element) {
    // 隐藏图表，显示文字
    elements.chartDisplay.style.display = 'none';
    elements.focusModeDisplay.style.display = 'block';
    elements.pageModeDisplay.style.display = 'none';
    
    // 显示文字内容
    elements.focusText.textContent = element.content;
    elements.focusText.style.fontSize = state.fontSize + 'px';
    elements.focusText.style.fontWeight = state.fontWeight;
}

async function displayChartElement(element) {
    // 隐藏文字，显示图表
    elements.focusModeDisplay.style.display = 'none';
    elements.pageModeDisplay.style.display = 'none';
    elements.chartDisplay.style.display = 'flex';
    
    // 如果是标记为扫描页，用 pdfjs 渲染
    if (element.content === 'scan' && state.pdfDocument && element.pageNum) {
        try {
            const page = await state.pdfDocument.getPage(element.pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            
            // 创建 canvas 并渲染
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
            elements.chartImage.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23ccc%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22%3E渲染失败%3C/text%3E%3C/svg%3E';
        }
    } else {
        // 直接使用 base64 或其他内容
        elements.chartImage.src = element.content;
    }
    
    // 重置旋转和翻转
    state.chartRotation = 0;
    state.chartFlipped = false;
    updateChartDisplay();
}

function continueFromChart() {
    console.log('继续阅读（从图表）');
    state.currentElementIndex++;
    state.isPaused = false;
    state.isPlaying = true;
    showNextPDFElement();
}

// ==================== 焦点式显示循环 ====================
function startFocusLoop() {
    const charsPerBatch = state.lineWidth * state.lineCount;
    const intervalMs = (60000 / state.speed) * charsPerBatch;

    console.log('=== startFocusLoop 开始 ===');
    console.log('charsPerBatch:', charsPerBatch);
    console.log('intervalMs:', intervalMs);
    console.log('总字数:', state.units.length);

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
        return; // PDF 自己管理显示
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
    
    if (state.fileType === 'pdf') {
        totalUnits = state.pdfElements.length;
        currentIndex = state.currentElementIndex;
    } else {
        totalUnits = state.units.length;
        currentIndex = state.currentIndex;
    }
    
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
        
        if (state.content) {
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
        
        const formData = new FormData();
        formData.append('pdf', file);
        
        // 后端 URL
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
        
        // 加载 PDF 文档（用于后续渲染）
        const pdfBuffer = await file.arrayBuffer();
        state.pdfDocument = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
        
        // 转换后端数据为阅读程序格式
        const elements = [];
        
        result.data.pages.forEach((page, pageIndex) => {
            if (page.elements && Array.isArray(page.elements)) {
                page.elements.forEach((elem) => {
                    if (elem.type === 'text') {
                        elements.push({
                            type: 'text',
                            content: elem.content,
                            textCount: elem.textCount || elem.content.length,
                            pageNum: pageIndex + 1
                        });
                    } else if (elem.type === 'image') {
                        elements.push({
                            type: 'image',
                            content: elem.content, // 'scan' 或其他标记
                            isChart: elem.isChart,
                            pageNum: pageIndex + 1
                        });
                    }
                });
            }
        });
        
        state.pdfElements = elements;
        state.content = file.name; // 用文件名作为内容标识
        state.fileType = 'pdf';
        state.currentIndex = 0;
        state.currentElementIndex = 0;
        state.totalPausedDuration = 0;
        
        // 更新进度显示
        elements.totalWords.textContent = elements.length;
        elements.currentPos.textContent = '0';
        
        resetDisplay();
        elements.startBtn.disabled = false;
        
        console.log('PDF 处理完成，元素数:', elements.length);
        
    } catch (error) {
        console.error('PDF 处理失败:', error);
        alert('PDF 处理失败：' + error.message);
    }
}

// 初始化
updateSpeedUnit();
updateFontSize();
updateFontWeight();
switchDisplayMode();
updateTrainingModeClass();

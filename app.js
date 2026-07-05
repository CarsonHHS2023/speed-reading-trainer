// ==================== 状态管理 ====================
const state = {
    content: '',
    cachedContentBlob: null,
    units: [],
    pages: [],
    currentIndex: 0,
    currentPageIndex: 0,
    currentLineIndex: 0,
    isPlaying: false,
    isPaused: false,
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
    isContentLoading: false,
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
    stopBtn: document.getElementById('stopBtn'),
    currentPos: document.getElementById('currentPos'),
    totalWords: document.getElementById('totalWords'),
    progressSlider: document.getElementById('progressSlider'),
    readingTime: document.getElementById('readingTime'),
    focusText: document.getElementById('focusText'),
    focusModeDisplay: document.getElementById('focusModeDisplay'),
    pageModeDisplay: document.getElementById('pageModeDisplay'),
    pageText: document.getElementById('pageText'),
    focusSettings: document.getElementById('focusSettings'),
    pageSettings: document.getElementById('pageSettings'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    readingPanel: document.querySelector('.reading-panel'),
    chartDisplay: document.getElementById('chartDisplay'),
    chartImage: document.getElementById('chartImage'),
    rotateLeftBtn: document.getElementById('rotateLeftBtn'),
    rotateRightBtn: document.getElementById('rotateRightBtn'),
    flipVerticalBtn: document.getElementById('flipVerticalBtn'),
    flipHorizontalBtn: document.getElementById('flipHorizontalBtn'),
};

// ==================== 图像变换状态 ====================
const imageTransform = {
    rotation: 0,
    flipH: false,
    flipV: false,
};

function resetImageTransform() {
    imageTransform.rotation = 0;
    imageTransform.flipH = false;
    imageTransform.flipV = false;
}

function applyImageTransform() {
    const scaleX = imageTransform.flipH ? -1 : 1;
    const scaleY = imageTransform.flipV ? -1 : 1;
    elements.chartImage.style.transform =
        `rotate(${imageTransform.rotation}deg) scaleX(${scaleX}) scaleY(${scaleY})`;
}

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
const NEWLINE_TOKEN = '__NEWLINE__';

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    elements.themeToggleBtn.addEventListener('click', toggleTheme);

    elements.focusText.addEventListener('click', () => {
        toggleReadingArea();
    });

    elements.pageModeDisplay.addEventListener('click', () => {
        toggleReadingArea();
    });

    // 图像点击继续阅读
    elements.chartImage.addEventListener('click', () => {
        if (state.isPaused && state.pendingImageMarkerIndex !== null) {
            continueFromImageMarker();
        }
    });

    // 图像变换控制按钮（仅变换，不继续）
    elements.rotateLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        imageTransform.rotation = (imageTransform.rotation - 90 + 360) % 360;
        applyImageTransform();
    });
    elements.rotateRightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        imageTransform.rotation = (imageTransform.rotation + 90) % 360;
        applyImageTransform();
    });
    elements.flipVerticalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        imageTransform.flipV = !imageTransform.flipV;
        applyImageTransform();
    });
    elements.flipHorizontalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        imageTransform.flipH = !imageTransform.flipH;
        applyImageTransform();
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
        if (state.isPaused && state.content) {
            generatePages();
            updateDisplay();
        }
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
        if (state.isPaused && state.content) {
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
        if (state.isPaused && state.content) {
            generatePages();
            updateDisplay();
        }
    });
    elements.maxLinesInput.addEventListener('change', (e) => {
        elements.maxLinesSlider.value = e.target.value;
        state.pageMaxLines = parseInt(e.target.value);
        if (state.isPaused && state.content) {
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
        if (state.isPaused && state.displayMode === 'focus' && state.content) {
            updateDisplay();
        }
    });

    elements.startBtn.addEventListener('click', startReading);
    elements.stopBtn.addEventListener('click', stopReading);
    elements.progressSlider.addEventListener('input', (e) => {
        seekToProgress(Number(e.target.value) / Number(e.target.max || 1000));
    });

    updateStartButtonState();
});

// ==================== 分词处理 ====================
function tokenizeContent() {
    const text = state.content.trim();
    if (!text || text.length === 0) {
        state.units = [];
        state.imageMarkerMap = {};
        elements.totalWords.textContent = 0;
        return;
    }

    const parts = text.split(CONTENT_DELIMITER);
    const units = [];
    const imageMarkerMap = {};

    for (let i = 0; i < parts.length; i += 2) {
        const textSegment = parts[i] || '';
        if (textSegment.length > 0) {
            const textUnits = tokenizeTextSegment(textSegment);
            for (let j = 0; j < textUnits.length; j++) {
                units.push(textUnits[j]);
            }
        }

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

function tokenizeTextSegment(text) {
    if (!text || text.length === 0) {
        return [];
    }

    const units = [];
    let i = 0;

    while (i < text.length) {
        const char = text[i];

        // 统一跳过 CR
        if (char === '\r') {
            i++;
            continue;
        }

        // 保留真实换行
        if (char === '\n') {
            units.push(NEWLINE_TOKEN);
            i++;
            continue;
        }

        // 跳过所有空白（含半角空格、制表符、全角空格等）
        // 注意：\s 不一定稳定覆盖 \u3000，这里显式补上
        if (/\s/.test(char) || char === '\u3000') {
            i++;
            continue;
        }

        // 英文单词连续合并
        if (/[a-zA-Z]/.test(char)) {
            let word = '';
            while (i < text.length && /[a-zA-Z]/.test(text[i])) {
                word += text[i];
                i++;
            }
            units.push(word);
            continue;
        }

        // 其它可见字符（中文、标点等）
        units.push(char);
        i++;
    }

    return units;
}

function generatePages() {
    state.pages = [];

    if (state.displayMode === 'focus') {
        return;
    }

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

            if (state.units[i] === NEWLINE_TOKEN) {
                pageText += '\n';
                lineLength = 0;
                lineCount++;
                i++;
                continue;
            }

            pageText += state.units[i];
            charCount++;
            lineLength += state.units[i].length;

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

function calculateFocusParameters() {
    const focusContainer = elements.focusModeDisplay;
    const containerHeight = focusContainer.clientHeight;
    const lineHeight = 1.8 * state.fontSize;
    const effectiveHeight = containerHeight - state.fontSize;

    state.focusMaxLines = Math.floor(effectiveHeight / lineHeight);
    state.focusLineHeight = effectiveHeight / state.focusMaxLines;
}

let readingInterval = null;

function clearReadingTimer() {
    if (readingInterval) {
        clearInterval(readingInterval);
        clearTimeout(readingInterval);
        readingInterval = null;
    }
}

function updateStartButtonState() {
    elements.startBtn.disabled = state.isContentLoading || !state.cachedContentBlob || state.isPlaying || state.isPaused;
}

async function decodeText(arrayBuffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
    } catch (error) {
        try {
            return new TextDecoder('gb2312').decode(arrayBuffer);
        } catch (fallbackError) {
            return new TextDecoder('latin1').decode(arrayBuffer);
        }
    }
}

async function readTxtFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const text = await decodeText(arrayBuffer);

    const normalizedText = text
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/[ \t\u3000]+\n/g, '\n')   // 行尾空白清理
      .replace(/\n{2,}/g, '\n')            // 连续空行压缩
      .trim();

    state.content = normalizedText;
    state.currentIndex = 0;
    state.currentPageIndex = 0;
    state.currentLineIndex = 0;
    state.currentLine = 0;
    state.pausedTime = 0;
    state.totalPausedDuration = 0;
    state.pendingImageMarkerIndex = null;

    tokenizeContent();
}

async function startReading() {
    if (!state.cachedContentBlob) {
        alert('请先选择书籍');
        return;
    }

    clearReadingTimer();
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = true;

    try {
        await readTxtFile(state.cachedContentBlob);
    } catch (error) {
        console.error('TXT 文件读取失败:', error);
        alert('TXT 文件读取失败');
        updateStartButtonState();
        return;
    }

    if (!state.units.length) {
        updateStartButtonState();
        return;
    }

    state.isPlaying = true;
    state.isPaused = false;
    state.startTime = Date.now();

    elements.stopBtn.disabled = false;
    elements.readingPanel.classList.add('is-reading');

    disableSettingsDuringReading();
    startReadingLoop();
}

function pauseReading() {
    state.isPlaying = false;
    state.isPaused = true;
    state.pausedTime = Date.now();
    clearReadingTimer();

    elements.readingPanel.classList.add('is-reading');
    enableSettingsDuringPause();
}

function resumeReading() {
    state.isPlaying = true;
    state.isPaused = false;
    const pauseDuration = Date.now() - state.pausedTime;
    state.totalPausedDuration += pauseDuration;
    state.startTime += pauseDuration;

    elements.readingPanel.classList.add('is-reading');

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
    clearReadingTimer();

    elements.stopBtn.disabled = true;
    elements.readingPanel.classList.remove('is-reading');

    elements.chartDisplay.classList.remove('active');

    enableSettings();
    resetDisplay();
    updateProgress();
    updateStartButtonState();
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
    const response = await fetch(`${API_BASE_URL}/api/v1/images/${encodeURIComponent(imageId)}`);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
        let bodySnippet = '';
        try {
            const errorText = await response.text();
            bodySnippet = errorText.replace(/\s+/g, ' ').slice(0, 120);
        } catch (error) {
            bodySnippet = '';
        }

        throw new Error(`HTTP ${response.status}${bodySnippet ? ` - ${bodySnippet}` : ''}`);
    }

    if (contentType.includes('application/json')) {
        let result;
        try {
            result = await response.json();
        } catch (error) {
            throw new Error('图像接口返回了无效 JSON');
        }

        if (!result.image_data) {
            throw new Error('未返回图像数据');
        }

        return result.image_data.startsWith('data:image')
            ? result.image_data
            : `data:image/png;base64,${result.image_data}`;
    }

    const imageBlob = await response.blob();
    return URL.createObjectURL(imageBlob);
}

async function pauseForImageMarker() {
    const imageId = getCurrentImageMarkerId();
    if (!imageId) {
        state.currentIndex++;
        return false;
    }

    clearReadingTimer();

    state.isPlaying = false;
    state.isPaused = true;
    state.pendingImageMarkerIndex = state.currentIndex;

    // Show chart display overlay covering the full reading area
    resetImageTransform();
    elements.chartImage.src = '';
    elements.chartImage.alt = '正在加载图像...';
    elements.chartImage.style.transform = '';
    elements.chartDisplay.classList.add('active');

    try {
        const imageSrc = await fetchImageData(imageId);
        elements.chartImage.src = imageSrc;
        elements.chartImage.alt = '内容图像';
    } catch (error) {
        console.error('图像加载失败:', error);
        elements.chartImage.alt = '图像加载失败，请点击此处继续';
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

    elements.chartDisplay.classList.remove('active');

    switchDisplayMode();
    disableSettingsDuringReading();
    startReadingLoop();
}

function getFocusBatchInfo(startIndex) {
    let i = startIndex;
    let linesUsed = 1;
    let lineLength = 0;
    let charCount = 0;

    while (i < state.units.length) {
        const unit = state.units[i];

        if (unit === CONTENT_DELIMITER) {
            break;
        }

        if (unit === NEWLINE_TOKEN) {
            i++;
            if (linesUsed >= state.lineCount) {
                break;
            }
            linesUsed++;
            lineLength = 0;
            continue;
        }

        const unitLength = unit.length;

        if (lineLength + unitLength > state.lineWidth) {
            if (linesUsed >= state.lineCount) {
                break;
            }
            linesUsed++;
            lineLength = 0;
            continue;
        }

        lineLength += unitLength;
        charCount++;
        i++;
    }

    return {
        endIndex: i,
        charCount,
        linesUsed
    };
}

function startFocusLoop() {
    if (state.currentIndex === 0) {
        state.currentLine = 0;
    }

    const baseCharsPerBatch = state.lineWidth * state.lineCount;
    const minIntervalMs = (60000 / state.speed) * baseCharsPerBatch * 0.5;

    function showNextBatch() {
        if (state.currentIndex >= state.units.length) {
            clearReadingTimer();
            onReadingComplete();
            return;
        }

        if (state.units[state.currentIndex] === CONTENT_DELIMITER) {
            pauseForImageMarker();
            return;
        }

        const batchInfo = getFocusBatchInfo(state.currentIndex);

        // 防御：避免死循环
        if (batchInfo.endIndex <= state.currentIndex) {
            state.currentIndex++;
            if (state.currentIndex >= state.units.length) {
                clearReadingTimer();
                onReadingComplete();
            }
            return;
        }

        updateFocusDisplay(batchInfo.endIndex);
        updateProgress();

        state.currentIndex = batchInfo.endIndex;
        state.currentLine += batchInfo.linesUsed;

        if (state.currentLine + state.lineCount > state.focusMaxLines) {
            state.currentLine = 0;
        }

        if (state.currentIndex >= state.units.length) {
            clearReadingTimer();
            onReadingComplete();
            return;
        }

        if (!state.isPlaying) {
            return;
        }

        const effectiveChars = Math.max(1, batchInfo.charCount);
        const dynamicIntervalMs = (60000 / state.speed) * effectiveChars;
        const intervalMs = Math.max(dynamicIntervalMs, minIntervalMs);

        clearReadingTimer();
        readingInterval = setTimeout(() => {
            if (state.isPlaying) {
                showNextBatch();
            }
        }, intervalMs);
    }

    showNextBatch();
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

function updateDisplay() {
    if (state.displayMode === 'focus') {
        updateFocusDisplay();
    } else {
        updatePageDisplay();
    }
}

function updateFocusDisplay(customBatchEnd = null) {
    const batchStart = state.currentIndex;
    const batchEnd = customBatchEnd === null
        ? getFocusBatchInfo(batchStart).endIndex
        : customBatchEnd;

    const displayUnits = state.units.slice(batchStart, batchEnd);

    let html = '';
    let lineLength = 0;

    for (let i = 0; i < displayUnits.length; i++) {
        const unit = displayUnits[i];

        if (unit === CONTENT_DELIMITER) {
            break;
        }

        if (unit === NEWLINE_TOKEN) {
            // 已有内容时才换行，避免开头/连续空行导致空白行
            if (html !== '') {
                html += '<br>';
            }
            lineLength = 0;
            continue;
        }

        const unitLength = unit.length;

        // 超宽时先换行，但避免开头就插入空行
        if (lineLength + unitLength > state.lineWidth) {
            if (html !== '') {
                html += '<br>';
            }
            lineLength = 0;
        }

        html += unit;
        lineLength += unitLength;
    }

    // 去掉尾部空白行（关键：防止“3行里最后一行空白”）
    html = html.replace(/(<br>\s*)+$/g, '');

    elements.focusText.innerHTML = html;

    if (state.trainingMode === 'fixed') {
        elements.focusText.style.marginTop = '0';
    } else {
        const marginTop = state.currentLine * state.focusLineHeight;
        elements.focusText.style.marginTop = marginTop + 'px';
    }
}

function updatePageDisplay() {
    if (state.currentPageIndex < state.pages.length) {
        elements.pageText.textContent = state.pages[state.currentPageIndex].text;
    }
}

function resetDisplay() {
    elements.focusText.textContent = '选择书籍开始阅读';
    elements.focusText.style.marginTop = '0';
    elements.pageText.textContent = '选择书籍开始阅读';
}

function updateProgress() {
    const totalUnits = state.units.length;
    const currentIndex = state.currentIndex;

    const percentage = totalUnits > 0 ? Math.round((currentIndex / totalUnits) * 100) : 0;

    elements.currentPos.textContent = currentIndex;
    elements.totalWords.textContent = totalUnits;
    elements.progressSlider.value = Math.round((percentage / 100) * Number(elements.progressSlider.max || 1000));

    if (state.isPlaying) {
        const elapsedMs = Date.now() - state.startTime;
        const minutes = Math.floor(elapsedMs / 60000);
        const seconds = Math.floor((elapsedMs % 60000) / 1000);
        elements.readingTime.textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

function findSeekableIndex(targetIndex) {
    const totalUnits = state.units.length;
    if (totalUnits === 0) {
        return 0;
    }

    let index = Math.max(0, Math.min(targetIndex, totalUnits - 1));
    while (index < totalUnits && state.units[index] === CONTENT_DELIMITER) {
        index++;
    }
    while (index > 0 && state.units[index] === CONTENT_DELIMITER) {
        index--;
    }
    return Math.max(0, Math.min(index, totalUnits - 1));
}

function findSeekablePageIndex(targetPageIndex) {
    const totalPages = state.pages.length;
    if (totalPages === 0) {
        return 0;
    }

    let pageIndex = Math.max(0, Math.min(targetPageIndex, totalPages - 1));
    while (pageIndex < totalPages && state.pages[pageIndex]?.isImageMarker) {
        pageIndex++;
    }
    while (pageIndex > 0 && state.pages[pageIndex]?.isImageMarker) {
        pageIndex--;
    }
    return Math.max(0, Math.min(pageIndex, totalPages - 1));
}

function seekToProgress(ratio) {
    if (!state.units.length) {
        elements.progressSlider.value = 0;
        return;
    }

    const clampedRatio = Math.max(0, Math.min(Number.isFinite(ratio) ? ratio : 0, 1));
    const wasPlaying = state.isPlaying;
    clearReadingTimer();

    if (state.displayMode === 'focus') {
        const targetIndex = clampedRatio >= 1
            ? state.units.length - 1
            : Math.floor(state.units.length * clampedRatio);
        state.currentIndex = findSeekableIndex(targetIndex);
        state.currentLine = 0;
    } else {
        if (!state.pages.length) {
            generatePages();
        }
        const targetPageIndex = clampedRatio >= 1
            ? state.pages.length - 1
            : Math.floor(state.pages.length * clampedRatio);
        state.currentPageIndex = findSeekablePageIndex(targetPageIndex);
        state.currentIndex = state.pages[state.currentPageIndex]?.startIndex || 0;
    }

    updateDisplay();
    updateProgress();

    if (wasPlaying) {
        startReadingLoop();
    }
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
        elements.focusSettings.style.display = 'flex';
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

function toggleReadingArea() {
    if (state.pendingImageMarkerIndex !== null) {
        return;
    }
    if (state.isPlaying) {
        pauseReading();
        showReadingClickFeedback('⏸');
    } else if (state.isPaused) {
        resumeReading();
        showReadingClickFeedback('▶');
    }
}

function showReadingClickFeedback(icon) {
    const hint = document.createElement('div');
    hint.className = 'reading-click-hint';
    hint.textContent = icon;
    elements.readingPanel.appendChild(hint);
    setTimeout(() => hint.remove(), 600);
}

function onReadingComplete() {
    alert('阅读完成！继续加油！💪');
    stopReading();
}

// 初始化
elements.speedUnit.textContent = '词/分钟';
updateFontSize();
updateFontWeight();
switchDisplayMode();
updateTrainingModeClass();

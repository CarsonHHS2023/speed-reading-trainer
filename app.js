// ==================== 状态管理 ====================
const state = {
    content: '',
    units: [], // 存储单位（字或词）
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    language: 'chinese',
    speed: 300,
    lineWidth: 20,
    lineCount: 4,
    viewMode: 'fixed',
    startTime: 0,
    pausedTime: 0,
    totalPausedDuration: 0,
};

// ==================== DOM 元素 ====================
const elements = {
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.getElementById('fileInfo'),
    language: document.getElementById('language'),
    speedSlider: document.getElementById('speedSlider'),
    speedInput: document.getElementById('speedInput'),
    speedUnit: document.getElementById('speedUnit'),
    widthSlider: document.getElementById('widthSlider'),
    widthInput: document.getElementById('widthInput'),
    linesSlider: document.getElementById('linesSlider'),
    linesInput: document.getElementById('linesInput'),
    viewMode: document.getElementById('viewMode'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),
    currentPos: document.getElementById('currentPos'),
    totalWords: document.getElementById('totalWords'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    readingTime: document.getElementById('readingTime'),
    focusText: document.getElementById('focusText'),
    fixedModeDisplay: document.getElementById('fixedModeDisplay'),
    scrollModeDisplay: document.getElementById('scrollModeDisplay'),
    scrollText: document.getElementById('scrollText'),
};

// ==================== 文件处理 ====================
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name;
    const fileSize = (file.size / 1024).toFixed(2);
    elements.fileInfo.textContent = `✓ 已加载: ${fileName} (${fileSize} KB)`;

    try {
        let text = '';
        
        if (file.type === 'text/plain') {
            // 支持多种编码的TXT文件处理
            const arrayBuffer = await file.arrayBuffer();
            text = await decodeTextFile(arrayBuffer);
        } else if (file.type === 'application/pdf') {
            const arrayBuffer = await file.arrayBuffer();
            text = await extractTextFromPDF(arrayBuffer);
        } else {
            alert('请选择TXT或PDF文件');
            return;
        }

        state.content = text;
        state.currentIndex = 0;
        tokenizeContent();
        resetUI();
        elements.startBtn.disabled = false;
    } catch (error) {
        console.error('文件处理错误:', error);
        alert('文件处理失败，请检查文件格式');
    }
}

// 解码文本文件（支持UTF-8, GB2312, GBK等编码）
async function decodeTextFile(arrayBuffer) {
    // 先尝试UTF-8解码
    try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        return decoder.decode(arrayBuffer);
    } catch (e) {
        // UTF-8失败，尝试GB2312/GBK
        try {
            const decoder = new TextDecoder('gb2312');
            return decoder.decode(arrayBuffer);
        } catch (e2) {
            // 如果都失败，使用latin1作为最后手段
            const decoder = new TextDecoder('latin1');
            return decoder.decode(arrayBuffer);
        }
    }
}

// PDF文本提取
async function extractTextFromPDF(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join('');
        text += pageText + '\n';
    }

    return text;
}

// 分词处理
function tokenizeContent() {
    const text = state.content.trim();

    if (state.language === 'chinese') {
        // 中文分字 - 移除空格和换行
        state.units = text.split('').filter(char => char.trim() !== '');
    } else {
        // 英文分词 - 按单词分割
        state.units = text.match(/\b\w+\b/g) || [];
    }

    elements.totalWords.textContent = state.units.length;
    updateProgress();
}

// ==================== 事件监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    // 文件上传
    elements.fileInput.addEventListener('change', handleFileUpload);

    // 设置同步
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
    });
    elements.widthInput.addEventListener('change', (e) => {
        elements.widthSlider.value = e.target.value;
        state.lineWidth = parseInt(e.target.value);
    });

    elements.linesSlider.addEventListener('input', (e) => {
        elements.linesInput.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
    });
    elements.linesInput.addEventListener('change', (e) => {
        elements.linesSlider.value = e.target.value;
        state.lineCount = parseInt(e.target.value);
    });

    elements.language.addEventListener('change', (e) => {
        state.language = e.target.value;
        updateSpeedUnit();
        if (state.content) {
            tokenizeContent();
        }
    });

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

// ==================== 阅读控制 ====================
let readingInterval = null;

function startReading() {
    if (!state.content) {
        alert('请先上传文件');
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

// 计算显示时间间隔
function calculateInterval() {
    const speed = state.speed;

    if (state.language === 'chinese') {
        return (60000 / speed) * 1;
    } else {
        return (60000 / speed) * 1;
    }
}

// ==================== 显示更新 ====================
function updateDisplay() {
    if (state.viewMode === 'fixed') {
        updateFixedMode();
    } else {
        updateScrollMode();
    }
}

function updateFixedMode() {
    const displayCount = state.lineWidth * state.lineCount;
    const endIndex = Math.min(state.currentIndex + displayCount, state.units.length);
    const displayUnits = state.units.slice(state.currentIndex, endIndex);

    let html = '';
    let lineLength = 0;

    for (let i = 0; i < displayUnits.length; i++) {
        html += displayUnits[i];
        lineLength++;

        // 每行达到行宽后换行
        if (lineLength >= state.lineWidth) {
            html += '<br>';
            lineLength = 0;
        }
    }

    elements.focusText.innerHTML = html;
}

function updateScrollMode() {
    const startIndex = Math.max(0, state.currentIndex - state.lineWidth);
    const endIndex = Math.min(state.currentIndex + state.lineWidth * state.lineCount, state.units.length);
    const displayUnits = state.units.slice(startIndex, endIndex);

    let text = '';
    let lineLength = 0;

    for (let i = 0; i < displayUnits.length; i++) {
        text += displayUnits[i];
        lineLength++;

        if (lineLength >= state.lineWidth) {
            text += '\n';
            lineLength = 0;
        }
    }

    elements.scrollText.textContent = text;
}

function resetDisplay() {
    elements.focusText.textContent = '已停止';
    elements.scrollText.textContent = '已停止';
}

// ==================== 进度更新 ====================
function updateProgress() {
    const totalUnits = state.units.length;
    const percentage = totalUnits > 0 ? Math.round((state.currentIndex / totalUnits) * 100) : 0;

    elements.currentPos.textContent = state.currentIndex;
    elements.progressFill.style.width = percentage + '%';
    elements.progressText.textContent = percentage + '%';

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
    if (state.language === 'chinese') {
        elements.speedUnit.textContent = '字/分钟';
    } else {
        elements.speedUnit.textContent = '词/分钟';
    }
}

function switchViewMode() {
    if (state.viewMode === 'fixed') {
        elements.fixedModeDisplay.classList.add('active');
        elements.scrollModeDisplay.classList.remove('active');
    } else {
        elements.fixedModeDisplay.classList.remove('active');
        elements.scrollModeDisplay.classList.add('active');
    }
}

function disableSettings() {
    elements.fileInput.disabled = true;
    elements.language.disabled = true;
    elements.speedSlider.disabled = true;
    elements.speedInput.disabled = true;
    elements.widthSlider.disabled = true;
    elements.widthInput.disabled = true;
    elements.linesSlider.disabled = true;
    elements.linesInput.disabled = true;
    elements.viewMode.disabled = true;
}

function enableSettings() {
    elements.fileInput.disabled = false;
    elements.language.disabled = false;
    elements.speedSlider.disabled = false;
    elements.speedInput.disabled = false;
    elements.widthSlider.disabled = false;
    elements.widthInput.disabled = false;
    elements.linesSlider.disabled = false;
    elements.linesInput.disabled = false;
    elements.viewMode.disabled = false;
}

function resetUI() {
    elements.currentPos.textContent = '0';
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '0%';
    elements.readingTime.textContent = '00:00';
    resetDisplay();
}

function onReadingComplete() {
    alert('阅读完成！继续加油！💪');
    stopReading();
}

// 初始化
updateSpeedUnit();

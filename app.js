// ==================== 状态管理 ====================
const state = {
    content: '',
    units: [], // 存储单位（字或词）
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    language: 'chinese',
    speed: 300,
    lineWidth: 25,
    lineCount: 5,
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

// ==================== 文件处理 ====================
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name;
    const fileSize = (file.size / 1024).toFixed(2);
    elements.fileInfo.textContent = `✓ 已加载: ${fileName} (${fileSize} KB)`;

    try {
        if (file.type === 'text/plain') {
            const text = await file.text();
            state.content = text;
        } else if (file.type === 'application/pdf') {
            const arrayBuffer = await file.arrayBuffer();
            state.content = await extractTextFromPDF(arrayBuffer);
        } else {
            alert('请选择TXT或PDF文件');
            return;
        }

        // 清空当前内容
        state.currentIndex = 0;
        tokenizeContent();
        resetUI();
        elements.startBtn.disabled = false;
    } catch (error) {
        console.error('文件处理错误:', error);
        alert('文件处理失败，请检查文件格式');
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
        // 中文分字
        state.units = text.split('').filter(char => char.trim() !== '');
    } else {
        // 英文分词
        state.units = text.match(/\b\w+\b|\s+|[^\w\s]/g) || [];
        state.units = state.units.filter(unit => unit.trim() !== '');
    }

    elements.totalWords.textContent = state.units.length;
    updateProgress();
}

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

    // 禁用设置
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

    // 重置UI
    elements.startBtn.disabled = false;
    elements.pauseBtn.disabled = true;
    elements.resumeBtn.disabled = true;
    elements.stopBtn.disabled = true;

    // 启用设置
    enableSettings();

    resetDisplay();
    updateProgress();
}

function startReadingLoop() {
    // 计算时间间隔（毫秒）
    const intervalMs = calculateInterval();

    readingInterval = setInterval(() => {
        if (state.currentIndex < state.units.length) {
            updateDisplay();
            state.currentIndex++;
            updateProgress();

            // 检查是否完成
            if (state.currentIndex >= state.units.length) {
                clearInterval(readingInterval);
                onReadingComplete();
            }
        }
    }, intervalMs);
}

// 计算显示时间间隔
function calculateInterval() {
    const speed = state.speed; // 字/词 每分钟

    if (state.language === 'chinese') {
        // 中文：speed 是字/分钟
        return (60000 / speed) * 1; // 每个字显示的毫秒数
    } else {
        // 英文：speed 是词/分钟
        return (60000 / speed) * 1; // 每个词显示的毫秒数
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
    const startIndex = state.currentIndex;
    const endIndex = Math.min(startIndex + state.lineWidth * state.lineCount, state.units.length);
    const displayUnits = state.units.slice(startIndex, endIndex);

    let html = '';
    for (let i = 0; i < displayUnits.length; i++) {
        if (state.language === 'chinese') {
            html += displayUnits[i];
            // 每行一定数量的字
            if ((i + 1) % state.lineWidth === 0) {
                html += '<br>';
            }
        } else {
            html += displayUnits[i];
            // 英文按词分行
            if ((i + 1) % (state.lineWidth / 5) === 0) {
                html += '<br>';
            }
        }
    }

    elements.focusText.innerHTML = html;
}

function updateScrollMode() {
    const startIndex = Math.max(0, state.currentIndex - state.lineWidth * 2);
    const endIndex = Math.min(startIndex + state.lineWidth * state.lineCount * 3, state.units.length);
    const displayUnits = state.units.slice(startIndex, endIndex);

    let html = '';
    for (let i = 0; i < displayUnits.length; i++) {
        if (state.language === 'chinese') {
            html += displayUnits[i];
            if ((i + 1) % state.lineWidth === 0) {
                html += '\n';
            }
        } else {
            html += displayUnits[i];
            if ((i + 1) % (state.lineWidth / 5) === 0) {
                html += '\n';
            }
        }
    }

    elements.scrollText.textContent = html;
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

    // 更新阅读时间
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

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

    for (let i = 0; i < displayUnits.length; i++) {
        html += displayUnits[i];
        lineLength++;

        if (lineLength >= state.lineWidth) {
            html += '<br>';
            lineLength = 0;
        }
    }

    elements.focusText.innerHTML = html;

    // 滚动式：计算应该显示在第几行，设置 margin-top
    if (state.trainingMode === 'scroll') {
        const batchNumber = Math.floor(state.currentIndex / charsPerBatch);
        const topOffset = batchNumber * state.lineCount;  // 向下偏移多少行
        elements.focusText.style.marginTop = (topOffset * 1.8 * state.fontSize) + 'px';
    } else {
        elements.focusText.style.marginTop = '0';
    }
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
    elements.focusText.style.marginTop = '0';
    elements.pageText.textContent = '选择书籍开始阅读';
}

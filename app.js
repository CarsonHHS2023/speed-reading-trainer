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

    // 固定式：始终显示在屏幕中央
    if (state.trainingMode === 'fixed') {
        elements.focusText.style.marginTop = '0';
    } else {
        // 滚动式：计算应该显示在第几行，设置 margin-top，循环回到第一行
        const batchNumber = Math.floor(state.currentIndex / charsPerBatch);
        const topOffset = batchNumber * state.lineCount;
        const lineHeight = 1.8 * state.fontSize;
        
        // 获取屏幕能显示的最大行数
        const focusContainer = elements.focusModeDisplay;
        const screenHeight = focusContainer.clientHeight - 40; // 减去 padding
        const maxLines = Math.floor(screenHeight / lineHeight);
        
        // 对最大行数取模，循环回到第一行
        const displayLines = topOffset % Math.max(maxLines, state.lineCount);
        elements.focusText.style.marginTop = (displayLines * lineHeight) + 'px';
    }
}

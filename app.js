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
    
    // 然后每隔 intervalMs 毫秒显示下一批
    console.log('设置定时器，间隔:', intervalMs, 'ms');
    
    // 清除旧的定时器（防止多个定时器并存）
    if (readingInterval) {
        clearInterval(readingInterval);
    }
    
    readingInterval = setInterval(() => {
        if (state.isPlaying) {
            console.log('--- 定时器触发，显示下一批 ---');
            showNextBatch();
        }
    }, intervalMs);
}

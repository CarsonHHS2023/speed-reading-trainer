// ==================== PDF 处理 ====================
async function processPDFFile(file) {
    try {
        console.log('开始处理 PDF:', file.name);
        
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
        
        // 加载 PDF 文档
        const pdfBuffer = await file.arrayBuffer();
        state.pdfDocument = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
        
        // 提取所有文字
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
                        // 保留原始文本格式（包含空格和换行）
                        allText += elem.content + '\n';
                    }
                });
            }
        });
        
        // 分词时保留空格
        if (state.language === 'chinese') {
            // 中文：按字符分词，但保留空格和换行
            state.units = allText
                .split('')
                .filter(char => {
                    // 保留中文、英文、数字、标点和空格
                    return char.trim() !== '' || char === ' ';
                });
        } else {
            // 英文：按单词和空格分词
            state.units = allText.match(/\S+|\s+/g) || [];
        }
        
        // 建立单位到元素的映射
        state.pdfUnitMap = {};
        let unitIndex = 0;
        state.pdfElements.forEach((elem, elemIndex) => {
            if (elem.type === 'text') {
                let text = elem.content + '\n'; // 保证页面间有换行
                let elemUnits;
                if (state.language === 'chinese') {
                    // 中文分词
                    elemUnits = text.split('').filter(char => char.trim() !== '' || char === ' ');
                } else {
                    // 英文分词
                    elemUnits = text.match(/\S+|\s+/g) || [];
                }
                
                for (let i = 0; i < elemUnits.length; i++) {
                    state.pdfUnitMap[unitIndex++] = {
                        elementIndex: elemIndex,
                        isChart: false
                    };
                }
            } else {
                // 图表占据一个单位位置
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
        
        console.log('PDF 处理完成，总单位数:', state.units.length);
        
    } catch (error) {
        console.error('PDF 处理失败:', error);
        alert('PDF 处理失败：' + error.message);
    }
}

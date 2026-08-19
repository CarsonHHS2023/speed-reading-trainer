(function (root, factory) {
    const api = factory(root && root.ReaderUIV2, root && root.ReaderHighlightsV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderHighlightsUIV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, Highlights) {
    'use strict';

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            Highlights = Highlights || require('./reader-highlights.js');
        }
        if (!ReaderUI || !Highlights) throw new Error('Reader v2 highlight dependencies are required');
        return { ReaderUI, Highlights };
    }

    function createElement(documentObject, tag, className, text) {
        const el = documentObject.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    function textRootForNode(nodeElement) {
        if (!nodeElement) return null;
        return nodeElement.querySelector('.reader-v2-node-text, .reader-v2-list li');
    }

    function selectionOffset(documentObject, root, container, offset) {
        const range = documentObject.createRange();
        range.selectNodeContents(root);
        try {
            range.setEnd(container, offset);
        } catch (_) {
            return null;
        }
        return range.toString().length;
    }

    function unwrapExisting(root) {
        if (!root) return;
        for (const mark of [...root.querySelectorAll('.reader-v2-user-highlight')]) {
            mark.replaceWith(mark.ownerDocument.createTextNode(mark.textContent || ''));
        }
        root.normalize();
    }

    function applySegments(documentObject, root, segments) {
        if (!root || !Array.isArray(segments) || !segments.length) return;
        unwrapExisting(root);
        const walker = documentObject.createTreeWalker(root, 4);
        const textNodes = [];
        let node = walker.nextNode();
        while (node) {
            textNodes.push(node);
            node = walker.nextNode();
        }
        let cursor = 0;
        for (const textNode of textNodes) {
            const text = textNode.nodeValue || '';
            const nodeStart = cursor;
            const nodeEnd = cursor + text.length;
            cursor = nodeEnd;
            const relevant = segments.filter((segment) => segment.end > nodeStart && segment.start < nodeEnd && segment.highlight_id);
            if (!relevant.length) continue;
            const boundaries = new Set([0, text.length]);
            for (const segment of relevant) {
                boundaries.add(Math.max(0, segment.start - nodeStart));
                boundaries.add(Math.min(text.length, segment.end - nodeStart));
            }
            const points = [...boundaries].sort((a, b) => a - b);
            const fragment = documentObject.createDocumentFragment();
            for (let index = 0; index + 1 < points.length; index += 1) {
                const localStart = points[index];
                const localEnd = points[index + 1];
                if (localEnd <= localStart) continue;
                const piece = text.slice(localStart, localEnd);
                const globalStart = nodeStart + localStart;
                const active = relevant.find((segment) => segment.start <= globalStart && segment.end >= nodeStart + localEnd);
                if (!active) {
                    fragment.appendChild(documentObject.createTextNode(piece));
                    continue;
                }
                const mark = createElement(documentObject, 'mark', `reader-v2-user-highlight reader-v2-user-highlight-${active.style}`, piece);
                mark.dataset.highlightId = active.highlight_id;
                fragment.appendChild(mark);
            }
            textNode.replaceWith(fragment);
        }
    }

    class ReaderHighlightUIControllerV2 {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.reader = options.readerController || deps.ReaderUI.getDefaultController();
            this.highlights = deps.Highlights;
            this.store = options.store || new deps.Highlights.ReaderHighlightStoreV2({ storage: options.storage });
            this.pendingSelection = null;
            this.openBookPatched = false;
            this.renderPatched = false;
            this.bound = false;
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        currentRecords() {
            return this.reader?.documentRef ? this.store.list(this.reader.documentRef) : [];
        }

        currentCandidateRecords() {
            return this.currentRecords().filter((record) => this.highlights.sameCandidate(record, this.reader?.openResponse));
        }

        captureSelection() {
            if (!this.document || !this.reader?.openResponse) return null;
            const selection = this.document.defaultView?.getSelection?.() || (typeof getSelection === 'function' ? getSelection() : null);
            if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
            const range = selection.getRangeAt(0);
            const startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            const endElement = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
            const startNode = startElement?.closest?.('.reader-v2-node');
            const endNode = endElement?.closest?.('.reader-v2-node');
            if (!startNode || startNode !== endNode) {
                this.pendingSelection = null;
                return null;
            }
            const root = textRootForNode(startNode);
            if (!root || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
                this.pendingSelection = null;
                return null;
            }
            const start = selectionOffset(this.document, root, range.startContainer, range.startOffset);
            const end = selectionOffset(this.document, root, range.endContainer, range.endOffset);
            const textLength = String(root.textContent || '').length;
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > textLength) {
                this.pendingSelection = null;
                return null;
            }
            this.pendingSelection = {
                node_id: startNode.dataset.readerNodeId,
                text_start: start,
                text_end: end,
            };
            this.updateCreateState();
            return this.pendingSelection;
        }

        updateCreateState() {
            const button = this.element('readerV2HighlightCreate');
            if (button) button.disabled = !this.reader?.openResponse || !this.pendingSelection;
        }

        createHighlight() {
            const selected = this.pendingSelection;
            if (!selected || !this.reader?.openResponse) {
                this.reader?.setStatus?.('请先在同一个段落内选择文字。');
                return null;
            }
            const node = this.reader.model?.findNodeById?.(this.reader.nodes || [], selected.node_id);
            const textLength = String(node?.text || '').length;
            if (!node || selected.text_end > textLength) {
                this.pendingSelection = null;
                this.updateCreateState();
                this.reader?.setStatus?.('所选文字已失效，请重新选择。', 'info');
                return null;
            }
            const location = this.reader.locationForNode?.(selected.node_id);
            const style = this.element('readerV2HighlightStyle')?.value || 'yellow';
            const record = this.highlights.recordForRange(
                this.reader.openResponse,
                location,
                selected.text_start,
                selected.text_end,
                { style },
            );
            const saved = this.store.upsert(record);
            this.pendingSelection = null;
            this.updateCreateState();
            this.renderAll();
            this.reader?.setStatus?.('高亮已保存。');
            return saved;
        }

        remove(record) {
            if (!record) return false;
            const removed = this.store.remove(record.document_ref, record.highlight_id);
            this.renderAll();
            return removed;
        }

        async navigate(record) {
            if (!record) return false;
            if (!this.highlights.sameCandidate(record, this.reader?.openResponse)) {
                this.reader?.setStatus?.('这个高亮属于旧内容版本，无法导航。', 'info');
                return false;
            }
            const node = await this.reader.ensureNodeLoaded?.(record.node_id);
            if (!node) {
                this.reader?.setStatus?.('高亮目标在当前内容中不可用。', 'info');
                return false;
            }
            if (!this.highlights.validForText(record, String(node.text || '').length)) {
                this.reader?.setStatus?.('这个高亮范围已失效。', 'info');
                return false;
            }
            this.reader.navigateTo?.(node.location || record);
            this.renderDocumentHighlights();
            const target = this.document.querySelector(`[data-highlight-id="${escapeSelector(record.highlight_id)}"]`);
            target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            return true;
        }

        clearDocument(documentRef) {
            this.store.clear(documentRef);
            if (String(documentRef || '') === String(this.reader?.documentRef || '')) {
                this.pendingSelection = null;
                this.renderAll();
            }
        }

        recordsForNode(node) {
            if (!node || !this.reader?.openResponse) return [];
            const textLength = String(node.text || '').length;
            return this.currentCandidateRecords()
                .filter((record) => record.node_id === node.node_id)
                .filter((record) => this.highlights.validForText(record, textLength));
        }

        renderDocumentHighlights() {
            if (!this.document || !this.reader?.openResponse) return;
            const nodeElements = [...this.document.querySelectorAll('.reader-v2-node[data-reader-node-id]')];
            for (const nodeElement of nodeElements) {
                const node = this.reader.model?.findNodeById?.(this.reader.nodes || [], nodeElement.dataset.readerNodeId);
                const root = textRootForNode(nodeElement);
                if (!node || !root) continue;
                const records = this.recordsForNode(node);
                const segments = this.highlights.segmentsForRanges(String(node.text || '').length, records);
                applySegments(this.document, root, segments);
            }
        }

        renderList() {
            const list = this.element('readerV2HighlightsList');
            if (!list) return;
            while (list.firstChild) list.removeChild(list.firstChild);
            const records = this.currentRecords();
            if (!records.length) {
                list.appendChild(createElement(this.document, 'p', 'reader-v2-highlight-empty', '暂无高亮'));
                return;
            }
            for (const record of records) {
                const current = this.highlights.sameCandidate(record, this.reader?.openResponse);
                const node = current ? this.reader.model?.findNodeById?.(this.reader.nodes || [], record.node_id) : null;
                const inRange = !node || this.highlights.validForText(record, String(node.text || '').length);
                const row = createElement(this.document, 'div', `reader-v2-highlight-item${current && inRange ? '' : ' is-stale'}`);
                const go = createElement(this.document, 'button', 'reader-v2-highlight-go');
                go.type = 'button';
                go.textContent = current && inRange ? `▰ 高亮 · ${record.node_id}` : `▰ 高亮 · 旧版本/失效`;
                go.title = current && inRange ? `定位到 ${record.node_id}` : '内容版本或范围已变化';
                go.addEventListener('click', () => this.navigate(record).catch((error) => this.reader?.renderError?.(error)));
                row.appendChild(go);
                const remove = createElement(this.document, 'button', 'reader-v2-highlight-action', '删除');
                remove.type = 'button';
                remove.addEventListener('click', () => this.remove(record));
                row.appendChild(remove);
                list.appendChild(row);
            }
        }

        renderAll() {
            this.renderDocumentHighlights();
            this.renderList();
            this.updateCreateState();
        }

        bind() {
            if (this.bound || !this.document) return;
            this.bound = true;
            this.element('readerV2Pages')?.addEventListener('mouseup', () => {
                this.captureSelection();
            });
            this.element('readerV2HighlightCreate')?.addEventListener('mousedown', (event) => event.preventDefault());
            this.element('readerV2HighlightCreate')?.addEventListener('click', () => this.createHighlight());
            this.renderAll();
        }

        patchReaderRender() {
            if (this.renderPatched) return;
            this.renderPatched = true;
            const prototype = ReaderUI.ReaderV2Controller?.prototype;
            if (!prototype || typeof prototype.reflowAndRender !== 'function') return;
            const original = prototype.reflowAndRender;
            const self = this;
            prototype.reflowAndRender = function reflowAndRenderWithHighlights(...args) {
                const result = original.apply(this, args);
                self.reader = this;
                self.renderDocumentHighlights();
                return result;
            };
        }

        patchReaderOpenBook() {
            if (this.openBookPatched) return;
            this.openBookPatched = true;
            const original = ReaderUI.openBook;
            if (typeof original !== 'function') return;
            const self = this;
            ReaderUI.openBook = async function openBookWithHighlights(book) {
                const result = await original(book);
                self.reader = ReaderUI.getDefaultController();
                self.pendingSelection = null;
                self.renderAll();
                return result;
            };
        }
    }

    function escapeSelector(value) {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
        return String(value).replace(/["\\]/g, '\\$&');
    }

    let defaultController = null;

    function getDefaultController() {
        if (!defaultController) defaultController = new ReaderHighlightUIControllerV2();
        return defaultController;
    }

    function install() {
        const controller = getDefaultController();
        controller.patchReaderRender();
        controller.patchReaderOpenBook();
        controller.bind();
        return controller;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    return {
        ReaderHighlightUIControllerV2,
        applySegments,
        getDefaultController,
        install,
        selectionOffset,
        textRootForNode,
    };
});
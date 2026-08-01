(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderStudyToolsRail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORAGE_KEY = 'reader.studyToolsRail.v1';
    const DEBUG_PAGE_PATH = 'reader-node-debug.html';
    const DEFAULT_STATE = Object.freeze({ expanded: false, activeToolId: 'notes' });
    const TOOL_DEFINITIONS = Object.freeze([
        { id: 'navigation', label: '文档导航', icon: '☰', selectors: ['.reader-v2-title', '.reader-v2-meta', '.reader-v2-find', '.reader-v2-navigation'] },
        { id: 'notes', label: '书签与笔记', icon: '📝', selectors: ['.reader-v2-annotations'] },
        { id: 'highlights', label: '高亮', icon: '🖍️', selectors: ['.reader-v2-highlights'] },
        { id: 'study-context', label: '学习上下文', icon: '🧠', selectors: ['.reader-v2-study-context'] },
    ]);

    function normalizeState(value) {
        const active = TOOL_DEFINITIONS.some((tool) => tool.id === value?.activeToolId)
            ? value.activeToolId
            : DEFAULT_STATE.activeToolId;
        return { expanded: value?.expanded === true, activeToolId: active };
    }

    function loadState(storage) {
        try { return normalizeState(JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null')); }
        catch (_) { return { ...DEFAULT_STATE }; }
    }

    function saveState(storage, state) {
        try { storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalizeState(state))); } catch (_) { /* ignore */ }
    }

    function normalizedIdentityValue(value) {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        return normalized || null;
    }

    function firstSourceUnitId(...values) {
        for (const value of values) {
            if (Array.isArray(value)) {
                const nested = firstSourceUnitId(...value);
                if (nested) return nested;
                continue;
            }
            const normalized = normalizedIdentityValue(value);
            if (normalized) return normalized;
        }
        return null;
    }

    function visibleSourceUnitId(documentObject) {
        const pages = Array.from(documentObject?.querySelectorAll?.('.reader-v2-page[data-source-unit-id]') || []);
        if (!pages.length) return null;
        const viewport = documentObject?.querySelector?.('.reader-v2-main');
        const viewportRect = viewport?.getBoundingClientRect?.() || null;
        let bestSourceUnitId = null;
        let bestVisibleHeight = -1;
        for (const page of pages) {
            const sourceUnitId = normalizedIdentityValue(page?.dataset?.sourceUnitId);
            if (!sourceUnitId) continue;
            const rect = page?.getBoundingClientRect?.();
            if (!rect || !viewportRect) {
                if (!bestSourceUnitId) bestSourceUnitId = sourceUnitId;
                continue;
            }
            const visibleTop = Math.max(Number(rect.top || 0), Number(viewportRect.top || 0));
            const visibleBottom = Math.min(Number(rect.bottom || 0), Number(viewportRect.bottom || 0));
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            if (visibleHeight > bestVisibleHeight) {
                bestVisibleHeight = visibleHeight;
                bestSourceUnitId = sourceUnitId;
            }
        }
        return bestSourceUnitId;
    }

    function resolveDebugContext(options = {}) {
        const reader = options.reader || null;
        const playback = options.playback || null;
        const frame = playback?.currentFrame?.() || null;
        const frameIdentity = frame?.identity || {};
        const location = reader?.lastLocation || reader?.resumeRecord || {};
        return {
            documentRef: normalizedIdentityValue(
                frameIdentity.document_ref
                || reader?.documentRef
                || reader?.openResponse?.document_ref
                || location.document_ref,
            ),
            candidateId: normalizedIdentityValue(
                frameIdentity.candidate_id
                || reader?.candidateId
                || reader?.openResponse?.candidate_id
                || location.candidate_id,
            ),
            sourceUnitId: firstSourceUnitId(
                frameIdentity.source_unit_id,
                frameIdentity.source_unit_ids,
                location.source_unit_id,
                location.source_unit_ids,
                visibleSourceUnitId(options.documentObject),
            ),
        };
    }

    function buildDebugPageUrl(context = {}, baseHref = '') {
        const base = normalizedIdentityValue(baseHref) || 'http://localhost/';
        const url = new URL(DEBUG_PAGE_PATH, base);
        if (context.documentRef) url.searchParams.set('document_ref', context.documentRef);
        if (context.candidateId) url.searchParams.set('candidate_id', context.candidateId);
        if (context.sourceUnitId) url.searchParams.set('source_unit_id', context.sourceUnitId);
        return url.href;
    }

    class StudyToolsRailController {
        constructor(options = {}) {
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.window = options.windowObject || this.document?.defaultView || null;
            this.storage = options.storage || this.window?.localStorage || null;
            this.state = loadState(this.storage);
            this.bound = false;
        }

        createElement(tag, className, attrs = {}) {
            const element = this.document.createElement(tag);
            if (className) element.className = className;
            for (const [name, value] of Object.entries(attrs)) {
                if (name === 'text') element.textContent = value;
                else element.setAttribute(name, value);
            }
            return element;
        }

        debugControllers() {
            const playbackController = this.window?.ReaderSpeedPlaybackUI?.getDefaultController?.() || null;
            const reader = playbackController?.reader
                || this.window?.ReaderUIV2?.getDefaultController?.()
                || null;
            return { reader, playback: playbackController?.playback || null };
        }

        openDebugPage() {
            const controllers = this.debugControllers();
            const context = resolveDebugContext({
                ...controllers,
                documentObject: this.document,
            });
            const href = buildDebugPageUrl(context, this.window?.location?.href || '');
            const opened = this.window?.open?.(href, '_blank', 'noopener,noreferrer') || null;
            try { if (opened) opened.opener = null; } catch (_) { /* cross-origin window */ }
            return href;
        }

        ensureRail() {
            if (!this.document) return null;
            const existing = this.document.getElementById('readerStudyToolsRail');
            if (existing) return existing;
            const panel = this.document.querySelector('.reading-panel');
            const sidebar = this.document.querySelector('.reader-v2-sidebar');
            const shell = this.document.querySelector('.reader-v2-shell');
            if (!panel || !sidebar) return null;

            const rail = this.createElement('aside', 'reader-study-tools-rail', {
                id: 'readerStudyToolsRail', 'aria-label': '学习工具',
            });
            const tabs = this.createElement('div', 'reader-study-tools-tabs', { role: 'tablist' });
            const drawer = this.createElement('div', 'reader-study-tools-drawer');
            const header = this.createElement('div', 'reader-study-tools-header');
            const title = this.createElement('strong', 'reader-study-tools-title', { text: '学习工具' });
            const collapse = this.createElement('button', 'reader-study-tools-collapse', {
                type: 'button', title: '收起学习工具', 'aria-label': '收起学习工具', text: '›',
            });
            const body = this.createElement('div', 'reader-study-tools-body');
            header.append(title, collapse);
            drawer.append(header, body);

            for (const tool of TOOL_DEFINITIONS) {
                const button = this.createElement('button', 'reader-study-tool-tab', {
                    type: 'button', role: 'tab', title: tool.label,
                    'aria-label': tool.label, 'data-tool-id': tool.id, text: tool.icon,
                });
                button.addEventListener('click', () => this.activate(tool.id, { expand: true }));
                tabs.appendChild(button);

                const panelElement = this.createElement('section', 'reader-study-tool-panel', {
                    role: 'tabpanel', 'data-tool-panel': tool.id,
                });
                for (const selector of tool.selectors) {
                    const source = sidebar.querySelector(selector);
                    if (source) panelElement.appendChild(source);
                }
                body.appendChild(panelElement);
            }

            const debugButton = this.createElement('button', 'reader-study-tools-debug', {
                id: 'readerStudyToolsDebug', type: 'button', title: '打开节点调试页',
                'aria-label': '打开节点调试页', text: '🐞',
            });
            debugButton.addEventListener('click', () => this.openDebugPage());
            tabs.appendChild(debugButton);

            collapse.addEventListener('click', () => this.setExpanded(false));
            rail.append(tabs, drawer);
            panel.appendChild(rail);
            sidebar.hidden = true;
            if (shell) shell.dataset.studyToolsReady = '1';
            this.render();
            return rail;
        }

        requestPlaybackReflow() {
            const run = () => {
                const controller = this.window?.ReaderSpeedPlaybackUI?.getDefaultController?.();
                if (!controller?.isReaderActive?.()) return;
                controller.refreshFrames?.({ preserveIdentity: true });
                const frame = controller.playback?.currentFrame?.();
                if (frame && ['playing', 'paused', 'manual'].includes(controller.playback?.state)) {
                    controller.showPlaybackSurface?.(frame);
                }
            };
            if (typeof this.window?.requestAnimationFrame === 'function') {
                this.window.requestAnimationFrame(() => this.window.requestAnimationFrame(run));
            } else if (typeof this.window?.setTimeout === 'function') this.window.setTimeout(run, 200);
        }

        emitLayoutChange() {
            const event = typeof this.window?.CustomEvent === 'function'
                ? new this.window.CustomEvent('reader-study-tools-layout-change', { detail: { ...this.state } })
                : null;
            if (event) this.document.dispatchEvent(event);
            this.requestPlaybackReflow();
        }

        setExpanded(expanded) {
            this.state.expanded = expanded === true;
            saveState(this.storage, this.state);
            this.render();
            this.emitLayoutChange();
        }

        activate(toolId, options = {}) {
            if (!TOOL_DEFINITIONS.some((tool) => tool.id === toolId)) return false;
            this.state.activeToolId = toolId;
            if (options.expand !== false) this.state.expanded = true;
            saveState(this.storage, this.state);
            this.render();
            this.emitLayoutChange();
            return true;
        }

        render() {
            const rail = this.document?.getElementById('readerStudyToolsRail');
            if (!rail) return;
            const readingPanel = rail.closest?.('.reading-panel') || this.document?.querySelector?.('.reading-panel');
            rail.dataset.expanded = this.state.expanded ? '1' : '0';
            rail.dataset.activeTool = this.state.activeToolId;
            if (readingPanel) {
                readingPanel.dataset.studyToolsExpanded = this.state.expanded ? '1' : '0';
                readingPanel.dataset.studyToolsActive = this.state.activeToolId;
            }
            rail.querySelectorAll('[data-tool-id]').forEach((button) => {
                const selected = button.dataset.toolId === this.state.activeToolId;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', selected ? 'true' : 'false');
            });
            rail.querySelectorAll('[data-tool-panel]').forEach((panel) => {
                panel.hidden = panel.dataset.toolPanel !== this.state.activeToolId;
            });
        }

        bind() {
            if (this.bound) return this;
            this.bound = true;
            this.ensureRail();
            return this;
        }
    }

    let defaultController = null;
    function install() {
        if (!defaultController) defaultController = new StudyToolsRailController();
        return defaultController.bind();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    return {
        DEBUG_PAGE_PATH,
        DEFAULT_STATE,
        STORAGE_KEY,
        TOOL_DEFINITIONS,
        StudyToolsRailController,
        buildDebugPageUrl,
        firstSourceUnitId,
        loadState,
        normalizeState,
        resolveDebugContext,
        saveState,
        visibleSourceUnitId,
        install,
    };
});

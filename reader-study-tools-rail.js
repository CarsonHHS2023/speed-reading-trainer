(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderStudyToolsRail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORAGE_KEY = 'reader.studyToolsRail.v1';
    const DEFAULT_STATE = Object.freeze({ expanded: false, activeToolId: 'notes' });
    const TOOL_DEFINITIONS = Object.freeze([
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
        try {
            return normalizeState(JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null'));
        } catch (_) {
            return { ...DEFAULT_STATE };
        }
    }

    function saveState(storage, state) {
        try { storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalizeState(state))); } catch (_) { /* ignore */ }
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

        ensureRail() {
            if (!this.document) return null;
            const existing = this.document.getElementById('readerStudyToolsRail');
            if (existing) return existing;
            const panel = this.document.querySelector('.reading-panel');
            const sidebar = this.document.querySelector('.reader-v2-sidebar');
            if (!panel || !sidebar) return null;

            const rail = this.createElement('aside', 'reader-study-tools-rail', {
                id: 'readerStudyToolsRail',
                'aria-label': '学习工具',
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
            collapse.addEventListener('click', () => this.setExpanded(false));
            rail.append(tabs, drawer);
            panel.appendChild(rail);
            this.render();
            return rail;
        }

        emitLayoutChange() {
            const event = typeof this.window?.CustomEvent === 'function'
                ? new this.window.CustomEvent('reader-study-tools-layout-change', { detail: { ...this.state } })
                : null;
            if (event) this.document.dispatchEvent(event);
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
            rail.dataset.expanded = this.state.expanded ? '1' : '0';
            rail.dataset.activeTool = this.state.activeToolId;
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

    return { DEFAULT_STATE, STORAGE_KEY, TOOL_DEFINITIONS, StudyToolsRailController, loadState, normalizeState, saveState, install };
});

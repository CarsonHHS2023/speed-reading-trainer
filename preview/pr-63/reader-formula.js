(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderFormulaV2 = api;
        if (root.document) api.installFormulaRendering({ root });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FORMULA_NODE_TYPE = 'formula';
    const SEMANTIC_PATCH_RETRY_MS = 20;
    const SEMANTIC_PATCH_MAX_ATTEMPTS = 500;

    function normalizeFormulaSource(value) {
        const original = typeof value === 'string' ? value.trim() : '';
        if (!original) return { original, source: '', delimiter: null };

        const delimiters = [
            { open: '$$', close: '$$', name: 'double-dollar' },
            { open: '\\[', close: '\\]', name: 'display-bracket' },
            { open: '\\(', close: '\\)', name: 'inline-parenthesis' },
            { open: '$', close: '$', name: 'single-dollar' },
        ];
        for (const delimiter of delimiters) {
            if (
                original.length >= delimiter.open.length + delimiter.close.length
                && original.startsWith(delimiter.open)
                && original.endsWith(delimiter.close)
            ) {
                return {
                    original,
                    source: original.slice(delimiter.open.length, -delimiter.close.length).trim(),
                    delimiter: delimiter.name,
                };
            }
        }
        return { original, source: original, delimiter: null };
    }

    function createElement(documentObject, tag, className, text) {
        const element = documentObject.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function formulaRenderer(root, override) {
        if (override && typeof override.render === 'function') return override;
        const candidate = root?.katex;
        return candidate && typeof candidate.render === 'function' ? candidate : null;
    }

    function hasAssetReferences(node) {
        return Array.isArray(node?.asset_refs) && node.asset_refs.length > 0;
    }

    function appendFormulaFallback(documentObject, target, source) {
        target.replaceChildren?.();
        while (!target.replaceChildren && target.firstChild) target.removeChild(target.firstChild);
        const fallback = createElement(
            documentObject,
            'code',
            'reader-v2-formula-fallback',
            source || '公式内容不可用',
        );
        target.appendChild(fallback);
        target.dataset.formulaRendering = 'fallback';
        return fallback;
    }

    function renderFormulaInto(options = {}) {
        const { documentObject, target, text, root, katex } = options;
        if (!documentObject || !target) return { rendered: false, source: '', mode: 'unavailable' };

        const normalized = normalizeFormulaSource(text);
        target.dataset.formulaSource = normalized.source;
        target.dataset.formulaDelimiter = normalized.delimiter || '';
        if (typeof target.setAttribute === 'function') {
            target.setAttribute('role', 'math');
            target.setAttribute('aria-label', normalized.source || '公式内容不可用');
        }

        const renderer = formulaRenderer(root, katex);
        if (!normalized.source || !renderer) {
            appendFormulaFallback(documentObject, target, normalized.source || normalized.original);
            return { rendered: false, source: normalized.source, mode: 'fallback' };
        }

        try {
            renderer.render(normalized.source, target, {
                displayMode: true,
                throwOnError: true,
                strict: 'warn',
                trust: false,
                output: 'htmlAndMathml',
            });
            target.dataset.formulaRendering = 'katex';
            return { rendered: true, source: normalized.source, mode: 'katex' };
        } catch (_error) {
            appendFormulaFallback(documentObject, target, normalized.source || normalized.original);
            return { rendered: false, source: normalized.source, mode: 'fallback' };
        }
    }

    function renderFormulaNode(controller, node, options = {}) {
        const documentObject = controller?.document;
        if (!documentObject) return null;

        const wrapper = createElement(
            documentObject,
            'article',
            'reader-v2-node reader-v2-node-formula',
        );
        wrapper.dataset.readerNodeId = node?.node_id || '';
        wrapper.tabIndex = -1;

        const formula = createElement(documentObject, 'div', 'reader-v2-formula');
        const result = renderFormulaInto({
            documentObject,
            target: formula,
            text: node?.text || '',
            root: options.root,
            katex: options.katex,
        });
        wrapper.dataset.formulaRendering = result.mode;
        wrapper.appendChild(formula);

        if (node?.text && controller.currentFindResult?.()?.node_id === node.node_id) {
            const searchText = createElement(documentObject, 'div', 'reader-v2-find-asset-text');
            if (typeof controller.appendHighlightedText === 'function') {
                controller.appendHighlightedText(searchText, node.text, node);
            } else {
                searchText.textContent = node.text;
            }
            wrapper.appendChild(searchText);
        }

        if (node?.content_state && node.content_state !== 'ready') {
            wrapper.appendChild(createElement(
                documentObject,
                'span',
                'reader-v2-state',
                node.content_state,
            ));
        }
        return wrapper;
    }

    function markFormulaAsSemanticText(SemanticPage) {
        const visualTypes = SemanticPage?.VISUAL_NODE_TYPES;
        if (!visualTypes || typeof visualTypes.delete !== 'function') return false;
        visualTypes.delete(FORMULA_NODE_TYPE);
        return typeof visualTypes.has !== 'function' || !visualTypes.has(FORMULA_NODE_TYPE);
    }

    function scheduleSemanticPagePatch(root) {
        if (!root || markFormulaAsSemanticText(root.ReaderSemanticPageV2)) return true;
        if (root.__readerFormulaSemanticPatchScheduled) return false;
        root.__readerFormulaSemanticPatchScheduled = true;
        let attempts = 0;

        function retry() {
            attempts += 1;
            if (markFormulaAsSemanticText(root.ReaderSemanticPageV2)) {
                root.__readerFormulaSemanticPatchScheduled = false;
                return;
            }
            if (attempts >= SEMANTIC_PATCH_MAX_ATTEMPTS) {
                root.__readerFormulaSemanticPatchScheduled = false;
                return;
            }
            const schedule = typeof root.setTimeout === 'function' ? root.setTimeout.bind(root) : setTimeout;
            schedule(retry, SEMANTIC_PATCH_RETRY_MS);
        }
        retry();
        return false;
    }

    function installFormulaRendering(options = {}) {
        const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : null);
        const ReaderUI = options.ReaderUI || root?.ReaderUIV2;
        const Controller = ReaderUI?.ReaderV2Controller;
        if (!Controller?.prototype) return false;

        const prototype = Controller.prototype;
        if (!prototype.__readerFormulaRenderingInstalled) {
            const originalRenderNode = prototype.renderNode;
            if (typeof originalRenderNode !== 'function') return false;
            prototype.renderNode = function renderNodeWithFormula(node) {
                if (String(node?.node_type || '').toLowerCase() !== FORMULA_NODE_TYPE) {
                    return originalRenderNode.call(this, node);
                }
                const rendered = renderFormulaNode(this, node, { root, katex: options.katex });
                if (
                    !rendered
                    || (hasAssetReferences(node) && rendered.dataset.formulaRendering !== 'katex')
                ) {
                    return originalRenderNode.call(this, node);
                }
                return rendered;
            };
            prototype.__readerFormulaRenderingInstalled = true;
            prototype.__readerFormulaOriginalRenderNode = originalRenderNode;
        }

        scheduleSemanticPagePatch(root);
        return true;
    }

    return {
        FORMULA_NODE_TYPE,
        SEMANTIC_PATCH_MAX_ATTEMPTS,
        SEMANTIC_PATCH_RETRY_MS,
        appendFormulaFallback,
        formulaRenderer,
        hasAssetReferences,
        installFormulaRendering,
        markFormulaAsSemanticText,
        normalizeFormulaSource,
        renderFormulaInto,
        renderFormulaNode,
        scheduleSemanticPagePatch,
    };
});

(function (root, factory) {
    const api = factory(root && root.SpeedReadingAdapter, root && root.ReaderFormulaV2);
    const isCommonJs = typeof module === 'object' && module.exports;
    if (isCommonJs) module.exports = api;
    if (root) {
        root.SpeedReadingFormulaRendering = api;
        if (!isCommonJs && root.document && typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.installWithRetry(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter, Formula) {
    'use strict';

    const INLINE_FORMULA_KIND = 'inline_formula';
    const INSTALL_RETRY_MS = 20;
    const INSTALL_RETRY_LIMIT = 250;

    function normalizeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function isEscaped(text, index) {
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
        return slashes % 2 === 1;
    }

    function fallbackNormalizeFormulaSource(value) {
        const original = String(value || '').trim();
        if (!original) return { original, source: '', delimiter: null };
        for (const delimiter of [
            { open: '$$', close: '$$', name: 'double-dollar' },
            { open: '\\[', close: '\\]', name: 'display-bracket' },
            { open: '\\(', close: '\\)', name: 'inline-parenthesis' },
            { open: '$', close: '$', name: 'single-dollar' },
        ]) {
            if (original.startsWith(delimiter.open) && original.endsWith(delimiter.close)
                && original.length >= delimiter.open.length + delimiter.close.length) {
                return {
                    original,
                    source: original.slice(delimiter.open.length, -delimiter.close.length).trim(),
                    delimiter: delimiter.name,
                };
            }
        }
        return { original, source: original, delimiter: null };
    }

    function normalizeFormulaSource(value, formulaApi = Formula) {
        if (formulaApi && typeof formulaApi.normalizeFormulaSource === 'function') {
            return formulaApi.normalizeFormulaSource(value);
        }
        return fallbackNormalizeFormulaSource(value);
    }

    function canonicalInlineFormulaText(value, formulaApi = Formula) {
        const normalized = normalizeFormulaSource(value, formulaApi);
        return normalized.source ? `\\(${normalized.source}\\)` : String(value || '');
    }

    function findClosingParenthesisMath(input, start) {
        for (let index = start + 2; index < input.length - 1; index += 1) {
            if (input[index] === '\\' && input[index + 1] === ')' && !isEscaped(input, index)) return index;
        }
        return -1;
    }

    function findClosingDollarMath(input, start) {
        for (let index = start + 1; index < input.length; index += 1) {
            if (input[index] !== '$' || isEscaped(input, index)) continue;
            if (input[index - 1] === '$' || input[index + 1] === '$') continue;
            return index;
        }
        return -1;
    }

    function splitInlineMathSegments(value, formulaApi = Formula) {
        const input = String(value || '');
        const segments = [];
        let textStart = 0;
        let index = 0;

        const pushText = (end) => {
            if (end > textStart) segments.push({ kind: 'text', text: input.slice(textStart, end) });
        };

        while (index < input.length) {
            if (input[index] === '\\' && input[index + 1] === '(' && !isEscaped(input, index)) {
                const close = findClosingParenthesisMath(input, index);
                if (close >= 0) {
                    pushText(index);
                    const raw = input.slice(index, close + 2);
                    const normalized = normalizeFormulaSource(raw, formulaApi);
                    if (normalized.source) {
                        segments.push({
                            kind: INLINE_FORMULA_KIND,
                            text: raw,
                            source: normalized.source,
                            delimiter: normalized.delimiter || 'inline-parenthesis',
                        });
                        index = close + 2;
                        textStart = index;
                        continue;
                    }
                }
            }

            if (input[index] === '$' && input[index + 1] !== '$' && !isEscaped(input, index)) {
                const close = findClosingDollarMath(input, index);
                if (close >= 0) {
                    pushText(index);
                    const raw = input.slice(index, close + 1);
                    const normalized = normalizeFormulaSource(raw, formulaApi);
                    if (normalized.source) {
                        segments.push({
                            kind: INLINE_FORMULA_KIND,
                            text: raw,
                            source: normalized.source,
                            delimiter: normalized.delimiter || 'single-dollar',
                        });
                        index = close + 1;
                        textStart = index;
                        continue;
                    }
                }
            }
            index += 1;
        }

        pushText(input.length);
        return segments.length ? segments : [{ kind: 'text', text: input }];
    }

    function rawTypeForNode(node, adapter) {
        if (!node) return '';
        if (typeof adapter?.rawTypeForNode === 'function') {
            const resolved = normalizeType(adapter.rawTypeForNode(node));
            if (resolved) return resolved;
        }
        for (const value of [
            node.raw_node_type,
            node?.metadata?.provider_block_label,
            node?.metadata?.block_label,
            node?.metadata?.source_label,
            node.block_label,
            node.source_label,
            node.paddle_label,
            node.label,
        ]) {
            const resolved = normalizeType(value);
            if (resolved) return resolved;
        }
        return '';
    }

    function installAdapterFormulaTokens(adapter = Adapter, formulaApi = Formula) {
        if (!adapter || adapter.__speedReadingFormulaTokensInstalled) return Boolean(adapter);
        if (typeof adapter.tokenizeReadingText !== 'function' || typeof adapter.buildReadingElements !== 'function') return false;

        const originalTokenizeReadingText = adapter.tokenizeReadingText;
        const originalBuildReadingElements = adapter.buildReadingElements;

        adapter.tokenizeReadingText = function tokenizeFormulaAwareReadingText(text, options = {}) {
            const input = options.normalizeSoftWraps === true && typeof adapter.normalizeSoftWraps === 'function'
                ? adapter.normalizeSoftWraps(text)
                : String(text || '').replace(/\r\n?/gu, '\n');
            const segments = splitInlineMathSegments(input, formulaApi);
            if (!segments.some((segment) => segment.kind === INLINE_FORMULA_KIND)) {
                return originalTokenizeReadingText(input, { ...options, normalizeSoftWraps: false });
            }

            const tokens = [];
            for (const segment of segments) {
                if (segment.kind !== INLINE_FORMULA_KIND) {
                    tokens.push(...originalTokenizeReadingText(segment.text, { ...options, normalizeSoftWraps: false }));
                    continue;
                }
                const sourceTokens = originalTokenizeReadingText(segment.source, { normalizeSoftWraps: false });
                tokens.push({
                    kind: INLINE_FORMULA_KIND,
                    text: segment.text,
                    formula_source: segment.source,
                    formula_delimiter: segment.delimiter,
                    reading_units: sourceTokens.reduce((sum, token) => sum + (Number(token.reading_units) || 0), 0),
                    display_width: typeof adapter.displayWidth === 'function'
                        ? adapter.displayWidth(segment.source)
                        : Math.max(1, segment.source.length),
                });
            }
            return tokens;
        };

        adapter.buildReadingElements = function buildFormulaAwareReadingElements(documentView, nodes) {
            const nodeById = new Map((nodes || []).map((node) => [String(node?.node_id || ''), node]));
            return originalBuildReadingElements(documentView, nodes).map((element) => {
                const source = nodeById.get(String(element?.identity?.node_id || ''));
                const rawType = normalizeType(element?.raw_node_type) || rawTypeForNode(source, adapter);
                if (rawType !== INLINE_FORMULA_KIND || element?.kind !== 'text') return element;
                return {
                    ...element,
                    raw_node_type: INLINE_FORMULA_KIND,
                    inline_formula: true,
                    text: canonicalInlineFormulaText(element.text, formulaApi),
                };
            });
        };

        adapter.__speedReadingFormulaTokensInstalled = true;
        adapter.__speedReadingFormulaOriginalTokenizeReadingText = originalTokenizeReadingText;
        adapter.__speedReadingFormulaOriginalBuildReadingElements = originalBuildReadingElements;
        return true;
    }

    function clearElement(target) {
        if (!target) return;
        if (typeof target.replaceChildren === 'function') {
            target.replaceChildren();
            return;
        }
        while (target.firstChild) target.removeChild(target.firstChild);
        target.textContent = '';
    }

    function renderInlineFormulaInto(options = {}) {
        const { documentObject, target, source, root, katex } = options;
        if (!documentObject || !target) return { rendered: false, source: '', mode: 'unavailable' };
        const normalizedSource = String(source || '').trim();
        clearElement(target);
        target.dataset.formulaSource = normalizedSource;
        if (typeof target.setAttribute === 'function') {
            target.setAttribute('role', 'math');
            target.setAttribute('aria-label', normalizedSource || '公式内容不可用');
        }
        const renderer = katex || root?.katex;
        if (!normalizedSource || !renderer || typeof renderer.render !== 'function') {
            target.textContent = normalizedSource || '公式内容不可用';
            target.dataset.formulaRendering = 'fallback';
            return { rendered: false, source: normalizedSource, mode: 'fallback' };
        }
        try {
            renderer.render(normalizedSource, target, {
                displayMode: false,
                throwOnError: true,
                strict: 'warn',
                trust: false,
                output: 'htmlAndMathml',
            });
            target.dataset.formulaRendering = 'katex';
            return { rendered: true, source: normalizedSource, mode: 'katex' };
        } catch (_error) {
            target.textContent = normalizedSource;
            target.dataset.formulaRendering = 'fallback';
            return { rendered: false, source: normalizedSource, mode: 'fallback' };
        }
    }

    function rowSegments(line, formulaApi = Formula) {
        if (Array.isArray(line?.tokens) && line.tokens.some((token) => token?.kind === INLINE_FORMULA_KIND)) {
            const segments = [];
            let text = '';
            const flushText = () => {
                if (!text) return;
                segments.push({ kind: 'text', text });
                text = '';
            };
            for (const token of line.tokens) {
                if (token?.kind !== INLINE_FORMULA_KIND) {
                    text += token?.text || '';
                    continue;
                }
                flushText();
                segments.push({
                    kind: INLINE_FORMULA_KIND,
                    text: token.text || '',
                    source: token.formula_source || normalizeFormulaSource(token.text, formulaApi).source,
                    delimiter: token.formula_delimiter || null,
                });
            }
            flushText();
            return segments;
        }
        return splitInlineMathSegments(line?.text || '', formulaApi);
    }

    function renderStructuredLineFormula(options = {}) {
        const { documentObject, row, line, root, formulaApi = Formula } = options;
        if (!documentObject || !row || !line) return false;
        const segments = rowSegments(line, formulaApi);
        if (!segments.some((segment) => segment.kind === INLINE_FORMULA_KIND)) return false;
        clearElement(row);
        for (const segment of segments) {
            const span = documentObject.createElement('span');
            if (segment.kind === INLINE_FORMULA_KIND) {
                span.className = 'reader-playback-inline-formula';
                span.dataset.formulaDelimiter = segment.delimiter || '';
                renderInlineFormulaInto({
                    documentObject,
                    target: span,
                    source: segment.source,
                    root,
                });
            } else {
                span.className = 'reader-playback-text-segment';
                span.textContent = segment.text || '';
            }
            row.appendChild(span);
        }
        return true;
    }

    function installPlaybackFormulaRendering(rootObject, formulaApi = Formula) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller?.prototype) return false;
        const prototype = Controller.prototype;
        if (prototype.__speedReadingFormulaRenderingInstalled) return true;

        const originalRenderFrame = prototype.renderFrame;
        const originalRenderManualFrame = prototype.renderManualFrame;
        if (typeof originalRenderFrame !== 'function' || typeof originalRenderManualFrame !== 'function') return false;

        prototype.renderFrame = function renderFormulaAwarePlaybackFrame(frame, target) {
            const result = originalRenderFrame.call(this, frame, target);
            if (!target || frame?.kind !== 'timed_text' || !Array.isArray(frame?.lines)) return result;
            const rows = target.querySelectorAll?.('.reader-playback-line') || [];
            frame.lines.forEach((line, index) => {
                renderStructuredLineFormula({
                    documentObject: this.document,
                    row: rows[index],
                    line,
                    root: this.document?.defaultView || rootObject,
                    formulaApi,
                });
            });
            return result;
        };

        prototype.renderManualFrame = function renderFormulaManualFrame(frame, target) {
            if (String(frame?.node_type || '').toLowerCase() !== 'formula') {
                return originalRenderManualFrame.call(this, frame, target);
            }

            const slot = this.document.createElement('div');
            slot.className = 'reader-playback-asset-slot reader-playback-formula-slot';
            const formulaTarget = this.document.createElement('div');
            formulaTarget.className = 'reader-playback-display-formula';
            slot.appendChild(formulaTarget);
            target.appendChild(slot);

            const result = formulaApi?.renderFormulaInto?.({
                documentObject: this.document,
                target: formulaTarget,
                text: frame.text || '',
                root: this.document?.defaultView || rootObject,
            }) || { rendered: false, mode: 'unavailable' };

            if (!result.rendered && Array.isArray(frame.asset_refs) && frame.asset_refs.length && this.assets?.renderAssetInto) {
                this.assets.renderAssetInto({
                    documentObject: this.document,
                    resolver: this.reader?.assetResolver,
                    documentRef: frame.identity?.document_ref,
                    candidateId: frame.identity?.candidate_id,
                    assetRefs: frame.asset_refs,
                    nodeType: frame.node_type,
                    fallbackText: frame.text,
                    target: slot,
                }).catch((error) => {
                    if (error?.code === 'reader_selection_changed' || error?.code === 'reader_identity_changed') {
                        this.reader?.renderError?.(error);
                    }
                });
            }

            const button = this.document.createElement('button');
            button.type = 'button';
            button.className = 'reader-playback-continue';
            button.textContent = '继续';
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.continueManual();
            });
            target.appendChild(button);
            return result;
        };

        prototype.__speedReadingFormulaRenderingInstalled = true;
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        const formulaApi = rootObject?.ReaderFormulaV2 || Formula;
        const adapterInstalled = installAdapterFormulaTokens(adapter, formulaApi);
        const rendererInstalled = installPlaybackFormulaRendering(rootObject, formulaApi);
        return Boolean(adapterInstalled && rendererInstalled);
    }

    function installWithRetry(rootObject = typeof globalThis !== 'undefined' ? globalThis : null, attempt = 0) {
        if (install(rootObject)) return true;
        if (!rootObject || attempt >= INSTALL_RETRY_LIMIT || typeof rootObject.setTimeout !== 'function') return false;
        rootObject.setTimeout(() => installWithRetry(rootObject, attempt + 1), INSTALL_RETRY_MS);
        return false;
    }

    return {
        INLINE_FORMULA_KIND,
        INSTALL_RETRY_LIMIT,
        INSTALL_RETRY_MS,
        canonicalInlineFormulaText,
        fallbackNormalizeFormulaSource,
        install,
        installAdapterFormulaTokens,
        installPlaybackFormulaRendering,
        installWithRetry,
        normalizeFormulaSource,
        renderInlineFormulaInto,
        renderStructuredLineFormula,
        rowSegments,
        splitInlineMathSegments,
    };
});

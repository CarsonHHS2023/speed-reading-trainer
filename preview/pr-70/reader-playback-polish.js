(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPlaybackPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WIDTH_INPUT_PX = 48;
    const FIRST_CONTROL_ID = 'speedReadingFirst';
    const LAST_CONTROL_ID = 'speedReadingLast';
    const ACTIVE_SESSION_STATES = new Set(['playing', 'paused', 'manual']);
    const NODE_WINDOW_SIZE = 150;
    const EDGE_PREFETCH_FRAMES = 20;

    function widenWidthInput(controller) {
        const input = controller?.element?.('widthInput');
        if (!input?.style) return false;
        input.style.width = `${WIDTH_INPUT_PX}px`;
        input.style.maxWidth = `${WIDTH_INPUT_PX}px`;
        input.style.minWidth = `${WIDTH_INPUT_PX}px`;
        input.style.flexShrink = '0';
        return true;
    }

    function createToolbarButton(controller, id, text, title) {
        const button = controller?.document?.createElement?.('button');
        if (!button) return null;
        button.id = id;
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        button.disabled = true;
        button.setAttribute?.('aria-label', title);
        return button;
    }

    function isTrainingRunning(controller) {
        return controller?.trainingClock?.state === 'running' && !controller?.trainingPaused;
    }

    function isPlaybackSessionEngaged(controller) {
        if (typeof controller?.isPlaybackSessionEngaged === 'function') {
            return Boolean(controller.isPlaybackSessionEngaged());
        }
        const playbackState = controller?.playback?.state;
        if (!ACTIVE_SESSION_STATES.has(playbackState)) return false;
        const clock = controller?.trainingClock;
        if (!clock) return playbackState === 'playing';
        return clock.state === 'running' || clock.state === 'paused';
    }

    function normalizedWindowStart(start) {
        const value = Math.max(0, Math.trunc(Number(start) || 0));
        return Math.floor(value / NODE_WINDOW_SIZE) * NODE_WINDOW_SIZE;
    }

    function playbackWindowStarts(controller) {
        if (!(controller.__playbackWindowStarts instanceof Set)) controller.__playbackWindowStarts = new Set();
        if (!controller.__playbackWindowStarts.size && Number.isInteger(controller.activeBatchStart)) {
            controller.__playbackWindowStarts.add(normalizedWindowStart(controller.activeBatchStart));
        }
        return controller.__playbackWindowStarts;
    }

    function playbackWindowBounds(controller) {
        const starts = [...playbackWindowStarts(controller)].sort((a, b) => a - b);
        if (!starts.length && Number.isInteger(controller?.activeBatchStart)) {
            const start = normalizedWindowStart(controller.activeBatchStart);
            return { first: start, last: start };
        }
        return {
            first: starts.length ? starts[0] : null,
            last: starts.length ? starts[starts.length - 1] : null,
        };
    }

    function windowRecord(controller, start) {
        return Number.isInteger(start) ? controller?.reader?.windowRecord?.(start) || null : null;
    }

    function hasPreviousDocumentContent(controller, snapshot = controller?.playback?.snapshot?.()) {
        if ((snapshot?.index || 0) > 0) return true;
        const { first } = playbackWindowBounds(controller);
        return Number.isInteger(first) && first > 0;
    }

    function hasNextDocumentContent(controller, snapshot = controller?.playback?.snapshot?.()) {
        if (snapshot?.frame_count && snapshot.index < snapshot.frame_count - 1) return true;
        const { last } = playbackWindowBounds(controller);
        const record = windowRecord(controller, last);
        return Boolean(record?.hasMore);
    }

    function measuredPageHeight(lines, rowGapPx = 0) {
        const gap = Math.max(0, Number(rowGapPx) || 0);
        return (lines || []).reduce((sum, line, index) => {
            const paragraphGap = index > 0 ? Math.max(0, Number(line?.paragraph_gap_before_px) || 0) : 0;
            return sum + (index > 0 ? gap : 0) + paragraphGap + Math.max(1, Number(line?.row_height_px) || 1);
        }, 0);
    }

    function packPageRows(lines, pageHeightPx, rowGapPx = 0) {
        const budget = Math.max(1, Number(pageHeightPx) || 1);
        const gap = Math.max(0, Number(rowGapPx) || 0);
        const pages = [];
        let page = [];
        let used = 0;
        for (const line of lines || []) {
            const rowHeight = Math.max(1, Number(line?.row_height_px) || 1);
            const paragraphGap = page.length ? Math.max(0, Number(line?.paragraph_gap_before_px) || 0) : 0;
            const separator = page.length ? gap + paragraphGap : 0;
            if (page.length && used + separator + rowHeight > budget + 0.01) {
                pages.push(page);
                page = [];
                used = 0;
            }
            const nextParagraphGap = page.length ? Math.max(0, Number(line?.paragraph_gap_before_px) || 0) : 0;
            const nextSeparator = page.length ? gap + nextParagraphGap : 0;
            page.push(line);
            used += nextSeparator + rowHeight;
        }
        if (page.length) pages.push(page);
        return pages;
    }

    function sourceSpansForLines(lines) {
        const seen = new Set();
        const spans = [];
        for (const line of lines || []) {
            for (const identity of line?.source_spans || (line?.identity ? [line.identity] : [])) {
                const key = `${identity?.candidate_id || ''}\u0000${identity?.node_id || ''}\u0000${identity?.source_unit_id || ''}`;
                if (seen.has(key)) continue;
                seen.add(key);
                spans.push(identity);
            }
        }
        return spans;
    }

    function repackedPageFrame(controller, template, lines, sequence) {
        const sourceSpans = sourceSpansForLines(lines);
        const identity = sourceSpans[0] || template?.identity || null;
        const readingUnits = (lines || []).reduce((sum, line) => sum + (Number(line?.reading_units) || 0), 0);
        const speedPerMinute = Math.max(1, Number(controller?.element?.('speedInput')?.value || 5000));
        const duration = typeof controller?.adapter?.frameDurationMs === 'function'
            ? controller.adapter.frameDurationMs(readingUnits, speedPerMinute)
            : Math.max(0, Number(template?.duration_ms) || 0);
        const placement = {
            ...(template?.placement || {}),
            virtual_page_index: Number(template?.placement?.virtual_page_index || 0) + sequence,
            content_height_px: measuredPageHeight(lines, template?.placement?.row_gap_px),
        };
        return {
            ...template,
            frame_id: `${template?.frame_id || 'playback-frame'}:page-pack:${sequence}`,
            node_type: lines.length === 1 ? lines[0]?.node_type || template?.node_type : 'mixed',
            heading_level: lines.length === 1 ? lines[0]?.heading_level ?? null : null,
            text: lines.map((line) => line?.text || '').join('\n'),
            lines,
            reading_units: readingUnits,
            duration_ms: duration,
            identity,
            source_spans: sourceSpans,
            placement,
        };
    }

    function repackPageFrames(controller, frames) {
        const source = Array.isArray(frames) ? frames : [];
        const output = [];
        let index = 0;
        while (index < source.length) {
            const frame = source[index];
            if (frame?.kind !== 'timed_text' || frame?.placement?.display_scope !== 'page' || !Array.isArray(frame.lines)) {
                output.push(frame);
                index += 1;
                continue;
            }
            const segment = [];
            let cursor = index;
            while (
                cursor < source.length
                && source[cursor]?.kind === 'timed_text'
                && source[cursor]?.placement?.display_scope === 'page'
                && Array.isArray(source[cursor]?.lines)
            ) {
                segment.push(source[cursor]);
                cursor += 1;
            }
            const lines = segment.flatMap((item) => item.lines || []);
            const template = segment[0];
            const pageHeight = Math.max(1, Number(template?.placement?.page_height_px) || 1);
            const rowGap = Math.max(0, Number(template?.placement?.row_gap_px) || 0);
            const pages = packPageRows(lines, pageHeight, rowGap);
            pages.forEach((pageLines, pageIndex) => output.push(repackedPageFrame(controller, template, pageLines, pageIndex)));
            index = cursor;
        }
        return output;
    }

    function uniqueFrames(frames) {
        const output = [];
        const seen = new Set();
        for (const frame of frames || []) {
            const key = frame?.frame_id || `${frame?.identity?.node_id || ''}\u0000${frame?.text || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            output.push(frame);
        }
        return output;
    }

    function mergePlaybackFrames(controller, loadedFrames, direction) {
        const current = Array.isArray(controller?.playback?.frames) ? controller.playback.frames : [];
        const incoming = Array.isArray(loadedFrames) ? loadedFrames : [];
        if (!current.length) return incoming;
        if (!incoming.length) return current;
        if (controller?.displayScope?.() !== 'page') {
            return direction < 0
                ? uniqueFrames(incoming.concat(current))
                : uniqueFrames(current.concat(incoming));
        }

        const snapshot = controller?.playback?.snapshot?.() || {};
        const currentIndex = Math.max(0, Math.min(current.length - 1, Number(snapshot.index) || 0));
        if (direction < 0) {
            const beforeCurrent = uniqueFrames(incoming.concat(current.slice(0, currentIndex)));
            return repackPageFrames(controller, beforeCurrent).concat(current.slice(currentIndex));
        }
        const throughCurrent = current.slice(0, currentIndex + 1);
        const afterCurrent = uniqueFrames(current.slice(currentIndex + 1).concat(incoming));
        return throughCurrent.concat(repackPageFrames(controller, afterCurrent));
    }

    async function buildWindowFrames(controller, start, options = {}) {
        const reader = controller?.reader;
        if (!reader?.requestWindow || !controller?.buildFrames) return null;
        const normalizedStart = normalizedWindowStart(start);
        const record = await reader.requestWindow(normalizedStart, { cache: options.cache !== false });
        if (!record?.nodes?.length) return null;
        const built = controller.buildFrames({
            start: record.start,
            nodes: record.nodes,
            firstNodeId: null,
        });
        return {
            start: record.start,
            record,
            frames: Array.isArray(built?.frames) ? built.frames : [],
        };
    }

    async function extendPlaybackWindow(controller, direction) {
        if (!controller?.playback || !controller?.reader) return false;
        const key = direction < 0 ? 'previous' : 'next';
        if (!controller.__playbackWindowPromises) controller.__playbackWindowPromises = {};
        if (controller.__playbackWindowPromises[key]) return controller.__playbackWindowPromises[key];
        const promise = (async () => {
            const bounds = playbackWindowBounds(controller);
            const edge = direction < 0 ? bounds.first : bounds.last;
            if (!Number.isInteger(edge)) return false;
            if (direction < 0 && edge <= 0) return false;
            if (direction > 0 && windowRecord(controller, edge)?.hasMore === false) return false;
            const target = direction < 0 ? Math.max(0, edge - NODE_WINDOW_SIZE) : edge + NODE_WINDOW_SIZE;
            if (playbackWindowStarts(controller).has(target)) return false;
            const loaded = await buildWindowFrames(controller, target);
            if (!loaded?.frames?.length) return false;
            const combined = mergePlaybackFrames(controller, loaded.frames, direction);
            playbackWindowStarts(controller).add(loaded.start);
            controller.playback.setFrames(combined, { preserveIdentity: true });
            return true;
        })().finally(() => {
            controller.__playbackWindowPromises[key] = null;
        });
        controller.__playbackWindowPromises[key] = promise;
        return promise;
    }

    function maybePrefetchPlaybackWindow(controller, snapshot = controller?.playback?.snapshot?.()) {
        if (!isPlaybackSessionEngaged(controller) || !snapshot?.frame_count) return false;
        const distanceFromStart = Math.max(0, Number(snapshot.index) || 0);
        const distanceFromEnd = Math.max(0, snapshot.frame_count - 1 - (Number(snapshot.index) || 0));
        if (distanceFromStart <= EDGE_PREFETCH_FRAMES) {
            extendPlaybackWindow(controller, -1).catch((error) => controller?.reader?.renderError?.(error));
        }
        if (distanceFromEnd <= EDGE_PREFETCH_FRAMES) {
            extendPlaybackWindow(controller, 1).catch((error) => controller?.reader?.renderError?.(error));
        }
        return true;
    }

    async function continuePastLoadedTail(controller) {
        const oldFrame = controller?.playback?.currentFrame?.();
        const oldNodeId = oldFrame?.identity?.node_id || null;
        const extended = await extendPlaybackWindow(controller, 1);
        if (!extended) return false;
        const frames = controller.playback.frames || [];
        let oldIndex = frames.findIndex((frame) => frame?.frame_id === oldFrame?.frame_id);
        if (oldIndex < 0 && oldNodeId) {
            oldIndex = frames.findIndex((frame) => (
                frame?.identity?.node_id === oldNodeId
                || (frame?.source_spans || []).some((identity) => identity?.node_id === oldNodeId)
            ));
        }
        controller.playback.index = Math.min(frames.length - 1, Math.max(0, oldIndex + 1));
        controller.playback.state = 'paused';
        controller.playback.play?.();
        controller.reader?.setStatus?.('');
        return true;
    }

    function setTransportBusy(controller, message = '') {
        controller.__playbackTransportBusyMessage = String(message || '');
        controller?.updateControls?.();
        return controller.__playbackTransportBusyMessage;
    }

    function clearTransportBusy(controller) {
        controller.__playbackTransportBusyMessage = '';
        controller?.updateControls?.();
        return true;
    }

    function applyTransportBusyState(controller) {
        const message = String(controller?.__playbackTransportBusyMessage || '');
        const state = controller?.element?.('speedReadingState');
        if (!message) {
            state?.removeAttribute?.('aria-busy');
            return false;
        }
        for (const id of [FIRST_CONTROL_ID, 'speedReadingPrev', 'speedReadingNext', LAST_CONTROL_ID]) {
            const button = controller?.element?.(id);
            if (button) button.disabled = true;
        }
        if (state) {
            state.textContent = message;
            state.setAttribute?.('aria-busy', 'true');
        }
        return true;
    }

    async function moveToDocumentStart(controller) {
        if (!isPlaybackSessionEngaged(controller)) return controller?.reader?.firstPage?.();
        controller.pauseTrainingForFrameNavigation?.();
        setTransportBusy(controller, '正在加载整本书第一帧…');
        controller.reader?.setStatus?.('正在加载整本书第一帧…');
        try {
            const loaded = await buildWindowFrames(controller, 0);
            if (!loaded?.frames?.length) return null;
            controller.__playbackWindowStarts = new Set([loaded.start]);
            controller.activeBatchStart = loaded.start;
            controller.playback.setFrames(loaded.frames, { preserveIdentity: false });
            controller.playback.index = 0;
            controller.playback.emit?.();
            return controller.playback.currentFrame?.() || null;
        } finally {
            controller.reader?.setStatus?.('');
            clearTransportBusy(controller);
        }
    }

    async function findLastWindow(controller, onProgress = null) {
        const reader = controller?.reader;
        if (!reader?.requestWindow) return null;
        const bounds = playbackWindowBounds(controller);
        let start = Number.isInteger(bounds.last) ? bounds.last : normalizedWindowStart(controller?.activeBatchStart || 0);
        let record = await reader.requestWindow(start);
        let scannedNodes = Array.isArray(record?.nodes) ? record.nodes.length : 0;
        let scannedWindows = record?.nodes?.length ? 1 : 0;
        onProgress?.({ scannedNodes, scannedWindows, start: record?.start ?? start });
        while (record?.hasMore) {
            const next = Number.isInteger(record?.nextNodeOrder)
                ? record.nextNodeOrder
                : record.start + NODE_WINDOW_SIZE;
            const scanned = await reader.requestWindow(next, { cache: false });
            if (!scanned?.nodes?.length || scanned.start === record.start) break;
            record = scanned;
            scannedNodes += scanned.nodes.length;
            scannedWindows += 1;
            onProgress?.({ scannedNodes, scannedWindows, start: scanned.start });
        }
        if (!record?.nodes?.length) return null;
        return reader.windowRecord?.(record.start) || await reader.requestWindow(record.start);
    }

    async function moveToDocumentEnd(controller) {
        if (!isPlaybackSessionEngaged(controller)) return controller?.reader?.lastPage?.();
        controller.pauseTrainingForFrameNavigation?.();
        const updateProgress = ({ scannedNodes, scannedWindows }) => {
            const message = `正在定位整本书最后一帧 · 已扫描 ${scannedNodes} 个节点（${scannedWindows} 批）…`;
            setTransportBusy(controller, message);
            controller.reader?.setStatus?.(message);
        };
        setTransportBusy(controller, '正在定位整本书最后一帧…');
        controller.reader?.setStatus?.('正在定位整本书最后一帧…');
        try {
            const record = await findLastWindow(controller, updateProgress);
            if (!record?.nodes?.length) return null;
            setTransportBusy(controller, '已找到最后一批，正在生成最后一帧…');
            const built = controller.buildFrames({ start: record.start, nodes: record.nodes, firstNodeId: null });
            const frames = Array.isArray(built?.frames) ? built.frames : [];
            if (!frames.length) return null;
            controller.__playbackWindowStarts = new Set([record.start]);
            controller.activeBatchStart = record.start;
            controller.playback.setFrames(frames, { preserveIdentity: false });
            controller.playback.index = frames.length - 1;
            controller.playback.state = frames[frames.length - 1]?.kind === 'manual' ? 'manual' : 'paused';
            controller.playback.emit?.();
            return controller.playback.currentFrame?.() || null;
        } finally {
            controller.reader?.setStatus?.('');
            clearTransportBusy(controller);
        }
    }

    function upgradeToolbar(controller) {
        if (!controller?.document) return false;
        const toolbar = controller.element?.('speedReadingV2Toolbar');
        if (!toolbar || toolbar.classList?.contains?.('speed-reading-v2-toolbar-compat')) return false;

        const prev = controller.element?.('speedReadingPrev');
        const playPause = controller.element?.('speedReadingPause');
        const next = controller.element?.('speedReadingNext');
        const stop = controller.element?.('speedReadingStop');
        if (!prev || !playPause || !next || !stop) return false;

        prev.textContent = '←';
        next.textContent = '→';
        stop.textContent = '⏹';
        stop.title = '停止';
        stop.setAttribute?.('aria-label', stop.title);

        let first = controller.element?.(FIRST_CONTROL_ID);
        if (!first) {
            first = createToolbarButton(controller, FIRST_CONTROL_ID, '⏮', '首页');
            if (first) {
                first.addEventListener?.('click', () => {
                    Promise.resolve(controller.firstFrame?.()).catch((error) => controller.reader?.renderError?.(error));
                });
                toolbar.insertBefore?.(first, prev);
            }
        }

        let last = controller.element?.(LAST_CONTROL_ID);
        if (!last) {
            last = createToolbarButton(controller, LAST_CONTROL_ID, '⏭', '尾页');
            if (last) {
                last.addEventListener?.('click', () => {
                    Promise.resolve(controller.lastFrame?.()).catch((error) => controller.reader?.renderError?.(error));
                });
                toolbar.insertBefore?.(last, stop);
            }
        }
        applyTransportLabels(controller);
        return Boolean(first && last);
    }

    function applyTransportLabels(controller) {
        const engaged = isPlaybackSessionEngaged(controller);
        const labels = engaged
            ? [
                [FIRST_CONTROL_ID, '到头（整本书第一帧）'],
                ['speedReadingPrev', '上一帧'],
                ['speedReadingNext', '下一帧'],
                [LAST_CONTROL_ID, '到尾（整本书最后一帧）'],
            ]
            : [
                [FIRST_CONTROL_ID, '首页'],
                ['speedReadingPrev', '上一页'],
                ['speedReadingNext', '下一页'],
                [LAST_CONTROL_ID, '尾页'],
            ];
        for (const [id, title] of labels) {
            const button = controller?.element?.(id);
            if (!button) continue;
            button.title = title;
            button.setAttribute?.('aria-label', title);
        }
        const hint = controller?.element?.('speedReadingV2Toolbar')?.querySelector?.('.speed-reading-v2-shortcuts');
        if (hint) {
            hint.textContent = engaged
                ? 'Space 播放/暂停 · ←/→ 上一帧/下一帧 · Home/End 整本书第一帧/最后一帧 · Esc 停止'
                : '←/→ 上一页/下一页 · Home/End 首页/尾页 · Space 开始速度阅读';
        }
        return true;
    }

    function applyDocumentTransportState(controller, snapshot = controller?.playback?.snapshot?.()) {
        if (!isPlaybackSessionEngaged(controller)) return false;
        const first = controller?.element?.(FIRST_CONTROL_ID);
        const prev = controller?.element?.('speedReadingPrev');
        const next = controller?.element?.('speedReadingNext');
        const last = controller?.element?.(LAST_CONTROL_ID);
        const canBack = hasPreviousDocumentContent(controller, snapshot);
        const canForward = hasNextDocumentContent(controller, snapshot);
        if (first) first.disabled = !canBack;
        if (prev) prev.disabled = !canBack;
        if (next) next.disabled = !canForward;
        if (last) last.disabled = !canForward;
        return true;
    }

    function wrapUpdateControls(target) {
        if (!target || typeof target.updateControls !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__playbackPolishLabelsWrapped')) return false;
        const original = target.updateControls;
        target.updateControls = function updateControlsWithLabels(...args) {
            const result = original.apply(this, args);
            applyTransportLabels(this);
            applyDocumentTransportState(this, args[0]);
            applyTransportBusyState(this);
            return result;
        };
        Object.defineProperty(target, '__playbackPolishLabelsWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller || Controller.prototype.__playbackPolishInstalled) return false;

        const originalBuildFrames = Controller.prototype.buildFrames;
        if (typeof originalBuildFrames === 'function') {
            Controller.prototype.buildFrames = function buildFramesWithPagePacking(...args) {
                const built = originalBuildFrames.apply(this, args);
                if (!built || !Array.isArray(built.frames) || this.displayScope?.() !== 'page') return built;
                return { ...built, frames: repackPageFrames(this, built.frames) };
            };
        }

        const originalStart = Controller.prototype.start;
        if (typeof originalStart === 'function') {
            Controller.prototype.start = async function startWithStreamingWindows(...args) {
                this.__playbackWindowStarts = new Set();
                this.__playbackWindowPromises = {};
                this.__playbackTransportBusyMessage = '';
                const started = await originalStart.apply(this, args);
                if (started && Number.isInteger(this.activeBatchStart)) {
                    playbackWindowStarts(this).add(normalizedWindowStart(this.activeBatchStart));
                    maybePrefetchPlaybackWindow(this, this.playback?.snapshot?.());
                }
                return started;
            };
        }

        const originalStop = Controller.prototype.stop;
        if (typeof originalStop === 'function') {
            Controller.prototype.stop = function stopStreamingWindows(...args) {
                const result = originalStop.apply(this, args);
                this.__playbackWindowStarts = new Set();
                this.__playbackWindowPromises = {};
                this.__playbackTransportBusyMessage = '';
                return result;
            };
        }

        const originalRenderSnapshot = Controller.prototype.renderSnapshot;
        if (typeof originalRenderSnapshot === 'function') {
            Controller.prototype.renderSnapshot = function renderSnapshotWithStreaming(snapshot) {
                if (snapshot?.state === 'completed' && hasNextDocumentContent(this, snapshot)) {
                    this.reader?.setStatus?.('正在加载下一批速读内容…');
                    continuePastLoadedTail(this).then((continued) => {
                        if (!continued) originalRenderSnapshot.call(this, snapshot);
                    }).catch((error) => {
                        this.reader?.renderError?.(error);
                        originalRenderSnapshot.call(this, snapshot);
                    });
                    return;
                }
                const result = originalRenderSnapshot.call(this, snapshot);
                if (ACTIVE_SESSION_STATES.has(snapshot?.state)) maybePrefetchPlaybackWindow(this, snapshot);
                return result;
            };
        }

        const originalPreviousFrame = Controller.prototype.previousFrame;
        if (typeof originalPreviousFrame === 'function') {
            Controller.prototype.previousFrame = async function previousFrameAcrossWindows(...args) {
                if (!isPlaybackSessionEngaged(this)) return originalPreviousFrame.apply(this, args);
                const snapshot = this.playback?.snapshot?.();
                if ((snapshot?.index || 0) > 0) return originalPreviousFrame.apply(this, args);
                this.pauseTrainingForFrameNavigation?.();
                const extended = await extendPlaybackWindow(this, -1);
                if (!extended) return this.playback?.currentFrame?.() || null;
                return this.playback?.moveBy?.(-1) || null;
            };
        }

        const originalNextFrame = Controller.prototype.nextFrame;
        if (typeof originalNextFrame === 'function') {
            Controller.prototype.nextFrame = async function nextFrameAcrossWindows(...args) {
                if (!isPlaybackSessionEngaged(this)) return originalNextFrame.apply(this, args);
                const snapshot = this.playback?.snapshot?.();
                if (snapshot?.index < snapshot?.frame_count - 1) return originalNextFrame.apply(this, args);
                this.pauseTrainingForFrameNavigation?.();
                const extended = await extendPlaybackWindow(this, 1);
                if (!extended) return this.playback?.currentFrame?.() || null;
                return this.playback?.moveBy?.(1) || null;
            };
        }

        Controller.prototype.firstFrame = function firstFrameAcrossDocument() {
            return moveToDocumentStart(this);
        };
        Controller.prototype.lastFrame = function lastFrameAcrossDocument() {
            return moveToDocumentEnd(this);
        };

        const originalRenderManualFrame = Controller.prototype.renderManualFrame;
        if (typeof originalRenderManualFrame === 'function') {
            Controller.prototype.renderManualFrame = function renderManualFrameWithSessionLabels(frame, target) {
                originalRenderManualFrame.call(this, frame, target);
                const button = target?.querySelector?.('.reader-playback-continue');
                const snapshot = this.playback?.snapshot?.() || {};
                const isLoadedLast = snapshot.index >= (snapshot.frame_count || 0) - 1;
                const isDocumentLast = isLoadedLast && !hasNextDocumentContent(this, snapshot);
                if (!button) return;
                if (isDocumentLast) {
                    button.textContent = '最后一帧 · 返回阅读视图';
                    button.onclick = (event) => {
                        event?.stopPropagation?.();
                        this.stop();
                    };
                } else {
                    button.textContent = isTrainingRunning(this) ? '继续' : '下一帧';
                }
            };
        }

        const originalEnsureToolbar = Controller.prototype.ensureToolbar;
        if (typeof originalEnsureToolbar === 'function') {
            Controller.prototype.ensureToolbar = function ensureCompletePlaybackToolbar(...args) {
                const result = originalEnsureToolbar.apply(this, args);
                upgradeToolbar(this);
                return result;
            };
        }

        const originalSettingsVisibility = Controller.prototype.updateSettingsVisibility;
        if (typeof originalSettingsVisibility === 'function') {
            Controller.prototype.updateSettingsVisibility = function settingsWithReadableWidthInput(...args) {
                const result = originalSettingsVisibility.apply(this, args);
                widenWidthInput(this);
                return result;
            };
        }

        const originalBind = Controller.prototype.bind;
        if (typeof originalBind === 'function') {
            Controller.prototype.bind = function bindPlaybackPolish(...args) {
                const result = originalBind.apply(this, args);
                upgradeToolbar(this);
                widenWidthInput(this);
                applyTransportLabels(this);
                return result;
            };
        }

        wrapUpdateControls(Controller.prototype);
        Controller.prototype.__playbackPolishInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) {
            wrapUpdateControls(controller);
            upgradeToolbar(controller);
            widenWidthInput(controller);
            applyTransportLabels(controller);
            controller.updateControls?.();
        }
        return true;
    }

    return {
        ACTIVE_SESSION_STATES,
        EDGE_PREFETCH_FRAMES,
        FIRST_CONTROL_ID,
        LAST_CONTROL_ID,
        NODE_WINDOW_SIZE,
        WIDTH_INPUT_PX,
        applyDocumentTransportState,
        applyTransportBusyState,
        applyTransportLabels,
        buildWindowFrames,
        clearTransportBusy,
        createToolbarButton,
        extendPlaybackWindow,
        findLastWindow,
        hasNextDocumentContent,
        hasPreviousDocumentContent,
        install,
        isPlaybackSessionEngaged,
        isTrainingRunning,
        measuredPageHeight,
        maybePrefetchPlaybackWindow,
        mergePlaybackFrames,
        moveToDocumentEnd,
        moveToDocumentStart,
        packPageRows,
        playbackWindowBounds,
        playbackWindowStarts,
        repackPageFrames,
        setTransportBusy,
        upgradeToolbar,
        widenWidthInput,
        wrapUpdateControls,
    };
});

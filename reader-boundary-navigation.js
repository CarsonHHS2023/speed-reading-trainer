(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderBoundaryNavigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const NODE_WINDOW_SIZE = 150;
    const CONTROL_IDS = Object.freeze([
        'speedReadingFirst',
        'speedReadingPrev',
        'speedReadingNext',
        'speedReadingLast',
    ]);

    function createTaskCoordinator(onStatus = null) {
        let generation = 0;
        let active = null;
        const publish = (message, task = active) => {
            if (typeof onStatus === 'function') onStatus(String(message || ''), task);
        };
        return {
            begin(kind, message = '') {
                generation += 1;
                active = { token: generation, kind: String(kind || 'boundary') };
                publish(message, active);
                return active.token;
            },
            cancel() {
                const hadActive = Boolean(active);
                generation += 1;
                active = null;
                if (hadActive) publish('', null);
                return hadActive;
            },
            update(token, message) {
                if (!active || active.token !== token || generation !== token) return false;
                publish(message, active);
                return true;
            },
            finish(token) {
                if (!active || active.token !== token || generation !== token) return false;
                active = null;
                publish('', null);
                return true;
            },
            isCurrent(token) {
                return Boolean(active && active.token === token && generation === token);
            },
            active() {
                return active;
            },
        };
    }

    function normalizedWindowStart(start) {
        const value = Math.max(0, Math.trunc(Number(start) || 0));
        return Math.floor(value / NODE_WINDOW_SIZE) * NODE_WINDOW_SIZE;
    }

    function stateElement(playback) {
        return playback?.element?.('speedReadingState') || null;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const reader = rootObject?.ReaderUIV2?.getDefaultController?.();
        const playback = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
        if (!reader || !playback || playback.__boundaryNavigationInstalled) return Boolean(reader && playback);
        if (!playback.__playbackPolishInstalled && !rootObject?.ReaderPlaybackPolish) return false;

        const coordinator = createTaskCoordinator((message) => {
            playback.__boundaryNavigationStatus = message;
            reader.setStatus?.(message);
            const state = stateElement(playback);
            if (state) {
                state.textContent = message || (playback.isPlaybackSessionEngaged?.() ? playback.stateLabel?.(playback.playback?.snapshot?.()) || '速度阅读' : '普通阅读');
                if (message) state.setAttribute?.('aria-busy', 'true');
                else state.removeAttribute?.('aria-busy');
            }
        });
        playback.__boundaryNavigationCoordinator = coordinator;

        const originalUpdateControls = playback.updateControls?.bind(playback);
        if (originalUpdateControls) {
            playback.updateControls = function updateControlsWithBoundaryTask(...args) {
                const result = originalUpdateControls(...args);
                const message = String(this.__boundaryNavigationStatus || '');
                if (message) {
                    const state = stateElement(this);
                    if (state) {
                        state.textContent = message;
                        state.setAttribute?.('aria-busy', 'true');
                    }
                    for (const id of CONTROL_IDS) {
                        const button = this.element?.(id);
                        if (button) button.disabled = false;
                    }
                    const toggle = this.element?.('readingToggleBtn');
                    if (toggle) toggle.disabled = false;
                }
                return result;
            };
        }

        const cancelBoundary = () => coordinator.cancel();

        const originalPreviousPage = reader.previousPage?.bind(reader);
        if (originalPreviousPage) reader.previousPage = async function previousPageCancelsBoundary(...args) {
            cancelBoundary();
            return originalPreviousPage(...args);
        };
        const originalNextPage = reader.nextPage?.bind(reader);
        if (originalNextPage) reader.nextPage = async function nextPageCancelsBoundary(...args) {
            cancelBoundary();
            return originalNextPage(...args);
        };

        reader.firstPage = async function cancellableFirstPage() {
            const token = coordinator.begin('reader-start', '正在定位整本书首页…');
            try {
                let record = this.windowRecord?.(0);
                if (!record) record = await this.requestWindow(0);
                if (!coordinator.isCurrent(token) || !record?.nodes?.length) return false;
                this.setVisibleWindows([0]);
                if (!coordinator.isCurrent(token)) return false;
                return this.scrollToPage(0);
            } finally {
                coordinator.finish(token);
            }
        };

        reader.lastPage = async function cancellableLastPage() {
            const token = coordinator.begin('reader-end', '正在定位整本书尾页…');
            try {
                let starts = this.visibleStarts?.() || [];
                let tail = starts.length ? this.windowRecord?.(starts[starts.length - 1]) : null;
                if (!tail) tail = await this.requestWindow(0, { cache: false });
                if (!coordinator.isCurrent(token)) return false;
                let previous = null;
                let scannedNodes = Array.isArray(tail?.nodes) ? tail.nodes.length : 0;
                let scannedWindows = tail?.nodes?.length ? 1 : 0;
                coordinator.update(token, `正在定位整本书尾页 · 已扫描 ${scannedNodes} 个节点（${scannedWindows} 批）…`);
                while (tail?.hasMore && coordinator.isCurrent(token)) {
                    const nextStart = Number(tail.nextNodeOrder);
                    if (!Number.isInteger(nextStart) || nextStart <= tail.start) break;
                    const scanned = await this.requestWindow(nextStart, { cache: false });
                    if (!coordinator.isCurrent(token)) return false;
                    if (!scanned?.nodes?.length || scanned.start === tail.start) break;
                    previous = tail;
                    tail = scanned;
                    scannedNodes += scanned.nodes.length;
                    scannedWindows += 1;
                    coordinator.update(token, `正在定位整本书尾页 · 已扫描 ${scannedNodes} 个节点（${scannedWindows} 批）…`);
                }
                if (!coordinator.isCurrent(token) || !tail?.nodes?.length) return false;
                this.contentWindows.set(tail.start, tail);
                const visible = [];
                if (previous?.nodes?.length) {
                    this.contentWindows.set(previous.start, previous);
                    visible.push(previous.start);
                }
                visible.push(tail.start);
                this.setVisibleWindows(visible);
                if (!coordinator.isCurrent(token)) return false;
                return this.scrollToPage((this.presentationState?.pages || []).length - 1);
            } finally {
                coordinator.finish(token);
            }
        };

        const originalPreviousFrame = playback.previousFrame?.bind(playback);
        if (originalPreviousFrame) playback.previousFrame = async function previousFrameCancelsBoundary(...args) {
            cancelBoundary();
            return originalPreviousFrame(...args);
        };
        const originalNextFrame = playback.nextFrame?.bind(playback);
        if (originalNextFrame) playback.nextFrame = async function nextFrameCancelsBoundary(...args) {
            cancelBoundary();
            return originalNextFrame(...args);
        };
        const originalTogglePause = playback.togglePause?.bind(playback);
        if (originalTogglePause) playback.togglePause = function togglePauseCancelsBoundary(...args) {
            cancelBoundary();
            return originalTogglePause(...args);
        };
        const originalStop = playback.stop?.bind(playback);
        if (originalStop) playback.stop = function stopCancelsBoundary(...args) {
            cancelBoundary();
            return originalStop(...args);
        };

        playback.firstFrame = async function cancellableDocumentStart() {
            if (!this.isReaderActive?.()) return null;
            if (!this.isPlaybackSessionEngaged?.()) return reader.firstPage();
            const token = coordinator.begin('playback-start', '正在定位整本书第一帧…');
            this.pauseTrainingForFrameNavigation?.();
            try {
                const record = await reader.requestWindow(0);
                if (!coordinator.isCurrent(token) || !record?.nodes?.length) return null;
                coordinator.update(token, '已找到第一批，正在生成第一帧…');
                const built = this.buildFrames({ start: record.start, nodes: record.nodes, firstNodeId: null });
                const frames = Array.isArray(built?.frames) ? built.frames : [];
                if (!coordinator.isCurrent(token) || !frames.length) return null;
                this.__playbackWindowStarts = new Set([record.start]);
                this.activeBatchStart = record.start;
                this.playback.setFrames(frames, { preserveIdentity: false });
                this.playback.index = 0;
                this.playback.emit?.();
                return this.playback.currentFrame?.() || null;
            } finally {
                coordinator.finish(token);
            }
        };

        playback.lastFrame = async function cancellableDocumentEnd() {
            if (!this.isReaderActive?.()) return null;
            if (!this.isPlaybackSessionEngaged?.()) return reader.lastPage();
            const token = coordinator.begin('playback-end', '正在定位整本书最后一帧…');
            this.pauseTrainingForFrameNavigation?.();
            try {
                const starts = this.__playbackWindowStarts instanceof Set ? [...this.__playbackWindowStarts] : [];
                let start = starts.length ? Math.max(...starts) : normalizedWindowStart(this.activeBatchStart || 0);
                let record = await reader.requestWindow(start);
                if (!coordinator.isCurrent(token)) return null;
                let scannedNodes = Array.isArray(record?.nodes) ? record.nodes.length : 0;
                let scannedWindows = record?.nodes?.length ? 1 : 0;
                coordinator.update(token, `正在定位整本书最后一帧 · 已扫描 ${scannedNodes} 个节点（${scannedWindows} 批）…`);
                while (record?.hasMore && coordinator.isCurrent(token)) {
                    const next = Number.isInteger(record?.nextNodeOrder)
                        ? record.nextNodeOrder
                        : record.start + NODE_WINDOW_SIZE;
                    const scanned = await reader.requestWindow(next, { cache: false });
                    if (!coordinator.isCurrent(token)) return null;
                    if (!scanned?.nodes?.length || scanned.start === record.start) break;
                    record = scanned;
                    scannedNodes += scanned.nodes.length;
                    scannedWindows += 1;
                    coordinator.update(token, `正在定位整本书最后一帧 · 已扫描 ${scannedNodes} 个节点（${scannedWindows} 批）…`);
                }
                if (!coordinator.isCurrent(token) || !record?.nodes?.length) return null;
                coordinator.update(token, '已找到最后一批，正在生成最后一帧…');
                const built = this.buildFrames({ start: record.start, nodes: record.nodes, firstNodeId: null });
                const frames = Array.isArray(built?.frames) ? built.frames : [];
                if (!coordinator.isCurrent(token) || !frames.length) return null;
                reader.contentWindows?.set?.(record.start, record);
                this.__playbackWindowStarts = new Set([record.start]);
                this.activeBatchStart = record.start;
                this.playback.setFrames(frames, { preserveIdentity: false });
                this.playback.index = frames.length - 1;
                this.playback.state = frames[frames.length - 1]?.kind === 'manual' ? 'manual' : 'paused';
                this.playback.emit?.();
                return this.playback.currentFrame?.() || null;
            } finally {
                coordinator.finish(token);
            }
        };

        playback.__boundaryNavigationInstalled = true;
        playback.updateControls?.();
        return true;
    }

    function installWithRetry(rootObject = typeof globalThis !== 'undefined' ? globalThis : null, options = {}) {
        const delay = Math.max(10, Number(options.delayMs) || 25);
        const timeout = Math.max(delay, Number(options.timeoutMs) || 10000);
        const started = Date.now();
        return new Promise((resolve) => {
            const attempt = () => {
                if (install(rootObject)) {
                    resolve(true);
                    return;
                }
                if (Date.now() - started >= timeout) {
                    resolve(false);
                    return;
                }
                rootObject?.setTimeout?.(attempt, delay);
            };
            attempt();
        });
    }

    return {
        CONTROL_IDS,
        NODE_WINDOW_SIZE,
        createTaskCoordinator,
        install,
        installWithRetry,
        normalizedWindowStart,
    };
});
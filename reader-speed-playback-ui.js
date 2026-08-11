(function (root, factory) {
    const api = factory(
        root && root.ReaderUIV2,
        root && root.SpeedReadingAdapter,
        root && root.ReaderPlaybackController,
        root && root.ReaderAssetRendererV2,
        root && root.ReaderTrainingSessionClock,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSpeedPlaybackUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, Adapter, PlaybackModule, Assets, TrainingClockModule) {
    'use strict';

    const ACTIVE_STATES = new Set(['playing', 'paused', 'manual']);
    const DISPLAY_SCOPES = new Set(['block', 'line', 'page']);
    const READING_MODES = new Set(['focus', 'moving']);

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            Adapter = Adapter || require('./speed-reading-adapter.js');
            PlaybackModule = PlaybackModule || require('./playback-controller.js');
            Assets = Assets || require('./reader-assets.js');
            TrainingClockModule = TrainingClockModule || require('./training-session-clock.js');
        }
        if (!ReaderUI || !Adapter || !PlaybackModule || !Assets || !TrainingClockModule) throw new Error('Reader v2 playback dependencies are required');
        return { ReaderUI, Adapter, PlaybackModule, Assets, TrainingClockModule };
    }

    class ReaderSpeedPlaybackUIController {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.reader = options.readerController || deps.ReaderUI.getDefaultController();
            this.adapter = options.adapter || deps.Adapter;
            this.assets = options.assets || deps.Assets;
            this.playback = options.playback || new deps.PlaybackModule.PlaybackController({
                scheduler: options.scheduler,
                onChange: (snapshot) => this.renderSnapshot(snapshot),
            });
            this.trainingClock = options.trainingClock || new deps.TrainingClockModule.TrainingSessionClock({
                now: options.trainingNow,
            });
            this.trainingPaused = false;
            this.comprehensionPaused = false;
            this.resumePlaybackAfterTrainingPause = false;
            this.activeBatchStart = null;
            const view = this.document?.defaultView || null;
            this.setIntervalFn = options.setIntervalFn || (view?.setInterval ? view.setInterval.bind(view) : null);
            this.clearIntervalFn = options.clearIntervalFn || (view?.clearInterval ? view.clearInterval.bind(view) : null);
            this.trainingTicker = null;
            this.bound = false;
            this.openBookPatched = false;
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        formatElapsed(ms) {
            const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        updateTrainingTime() {
            const target = this.element('readingTime');
            if (target) target.textContent = this.formatElapsed(this.trainingClock?.elapsedMs?.() || 0);
        }

        startTrainingTicker() {
            this.stopTrainingTicker();
            this.updateTrainingTime();
            if (!this.setIntervalFn) return;
            this.trainingTicker = this.setIntervalFn(() => this.updateTrainingTime(), 250);
        }

        stopTrainingTicker() {
            if (this.trainingTicker !== null && this.clearIntervalFn) this.clearIntervalFn(this.trainingTicker);
            this.trainingTicker = null;
        }

        beginTrainingSession() {
            this.trainingPaused = false;
            this.comprehensionPaused = false;
            this.resumePlaybackAfterTrainingPause = false;
            this.trainingClock.start();
            this.startTrainingTicker();
        }

        isReaderActive() {
            return Boolean(this.document?.body?.dataset?.readerV2Active === '1' && this.reader?.openResponse);
        }

        isPlaybackSessionEngaged() {
            if (!ACTIVE_STATES.has(this.playback?.state)) return false;
            if (!this.trainingClock) return this.playback.state === 'playing';
            return this.trainingClock.state === 'running' || this.trainingClock.state === 'paused';
        }

        displayScope() {
            const value = this.element('displayMode')?.value || 'line';
            return DISPLAY_SCOPES.has(value) ? value : (value === 'page' ? 'page' : 'line');
        }

        readingMode() {
            const value = this.element('trainingMode')?.value || 'focus';
            if (READING_MODES.has(value)) return value;
            return value === 'scroll' ? 'moving' : 'focus';
        }

        adapterOptions() {
            const scope = this.displayScope();
            return {
                displayScope: scope,
                lineWidth: Number(this.element('widthInput')?.value || 35),
                maxLines: scope === 'page'
                    ? Number(this.element('maxLinesInput')?.value || 20)
                    : Number(this.element('linesInput')?.value || 3),
                speedPerMinute: Number(this.element('speedInput')?.value || 5000),
            };
        }

        ensureStylesheet() {
            if (!this.document?.head || this.element('speedReadingV2Styles')) return;
            const link = this.document.createElement('link');
            link.id = 'speedReadingV2Styles';
            link.rel = 'stylesheet';
            link.href = 'speed-reading-v2.css';
            this.document.head.appendChild(link);
        }

        configureModeControls() {
            const scope = this.element('displayMode');
            if (scope && scope.dataset.readerV2Configured !== '1') {
                const previous = scope.value;
                scope.textContent = '';
                for (const [value, label] of [['block', '段落'], ['line', '行'], ['page', '页']]) {
                    const option = this.document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    scope.appendChild(option);
                }
                scope.value = previous === 'page' ? 'page' : 'line';
                scope.dataset.readerV2Configured = '1';
                const label = scope.closest?.('.setting-grid-cell')?.querySelector?.('label');
                if (label) label.textContent = '显示范围：';
            }
            const mode = this.element('trainingMode');
            if (mode && mode.dataset.readerV2Configured !== '1') {
                const previous = mode.value;
                mode.textContent = '';
                for (const [value, label] of [['focus', '焦点式'], ['moving', '移动式']]) {
                    const option = this.document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    mode.appendChild(option);
                }
                mode.value = previous === 'scroll' ? 'moving' : 'focus';
                mode.dataset.readerV2Configured = '1';
                const label = mode.closest?.('.setting-grid-cell')?.querySelector?.('label');
                if (label) label.textContent = '阅读模式：';
            }
            this.updateSettingsVisibility();
        }

        updateSettingsVisibility() {
            const scope = this.displayScope();
            const pageSettings = this.element('pageSettings');
            const focusSettings = this.element('focusSettings');
            if (pageSettings) pageSettings.style.display = scope === 'page' ? '' : 'none';
            if (focusSettings) focusSettings.style.display = scope === 'page' ? 'none' : '';
        }

        ensureToolbar() {
            if (!this.document || this.element('speedReadingV2Toolbar')) return;
            const panel = this.document.querySelector?.('.reading-panel');
            if (!panel) return;
            const toolbar = this.document.createElement('div');
            toolbar.id = 'speedReadingV2Toolbar';
            toolbar.className = 'speed-reading-v2-toolbar';
            toolbar.setAttribute('aria-label', '速度阅读控制');
            const controls = [
                ['speedReadingPrev', '⏮', '上一帧'],
                ['speedReadingPause', '⏸', '暂停/继续'],
                ['speedReadingNext', '⏭', '下一帧'],
                ['speedReadingStop', '⏹', '停止'],
            ];
            for (const [id, text, title] of controls) {
                const button = this.document.createElement('button');
                button.id = id;
                button.type = 'button';
                button.textContent = text;
                button.title = title;
                button.disabled = true;
                toolbar.appendChild(button);
            }
            const state = this.document.createElement('span');
            state.id = 'speedReadingState';
            state.className = 'speed-reading-v2-state';
            state.setAttribute('aria-live', 'polite');
            state.textContent = '未开始';
            toolbar.appendChild(state);
            const hint = this.document.createElement('span');
            hint.className = 'speed-reading-v2-shortcuts';
            hint.textContent = 'Space 暂停/继续 · ←/→ 上一帧/下一帧 · Esc 停止';
            toolbar.appendChild(hint);
            panel.prepend(toolbar);
        }

        applyVisualSettings() {
            if (!this.document) return;
            const panel = this.document.querySelector?.('.reading-panel');
            if (!panel) return;
            const fontSize = Math.max(12, Math.min(72, Number(this.element('fontInput')?.value || 28)));
            const lineWidth = Math.max(5, Math.min(80, Number(this.element('widthInput')?.value || 35)));
            const weight = this.element('fontWeight')?.value === 'bold' ? '700' : '400';
            panel.style.setProperty('--speed-reading-font-size', `${fontSize}px`);
            panel.style.setProperty('--speed-reading-measure', `${lineWidth}ch`);
            panel.style.setProperty('--speed-reading-font-weight', weight);
            panel.dataset.speedReadingMode = this.readingMode();
            panel.dataset.speedReadingScope = this.displayScope();
        }

        playbackContext() {
            if (Number.isInteger(this.activeBatchStart)) {
                const record = this.reader?.windowRecord?.(this.activeBatchStart);
                if (record?.nodes?.length) {
                    return {
                        start: this.activeBatchStart,
                        nodes: record.nodes,
                        firstNodeId: this.playback?.currentFrame?.()?.identity?.node_id || null,
                    };
                }
            }
            return this.reader?.playbackBatchForCurrentPage?.() || null;
        }

        buildFrames(context = this.playbackContext()) {
            if (!this.reader?.openResponse || !context?.nodes?.length) {
                return { elements: [], frames: [], options: this.adapterOptions() };
            }
            return this.adapter.buildPlaybackFrames(
                this.reader.openResponse,
                context.nodes,
                this.adapterOptions(),
            );
        }

        refreshFrames(options = {}) {
            if (!this.reader?.openResponse) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateControls();
                return [];
            }
            const context = options.context || this.playbackContext();
            if (!context?.nodes?.length) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateControls();
                return [];
            }
            const built = this.buildFrames(context);
            const frames = Array.isArray(built?.frames) ? built.frames : [];
            this.playback.setFrames(frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls();
            return frames;
        }

        persistResume(snapshot = this.playback.snapshot()) {
            const frame = snapshot?.frame;
            if (!frame?.identity?.node_id || !this.reader?.openResponse) return null;
            if (!['playing', 'paused', 'manual', 'completed'].includes(snapshot.state)) return null;
            return this.reader.persistLocation?.(frame.identity, {
                frameId: frame.frame_id || null,
                frameOrdinal: Number.isInteger(frame.frame_ordinal) ? frame.frame_ordinal : null,
            }) || null;
        }

        restoreResumeFrame() {
            return false;
        }

        async ensureAllContent() {
            return this.playbackContext()?.nodes || [];
        }

        frameIndexForNode(nodeId, frames = this.playback.frames || []) {
            const matcher = PlaybackModule?.frameContainsNode;
            return frames.findIndex((frame) => {
                if (typeof matcher === 'function') return matcher(frame, nodeId);
                if (String(frame?.identity?.node_id || '') === String(nodeId || '')) return true;
                return (frame?.source_spans || []).some((identity) => String(identity?.node_id || '') === String(nodeId || ''));
            });
        }

        async start() {
            if (!this.isReaderActive()) return false;
            const context = this.reader?.playbackBatchForCurrentPage?.();
            if (!context?.nodes?.length) return false;
            this.activeBatchStart = context.start;
            const frames = this.refreshFrames({ preserveIdentity: false, context });
            const startIndex = this.frameIndexForNode(context.firstNodeId, frames);
            if (startIndex > 0 && frames.length && typeof this.playback.seek === 'function') {
                this.playback.seek(startIndex / frames.length, { activate: false });
            }
            this.applyVisualSettings();
            this.beginTrainingSession();
            const started = this.playback.play();
            if (!started) {
                this.trainingClock.stop();
                this.stopTrainingTicker();
                this.activeBatchStart = null;
            }
            this.updateControls();
            return started;
        }

        stop() {
            this.persistResume();
            this.trainingClock.stop();
            this.stopTrainingTicker();
            this.trainingPaused = false;
            this.comprehensionPaused = false;
            this.resumePlaybackAfterTrainingPause = false;
            this.activeBatchStart = null;
            this.updateTrainingTime();
            this.playback.stop();
            this.showReaderSurface();
            this.updateControls();
        }

        toggleComprehensionPause() {
            if (!this.isReaderActive() || this.trainingPaused) return false;
            if (this.playback.state === 'playing') {
                this.comprehensionPaused = true;
                return this.playback.pause();
            }
            if (this.playback.state === 'paused' && this.comprehensionPaused) {
                this.comprehensionPaused = false;
                return this.playback.resume();
            }
            return false;
        }

        toggleTrainingPause() {
            if (!this.isReaderActive() || !ACTIVE_STATES.has(this.playback.state)) return false;
            if (!this.trainingPaused) {
                this.trainingPaused = true;
                this.resumePlaybackAfterTrainingPause = this.playback.state === 'playing';
                this.trainingClock.pause();
                if (this.resumePlaybackAfterTrainingPause) this.playback.pause();
                else {
                    this.updateTrainingTime();
                    this.updateControls();
                }
                return true;
            }

            this.trainingPaused = false;
            this.trainingClock.resume();
            const shouldResumePlayback = this.resumePlaybackAfterTrainingPause;
            this.resumePlaybackAfterTrainingPause = false;
            if (shouldResumePlayback && this.playback.state === 'paused') {
                this.comprehensionPaused = false;
                return this.playback.resume();
            }
            this.updateTrainingTime();
            this.updateControls();
            return true;
        }

        pauseTrainingForFrameNavigation() {
            if (!this.isPlaybackSessionEngaged()) return false;
            if (this.trainingPaused || this.trainingClock?.state !== 'running') return false;
            this.trainingPaused = true;
            this.comprehensionPaused = false;
            this.resumePlaybackAfterTrainingPause = true;
            this.trainingClock.pause?.();
            const pausedPlayback = this.playback?.state === 'playing'
                ? Boolean(this.playback.pause?.())
                : false;
            if (!pausedPlayback) {
                this.updateTrainingTime();
                this.updateControls();
            }
            return true;
        }

        navigateFrameBy(delta) {
            if (!this.isReaderActive() || !this.isPlaybackSessionEngaged() || !this.playback?.frames?.length) return null;
            this.pauseTrainingForFrameNavigation();
            return this.playback.moveBy?.(delta) || null;
        }

        togglePause() {
            if (this.isPlaybackSessionEngaged()) return this.toggleTrainingPause();
            this.start().catch((error) => this.reader?.renderError?.(error));
            return true;
        }

        continueManual() {
            if (this.trainingPaused || this.playback.state !== 'manual') return false;
            return this.playback.continueManual();
        }

        previousFrame() {
            if (!this.isReaderActive()) return null;
            if (!this.isPlaybackSessionEngaged()) return this.reader?.previousPage?.();
            return this.navigateFrameBy(-1);
        }

        nextFrame() {
            if (!this.isReaderActive()) return null;
            if (!this.isPlaybackSessionEngaged()) return this.reader?.nextPage?.();
            return this.navigateFrameBy(1);
        }

        firstFrame() {
            if (!this.isReaderActive()) return null;
            if (!this.isPlaybackSessionEngaged()) return this.reader?.firstPage?.();
            const snapshot = this.playback.snapshot();
            return this.navigateFrameBy(-snapshot.index);
        }

        lastFrame() {
            if (!this.isReaderActive()) return null;
            if (!this.isPlaybackSessionEngaged()) return this.reader?.lastPage?.();
            const snapshot = this.playback.snapshot();
            return this.navigateFrameBy(snapshot.frame_count - 1 - snapshot.index);
        }

        showReaderSurface() {
            const reader = this.element('readerV2Display');
            const focus = this.element('focusModeDisplay');
            const page = this.element('pageModeDisplay');
            const chart = this.element('chartDisplay');
            if (focus) focus.classList.remove('active');
            if (page) page.classList.remove('active');
            if (chart) chart.classList.remove('active');
            if (reader) reader.classList.add('active');
        }

        showPlaybackSurface(frame) {
            if (!this.isPlaybackSessionEngaged()) {
                this.showReaderSurface();
                return false;
            }
            const reader = this.element('readerV2Display');
            const focus = this.element('focusModeDisplay');
            const page = this.element('pageModeDisplay');
            const chart = this.element('chartDisplay');
            const usePage = this.displayScope() === 'page';
            if (reader) reader.classList.remove('active');
            if (chart) chart.classList.remove('active');
            if (focus) focus.classList.toggle('active', !usePage);
            if (page) page.classList.toggle('active', usePage);
            this.applyVisualSettings();
            this.renderFrame(frame, usePage ? this.element('pageText') : this.element('focusText'));
            return true;
        }

        renderManualFrame(frame, target) {
            const slot = this.document.createElement('div');
            slot.className = 'reader-playback-asset-slot';
            const placeholder = this.document.createElement('div');
            placeholder.className = 'reader-v2-placeholder';
            placeholder.textContent = frame.text || this.assets.defaultLabel(frame.node_type);
            slot.appendChild(placeholder);
            target.appendChild(slot);

            this.assets.renderAssetInto({
                documentObject: this.document,
                resolver: this.reader?.assetResolver,
                documentRef: frame.identity?.document_ref,
                candidateId: frame.identity?.candidate_id,
                assetRefs: frame.asset_refs || [],
                nodeType: frame.node_type,
                fallbackText: frame.text,
                target: slot,
            }).catch((error) => {
                if (error?.code === 'reader_selection_changed' || error?.code === 'reader_identity_changed') {
                    this.reader?.renderError?.(error);
                }
            });

            const button = this.document.createElement('button');
            button.type = 'button';
            button.className = 'reader-playback-continue';
            button.textContent = '继续';
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.continueManual();
            });
            target.appendChild(button);
        }

        renderFrame(frame, target) {
            if (!target) return;
            while (target.firstChild) target.removeChild(target.firstChild);
            if (!frame) return;
            if (frame.kind === 'manual') {
                this.renderManualFrame(frame, target);
                return;
            }
            const text = this.document.createElement('div');
            text.className = 'reader-playback-frame-text';
            text.textContent = frame.text || '';
            target.appendChild(text);
        }

        stateLabel(snapshot) {
            if (!snapshot.frame_count) return '无可播放内容';
            if (this.trainingPaused) return '训练已暂停';
            if (snapshot.state === 'playing') return '播放中';
            if (snapshot.state === 'paused' && this.comprehensionPaused) return '理解中 · 计时继续';
            if (snapshot.state === 'paused') return '自动播放已暂停';
            if (snapshot.state === 'manual') return '阅读图表/公式 · 计时继续';
            if (snapshot.state === 'completed') return '已完成';
            return '未开始';
        }

        renderSnapshot(snapshot) {
            if (snapshot.state === 'completed') {
                this.trainingClock.stop();
                this.stopTrainingTicker();
                this.trainingPaused = false;
                this.comprehensionPaused = false;
                this.resumePlaybackAfterTrainingPause = false;
            }
            this.updateTrainingTime();
            const current = this.element('currentPos');
            const total = this.element('totalWords');
            const slider = this.element('progressSlider');
            if (current) current.textContent = snapshot.frame_count ? String(snapshot.index + 1) : '0';
            if (total) total.textContent = String(snapshot.frame_count || 0);
            if (slider) {
                const max = Number(slider.max || 1000);
                const denominator = Math.max(1, snapshot.frame_count - 1);
                slider.value = snapshot.frame_count <= 1 ? '0' : String(Math.round((snapshot.index / denominator) * max));
            }
            this.persistResume(snapshot);
            this.updateControls(snapshot);
            if (ACTIVE_STATES.has(snapshot.state)) this.showPlaybackSurface(snapshot.frame);
            else {
                this.showReaderSurface();
                if (snapshot.state === 'completed') this.reader?.setStatus?.('速度阅读完成。');
            }
        }

        updateControls(snapshot = this.playback.snapshot()) {
            const engaged = this.isPlaybackSessionEngaged();
            const pageState = this.reader?.pageNavigationState?.() || {};
            const canStart = Boolean(this.isReaderActive() && this.reader?.playbackBatchForCurrentPage?.()?.nodes?.length);
            const playable = engaged ? snapshot.frame_count > 0 : canStart;
            const button = this.element('readingToggleBtn');
            if (button) {
                button.disabled = !playable;
                button.textContent = engaged ? (this.trainingPaused ? '▶' : '⏸') : '▶';
                button.classList.toggle('active', engaged && !this.trainingPaused);
                button.title = engaged
                    ? (this.trainingPaused ? '继续速度阅读' : '暂停速度阅读')
                    : '开始速度阅读';
                button.setAttribute?.('aria-label', button.title);
            }
            const prev = this.element('speedReadingPrev');
            const pause = this.element('speedReadingPause');
            const next = this.element('speedReadingNext');
            const first = this.element('speedReadingFirst');
            const last = this.element('speedReadingLast');
            const stop = this.element('speedReadingStop');
            const state = this.element('speedReadingState');

            if (engaged) {
                if (first) first.disabled = !snapshot.frame_count || snapshot.index <= 0;
                if (prev) prev.disabled = !snapshot.frame_count || snapshot.index <= 0;
                if (next) next.disabled = !snapshot.frame_count || snapshot.index >= snapshot.frame_count - 1;
                if (last) last.disabled = !snapshot.frame_count || snapshot.index >= snapshot.frame_count - 1;
            } else {
                if (first) first.disabled = !pageState.readable || pageState.pending || pageState.atDocumentStart;
                if (prev) prev.disabled = !pageState.readable || pageState.pending || pageState.atDocumentStart;
                if (next) next.disabled = !pageState.readable || pageState.pending || pageState.atDocumentEnd;
                if (last) last.disabled = !pageState.readable || pageState.pending || pageState.atDocumentEnd;
            }
            if (pause) {
                pause.disabled = engaged ? false : !canStart;
                pause.textContent = engaged ? (this.trainingPaused ? '▶' : '⏸') : '▶';
                pause.title = engaged
                    ? (this.trainingPaused ? '继续训练（恢复计时）' : '暂停训练（暂停计时）')
                    : '开始速度阅读';
                pause.setAttribute?.('aria-label', pause.title);
            }
            if (stop) stop.disabled = !engaged && snapshot.state !== 'completed';
            if (state) state.textContent = engaged
                ? `${this.stateLabel(snapshot)} · ${snapshot.frame_count ? snapshot.index + 1 : 0}/${snapshot.frame_count}`
                : '普通阅读';
        }

        seekFromSlider() {
            const slider = this.element('progressSlider');
            if (!slider || !this.isReaderActive() || !this.isPlaybackSessionEngaged()) return;
            this.pauseTrainingForFrameNavigation();
            const max = Math.max(1, Number(slider.max || 1000));
            this.playback.seek(Number(slider.value || 0) / max);
        }

        onSettingChanged(options = {}) {
            if (!this.isReaderActive()) return;
            this.applyVisualSettings();
            if (options.frames !== false && this.isPlaybackSessionEngaged()) {
                this.refreshFrames({ preserveIdentity: true });
            }
        }

        onDisplayModeChanged(event) {
            if (!this.isReaderActive()) return;
            event?.stopImmediatePropagation?.();
            this.updateSettingsVisibility();
            if (!this.isPlaybackSessionEngaged()) this.reader?.reflowAndRender?.();
            this.onSettingChanged();
            if (!this.isPlaybackSessionEngaged()) this.showReaderSurface();
        }

        isEditableTarget(target) {
            const tag = String(target?.tagName || '').toLowerCase();
            return ['input', 'textarea', 'select', 'button'].includes(tag) || Boolean(target?.isContentEditable);
        }

        onKeyDown(event) {
            if (!this.isReaderActive() || this.isEditableTarget(event.target)) return;
            if (event.code === 'Space') {
                event.preventDefault();
                this.togglePause();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                Promise.resolve(this.previousFrame()).catch((error) => this.reader?.renderError?.(error));
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                Promise.resolve(this.nextFrame()).catch((error) => this.reader?.renderError?.(error));
            } else if (event.key === 'Home') {
                event.preventDefault();
                Promise.resolve(this.firstFrame()).catch((error) => this.reader?.renderError?.(error));
            } else if (event.key === 'End') {
                event.preventDefault();
                Promise.resolve(this.lastFrame()).catch((error) => this.reader?.renderError?.(error));
            } else if (event.key === 'Escape' && this.isPlaybackSessionEngaged()) {
                event.preventDefault();
                this.stop();
            }
        }

        bind() {
            if (this.bound || !this.document) return;
            this.bound = true;
            this.ensureStylesheet();
            this.configureModeControls();
            this.ensureToolbar();
            this.applyVisualSettings();

            const start = this.element('readingToggleBtn');
            start?.addEventListener('click', (event) => {
                if (!this.isReaderActive()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                this.togglePause();
            }, true);

            for (const id of ['focusModeDisplay', 'pageModeDisplay']) {
                this.element(id)?.addEventListener('click', (event) => {
                    if (!this.isReaderActive() || !['playing', 'paused'].includes(this.playback.state)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.toggleComprehensionPause();
                }, true);
            }

            this.element('speedReadingPrev')?.addEventListener('click', () => Promise.resolve(this.previousFrame()).catch((error) => this.reader?.renderError?.(error)));
            this.element('speedReadingPause')?.addEventListener('click', () => this.togglePause());
            this.element('speedReadingNext')?.addEventListener('click', () => Promise.resolve(this.nextFrame()).catch((error) => this.reader?.renderError?.(error)));
            this.element('speedReadingStop')?.addEventListener('click', () => this.stop());

            this.element('progressSlider')?.addEventListener('input', (event) => {
                if (!this.isReaderActive()) return;
                event.stopImmediatePropagation();
                this.seekFromSlider();
            }, true);

            const displayMode = this.element('displayMode');
            displayMode?.addEventListener('input', (event) => this.onDisplayModeChanged(event), true);
            displayMode?.addEventListener('change', (event) => this.onDisplayModeChanged(event), true);

            const trainingMode = this.element('trainingMode');
            trainingMode?.addEventListener('input', (event) => {
                event.stopImmediatePropagation();
                this.onSettingChanged({ frames: false });
                if (this.isPlaybackSessionEngaged()) this.showPlaybackSurface(this.playback.currentFrame());
            }, true);
            trainingMode?.addEventListener('change', (event) => {
                event.stopImmediatePropagation();
                this.onSettingChanged({ frames: false });
            }, true);

            for (const id of ['speedInput', 'speedSlider', 'widthInput', 'widthSlider', 'linesInput', 'linesSlider', 'maxLinesInput', 'maxLinesSlider']) {
                const el = this.element(id);
                el?.addEventListener('input', () => this.onSettingChanged());
                el?.addEventListener('change', () => this.onSettingChanged());
            }
            for (const id of ['fontInput', 'fontSlider', 'fontWeight']) {
                const el = this.element(id);
                el?.addEventListener('input', () => this.onSettingChanged({ frames: false }));
                el?.addEventListener('change', () => this.onSettingChanged({ frames: false }));
            }
            this.document.addEventListener('keydown', (event) => this.onKeyDown(event));
            this.document.addEventListener('reader-v2-page-change', () => this.updateControls());
            this.updateControls();
        }

        patchReaderOpenBook() {
            if (this.openBookPatched) return;
            this.openBookPatched = true;
            const original = ReaderUI.openBook;
            if (typeof original !== 'function') return;
            const self = this;
            ReaderUI.openBook = async function openBookWithPlayback(book) {
                self.persistResume();
                self.trainingClock?.stop?.();
                self.stopTrainingTicker();
                self.activeBatchStart = null;
                self.playback.stop();
                self.playback.setFrames?.([], { preserveIdentity: false });
                const result = await original(book);
                self.reader = ReaderUI.getDefaultController();
                self.showReaderSurface();
                self.updateControls();
                return result;
            };
        }
    }

    let defaultController = null;

    function getDefaultController() {
        if (!defaultController) defaultController = new ReaderSpeedPlaybackUIController();
        return defaultController;
    }

    function install() {
        const controller = getDefaultController();
        controller.patchReaderOpenBook();
        controller.bind();
        return controller;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    return { ReaderSpeedPlaybackUIController, getDefaultController, install };
});
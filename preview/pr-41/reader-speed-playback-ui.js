(function (root, factory) {
    const api = factory(
        root && root.ReaderUIV2,
        root && root.SpeedReadingAdapter,
        root && root.ReaderPlaybackController,
        root && root.ReaderAssetRendererV2,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSpeedPlaybackUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, Adapter, PlaybackModule, Assets) {
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
        }
        if (!ReaderUI || !Adapter || !PlaybackModule || !Assets) throw new Error('Reader v2 playback dependencies are required');
        return { ReaderUI, Adapter, PlaybackModule, Assets };
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
            this.bound = false;
            this.openBookPatched = false;
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        isReaderActive() {
            return Boolean(this.document?.body?.dataset?.readerV2Active === '1' && this.reader?.openResponse);
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

        refreshFrames(options = {}) {
            if (!this.reader?.openResponse) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateControls();
                return [];
            }
            const built = this.adapter.buildPlaybackFrames(
                this.reader.openResponse,
                this.reader.nodes || [],
                this.adapterOptions(),
            );
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls();
            return built.frames;
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
            const record = this.reader?.resumeRecord;
            if ((!record?.frame_id && record?.frame_ordinal == null) || !this.playback.frames.length) return false;
            let index = record.frame_id
                ? this.playback.frames.findIndex((frame) => frame.frame_id === record.frame_id)
                : -1;
            if (index < 0 && record.node_id) {
                index = this.playback.frames.findIndex((frame) => (
                    frame?.identity?.node_id === record.node_id
                    && (record.frame_ordinal == null || frame.frame_ordinal === record.frame_ordinal)
                ));
            }
            if (index < 0) return false;
            this.playback.seek(index / this.playback.frames.length);
            return true;
        }

        async ensureAllContent() {
            while (this.reader?.hasMore) await this.reader.loadMore();
            return this.reader?.nodes || [];
        }

        async start() {
            if (!this.isReaderActive()) return false;
            await this.ensureAllContent();
            this.refreshFrames();
            this.applyVisualSettings();
            return this.playback.play();
        }

        stop() {
            this.persistResume();
            this.playback.stop();
            this.showReaderSurface();
        }

        togglePause() {
            if (!this.isReaderActive()) return false;
            if (this.playback.state === 'playing') return this.playback.pause();
            if (this.playback.state === 'paused') return this.playback.resume();
            if (this.playback.state === 'manual') return this.playback.continueManual();
            return false;
        }

        previousFrame() {
            if (!this.isReaderActive() || !this.playback.frames.length) return null;
            return this.playback.previous();
        }

        nextFrame() {
            if (!this.isReaderActive() || !this.playback.frames.length) return null;
            if (this.playback.state === 'manual') {
                this.playback.continueManual();
                if (this.playback.state === 'playing') this.playback.pause();
                return this.playback.currentFrame();
            }
            return this.playback.next();
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
                this.playback.continueManual();
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
            if (snapshot.state === 'playing') return '播放中';
            if (snapshot.state === 'paused') return '已暂停';
            if (snapshot.state === 'manual') return '等待继续';
            if (snapshot.state === 'completed') return '已完成';
            return '未开始';
        }

        renderSnapshot(snapshot) {
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
            if (ACTIVE_STATES.has(snapshot.state)) {
                this.showPlaybackSurface(snapshot.frame);
            } else {
                this.showReaderSurface();
                if (snapshot.state === 'completed') this.reader?.setStatus?.('速度阅读完成。');
            }
        }

        updateControls(snapshot = this.playback.snapshot()) {
            const button = this.element('readingToggleBtn');
            const playable = this.isReaderActive() && snapshot.frame_count > 0;
            const active = ACTIVE_STATES.has(snapshot.state);
            if (button) {
                button.disabled = !playable;
                button.textContent = active ? '⏹' : '▶';
                button.classList.toggle('active', active);
                button.title = active ? '停止速度阅读' : '开始速度阅读';
            }
            const prev = this.element('speedReadingPrev');
            const pause = this.element('speedReadingPause');
            const next = this.element('speedReadingNext');
            const stop = this.element('speedReadingStop');
            const state = this.element('speedReadingState');
            if (prev) prev.disabled = !playable || snapshot.index <= 0;
            if (next) next.disabled = !playable || snapshot.index >= snapshot.frame_count - 1;
            if (pause) {
                pause.disabled = !active;
                pause.textContent = snapshot.state === 'playing' ? '⏸' : (snapshot.state === 'manual' ? '▶' : '▶');
                pause.title = snapshot.state === 'manual' ? '继续' : (snapshot.state === 'playing' ? '暂停' : '继续');
            }
            if (stop) stop.disabled = !active && snapshot.state !== 'completed';
            if (state) state.textContent = `${this.stateLabel(snapshot)} · ${snapshot.frame_count ? snapshot.index + 1 : 0}/${snapshot.frame_count}`;
        }

        seekFromSlider() {
            const slider = this.element('progressSlider');
            if (!slider || !this.isReaderActive()) return;
            const max = Math.max(1, Number(slider.max || 1000));
            this.playback.seek(Number(slider.value || 0) / max);
        }

        onSettingChanged(options = {}) {
            if (!this.isReaderActive()) return;
            this.applyVisualSettings();
            if (options.frames !== false) this.refreshFrames({ preserveIdentity: true });
        }

        onDisplayModeChanged(event) {
            if (!this.isReaderActive()) return;
            event?.stopImmediatePropagation?.();
            this.updateSettingsVisibility();
            this.reader?.reflowAndRender?.();
            this.onSettingChanged();
            if (!ACTIVE_STATES.has(this.playback.state)) this.showReaderSurface();
        }

        isEditableTarget(target) {
            const tag = String(target?.tagName || '').toLowerCase();
            return ['input', 'textarea', 'select', 'button'].includes(tag) || Boolean(target?.isContentEditable);
        }

        onKeyDown(event) {
            if (!this.isReaderActive() || this.isEditableTarget(event.target)) return;
            if (event.code === 'Space') {
                event.preventDefault();
                if (this.playback.state === 'idle' || this.playback.state === 'completed') {
                    this.start().catch((error) => this.reader?.renderError?.(error));
                } else this.togglePause();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                this.previousFrame();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                this.nextFrame();
            } else if (event.key === 'Escape' && ACTIVE_STATES.has(this.playback.state)) {
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
                if (ACTIVE_STATES.has(this.playback.state)) this.stop();
                else this.start().catch((error) => this.reader?.renderError?.(error));
            }, true);

            for (const id of ['focusModeDisplay', 'pageModeDisplay']) {
                this.element(id)?.addEventListener('click', (event) => {
                    if (!this.isReaderActive() || !['playing', 'paused'].includes(this.playback.state)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.togglePause();
                }, true);
            }

            this.element('speedReadingPrev')?.addEventListener('click', () => this.previousFrame());
            this.element('speedReadingPause')?.addEventListener('click', () => this.togglePause());
            this.element('speedReadingNext')?.addEventListener('click', () => this.nextFrame());
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
                if (ACTIVE_STATES.has(this.playback.state)) this.showPlaybackSurface(this.playback.currentFrame());
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
                self.playback.stop();
                const result = await original(book);
                self.reader = ReaderUI.getDefaultController();
                self.refreshFrames({ preserveIdentity: false });
                self.restoreResumeFrame();
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
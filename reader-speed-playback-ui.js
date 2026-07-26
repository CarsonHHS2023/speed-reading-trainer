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

        adapterOptions() {
            const displayMode = this.element('displayMode')?.value || 'focus';
            return {
                displayScope: displayMode === 'page' ? 'page' : 'line',
                lineWidth: Number(this.element('widthInput')?.value || 35),
                maxLines: displayMode === 'page'
                    ? Number(this.element('maxLinesInput')?.value || 20)
                    : Number(this.element('linesInput')?.value || 3),
                speedPerMinute: Number(this.element('speedInput')?.value || 5000),
            };
        }

        refreshFrames(options = {}) {
            if (!this.reader?.openResponse) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateStartButton();
                return [];
            }
            const built = this.adapter.buildPlaybackFrames(
                this.reader.openResponse,
                this.reader.nodes || [],
                this.adapterOptions(),
            );
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateStartButton();
            return built.frames;
        }

        async ensureAllContent() {
            while (this.reader?.hasMore) await this.reader.loadMore();
            return this.reader?.nodes || [];
        }

        async start() {
            if (!this.isReaderActive()) return false;
            await this.ensureAllContent();
            this.refreshFrames();
            return this.playback.play();
        }

        stop() {
            this.playback.stop();
            this.showReaderSurface();
        }

        togglePause() {
            if (!this.isReaderActive()) return;
            if (this.playback.state === 'playing') this.playback.pause();
            else if (this.playback.state === 'paused') this.playback.resume();
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
            const usePage = (this.element('displayMode')?.value || 'focus') === 'page';
            if (reader) reader.classList.remove('active');
            if (chart) chart.classList.remove('active');
            if (focus) focus.classList.toggle('active', !usePage);
            if (page) page.classList.toggle('active', usePage);
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
            this.updateStartButton(snapshot);
            if (snapshot.state === 'playing' || snapshot.state === 'paused' || snapshot.state === 'manual') {
                this.showPlaybackSurface(snapshot.frame);
            } else {
                this.showReaderSurface();
                if (snapshot.state === 'completed') this.reader?.setStatus?.('速度阅读完成。');
            }
        }

        updateStartButton(snapshot = this.playback.snapshot()) {
            const button = this.element('readingToggleBtn');
            if (!button) return;
            const playable = this.isReaderActive() && snapshot.frame_count > 0;
            button.disabled = !playable;
            const active = ['playing', 'paused', 'manual'].includes(snapshot.state);
            button.textContent = active ? '⏹' : '▶';
            button.classList.toggle('active', active);
            button.title = active ? '停止速度阅读' : '开始速度阅读';
        }

        seekFromSlider() {
            const slider = this.element('progressSlider');
            if (!slider || !this.isReaderActive()) return;
            const max = Math.max(1, Number(slider.max || 1000));
            this.playback.seek(Number(slider.value || 0) / max);
        }

        onSettingChanged() {
            if (!this.isReaderActive()) return;
            this.refreshFrames({ preserveIdentity: true });
        }

        onDisplayModeChanged(event) {
            if (!this.isReaderActive()) return;
            event?.stopImmediatePropagation?.();
            this.reader?.reflowAndRender?.();
            this.refreshFrames({ preserveIdentity: true });
            if (!['playing', 'paused', 'manual'].includes(this.playback.state)) this.showReaderSurface();
        }

        bind() {
            if (this.bound || !this.document) return;
            this.bound = true;
            const start = this.element('readingToggleBtn');
            start?.addEventListener('click', (event) => {
                if (!this.isReaderActive()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const active = ['playing', 'paused', 'manual'].includes(this.playback.state);
                if (active) this.stop();
                else this.start().catch((error) => this.reader?.renderError?.(error));
            }, true);

            for (const id of ['focusModeDisplay', 'pageModeDisplay']) {
                this.element(id)?.addEventListener('click', (event) => {
                    if (!this.isReaderActive()) return;
                    if (!['playing', 'paused'].includes(this.playback.state)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.togglePause();
                }, true);
            }

            this.element('progressSlider')?.addEventListener('input', (event) => {
                if (!this.isReaderActive()) return;
                event.stopImmediatePropagation();
                this.seekFromSlider();
            }, true);

            const displayMode = this.element('displayMode');
            displayMode?.addEventListener('input', (event) => this.onDisplayModeChanged(event), true);
            displayMode?.addEventListener('change', (event) => this.onDisplayModeChanged(event), true);

            for (const id of ['speedInput', 'speedSlider', 'widthInput', 'widthSlider', 'linesInput', 'linesSlider', 'maxLinesInput', 'maxLinesSlider']) {
                const el = this.element(id);
                el?.addEventListener('input', () => this.onSettingChanged());
                el?.addEventListener('change', () => this.onSettingChanged());
            }
        }

        patchReaderOpenBook() {
            if (this.openBookPatched) return;
            this.openBookPatched = true;
            const original = ReaderUI.openBook;
            if (typeof original !== 'function') return;
            const self = this;
            ReaderUI.openBook = async function openBookWithPlayback(book) {
                self.playback.stop();
                const result = await original(book);
                self.reader = ReaderUI.getDefaultController();
                self.refreshFrames({ preserveIdentity: false });
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
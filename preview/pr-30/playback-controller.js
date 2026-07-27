(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPlaybackController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STATES = Object.freeze({
        IDLE: 'idle',
        PLAYING: 'playing',
        PAUSED: 'paused',
        MANUAL: 'manual',
        COMPLETED: 'completed',
    });

    function defaultScheduler() {
        return {
            now: () => Date.now(),
            setTimeout: (callback, delay) => setTimeout(callback, delay),
            clearTimeout: (handle) => clearTimeout(handle),
        };
    }

    class PlaybackController {
        constructor(options = {}) {
            this.scheduler = options.scheduler || defaultScheduler();
            this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
            this.frames = [];
            this.index = 0;
            this.state = STATES.IDLE;
            this.timer = null;
            this.startedAt = null;
            this.remainingMs = null;
        }

        snapshot() {
            return {
                state: this.state,
                index: this.index,
                frame: this.currentFrame(),
                frame_count: this.frames.length,
                progress: this.frames.length ? this.index / this.frames.length : 0,
                remaining_ms: this.remainingMs,
            };
        }

        emit() {
            this.onChange(this.snapshot());
        }

        currentFrame() {
            return this.frames[this.index] || null;
        }

        cancelTimer() {
            if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
            this.timer = null;
            this.startedAt = null;
        }

        setFrames(frames, options = {}) {
            const previous = options.preserveIdentity === false ? null : this.currentFrame();
            const previousId = previous?.frame_id || null;
            const previousNodeId = previous?.identity?.node_id || null;
            const wasActive = [STATES.PLAYING, STATES.PAUSED, STATES.MANUAL].includes(this.state);
            const previousState = this.state;
            this.cancelTimer();
            this.frames = Array.isArray(frames) ? [...frames] : [];
            let nextIndex = 0;
            if (previousId) {
                const exact = this.frames.findIndex((frame) => frame.frame_id === previousId);
                if (exact >= 0) nextIndex = exact;
                else if (previousNodeId) {
                    const nodeMatch = this.frames.findIndex((frame) => frame?.identity?.node_id === previousNodeId);
                    if (nodeMatch >= 0) nextIndex = nodeMatch;
                }
            }
            this.index = Math.min(nextIndex, Math.max(0, this.frames.length - 1));
            this.remainingMs = null;
            if (!this.frames.length) this.state = STATES.IDLE;
            else if (wasActive) {
                const frame = this.currentFrame();
                if (frame?.kind === 'manual') this.state = STATES.MANUAL;
                else if (previousState === STATES.PLAYING) this.state = STATES.PLAYING;
                else this.state = STATES.PAUSED;
            } else if (this.state === STATES.COMPLETED) {
                this.state = STATES.IDLE;
            }
            this.emit();
            if (this.state === STATES.PLAYING) this.scheduleCurrent();
        }

        play() {
            if (!this.frames.length) return false;
            if (this.state === STATES.COMPLETED) this.index = 0;
            const frame = this.currentFrame();
            if (!frame) return false;
            if (frame.kind === 'manual') {
                this.state = STATES.MANUAL;
                this.remainingMs = null;
                this.emit();
                return true;
            }
            this.state = STATES.PLAYING;
            this.emit();
            this.scheduleCurrent();
            return true;
        }

        pause() {
            if (this.state !== STATES.PLAYING) return false;
            const frame = this.currentFrame();
            const elapsed = this.startedAt === null ? 0 : Math.max(0, this.scheduler.now() - this.startedAt);
            const base = this.remainingMs == null ? Number(frame?.duration_ms || 0) : this.remainingMs;
            this.remainingMs = Math.max(0, base - elapsed);
            this.cancelTimer();
            this.state = STATES.PAUSED;
            this.emit();
            return true;
        }

        resume() {
            if (this.state !== STATES.PAUSED) return false;
            const frame = this.currentFrame();
            if (!frame) return false;
            if (frame.kind === 'manual') {
                this.state = STATES.MANUAL;
                this.emit();
                return true;
            }
            this.state = STATES.PLAYING;
            this.emit();
            this.scheduleCurrent();
            return true;
        }

        stop() {
            this.cancelTimer();
            this.index = 0;
            this.remainingMs = null;
            this.state = STATES.IDLE;
            this.emit();
        }

        seek(progress) {
            this.cancelTimer();
            if (!this.frames.length) {
                this.index = 0;
                this.state = STATES.IDLE;
                this.emit();
                return null;
            }
            const bounded = Math.max(0, Math.min(1, Number(progress) || 0));
            this.index = Math.min(this.frames.length - 1, Math.floor(bounded * this.frames.length));
            this.remainingMs = null;
            const frame = this.currentFrame();
            if (this.state === STATES.PLAYING) {
                if (frame.kind === 'manual') this.state = STATES.MANUAL;
                this.emit();
                if (this.state === STATES.PLAYING) this.scheduleCurrent();
            } else {
                this.state = frame.kind === 'manual' && this.state === STATES.MANUAL ? STATES.MANUAL : STATES.PAUSED;
                this.emit();
            }
            return frame;
        }

        continueManual() {
            if (this.state !== STATES.MANUAL) return false;
            return this.advance();
        }

        advance() {
            this.cancelTimer();
            this.remainingMs = null;
            if (this.index + 1 >= this.frames.length) {
                this.state = STATES.COMPLETED;
                this.emit();
                return false;
            }
            this.index += 1;
            const frame = this.currentFrame();
            if (frame.kind === 'manual') {
                this.state = STATES.MANUAL;
                this.emit();
                return true;
            }
            this.state = STATES.PLAYING;
            this.emit();
            this.scheduleCurrent();
            return true;
        }

        scheduleCurrent() {
            this.cancelTimer();
            if (this.state !== STATES.PLAYING) return;
            const frame = this.currentFrame();
            if (!frame) return;
            if (frame.kind === 'manual') {
                this.state = STATES.MANUAL;
                this.remainingMs = null;
                this.emit();
                return;
            }
            const delay = Math.max(0, this.remainingMs == null ? Number(frame.duration_ms || 0) : this.remainingMs);
            this.remainingMs = delay;
            this.startedAt = this.scheduler.now();
            this.timer = this.scheduler.setTimeout(() => {
                this.timer = null;
                this.startedAt = null;
                this.remainingMs = null;
                this.advance();
            }, delay);
        }
    }

    return { PlaybackController, STATES };
});
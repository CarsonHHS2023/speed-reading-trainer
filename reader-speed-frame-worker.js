(function (worker) {
    'use strict';

    const href = String(worker.location?.href || '');
    let version = '';
    try {
        version = new URL(href).searchParams.get('v') || '';
    } catch (_error) {
        const match = href.match(/[?&]v=([^&#]+)/u);
        version = match ? decodeURIComponent(match[1]) : '';
    }
    const suffix = version ? `?v=${encodeURIComponent(version)}` : '';

    worker.importScripts(
        `reader-model.js${suffix}`,
        `speed-reading-adapter.js${suffix}`,
    );

    worker.onmessage = function buildSpeedFrames(event) {
        const payload = event?.data || {};
        const id = payload.id;
        try {
            const built = worker.SpeedReadingAdapter.buildPlaybackFrames(
                payload.documentView,
                Array.isArray(payload.nodes) ? payload.nodes : [],
                payload.options || {},
            );
            worker.postMessage({
                id,
                ok: true,
                frames: Array.isArray(built?.frames) ? built.frames : [],
            });
        } catch (error) {
            worker.postMessage({
                id,
                ok: false,
                error_name: error?.name || 'Error',
            });
        }
    };
})(typeof self !== 'undefined' ? self : globalThis);

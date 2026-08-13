(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SpeedReadingMeasurementGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_MEASURE_RESERVE_PX = 48;
    const FONT_MEASURE_RESERVE_RATIO = 1.5;
    const WRAPPABLE_STRUCTURE_TYPES = Object.freeze(['list', 'list_item']);

    function measureReservePx(options = {}) {
        const fontSizePx = Math.max(0, Number(options?.fontSizePx || options?.fontSize || 0) || 0);
        return Math.max(DEFAULT_MEASURE_RESERVE_PX, fontSizePx * FONT_MEASURE_RESERVE_RATIO);
    }

    function enableWrappedStructureRows(layout) {
        const singleRowTypes = layout?.SINGLE_ROW_TYPES;
        if (!singleRowTypes || typeof singleRowTypes.delete !== 'function') return false;
        for (const nodeType of WRAPPABLE_STRUCTURE_TYPES) singleRowTypes.delete(nodeType);
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const responsive = rootObject?.SpeedReadingResponsiveLayout;
        if (!Controller || !responsive || Controller.prototype.__measurementGuardInstalled) return false;

        enableWrappedStructureRows(responsive);
        const originalAdapterOptions = Controller.prototype.adapterOptions;
        if (typeof originalAdapterOptions !== 'function') return false;
        Controller.prototype.adapterOptions = function guardedAdapterOptions() {
            const options = originalAdapterOptions.call(this);
            const reserve = measureReservePx(options);
            return {
                ...options,
                maxWidthPx: Math.max(1, Number(options?.maxWidthPx || 1) - reserve),
                measurementReservePx: reserve,
            };
        };

        Controller.prototype.__measurementGuardInstalled = true;
        return true;
    }

    return {
        DEFAULT_MEASURE_RESERVE_PX,
        FONT_MEASURE_RESERVE_RATIO,
        WRAPPABLE_STRUCTURE_TYPES,
        enableWrappedStructureRows,
        install,
        measureReservePx,
    };
});

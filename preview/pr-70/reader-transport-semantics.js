(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderTransportSemantics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WINDOW_SIZE = 150;
    const FIRST_CONTROL_ID = 'speedReadingFirst';
    const PREV_CONTROL_ID = 'speedReadingPrev';
    const NEXT_CONTROL_ID = 'speedReadingNext';
    const LAST_CONTROL_ID = 'speedReadingLast';
    const ORDINARY_ACTIONS = Object.freeze({
        [FIRST_CONTROL_ID]: 'first',
        [PREV_CONTROL_ID]: 'previous',
        [NEXT_CONTROL_ID]: 'next',
        [LAST_CONTROL_ID]: 'last',
    });

    function isPlaybackSessionEngaged(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const shared = rootObject?.ReaderPlaybackPolish?.isPlaybackSessionEngaged;
        if (typeof shared === 'function') return Boolean(shared(controller));
        const state = controller?.playback?.state;
        if (!['playing', 'paused', 'manual'].includes(state)) return false;
        const clock = controller?.trainingClock;
        if (!clock) return state === 'playing';
        return clock.state === 'running' || clock.state === 'paused';
    }

    function windowStartForOrder(order) {
        const normalized = Math.max(0, Math.trunc(Number(order) || 0));
        return Math.floor(normalized / WINDOW_SIZE) * WINDOW_SIZE;
    }

    function ensureWindowState(reader) {
        if (!(reader?.__readerContentWindows instanceof Map)) reader.__readerContentWindows = new Map();
        if (!Array.isArray(reader?.__readerVisibleWindowStarts)) reader.__readerVisibleWindowStarts = [];
        return reader.__readerContentWindows;
    }

    function resetWindowState(reader) {
        if (!reader) return;
        reader.__readerContentWindows = new Map();
        reader.__readerVisibleWindowStarts = [];
        reader.__readerNavigationPending = false;
        reader.__readerOpening = false;
        reader.__readerAutoLoadPromise = null;
        reader.__readerAutoLoadScrollTop = null;
    }

    function orderedWindowStarts(reader) {
        return [...new Set(reader?.__readerVisibleWindowStarts || [])]
            .filter((value) => Number.isInteger(value) && value >= 0)
            .sort((a, b) => a - b);
    }

    function windowRecord(reader, start) {
        return ensureWindowState(reader).get(Number(start)) || null;
    }

    async function fetchWindow(reader, start, options = {}) {
        if (!reader?.api?.content || !reader?.documentRef || !reader?.candidateId) return null;
        const normalizedStart = windowStartForOrder(start);
        const windows = ensureWindowState(reader);
        if (options.force !== true && windows.has(normalizedStart)) return windows.get(normalizedStart);
        const chunk = await reader.api.content(reader.documentRef, {
            candidateId: reader.candidateId,
            startNodeOrder: normalizedStart,
            limit: WINDOW_SIZE,
        });
        const nodes = reader.model?.orderedNodes
            ? reader.model.orderedNodes(chunk?.nodes || [])
            : [...(chunk?.nodes || [])].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
        const record = Object.freeze({
            start: normalizedStart,
            nodes,
            hasMore: Boolean(chunk?.has_more),
            nextNodeOrder: chunk?.next_node_order == null ? null : Number(chunk.next_node_order),
        });
        windows.set(normalizedStart, record);
        return record;
    }

    function updateLoadMoreButton(reader) {
        const button = reader?.element?.('readerV2LoadMore');
        if (button) button.hidden = !reader?.hasMore;
    }

    function rebuildReaderNodes(reader, options = {}) {
        const starts = orderedWindowStarts(reader);
        const windows = ensureWindowState(reader);
        let nodes = [];
        for (const start of starts) {
            const record = windows.get(start);
            if (!record?.nodes?.length) continue;
            nodes = reader.model?.mergeNodes
                ? reader.model.mergeNodes(nodes, record.nodes)
                : nodes.concat(record.nodes);
        }
        if (reader.model?.orderedNodes) nodes = reader.model.orderedNodes(nodes);
        reader.nodes = nodes;
        const tail = starts.length ? windows.get(starts[starts.length - 1]) : null;
        reader.hasMore = Boolean(tail?.hasMore);
        reader.nextNodeOrder = tail?.nextNodeOrder == null
            ? (tail ? tail.start + tail.nodes.length : 0)
            : Number(tail.nextNodeOrder);
        updateLoadMoreButton(reader);
        if (options.render !== false) reader.reflowAndRender?.();
        return nodes;
    }

    function setVisibleWindows(reader, starts, options = {}) {
        reader.__readerVisibleWindowStarts = [...new Set((starts || []).map(windowStartForOrder))].sort((a, b) => a - b);
        return rebuildReaderNodes(reader, options);
    }

    function nodeById(reader, nodeId) {
        return reader?.model?.findNodeById?.(reader.nodes || [], nodeId)
            || (reader?.nodes || []).find((node) => String(node?.node_id || '') === String(nodeId || ''))
            || null;
    }

    function nodeOrder(reader, nodeId) {
        const node = nodeById(reader, nodeId);
        const order = Number(node?.order);
        return Number.isInteger(order) && order >= 0 ? order : null;
    }

    function locationForNode(reader, node) {
        return reader?.locationForNode?.(node?.node_id) || node?.location || { node_id: node?.node_id };
    }

    async function probeNodeOrder(reader, nodeId, options = {}) {
        const expected = String(nodeId || '').trim();
        if (!expected || !reader?.api?.content) return null;
        const cachedOrder = nodeOrder(reader, expected);
        if (cachedOrder !== null) return cachedOrder;

        let start = 0;
        let scanned = 0;
        const maxIterations = 100000;
        for (let iteration = 0; iteration < maxIterations; iteration += 1) {
            let record = windowRecord(reader, start);
            if (!record) {
                const chunk = await reader.api.content(reader.documentRef, {
                    candidateId: reader.candidateId,
                    startNodeOrder: start,
                    limit: WINDOW_SIZE,
                });
                const nodes = reader.model?.orderedNodes
                    ? reader.model.orderedNodes(chunk?.nodes || [])
                    : [...(chunk?.nodes || [])];
                const found = nodes.find((node) => String(node?.node_id || '') === expected) || null;
                scanned += nodes.length;
                options.onProgress?.(scanned);
                if (found) {
                    record = Object.freeze({
                        start: windowStartForOrder(Number(found.order)),
                        nodes,
                        hasMore: Boolean(chunk?.has_more),
                        nextNodeOrder: chunk?.next_node_order == null ? null : Number(chunk.next_node_order),
                    });
                    ensureWindowState(reader).set(record.start, record);
                    return Number(found.order);
                }
                if (!chunk?.has_more) return null;
                const next = Number(chunk?.next_node_order);
                if (!Number.isInteger(next) || next <= start) return null;
                start = next;
                continue;
            }

            const found = record.nodes.find((node) => String(node?.node_id || '') === expected) || null;
            scanned += record.nodes.length;
            options.onProgress?.(scanned);
            if (found) return Number(found.order);
            if (!record.hasMore) return null;
            const next = Number(record.nextNodeOrder);
            if (!Number.isInteger(next) || next <= start) return null;
            start = next;
        }
        return null;
    }

    async function loadWindowPair(reader, start) {
        const first = await fetchWindow(reader, start);
        const starts = [];
        if (first?.nodes?.length) starts.push(first.start);
        if (first?.hasMore) {
            const secondStart = first.start + WINDOW_SIZE;
            const second = await fetchWindow(reader, secondStart);
            if (second?.nodes?.length) starts.push(second.start);
        }
        return starts;
    }

    function navigationButtons(reader) {
        const nav = reader?.element?.('readerV2Navigation');
        return Array.from(nav?.querySelectorAll?.('.reader-v2-nav-item') || []);
    }

    function setNavigationDisabled(reader, disabled) {
        for (const button of navigationButtons(reader)) button.disabled = Boolean(disabled);
    }

    function navigationButtonFor(reader, nodeId) {
        return navigationButtons(reader).find((button) => (
            String(button?.dataset?.readerNavNodeId || '') === String(nodeId || '')
        )) || null;
    }

    function setNavigationBusy(reader, button, busy, scanned = 0) {
        if (!button) return;
        if (!button.dataset.readerNavLabel) button.dataset.readerNavLabel = String(button.textContent || '目标章节');
        const label = button.dataset.readerNavLabel;
        if (busy) {
            setNavigationDisabled(reader, true);
            button.setAttribute?.('aria-busy', 'true');
            button.textContent = scanned > 0
                ? `⏳ ${label} · 已扫描 ${scanned} 个内容块`
                : `⏳ ${label} · 正在定位…`;
        } else {
            button.removeAttribute?.('aria-busy');
            button.textContent = label;
            setNavigationDisabled(reader, Boolean(reader?.__readerOpening));
        }
    }

    function escapeNodeId(value, rootObject) {
        if (rootObject?.CSS?.escape) return rootObject.CSS.escape(String(value));
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function navigateLoadedNode(reader, nodeId, options = {}, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const node = nodeById(reader, nodeId);
        if (!node) return false;
        const selector = `[data-reader-node-id="${escapeNodeId(nodeId, rootObject)}"]`;
        const nodeEl = reader.document?.querySelector?.(selector);
        if (!nodeEl) return false;
        nodeEl.scrollIntoView?.({ block: options.block || 'center', behavior: options.behavior || 'auto' });
        nodeEl.focus?.({ preventScroll: true });
        const location = locationForNode(reader, node);
        reader.lastLocation = location;
        if (options.persist !== false) reader.persistLocation?.(location, { nodeOrder: Number(node.order) });
        return true;
    }

    async function restoreWindowedResume(reader, record, rootObject) {
        if (!record || !reader.resume?.sameCandidate?.(record, reader.openResponse)) return false;
        let order = Number.isInteger(record.node_order) && record.node_order >= 0 ? record.node_order : null;
        const legacy = order === null;
        if (legacy) {
            reader.setStatus?.('正在升级历史阅读位置…');
            order = await probeNodeOrder(reader, record.node_id, {
                onProgress(scanned) {
                    reader.setStatus?.(`正在升级历史阅读位置… 已扫描 ${scanned} 个内容块`);
                },
            });
        }
        if (order === null) return false;

        const starts = await loadWindowPair(reader, windowStartForOrder(order));
        setVisibleWindows(reader, starts);
        const node = nodeById(reader, record.node_id);
        if (!node) return false;
        const location = locationForNode(reader, node);
        reader.resumeRecord = record;
        reader.lastLocation = location;
        navigateLoadedNode(reader, node.node_id, { persist: false }, rootObject);
        if (legacy) {
            reader.persistLocation?.(location, {
                nodeOrder: Number(node.order),
                frameId: record.frame_id,
                frameOrdinal: record.frame_ordinal,
            });
        }
        reader.setStatus?.('已恢复上次阅读位置。');
        return true;
    }

    function installReaderWindowing(rootObject) {
        const Controller = rootObject?.ReaderUIV2?.ReaderV2Controller;
        const prototype = Controller?.prototype;
        if (!prototype || prototype.__readerWindowingInstalled) return false;

        const originalReset = prototype.reset;
        prototype.reset = function resetWithWindowState(...args) {
            const result = originalReset.apply(this, args);
            resetWindowState(this);
            return result;
        };

        const originalPersistLocation = prototype.persistLocation;
        prototype.persistLocation = function persistLocationWithNodeOrder(location, extra = {}) {
            const resolvedOrder = Number.isInteger(extra.nodeOrder)
                ? extra.nodeOrder
                : nodeOrder(this, location?.node_id);
            return originalPersistLocation.call(this, location, {
                ...extra,
                nodeOrder: resolvedOrder,
            });
        };

        const originalRenderNavigation = prototype.renderNavigation;
        prototype.renderNavigation = function renderNavigationWithIdentity(...args) {
            const result = originalRenderNavigation.apply(this, args);
            const buttons = navigationButtons(this);
            buttons.forEach((button, index) => {
                const entry = this.navigation?.[index];
                if (entry?.location?.node_id) button.dataset.readerNavNodeId = String(entry.location.node_id);
                button.dataset.readerNavLabel = String(entry?.label || button.textContent || '未命名标题');
            });
            setNavigationDisabled(this, Boolean(this.__readerOpening));
            return result;
        };

        prototype.loadMore = async function loadNextReaderWindow(options = {}) {
            if (!this.documentRef || !this.candidateId) return null;
            const starts = orderedWindowStarts(this);
            const tail = starts.length ? windowRecord(this, starts[starts.length - 1]) : null;
            const target = options.replace === true
                ? 0
                : (tail?.nextNodeOrder == null ? this.nextNodeOrder : tail.nextNodeOrder);
            if (!Number.isInteger(Number(target)) || Number(target) < 0) return null;
            if (!options.silent) this.setStatus?.('正在加载内容…');
            const record = await fetchWindow(this, Number(target));
            if (options.replace === true) setVisibleWindows(this, record?.nodes?.length ? [record.start] : [], { render: !options.deferRender });
            else {
                const nextStarts = record?.nodes?.length ? starts.concat(record.start) : starts;
                setVisibleWindows(this, nextStarts, { render: !options.deferRender });
            }
            if (!options.silent) this.setStatus?.('');
            return record;
        };

        prototype.navigateTo = async function navigateToWindowedNode(location, options = {}) {
            const nodeId = String(location?.node_id || '').trim();
            if (!nodeId || this.__readerNavigationPending) return false;
            if (nodeById(this, nodeId)) return navigateLoadedNode(this, nodeId, options, rootObject);

            const button = navigationButtonFor(this, nodeId);
            this.__readerNavigationPending = true;
            setNavigationBusy(this, button, true, 0);
            try {
                const order = await probeNodeOrder(this, nodeId, {
                    onProgress: (scanned) => setNavigationBusy(this, button, true, scanned),
                });
                if (order === null) {
                    this.setStatus?.('未能定位到该章节。', 'info');
                    return false;
                }
                const starts = await loadWindowPair(this, windowStartForOrder(order));
                setVisibleWindows(this, starts);
                const found = navigateLoadedNode(this, nodeId, options, rootObject);
                if (found) this.setStatus?.('');
                return found;
            } catch (error) {
                this.renderError?.(error);
                return false;
            } finally {
                this.__readerNavigationPending = false;
                setNavigationBusy(this, button, false);
            }
        };

        prototype.restoreResumeLocation = async function restoreResumeLocationWindowed() {
            if (!this.documentRef || !this.openResponse) return null;
            const record = this.resumeStore?.read?.(this.documentRef);
            if (!record) return null;
            if (!this.resume?.sameCandidate?.(record, this.openResponse)) {
                this.resumeStore?.clear?.(this.documentRef);
                return null;
            }
            const restored = await restoreWindowedResume(this, record, rootObject);
            if (!restored) {
                this.resumeStore?.clear?.(this.documentRef);
                return null;
            }
            return this.resumeRecord;
        };

        prototype.openBook = async function openBookWindowed(book) {
            this.reset();
            this.documentRef = String(book && book.id !== undefined ? book.id : book);
            this.__readerOpening = true;
            this.activateReaderSurface?.();
            this.setStatus?.('正在打开 Reader v2…');
            this.clear?.(this.element?.('readerV2Navigation'));
            this.clear?.(this.element?.('readerV2Pages'));
            try {
                const opened = await this.api.open(this.documentRef);
                this.openResponse = opened;
                this.candidateId = opened.candidate_id;
                const navigationResponse = await this.api.navigation(this.documentRef, { candidateId: this.candidateId });
                this.navigation = navigationResponse.navigation || [];
                this.renderHeader?.(book);
                this.renderNavigation?.();
                setNavigationDisabled(this, true);

                const record = this.resumeStore?.read?.(this.documentRef);
                let restored = false;
                if (record && this.resume?.sameCandidate?.(record, this.openResponse)) {
                    restored = await restoreWindowedResume(this, record, rootObject);
                } else if (record) {
                    this.resumeStore?.clear?.(this.documentRef);
                }

                if (!restored) {
                    const first = await fetchWindow(this, 0);
                    setVisibleWindows(this, first?.nodes?.length ? [0] : []);
                    this.setStatus?.('');
                }
                return opened;
            } catch (error) {
                this.renderError?.(error);
                throw error;
            } finally {
                this.__readerOpening = false;
                setNavigationDisabled(this, false);
            }
        };

        Object.defineProperty(prototype, '__readerWindowingInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function readerMain(controller) {
        return controller?.reader?.document?.querySelector?.('.reader-v2-main')
            || controller?.document?.querySelector?.('.reader-v2-main')
            || null;
    }

    function readerPageElements(controller) {
        const container = controller?.reader?.element?.('readerV2Pages');
        if (!container) return [];
        const queried = container.querySelectorAll?.('.reader-v2-page');
        return queried ? Array.from(queried) : Array.from(container.children || []);
    }

    function currentReaderPageIndex(controller) {
        const pages = readerPageElements(controller);
        if (!pages.length) return -1;
        const main = readerMain(controller);
        if (!main) return 0;
        const mainRect = main.getBoundingClientRect?.();
        if (mainRect && Number.isFinite(mainRect.top) && Number.isFinite(mainRect.bottom)) {
            const probeY = Number(mainRect.top) + Math.min(Math.max(1, Number(mainRect.height || 1)) * 0.35, 180);
            let nearest = 0;
            let distance = Number.POSITIVE_INFINITY;
            for (let index = 0; index < pages.length; index += 1) {
                const rect = pages[index]?.getBoundingClientRect?.();
                if (!rect) continue;
                if (rect.top <= probeY && rect.bottom > probeY) return index;
                const nextDistance = Math.min(Math.abs(rect.top - probeY), Math.abs(rect.bottom - probeY));
                if (nextDistance < distance) {
                    distance = nextDistance;
                    nearest = index;
                }
            }
            return nearest;
        }
        const probe = Number(main.scrollTop || 0) + Math.max(1, Number(main.clientHeight || 1)) * 0.35;
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < pages.length; index += 1) {
            const top = Number(pages[index]?.offsetTop || 0);
            const height = Math.max(1, Number(pages[index]?.offsetHeight || 1));
            if (top <= probe && top + height > probe) return index;
            const nextDistance = Math.min(Math.abs(top - probe), Math.abs(top + height - probe));
            if (nextDistance < distance) {
                distance = nextDistance;
                nearest = index;
            }
        }
        return nearest;
    }

    function currentPresentationPage(controller) {
        const index = currentReaderPageIndex(controller);
        return index >= 0 ? controller?.reader?.presentationState?.pages?.[index] || null : null;
    }

    function currentPageFirstNode(controller) {
        return currentPresentationPage(controller)?.nodes?.[0] || null;
    }

    function scrollToReaderPage(controller, index, options = {}) {
        const pages = readerPageElements(controller);
        if (!pages.length) return false;
        const bounded = Math.max(0, Math.min(pages.length - 1, Number(index) || 0));
        pages[bounded]?.scrollIntoView?.({ block: 'start', behavior: options.behavior || 'smooth' });
        const node = controller?.reader?.presentationState?.pages?.[bounded]?.nodes?.[0];
        if (node?.node_id) {
            const location = locationForNode(controller.reader, node);
            controller.reader.lastLocation = location;
            if (options.persist !== false) controller.reader.persistLocation?.(location, { nodeOrder: Number(node.order) });
        }
        return true;
    }

    async function loadPreviousReaderWindow(controller) {
        const reader = controller?.reader;
        const starts = orderedWindowStarts(reader);
        const minStart = starts[0] ?? 0;
        if (minStart <= 0) return false;
        const currentNodeId = currentPresentationPage(controller)?.nodes?.[0]?.node_id || null;
        const previousStart = Math.max(0, minStart - WINDOW_SIZE);
        const previous = await fetchWindow(reader, previousStart);
        if (!previous?.nodes?.length) return false;
        setVisibleWindows(reader, [previous.start, ...starts]);
        const currentIndex = (reader.presentationState?.pages || []).findIndex((page) => (
            (page.nodes || []).some((node) => node.node_id === currentNodeId)
        ));
        return scrollToReaderPage(controller, Math.max(0, currentIndex - 1));
    }

    async function loadNextReaderPage(controller) {
        const reader = controller?.reader;
        const beforePage = currentPresentationPage(controller);
        const beforeNodeId = beforePage?.nodes?.[0]?.node_id || null;
        const chunk = await reader.loadMore?.({ silent: true });
        if (!chunk) return false;
        const currentIndex = (reader.presentationState?.pages || []).findIndex((page) => (
            (page.nodes || []).some((node) => node.node_id === beforeNodeId)
        ));
        const target = currentIndex >= 0 ? currentIndex + 1 : currentReaderPageIndex(controller) + 1;
        return scrollToReaderPage(controller, target);
    }

    async function jumpToDocumentStart(controller) {
        const reader = controller?.reader;
        if (!windowRecord(reader, 0)) await fetchWindow(reader, 0);
        setVisibleWindows(reader, [0]);
        return scrollToReaderPage(controller, 0);
    }

    async function jumpToDocumentEnd(controller) {
        const reader = controller?.reader;
        let starts = orderedWindowStarts(reader);
        let tail = starts.length ? windowRecord(reader, starts[starts.length - 1]) : null;
        if (!tail) tail = await fetchWindow(reader, 0);
        let previous = null;
        while (tail?.hasMore) {
            const nextStart = Number(tail.nextNodeOrder);
            if (!Number.isInteger(nextStart) || nextStart <= tail.start) break;
            previous = tail;
            tail = await fetchWindow(reader, nextStart, { force: false });
            reader.setStatus?.(`正在定位尾页… 已到第 ${tail.start + tail.nodes.length} 个内容块`);
        }
        const visible = [];
        if (previous?.nodes?.length) visible.push(previous.start);
        if (tail?.nodes?.length) visible.push(tail.start);
        setVisibleWindows(reader, visible);
        reader.setStatus?.('');
        const pages = readerPageElements(controller);
        return pages.length ? scrollToReaderPage(controller, pages.length - 1) : false;
    }

    async function navigateReaderPage(controller, action, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        if (!controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return false;
        if (controller.__readerPageNavigationPending) return false;
        const reader = controller.reader;
        let pages = readerPageElements(controller);
        if (!reader?.openResponse || !pages.length) return false;
        controller.__readerPageNavigationPending = true;
        applyReaderPageControlState(controller, rootObject);
        try {
            let current = currentReaderPageIndex(controller);
            if (current < 0) current = 0;
            if (action === 'first') return jumpToDocumentStart(controller);
            if (action === 'last') return jumpToDocumentEnd(controller);
            if (action === 'previous') {
                if (current > 0) return scrollToReaderPage(controller, current - 1);
                return loadPreviousReaderWindow(controller);
            }
            if (action === 'next') {
                if (current < pages.length - 1) return scrollToReaderPage(controller, current + 1);
                if (reader.hasMore) return loadNextReaderPage(controller);
                return false;
            }
            return false;
        } catch (error) {
            reader?.renderError?.(error);
            return false;
        } finally {
            controller.__readerPageNavigationPending = false;
            applyReaderPageControlState(controller, rootObject);
        }
    }

    function setTransportLabels(controller, ordinary) {
        const labels = ordinary
            ? [
                [FIRST_CONTROL_ID, '首页'],
                [PREV_CONTROL_ID, '上一页'],
                [NEXT_CONTROL_ID, '下一页'],
                [LAST_CONTROL_ID, '尾页'],
            ]
            : [
                [FIRST_CONTROL_ID, '到头（第一帧）'],
                [PREV_CONTROL_ID, '上一帧'],
                [NEXT_CONTROL_ID, '下一帧'],
                [LAST_CONTROL_ID, '到尾（最后一帧）'],
            ];
        for (const [id, title] of labels) {
            const button = controller?.element?.(id);
            if (!button) continue;
            button.title = title;
            button.setAttribute?.('aria-label', title);
        }
    }

    function applyReaderPageControlState(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        if (!controller) return false;
        const ordinary = !isPlaybackSessionEngaged(controller, rootObject);
        setTransportLabels(controller, ordinary);
        if (!ordinary) return false;
        const reader = controller.reader;
        const pages = readerPageElements(controller);
        const readable = Boolean(controller.isReaderActive?.() && reader?.openResponse && pages.length);
        const index = readable ? currentReaderPageIndex(controller) : -1;
        const starts = orderedWindowStarts(reader);
        const firstWindowStart = starts[0] ?? 0;
        const tail = starts.length ? windowRecord(reader, starts[starts.length - 1]) : null;
        const atDocumentStart = index <= 0 && firstWindowStart === 0;
        const atDocumentEnd = index >= pages.length - 1 && tail && !tail.hasMore;
        const pending = Boolean(controller.__readerPageNavigationPending || reader?.__readerNavigationPending || reader?.__readerOpening);

        const first = controller.element?.(FIRST_CONTROL_ID);
        const prev = controller.element?.(PREV_CONTROL_ID);
        const next = controller.element?.(NEXT_CONTROL_ID);
        const last = controller.element?.(LAST_CONTROL_ID);
        if (first) first.disabled = !readable || pending || atDocumentStart;
        if (prev) prev.disabled = !readable || pending || atDocumentStart;
        if (next) next.disabled = !readable || pending || Boolean(atDocumentEnd);
        if (last) last.disabled = !readable || pending || Boolean(atDocumentEnd);
        return true;
    }

    function frameContainsNode(frame, nodeId, rootObject) {
        const shared = rootObject?.ReaderPlaybackController?.frameContainsNode;
        if (typeof shared === 'function') return Boolean(shared(frame, nodeId));
        if (String(frame?.identity?.node_id || '') === String(nodeId || '')) return true;
        return (frame?.source_spans || []).some((identity) => String(identity?.node_id || '') === String(nodeId || ''));
    }

    function playbackBatchContext(controller) {
        const reader = controller?.reader;
        const firstNode = currentPageFirstNode(controller);
        const order = Number(firstNode?.order);
        if (!firstNode || !Number.isInteger(order) || order < 0) return null;
        const start = windowStartForOrder(order);
        const record = windowRecord(reader, start);
        const nodes = record?.nodes?.length
            ? record.nodes
            : (reader?.nodes || []).filter((node) => Number(node?.order) >= start && Number(node?.order) < start + WINDOW_SIZE);
        return nodes.length ? { start, nodes, firstNodeId: firstNode.node_id } : null;
    }

    function buildPlaybackBatchFrames(controller, context, options = {}) {
        if (!context?.nodes?.length || !controller?.reader?.openResponse) return [];
        const built = controller.adapter.buildPlaybackFrames(
            controller.reader.openResponse,
            context.nodes,
            controller.adapterOptions(),
        );
        controller.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity === true });
        controller.updateControls?.();
        return built.frames;
    }

    function installPlaybackBatchStart(rootObject) {
        const Controller = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        const prototype = Controller?.prototype;
        if (!prototype || prototype.__readerBatchPlaybackInstalled) return false;

        const originalRefreshFrames = prototype.refreshFrames;
        prototype.refreshFrames = function refreshFramesForCurrentReaderBatch(options = {}) {
            let context = null;
            if (Number.isInteger(this.__readerSpeedBatchStart)) {
                const record = windowRecord(this.reader, this.__readerSpeedBatchStart);
                if (record?.nodes?.length) {
                    context = {
                        start: this.__readerSpeedBatchStart,
                        nodes: record.nodes,
                        firstNodeId: this.playback?.currentFrame?.()?.identity?.node_id || null,
                    };
                }
            }
            if (!context) context = playbackBatchContext(this);
            if (!context) return originalRefreshFrames.call(this, options);
            return buildPlaybackBatchFrames(this, context, {
                preserveIdentity: options.preserveIdentity !== false,
            });
        };

        prototype.start = async function startCurrentReaderBatch() {
            if (!this.isReaderActive?.()) return false;
            const context = playbackBatchContext(this);
            if (!context) return false;
            this.__readerSpeedBatchStart = context.start;
            this.pendingResumeFrameIndex = null;
            const frames = buildPlaybackBatchFrames(this, context, { preserveIdentity: false });
            if (!frames.length) return false;
            const startIndex = Math.max(0, frames.findIndex((frame) => frameContainsNode(frame, context.firstNodeId, rootObject)));
            if (startIndex > 0 && typeof this.playback.seek === 'function') {
                this.playback.seek(startIndex / frames.length, { activate: false });
            }
            this.applyVisualSettings?.();
            this.beginTrainingSession?.();
            const started = this.playback.play?.();
            if (!started) {
                this.trainingClock?.stop?.();
                this.stopTrainingTicker?.();
            }
            if (started) this.reader?.setStatus?.('');
            this.updateControls?.();
            return Boolean(started);
        };

        const originalStop = prototype.stop;
        if (typeof originalStop === 'function') {
            prototype.stop = function stopBatchPlayback(...args) {
                const result = originalStop.apply(this, args);
                this.__readerSpeedBatchStart = null;
                this.updateControls?.();
                return result;
            };
        }

        Object.defineProperty(prototype, '__readerBatchPlaybackInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapUpdateControls(target, rootObject) {
        if (!target || typeof target.updateControls !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerTransportSemanticsWrapped')) return false;
        const original = target.updateControls;
        target.updateControls = function updateControlsWithReaderPageSemantics(...args) {
            const result = original.apply(this, args);
            applyReaderPageControlState(this, rootObject);
            return result;
        };
        Object.defineProperty(target, '__readerTransportSemanticsWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapReaderSurfaceActivation(rootObject) {
        const prototype = rootObject?.ReaderUIV2?.ReaderV2Controller?.prototype;
        if (!prototype || typeof prototype.activateReaderSurface !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(prototype, '__readerSurfaceControlSyncWrapped')) return false;
        const original = prototype.activateReaderSurface;
        prototype.activateReaderSurface = function activateReaderSurfaceAndSyncControls(...args) {
            const result = original.apply(this, args);
            const playback = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
            if (playback?.reader === this) playback.updateControls?.();
            return result;
        };
        Object.defineProperty(prototype, '__readerSurfaceControlSyncWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function controlFromEvent(event) {
        const target = event?.target;
        if (target?.id && ORDINARY_ACTIONS[target.id]) return target;
        return target?.closest?.('#speedReadingFirst, #speedReadingPrev, #speedReadingNext, #speedReadingLast') || null;
    }

    function bindOrdinaryTransport(controller, rootObject) {
        if (!rootObject?.addEventListener || rootObject.__readerOrdinaryTransportBound) return false;
        rootObject.__readerOrdinaryTransportBound = true;
        rootObject.addEventListener('click', (event) => {
            const button = controlFromEvent(event);
            const action = button?.id ? ORDINARY_ACTIONS[button.id] : null;
            if (!action || !controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            Promise.resolve(navigateReaderPage(controller, action, rootObject)).catch((error) => controller.reader?.renderError?.(error));
        }, true);
        rootObject.addEventListener('keydown', (event) => {
            if (!controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return;
            if (controller.isEditableTarget?.(event?.target)) return;
            const action = event?.key === 'Home'
                ? 'first'
                : event?.key === 'End'
                    ? 'last'
                    : event?.key === 'ArrowLeft'
                        ? 'previous'
                        : event?.key === 'ArrowRight'
                            ? 'next'
                            : null;
            if (!action) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            Promise.resolve(navigateReaderPage(controller, action, rootObject)).catch((error) => controller.reader?.renderError?.(error));
        }, true);
        return true;
    }

    function bindReaderScroll(controller, rootObject) {
        const main = readerMain(controller);
        if (!main?.addEventListener || main.dataset?.readerWindowScrollBound === '1') return false;
        if (main.dataset) main.dataset.readerWindowScrollBound = '1';
        let scheduled = false;
        main.addEventListener('scroll', () => {
            if (!scheduled) {
                scheduled = true;
                const refresh = () => {
                    scheduled = false;
                    applyReaderPageControlState(controller, rootObject);
                };
                if (typeof rootObject?.requestAnimationFrame === 'function') rootObject.requestAnimationFrame(refresh);
                else refresh();
            }
            const reader = controller.reader;
            if (!reader?.hasMore || reader.__readerNavigationPending || reader.__readerOpening || reader.__readerAutoLoadPromise) return;
            const remaining = Number(main.scrollHeight || 0) - Number(main.scrollTop || 0) - Number(main.clientHeight || 0);
            const threshold = Math.max(600, Number(main.clientHeight || 0) * 0.75);
            if (remaining > threshold) return;
            const scrollTop = Number(main.scrollTop || 0);
            if (reader.__readerAutoLoadScrollTop !== null && scrollTop < reader.__readerAutoLoadScrollTop + 120) return;
            reader.__readerAutoLoadScrollTop = scrollTop;
            reader.__readerAutoLoadPromise = Promise.resolve(reader.loadMore?.({ silent: true }))
                .catch((error) => reader.renderError?.(error))
                .finally(() => {
                    reader.__readerAutoLoadPromise = null;
                });
        }, { passive: true });
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller) return false;
        installReaderWindowing(rootObject);
        installPlaybackBatchStart(rootObject);
        wrapReaderSurfaceActivation(rootObject);
        wrapUpdateControls(Controller.prototype, rootObject);
        const controller = PlaybackUI.getDefaultController?.();
        if (!controller) return false;
        bindOrdinaryTransport(controller, rootObject);
        bindReaderScroll(controller, rootObject);
        controller.updateControls?.();
        applyReaderPageControlState(controller, rootObject);
        return true;
    }

    return {
        FIRST_CONTROL_ID,
        LAST_CONTROL_ID,
        NEXT_CONTROL_ID,
        ORDINARY_ACTIONS,
        PREV_CONTROL_ID,
        WINDOW_SIZE,
        applyReaderPageControlState,
        buildPlaybackBatchFrames,
        currentPageFirstNode,
        currentPresentationPage,
        currentReaderPageIndex,
        ensureWindowState,
        fetchWindow,
        install,
        installPlaybackBatchStart,
        installReaderWindowing,
        isPlaybackSessionEngaged,
        loadWindowPair,
        navigateReaderPage,
        nodeOrder,
        orderedWindowStarts,
        playbackBatchContext,
        probeNodeOrder,
        rebuildReaderNodes,
        resetWindowState,
        restoreWindowedResume,
        setVisibleWindows,
        windowStartForOrder,
    };
});
(function (root, factory) {
    const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AppAccessModule = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const SESSION_TOKEN_KEY = 'smart-reading-access-token';
    const LOGIN_PATH = '/api/access/login';

    function normalizeBaseUrl(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function resolveApiBaseUrl(rootObject = root) {
        const configured = rootObject && (
            rootObject.READER_API_BASE_URL ||
            rootObject.API_BASE_URL_OVERRIDE ||
            rootObject.API_BASE_URL ||
            rootObject.SPEED_READING_CONFIG?.apiBaseUrl
        );
        return normalizeBaseUrl(configured || PRODUCTION_API_BASE_URL);
    }

    function resolveAuthBaseUrl(rootObject = root) {
        return normalizeBaseUrl(
            rootObject?.APP_ACCESS_AUTH_BASE_URL || PRODUCTION_API_BASE_URL,
        );
    }

    function resolveUrl(value, rootObject = root) {
        const raw = typeof value === 'string' || value instanceof URL
            ? String(value)
            : String(value?.url || '');
        if (!raw) return null;
        try {
            return new URL(raw, rootObject?.location?.href || PRODUCTION_API_BASE_URL);
        } catch (error) {
            return null;
        }
    }

    function backendOrigins(rootObject = root) {
        const origins = new Set();
        [PRODUCTION_API_BASE_URL, resolveApiBaseUrl(rootObject), resolveAuthBaseUrl(rootObject)]
            .forEach((value) => {
                try {
                    origins.add(new URL(value).origin);
                } catch (error) {
                    // Ignore invalid optional overrides and let request handling fail normally.
                }
            });
        return origins;
    }

    function isBackendRequest(input, rootObject = root) {
        const url = resolveUrl(input, rootObject);
        return Boolean(url && backendOrigins(rootObject).has(url.origin));
    }

    function storageFor(rootObject = root) {
        try {
            return rootObject?.sessionStorage || null;
        } catch (error) {
            return null;
        }
    }

    function createController(rootObject = root, options = {}) {
        if (!rootObject) throw new Error('App access requires a global object');
        const nativeFetch = options.fetchImpl || rootObject.fetch?.bind(rootObject);
        if (!nativeFetch) throw new Error('App access requires fetch');

        const HeadersCtor = rootObject.Headers || (typeof Headers !== 'undefined' ? Headers : null);
        if (!HeadersCtor) throw new Error('App access requires Headers');

        let overlay = null;
        let errorElement = null;
        let logoutButton = null;
        let initialized = false;
        let authExpiredNotified = false;

        function getToken() {
            try {
                return storageFor(rootObject)?.getItem(SESSION_TOKEN_KEY) || '';
            } catch (error) {
                return '';
            }
        }

        function setToken(token) {
            const value = String(token || '').trim();
            if (!value) throw new Error('Access token is missing');
            const storage = storageFor(rootObject);
            if (!storage) throw new Error('Session storage is unavailable');
            storage.setItem(SESSION_TOKEN_KEY, value);
            authExpiredNotified = false;
        }

        function clearToken() {
            try {
                storageFor(rootObject)?.removeItem(SESSION_TOKEN_KEY);
            } catch (error) {
                // Storage cleanup is best effort; the UI still returns to the login gate.
            }
        }

        function requestInitWithToken(input, init, token) {
            const headers = new HeadersCtor(
                input && typeof input === 'object' && input.headers ? input.headers : undefined,
            );
            if (init?.headers) {
                new HeadersCtor(init.headers).forEach((value, key) => headers.set(key, value));
            }
            headers.set('Authorization', `Bearer ${token}`);
            return { ...(init || {}), headers };
        }

        function showLogin(message = '') {
            clearToken();
            if (errorElement) errorElement.textContent = message;
            if (overlay) {
                overlay.hidden = false;
                const input = overlay.querySelector('input[type="password"]');
                if (input && typeof input.focus === 'function') input.focus();
            }
            if (logoutButton) logoutButton.hidden = true;
        }

        function handleUnauthorized() {
            if (authExpiredNotified) return;
            authExpiredNotified = true;
            showLogin('登录已失效，请重新输入开发访问密码。');
        }

        async function authenticatedFetch(input, init) {
            const token = getToken();
            const shouldAuthorize = token && isBackendRequest(input, rootObject);
            const response = await nativeFetch(
                input,
                shouldAuthorize ? requestInitWithToken(input, init, token) : init,
            );
            if (response?.status === 401 && isBackendRequest(input, rootObject)) {
                const url = resolveUrl(input, rootObject);
                if (!url || url.pathname !== LOGIN_PATH) handleUnauthorized();
            }
            return response;
        }

        async function login(password) {
            const response = await nativeFetch(`${resolveAuthBaseUrl(rootObject)}${LOGIN_PATH}`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password: String(password || '') }),
            });

            let body = null;
            try {
                body = await response.json();
            } catch (error) {
                body = null;
            }

            if (!response.ok) {
                if (response.status === 401 || response.status === 422) {
                    throw new Error('密码不正确。');
                }
                if (response.status === 503) {
                    throw new Error('登录服务尚未配置，请先完成 Backend Secret 设置。');
                }
                throw new Error(body?.detail || `登录失败 (${response.status})。`);
            }

            if (!body?.access_token) throw new Error('登录服务没有返回访问令牌。');
            setToken(body.access_token);
            return body;
        }

        async function fetchBlobUrl(url) {
            const response = await authenticatedFetch(url, {
                headers: { Accept: 'image/*,*/*;q=0.8' },
            });
            if (!response.ok) throw new Error(`Asset request failed (${response.status})`);
            const blob = await response.blob();
            const URLCtor = rootObject.URL || (typeof URL !== 'undefined' ? URL : null);
            if (!URLCtor?.createObjectURL) throw new Error('Blob URLs are unavailable');
            return URLCtor.createObjectURL(blob);
        }

        function buildLoginUi() {
            const documentObject = rootObject.document;
            if (!documentObject?.body || overlay) return;

            overlay = documentObject.createElement('div');
            overlay.id = 'appAccessOverlay';
            overlay.className = 'app-access-overlay';
            overlay.hidden = Boolean(getToken());

            const card = documentObject.createElement('section');
            card.className = 'app-access-card';
            card.setAttribute('aria-labelledby', 'appAccessTitle');

            const brand = documentObject.createElement('div');
            brand.className = 'app-access-brand';
            brand.textContent = 'Smart Reading OS';

            const title = documentObject.createElement('h1');
            title.id = 'appAccessTitle';
            title.textContent = '开发访问';

            const description = documentObject.createElement('p');
            description.textContent = '请输入开发访问密码后继续。';

            const form = documentObject.createElement('form');
            form.className = 'app-access-form';

            const label = documentObject.createElement('label');
            label.setAttribute('for', 'appAccessPassword');
            label.textContent = '访问密码';

            const passwordInput = documentObject.createElement('input');
            passwordInput.id = 'appAccessPassword';
            passwordInput.type = 'password';
            passwordInput.autocomplete = 'current-password';
            passwordInput.minLength = 12;
            passwordInput.required = true;

            const button = documentObject.createElement('button');
            button.type = 'submit';
            button.textContent = '登录';

            errorElement = documentObject.createElement('div');
            errorElement.className = 'app-access-error';
            errorElement.setAttribute('role', 'alert');
            errorElement.setAttribute('aria-live', 'polite');

            form.append(label, passwordInput, button, errorElement);
            card.append(brand, title, description, form);
            overlay.appendChild(card);
            documentObject.body.appendChild(overlay);

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                errorElement.textContent = '';
                button.disabled = true;
                button.textContent = '登录中…';
                try {
                    await login(passwordInput.value);
                    passwordInput.value = '';
                    if (rootObject.location?.reload) rootObject.location.reload();
                } catch (error) {
                    errorElement.textContent = error?.message || '登录失败。';
                    passwordInput.select?.();
                    passwordInput.focus?.();
                } finally {
                    button.disabled = false;
                    button.textContent = '登录';
                }
            });
        }

        function buildLogoutUi() {
            const documentObject = rootObject.document;
            if (!documentObject || logoutButton) return;
            const host = documentObject.querySelector('.app-title');
            if (!host) return;

            logoutButton = documentObject.createElement('button');
            logoutButton.id = 'appAccessLogoutBtn';
            logoutButton.className = 'app-access-logout-btn';
            logoutButton.type = 'button';
            logoutButton.textContent = '退出';
            logoutButton.title = '退出开发访问';
            logoutButton.hidden = !getToken();
            logoutButton.addEventListener('click', () => {
                clearToken();
                if (rootObject.location?.reload) rootObject.location.reload();
                else showLogin();
            });
            host.appendChild(logoutButton);
        }

        function install() {
            if (initialized) return controller;
            initialized = true;
            rootObject.fetch = authenticatedFetch;

            const mount = () => {
                buildLoginUi();
                buildLogoutUi();
                if (!getToken()) showLogin();
            };
            if (rootObject.document?.body) mount();
            else rootObject.document?.addEventListener?.('DOMContentLoaded', mount, { once: true });
            return controller;
        }

        const controller = {
            getToken,
            setToken,
            clearToken,
            login,
            authenticatedFetch,
            fetchBlobUrl,
            showLogin,
            install,
            isBackendRequest: (input) => isBackendRequest(input, rootObject),
            resolveApiBaseUrl: () => resolveApiBaseUrl(rootObject),
            resolveAuthBaseUrl: () => resolveAuthBaseUrl(rootObject),
        };
        return controller;
    }

    const api = {
        PRODUCTION_API_BASE_URL,
        SESSION_TOKEN_KEY,
        LOGIN_PATH,
        normalizeBaseUrl,
        resolveApiBaseUrl,
        resolveAuthBaseUrl,
        isBackendRequest,
        createController,
    };

    if (root?.document && root?.fetch) {
        const controller = createController(root);
        root.AppAccess = controller;
        controller.install();
    }

    return api;
});

'use strict';

// --- CONFIGURATION ---
const CONFIG = {
    TWITCH_AUTH_URL: 'https://id.twitch.tv/oauth2/authorize',
    STORAGE_TOKEN_KEY: 'twitch_token', // TODO: Le token doit être chiffré pour plus de sécurité.
    API_BASE_URL: 'https://api.twitch.tv/helix/streams',
    manifest: chrome.runtime.getManifest(),
};

// --- PROMISIFICATION DES APIS CHROME ---
const storage = {
    get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
    set: (items) => new Promise(resolve => chrome.storage.local.set(items, resolve)),
    remove: (keys) => new Promise(resolve => chrome.storage.local.remove(keys, resolve)),
};
const identity = {
    launchWebAuthFlow: (details) => new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(details, (redirectUrl) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!redirectUrl) return reject(new Error("Authentication flow was cancelled by the user."));
            resolve(redirectUrl);
        });
    }),
};

// --- FONCTIONS DE NOTIFICATION ---
function showTokenExpiredNotification() {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#D93025' });
    chrome.action.setTitle({ title: chrome.i18n.getMessage('notificationTokenExpired') });
}

function showApiUnavailableNotification() {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#F9AB00' });
    chrome.action.setTitle({ title: chrome.i18n.getMessage('notificationApiUnavailable') });
}

function clearNotification() {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: '' });
}

// --- LOGIQUE API ---
async function getStreamsUptimeBatch(channelLogins) {
    const { token, clientId } = await getApiCredentials();
    if (!token || !clientId) {
        return { success: false, error: 'NO_TOKEN' };
    }
    if (channelLogins.length === 0) {
        return { success: true, data: [] };
    }

    const queryParams = channelLogins.map(login => `user_login=${encodeURIComponent(login)}`).join('&');
    const url = `${CONFIG.API_BASE_URL}?${queryParams}`;

    try {
        const response = await fetch(url, { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } });

        if (response.status === 401) {
            await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
            showTokenExpiredNotification();
            return { success: false, error: 'TOKEN_EXPIRED' };
        }
        if (response.status === 429) {
            showApiUnavailableNotification();
            return { success: false, error: 'RATE_LIMITED' };
        }
        if (!response.ok) throw new Error(`API fetch failed: ${response.status}`);

        clearNotification();
        const data = await response.json();
        
        // AMÉLIORATION SÉCURITÉ : Valider la structure de la réponse de l'API
        if (!data || !Array.isArray(data.data)) {
            throw new Error("Invalid API response structure.");
        }

        const validStreams = data.data.filter(stream => 
            typeof stream.user_login === 'string' && typeof stream.started_at === 'string'
        );

        const results = new Map(validStreams.map(stream => [stream.user_login.toLowerCase(), stream.started_at]));
        return { success: true, data: Array.from(results.entries()) };

    } catch (error) {
        console.error("[Background API Error]", error.message);
        showApiUnavailableNotification();
        return { success: false, error: 'API_UNAVAILABLE' };
    }
}

// --- FONCTIONS MÉTIER ---
async function login() {
    try {
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl = new URL(CONFIG.TWITCH_AUTH_URL);
        authUrl.search = new URLSearchParams({
            client_id: CONFIG.manifest.oauth2.client_id,
            redirect_uri: redirectUri,
            response_type: 'token',
            scope: CONFIG.manifest.oauth2.scopes.join(' '),
            force_verify: 'true',
        }).toString();
        
        const resultUrl = await identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });
        const accessToken = new URL(resultUrl).hash.match(/access_token=([^&]*)/)[1];

        if (!accessToken) throw new Error("Access token not found.");
        
        await storage.set({ [CONFIG.STORAGE_TOKEN_KEY]: accessToken });
        console.log('Twitch token stored successfully.');
        return true;
    } catch (error) {
        console.error("Login process failed:", error.message);
        await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
        return false;
    }
}

async function logout() {
    await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
    console.log('Token removed. User logged out.');
}

async function getApiCredentials() {
    const result = await storage.get(CONFIG.STORAGE_TOKEN_KEY);
    return {
        token: result[CONFIG.STORAGE_TOKEN_KEY] || null,
        clientId: CONFIG.manifest.oauth2.client_id,
    };
}

async function getAuthStatus() {
    const { token } = await getApiCredentials();
    return !!token;
}

// --- GESTIONNAIRE DE MESSAGES ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            let result;
            switch (request.type) {
                case 'GET_UPTIMES_FOR_CHANNELS':
                    result = await getStreamsUptimeBatch(request.logins);
                    break;
                case 'LOGIN':
                    const isLoggedIn = await login();
                    if (isLoggedIn) clearNotification();
                    result = { isLoggedIn };
                    break;
                case 'LOGOUT':
                    await logout();
                    clearNotification();
                    result = { isLoggedIn: false };
                    break;
                case 'GET_AUTH_STATUS':
                    result = { isLoggedIn: await getAuthStatus() };
                    break;
                default:
                    // Ne rien faire si le type est inconnu
                    return; 
            }
            sendResponse(result);
        } catch (error) {
            console.error(`Error handling message type ${request.type}:`, error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // Réponse asynchrone
});

// --- CYCLE DE VIE DE L'EXTENSION ---
chrome.runtime.onStartup.addListener(clearNotification);
chrome.runtime.onInstalled.addListener(clearNotification);
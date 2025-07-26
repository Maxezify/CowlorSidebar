// background.js - Version optimisée qui préserve les fonctionnalités
'use strict';

// --- UTILITIES (Promisification & Storage) ---

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

// --- SECURITÉ (Web Crypto API) ---

// Cache pour la clé de chiffrement
let encryptionKeyCache = null;

/**
 * Récupère ou génère une clé de chiffrement et la stocke.
 * @returns {Promise<CryptoKey>} La clé de chiffrement.
 */
async function getEncryptionKey() {
    // Utilise le cache si disponible
    if (encryptionKeyCache) {
        return encryptionKeyCache;
    }
    
    let keyData = await storage.get('encryption_key');
    if (keyData.encryption_key) {
        encryptionKeyCache = await crypto.subtle.importKey(
            'jwk',
            keyData.encryption_key,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
        );
        return encryptionKeyCache;
    } else {
        const newKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        const exportedKey = await crypto.subtle.exportKey('jwk', newKey);
        await storage.set({ 'encryption_key': exportedKey });
        encryptionKeyCache = newKey;
        return newKey;
    }
}

/**
 * Chiffre une chaîne de caractères (le token).
 * @param {string} token Le token en clair.
 * @returns {Promise<string>} Le token chiffré et encodé en base64.
 */
async function encryptToken(token) {
    const key = await getEncryptionKey();
    const encodedToken = new TextEncoder().encode(token);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // Vecteur d'initialisation (nonce)
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encodedToken
    );
    // On combine le vecteur et les données chiffrées pour le stockage
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);
    // On retourne le tout en base64 pour un stockage sûr
    return btoa(String.fromCharCode.apply(null, combined));
}

/**
 * Déchiffre une chaîne de caractères (le token).
 * @param {string | null} encryptedString Le token chiffré en base64.
 * @returns {Promise<string | null>} Le token en clair ou null en cas d'erreur.
 */
async function decryptToken(encryptedString) {
    if (!encryptedString) return null;
    try {
        const key = await getEncryptionKey();
        const combined = new Uint8Array(atob(encryptedString).split('').map(c => c.charCodeAt(0)));
        const iv = combined.slice(0, 12);
        const encryptedData = combined.slice(12);
        
        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encryptedData
        );
        return new TextDecoder().decode(decryptedData);
    } catch (e) {
        console.error("Erreur de déchiffrement, le token est peut-être corrompu ou la clé a changé.", e);
        // En cas d'erreur, on supprime l'ancien token pour forcer une reconnexion
        await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
        encryptionKeyCache = null; // Invalide le cache
        return null;
    }
}

// --- CONFIGURATION ---
const CONFIG = {
    TWITCH_AUTH_URL: 'https://id.twitch.tv/oauth2/authorize',
    STORAGE_TOKEN_KEY: 'twitch_token_encrypted', // Clé de stockage mise à jour
    API_BASE_URL: 'https://api.twitch.tv/helix/streams',
    manifest: chrome.runtime.getManifest(),
    API_RETRY_ATTEMPTS: 3,
    API_INITIAL_BACKOFF_MS: 1000,
    CACHE_DURATION_MS: 60000, // 1 minute
    CACHE_CLEANUP_INTERVAL_MS: 300000, // 5 minutes
    MAX_CACHE_SIZE: 200
};

// --- CACHE DES RÉPONSES API ---
const apiCache = {
    data: new Map(),
    cleanupInterval: null,
    
    init() {
        // Programme le nettoyage périodique
        this.cleanupInterval = setInterval(() => this.cleanup(), CONFIG.CACHE_CLEANUP_INTERVAL_MS);
    },
    
    get(key) {
        const cached = this.data.get(key);
        if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION_MS) {
            return cached.value;
        }
        this.data.delete(key);
        return null;
    },
    
    set(key, value) {
        this.data.set(key, {
            value: value,
            timestamp: Date.now()
        });
        
        // Limite la taille du cache
        if (this.data.size > CONFIG.MAX_CACHE_SIZE) {
            const firstKey = this.data.keys().next().value;
            this.data.delete(firstKey);
        }
    },
    
    cleanup() {
        const now = Date.now();
        for (const [key, cached] of this.data) {
            if (now - cached.timestamp > CONFIG.CACHE_DURATION_MS) {
                this.data.delete(key);
            }
        }
    },
    
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.data.clear();
    }
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

// --- LOGIQUE API TWITCH ---

/**
 * Fonction fetch avec gestion des erreurs et des nouvelles tentatives (exponential backoff).
 */
async function fetchWithRetry(url, options, attempt = 1) {
    try {
        const response = await fetch(url, options);

        if (response.status === 429 && attempt <= CONFIG.API_RETRY_ATTEMPTS) {
            const delay = CONFIG.API_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            console.warn(`Rate limited. Retrying in ${delay}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, attempt + 1);
        }
        
        return response;
    } catch (error) {
        // Gérer les erreurs réseau
        if (attempt <= CONFIG.API_RETRY_ATTEMPTS) {
            const delay = CONFIG.API_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            console.warn(`Network error. Retrying in ${delay}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, attempt + 1);
        }
        throw error; // Lancer l'erreur après la dernière tentative
    }
}


async function getStreamsUptimeBatch(channelLogins) {
    if (channelLogins.length === 0) {
        return { success: true, data: [] };
    }
    
    // Vérifie le cache pour chaque login
    const cacheKey = channelLogins.sort().join(',');
    const cachedResult = apiCache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }
    
    const { token, clientId } = await getApiCredentials();
    if (!token || !clientId) {
        return { success: false, error: 'NO_TOKEN' };
    }

    const queryParams = channelLogins.map(login => `user_login=${encodeURIComponent(login)}`).join('&');
    const url = `${CONFIG.API_BASE_URL}?${queryParams}`;
    const options = { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } };

    try {
        const response = await fetchWithRetry(url, options);

        if (response.status === 401) {
            await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
            encryptionKeyCache = null; // Invalide le cache de la clé
            showTokenExpiredNotification();
            return { success: false, error: 'TOKEN_EXPIRED' };
        }
        if (!response.ok) {
            throw new Error(`API fetch failed with status: ${response.status}`);
        }

        clearNotification();
        const data = await response.json();
        
        // Validation robuste de la réponse de l'API
        if (!data || !Array.isArray(data.data)) {
            console.error("Invalid API response structure: 'data' array not found.", data);
            throw new Error("Invalid API response structure.");
        }

        const validStreams = data.data.filter(stream => 
            stream && typeof stream.user_login === 'string' && typeof stream.started_at === 'string'
        );

        const results = new Map(validStreams.map(stream => [stream.user_login.toLowerCase(), stream.started_at]));
        const result = { success: true, data: Array.from(results.entries()) };
        
        // Met en cache le résultat
        apiCache.set(cacheKey, result);
        
        return result;

    } catch (error) {
        console.error("[Background API Error]", error.message);
        showApiUnavailableNotification();
        return { success: false, error: 'API_UNAVAILABLE' };
    }
}

// --- FONCTIONS MÉTIER (Authentification, etc.) ---

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

        if (!accessToken) throw new Error("Access token not found in redirect URL.");
        
        const encryptedToken = await encryptToken(accessToken);
        await storage.set({ [CONFIG.STORAGE_TOKEN_KEY]: encryptedToken });
        
        console.log('Twitch token stored successfully (encrypted).');
        return true;
    } catch (error) {
        console.error("Login process failed:", error.message);
        await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
        encryptionKeyCache = null; // Invalide le cache
        return false;
    }
}

async function logout() {
    await storage.remove(CONFIG.STORAGE_TOKEN_KEY);
    encryptionKeyCache = null; // Invalide le cache
    apiCache.data.clear(); // Vide le cache API
    console.log('Encrypted token removed. User logged out.');
}

async function getApiCredentials() {
    const result = await storage.get(CONFIG.STORAGE_TOKEN_KEY);
    const encryptedToken = result[CONFIG.STORAGE_TOKEN_KEY] || null;
    const decryptedToken = await decryptToken(encryptedToken);

    return {
        token: decryptedToken,
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
                    console.warn(`Unknown message type received: ${request.type}`);
                    return; 
            }
            sendResponse(result);
        } catch (error) {
            console.error(`Error handling message type ${request.type}:`, error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // Indique une réponse asynchrone
});

// --- CYCLE DE VIE DE L'EXTENSION ---
chrome.runtime.onStartup.addListener(() => {
    clearNotification();
    apiCache.init();
});

chrome.runtime.onInstalled.addListener(() => {
    clearNotification();
    apiCache.init();
});

// Nettoie lors de la suspension (pour Manifest V3)
if (typeof self !== 'undefined' && self.addEventListener) {
    self.addEventListener('deactivate', () => {
        apiCache.destroy();
        encryptionKeyCache = null;
    });
}
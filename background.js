'use strict';

// --- CONFIGURATION ---
const CONFIG = {
    TWITCH_AUTH_URL: 'https://id.twitch.tv/oauth2/authorize',
    STORAGE_TOKEN_KEY: 'twitch_token',
    API_BASE_URL: 'https://api.twitch.tv/helix/streams',
    API_MAX_CHANNELS_PER_REQUEST: 100,
    manifest: chrome.runtime.getManifest(),
};

// --- CLASSES DE SÉCURITÉ ET UTILITAIRES ---

/**
 * Limiteur de taux pour contrôler la fréquence des requêtes API.
 * @class
 */
class RateLimiter {
    constructor(maxRequests = 30, windowMs = 60000) { // Limite à 30 requêtes/minute
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }

    /**
     * Vérifie si une requête peut être effectuée.
     * @returns {boolean} - True si la requête est autorisée.
     */
    canMakeRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        if (this.requests.length >= this.maxRequests) {
            console.warn(`[RateLimiter] Limite de taux atteinte : ${this.requests.length} requêtes dans les ${this.windowMs / 1000} dernières secondes.`);
            return false;
        }
        this.requests.push(now);
        return true;
    }
}

const apiRateLimiter = new RateLimiter();

/**
 * Classe d'erreur personnalisée pour une gestion sécurisée des erreurs.
 * @class
 */
class SecureError extends Error {
    constructor(message, code, details = null) {
        super(message);
        this.code = code;
        this.details = details;
        this.timestamp = Date.now();
    }

    /**
     * Retourne une version publique et sécurisée de l'erreur.
     * @returns {{success: boolean, error: string, message: string}}
     */
    toPublic() {
        return {
            success: false,
            error: this.code,
            message: this.message,
        };
    }
}

// --- PROMISIFICATION DES APIS CHROME ---
const storage = {
    get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
    set: (items) => new Promise(resolve => chrome.storage.local.set(items, resolve)),
    remove: (keys) => new Promise(resolve => chrome.storage.local.remove(keys, resolve)),
};

const identity = {
    launchWebAuthFlow: (details) => new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(details, (redirectUrl) => {
            if (chrome.runtime.lastError) return reject(new SecureError(chrome.runtime.lastError.message, 'AUTH_FLOW_ERROR'));
            if (!redirectUrl) return reject(new SecureError("Le processus d'authentification a été annulé par l'utilisateur.", 'AUTH_CANCELLED'));
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

// --- VALIDATION ET SANITISATION ---

/**
 * Valide un login de chaîne Twitch pour plus de sécurité.
 * @param {string} login - Le login à valider.
 * @returns {boolean} - True si le login est valide.
 */
function validateChannelLogin(login) {
    if (typeof login !== 'string' || login.length < 3 || login.length > 25) return false;
    if (!/^[a-zA-Z0-9_]+$/.test(login) || login.startsWith('_')) return false;
    const blockedWords = ['admin', 'api', 'www', 'help', 'support', 'twitch', 'mod', 'staff'];
    if (blockedWords.includes(login.toLowerCase())) return false;
    return true;
}

/**
 * Valide un token d'authentification OAuth.
 * @param {string} token - Le token à valider.
 * @returns {boolean} - True si le token a un format valide.
 */
function validateToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
    // Les tokens Twitch sont généralement alphanumériques
    if (!/^[a-z0-9]+$/.test(token)) return false;
    return true;
}

// --- LOGIQUE API ---
async function getStreamsUptimeBatch(channelLogins) {
    if (!apiRateLimiter.canMakeRequest()) {
        return new SecureError('Rate limit exceeded from client.', 'RATE_LIMIT_EXCEEDED').toPublic();
    }

    if (!Array.isArray(channelLogins)) {
        return new SecureError('L\'entrée pour les logins de chaînes est invalide.', 'INVALID_INPUT_TYPE').toPublic();
    }

    const validLogins = channelLogins
        .filter(validateChannelLogin)
        .slice(0, CONFIG.API_MAX_CHANNELS_PER_REQUEST);

    if (validLogins.length === 0) {
        return { success: true, data: [] };
    }

    const { token, clientId } = await getApiCredentials();
    if (!token) {
        return new SecureError('Le token d\'authentification est manquant.', 'NO_TOKEN').toPublic();
    }

    const queryParams = validLogins.map(login => `user_login=${encodeURIComponent(login)}`).join('&');
    const url = `${CONFIG.API_BASE_URL}?${queryParams}`;

    try {
        const response = await fetch(url, { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } });

        if (response.status === 401) {
            await logout(); // Le token est invalide, on déconnecte l'utilisateur
            showTokenExpiredNotification();
            throw new SecureError('Le token Twitch a expiré.', 'TOKEN_EXPIRED');
        }
        if (response.status === 429) {
            showApiUnavailableNotification();
            throw new SecureError('Limite de taux de l\'API Twitch atteinte.', 'RATE_LIMITED_API');
        }
        if (!response.ok) {
             throw new SecureError(`L'appel API a échoué avec le statut : ${response.status}`, 'API_FETCH_FAILED');
        }

        clearNotification();
        const data = await response.json();
        const results = new Map(data.data?.map(stream => [stream.user_login.toLowerCase(), stream.started_at]));
        return { success: true, data: Array.from(results.entries()) };

    } catch (error) {
        console.error("[Background API Error]", error.message);
        if (!(error instanceof SecureError && error.code === 'TOKEN_EXPIRED')) {
            showApiUnavailableNotification();
        }
        return error instanceof SecureError ? error.toPublic() : new SecureError('Une erreur API inattendue est survenue.', 'GENERIC_API_ERROR').toPublic();
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

        if (!validateToken(accessToken)) {
            throw new SecureError("Token invalide reçu de Twitch.", 'INVALID_TOKEN_FORMAT');
        }
        
        await storage.set({ [CONFIG.STORAGE_TOKEN_KEY]: accessToken, tokenTimestamp: Date.now() });
        console.log('Token Twitch stocké avec succès.');
        clearNotification();
        return { isLoggedIn: true, success: true };
    } catch (error) {
        console.error("Le processus de connexion a échoué :", error.message);
        await logout(); // Assurer un état propre
        return { isLoggedIn: false, success: false, error: error.code || 'LOGIN_FAILED' };
    }
}

async function logout() {
    await storage.remove([CONFIG.STORAGE_TOKEN_KEY, 'tokenTimestamp']);
    clearNotification();
    console.log('Token supprimé. Utilisateur déconnecté.');
}

async function getApiCredentials() {
    const result = await storage.get([CONFIG.STORAGE_TOKEN_KEY]);
    const token = result[CONFIG.STORAGE_TOKEN_KEY] || null;
    return {
        token: token,
        clientId: CONFIG.manifest.oauth2.client_id,
    };
}

async function getAuthStatus() {
    const { token } = await getApiCredentials();
    const isValid = token ? validateToken(token) : false;
    if (!isValid && token) {
        // Le token stocké est invalide, le supprimer
        await logout();
    }
    return { isLoggedIn: isValid, success: true };
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
                    result = await login();
                    break;
                case 'LOGOUT':
                    await logout();
                    result = { isLoggedIn: false, success: true };
                    break;
                case 'GET_AUTH_STATUS':
                    result = await getAuthStatus();
                    break;
                default:
                    // Ignorer les types de messages inconnus pour éviter les erreurs
                    return; 
            }
            sendResponse(result);
        } catch (error) {
            console.error(`Erreur lors du traitement du message de type ${request.type}:`, error);
            sendResponse(new SecureError('Une erreur interne est survenue.', 'GENERIC_ERROR').toPublic());
        }
    })();
    return true; // Indique une réponse asynchrone
});

// --- CYCLE DE VIE DE L'EXTENSION ---
chrome.runtime.onStartup.addListener(clearNotification);
chrome.runtime.onInstalled.addListener(clearNotification);
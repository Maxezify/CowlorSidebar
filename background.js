'use strict';

// --- CONFIGURATION ---
const CONFIG = {
    TWITCH_AUTH_URL: 'https://id.twitch.tv/oauth2/authorize',
    STORAGE_TOKEN_KEY: 'twitch_token',
    API_BASE_URL: 'https://api.twitch.tv/helix/streams',
    API_MAX_CHANNELS_PER_REQUEST: 100,
    manifest: chrome.runtime.getManifest(),
};

// --- CONSTANTES DE SÉCURITÉ ---
const SECURITY_CONFIG = {
    TOKEN_MIN_LENGTH: 20,
    TOKEN_MAX_LENGTH: 100,
    TOKEN_PATTERN: /^[a-z0-9]+$/,
    TOKEN_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000, // 30 jours
    MAX_LOGIN_ATTEMPTS: 5,
    LOGIN_ATTEMPT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    CHANNEL_LOGIN_PATTERN: /^[a-zA-Z0-9_]{3,25}$/,
    BLOCKED_CHANNEL_WORDS: ['admin', 'api', 'www', 'help', 'support', 'twitch', 'mod', 'staff', 'root', 'system'],
    ALLOWED_REDIRECT_ORIGINS: ['chromiumapp.org'],
    API_TIMEOUT_MS: 10000, // 10 secondes
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

    /**
     * Réinitialise le compteur de requêtes
     */
    reset() {
        this.requests = [];
    }
}

/**
 * Tracking des tentatives de login pour prévenir le brute force
 * @class
 */
class LoginAttemptTracker {
    constructor() {
        this.attempts = [];
    }
    
    add() {
        const now = Date.now();
        this.attempts = this.attempts.filter(time => now - time < SECURITY_CONFIG.LOGIN_ATTEMPT_WINDOW_MS);
        this.attempts.push(now);
    }
    
    canAttempt() {
        const now = Date.now();
        this.attempts = this.attempts.filter(time => now - time < SECURITY_CONFIG.LOGIN_ATTEMPT_WINDOW_MS);
        return this.attempts.length < SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS;
    }
    
    reset() {
        this.attempts = [];
    }
}

const apiRateLimiter = new RateLimiter();
const loginAttempts = new LoginAttemptTracker();

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

// --- MÉTRIQUES ET MONITORING ---
const metrics = {
    apiRequests: 0,
    apiErrors: 0,
    tokenRefreshes: 0,
    lastError: null,
    
    log() {
        console.log(`[Metrics] API requests: ${this.apiRequests}, Errors: ${this.apiErrors}, Token refreshes: ${this.tokenRefreshes}`);
        if (this.lastError) {
            console.log(`[Metrics] Last error: ${this.lastError}`);
        }
    }
};

// Log des métriques toutes les heures
chrome.alarms.create('metricsLog', { periodInMinutes: 60 });

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

// --- VALIDATION ET SANITISATION AMÉLIORÉES ---

/**
 * Valide un login de chaîne Twitch avec sécurité renforcée.
 * @param {string} login - Le login à valider.
 * @returns {boolean} - True si le login est valide.
 */
function validateChannelLogin(login) {
    if (typeof login !== 'string' || !SECURITY_CONFIG.CHANNEL_LOGIN_PATTERN.test(login)) {
        return false;
    }
    
    const lowerLogin = login.toLowerCase();
    
    // Vérifier contre la liste noire
    if (SECURITY_CONFIG.BLOCKED_CHANNEL_WORDS.includes(lowerLogin)) {
        return false;
    }
    
    // Vérifier les patterns suspects
    if (lowerLogin.includes('__') || // Double underscore
        lowerLogin.match(/(.)\1{3,}/) || // Plus de 3 caractères identiques consécutifs
        lowerLogin.match(/^[0-9_]+$/)) { // Que des chiffres et underscores
        return false;
    }
    
    return true;
}

/**
 * Valide un token d'authentification OAuth avec vérification d'âge.
 * @param {string} token - Le token à valider.
 * @returns {Promise<boolean>} - True si le token a un format valide.
 */
async function validateToken(token) {
    if (typeof token !== 'string' || 
        token.length < SECURITY_CONFIG.TOKEN_MIN_LENGTH || 
        token.length > SECURITY_CONFIG.TOKEN_MAX_LENGTH) {
        return false;
    }
    
    if (!SECURITY_CONFIG.TOKEN_PATTERN.test(token)) {
        return false;
    }
    
    // Vérifier l'âge du token
    const { tokenTimestamp } = await storage.get(['tokenTimestamp']);
    if (tokenTimestamp) {
        const age = Date.now() - tokenTimestamp;
        if (age > SECURITY_CONFIG.TOKEN_MAX_AGE_MS) {
            console.warn('[Security] Token trop ancien, invalidation requise');
            return false;
        }
    }
    
    return true;
}

/**
 * Génère un state cryptographiquement sûr pour CSRF protection
 * @returns {string} - State aléatoire
 */
function generateSecureState() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// --- LOGIQUE API AMÉLIORÉE ---
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

    // Utiliser AbortController pour timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SECURITY_CONFIG.API_TIMEOUT_MS);

    try {
        metrics.apiRequests++;
        
        const response = await fetch(url, { 
            headers: { 
                'Client-ID': clientId, 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            await logout(); // Le token est invalide, on déconnecte l'utilisateur
            showTokenExpiredNotification();
            throw new SecureError('Le token Twitch a expiré.', 'TOKEN_EXPIRED');
        }
        if (response.status === 429) {
            showApiUnavailableNotification();
            const retryAfter = response.headers.get('Retry-After');
            throw new SecureError(`Limite de taux de l'API Twitch atteinte. Réessayer après ${retryAfter}s.`, 'RATE_LIMITED_API');
        }
        if (!response.ok) {
            metrics.apiErrors++;
            throw new SecureError(`L'appel API a échoué avec le statut : ${response.status}`, 'API_FETCH_FAILED');
        }

        clearNotification();
        const data = await response.json();
        
        // Validation des données reçues
        if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
            throw new SecureError('Format de réponse API invalide', 'INVALID_API_RESPONSE');
        }
        
        const results = new Map(data.data?.map(stream => {
            // Validation supplémentaire des données de stream
            if (stream && stream.user_login && stream.started_at) {
                return [stream.user_login.toLowerCase(), stream.started_at];
            }
            return null;
        }).filter(Boolean));
        
        return { success: true, data: Array.from(results.entries()) };

    } catch (error) {
        console.error("[Background API Error]", error.message);
        metrics.apiErrors++;
        metrics.lastError = error.message;
        
        if (error.name === 'AbortError') {
            showApiUnavailableNotification();
            return new SecureError('Timeout de la requête API', 'API_TIMEOUT').toPublic();
        }
        
        if (!(error instanceof SecureError && error.code === 'TOKEN_EXPIRED')) {
            showApiUnavailableNotification();
        }
        
        return error instanceof SecureError ? error.toPublic() : new SecureError('Une erreur API inattendue est survenue.', 'GENERIC_API_ERROR').toPublic();
    }
}

// --- FONCTIONS MÉTIER SÉCURISÉES ---
async function login() {
    // Vérifier le rate limiting
    if (!loginAttempts.canAttempt()) {
        console.error('[Security] Trop de tentatives de connexion');
        return { 
            isLoggedIn: false, 
            success: false, 
            error: 'TOO_MANY_ATTEMPTS' 
        };
    }
    
    loginAttempts.add();
    
    try {
        const redirectUri = chrome.identity.getRedirectURL();
        
        // Validation de l'URL de redirection
        if (!redirectUri.startsWith('https://')) {
            throw new SecureError('URL de redirection non sécurisée', 'INSECURE_REDIRECT');
        }
        
        const state = generateSecureState();
        await storage.set({ authState: state });
        
        const authUrl = new URL(CONFIG.TWITCH_AUTH_URL);
        authUrl.search = new URLSearchParams({
            client_id: CONFIG.manifest.oauth2.client_id,
            redirect_uri: redirectUri,
            response_type: 'token',
            scope: CONFIG.manifest.oauth2.scopes.join(' '),
            force_verify: 'true',
            state: state // CSRF protection
        }).toString();
        
        const resultUrl = await identity.launchWebAuthFlow({ 
            url: authUrl.href, 
            interactive: true 
        });
        
        // Validation stricte de l'URL de retour
        const resultUrlObj = new URL(resultUrl);
        const isValidOrigin = SECURITY_CONFIG.ALLOWED_REDIRECT_ORIGINS.some(origin => 
            resultUrlObj.origin.includes(origin)
        );
        
        if (!isValidOrigin) {
            throw new SecureError('URL de retour invalide', 'INVALID_RETURN_URL');
        }
        
        // Vérifier le state pour CSRF
        const returnedState = resultUrlObj.hash.match(/state=([^&]*)/)?.[1];
        const { authState } = await storage.get(['authState']);
        
        if (!returnedState || returnedState !== authState) {
            throw new SecureError('State invalide - possible attaque CSRF', 'INVALID_STATE');
        }
        
        const accessToken = resultUrlObj.hash.match(/access_token=([^&]*)/)?.[1];
        
        if (!accessToken || !await validateToken(accessToken)) {
            throw new SecureError("Token invalide reçu de Twitch", 'INVALID_TOKEN_FORMAT');
        }
        
        await storage.set({ 
            [CONFIG.STORAGE_TOKEN_KEY]: accessToken, 
            tokenTimestamp: Date.now() 
        });
        
        await storage.remove(['authState']); // Nettoyer le state
        
        metrics.tokenRefreshes++;
        console.log('Token Twitch stocké avec succès');
        clearNotification();
        loginAttempts.reset(); // Réinitialiser les tentatives après succès
        
        return { isLoggedIn: true, success: true };
        
    } catch (error) {
        console.error("Processus de connexion échoué:", error.message);
        await logout();
        return { 
            isLoggedIn: false, 
            success: false, 
            error: error.code || 'LOGIN_FAILED' 
        };
    }
}

async function logout() {
    await storage.remove([CONFIG.STORAGE_TOKEN_KEY, 'tokenTimestamp', 'authState']);
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
    const isValid = token ? await validateToken(token) : false;
    
    if (!isValid && token) {
        // Le token stocké est invalide, le supprimer
        await logout();
        showTokenExpiredNotification();
    }
    
    return { isLoggedIn: isValid, success: true };
}

// --- NETTOYAGE PÉRIODIQUE ---
async function cleanupExpiredTokens() {
    const { tokenTimestamp } = await storage.get(['tokenTimestamp']);
    
    if (tokenTimestamp) {
        const age = Date.now() - tokenTimestamp;
        if (age > SECURITY_CONFIG.TOKEN_MAX_AGE_MS) {
            console.log('[Security] Token expiré détecté, nettoyage...');
            await logout();
            showTokenExpiredNotification();
        }
    }
}

// --- GESTIONNAIRE DE MESSAGES SÉCURISÉ ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Vérifier que le message vient d'une source légitime
    if (!sender.id || sender.id !== chrome.runtime.id) {
        console.warn('[Security] Message reçu d\'une source non autorisée');
        return;
    }
    
    (async () => {
        try {
            let result;
            
            // Validation du type de message
            const allowedTypes = ['GET_UPTIMES_FOR_CHANNELS', 'LOGIN', 'LOGOUT', 'GET_AUTH_STATUS'];
            if (!allowedTypes.includes(request.type)) {
                console.warn(`[Security] Type de message non autorisé: ${request.type}`);
                return;
            }
            
            switch (request.type) {
                case 'GET_UPTIMES_FOR_CHANNELS':
                    // Validation supplémentaire des données
                    if (!request.logins || !Array.isArray(request.logins)) {
                        result = new SecureError('Format de requête invalide', 'INVALID_REQUEST').toPublic();
                    } else {
                        result = await getStreamsUptimeBatch(request.logins);
                    }
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
            }
            
            sendResponse(result);
        } catch (error) {
            console.error(`Erreur lors du traitement du message de type ${request.type}:`, error);
            sendResponse(new SecureError('Une erreur interne est survenue.', 'GENERIC_ERROR').toPublic());
        }
    })();
    
    return true; // Indique une réponse asynchrone
});

// --- GESTION DES ALARMES ---
chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
        case 'tokenCleanup':
            cleanupExpiredTokens();
            break;
        case 'metricsLog':
            metrics.log();
            break;
        case 'rateLimiterReset':
            apiRateLimiter.reset();
            console.log('[RateLimiter] Compteur réinitialisé');
            break;
    }
});

// --- CYCLE DE VIE DE L'EXTENSION ---
chrome.runtime.onStartup.addListener(() => {
    clearNotification();
    cleanupExpiredTokens();
});

chrome.runtime.onInstalled.addListener(() => {
    clearNotification();
    
    // Configurer les alarmes périodiques
    chrome.alarms.create('tokenCleanup', { periodInMinutes: 60 }); // Toutes les heures
    chrome.alarms.create('rateLimiterReset', { periodInMinutes: 1 }); // Toutes les minutes
    
    console.log('[Background] Extension installée/mise à jour - v2.0 sécurisée');
});

// Nettoyer à la désinstallation
chrome.runtime.setUninstallURL('https://twitch.tv', () => {
    storage.remove([CONFIG.STORAGE_TOKEN_KEY, 'tokenTimestamp', 'authState']);
});

console.log('[Background] Service worker initialisé - v2.0 avec sécurité renforcée');
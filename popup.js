'use strict';

// --- OPTIMISATION: Cache pour les messages i18n ---
const i18nCache = new Map();
const getI18nMessage = (key) => {
    if (!i18nCache.has(key)) {
        i18nCache.set(key, chrome.i18n.getMessage(key));
    }
    return i18nCache.get(key);
};

// --- Gestion de l'Authentification ---
function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

async function initializeAuth() {
    const authButton = document.getElementById('auth-button');
    const statusMessage = document.getElementById('status-message');
    const reloadMessage = document.getElementById('reload-message');
    let currentUserIsLoggedIn = false;

    // OPTIMISATION: Pré-cache des messages utilisés
    const messages = {
        logout: getI18nMessage('popupLogout'),
        login: getI18nMessage('popupLogin'),
        connected: getI18nMessage('popupStatusConnected'),
        disconnected: getI18nMessage('popupStatusDisconnected'),
        reload: getI18nMessage('popupReloadMessage'),
        loading: getI18nMessage('popupLoading'),
        errorComm: getI18nMessage('popupErrorCommunicating'),
        actionFailed: getI18nMessage('popupActionFailed'),
        inProgress: getI18nMessage('buttonInProgress')
    };

    function updateUi(isLoggedIn) {
        currentUserIsLoggedIn = isLoggedIn;
        authButton.textContent = isLoggedIn ? messages.logout : messages.login;
        statusMessage.textContent = isLoggedIn ? messages.connected : messages.disconnected;
        statusMessage.classList.toggle('status-connected', isLoggedIn);
        reloadMessage.style.display = isLoggedIn ? 'block' : 'none';
        if (isLoggedIn) reloadMessage.textContent = messages.reload;
    }

    authButton.textContent = messages.loading;
    try {
        const response = await sendMessage({ type: 'GET_AUTH_STATUS' });
        updateUi(response.isLoggedIn);
    } catch (error) {
        statusMessage.textContent = messages.errorComm;
        console.error(error.message);
    }

    authButton.addEventListener('click', async () => {
        const actionType = currentUserIsLoggedIn ? 'LOGOUT' : 'LOGIN';
        authButton.textContent = messages.inProgress;
        authButton.disabled = true;
        try {
            const responseAfterAction = await sendMessage({ type: actionType });
            updateUi(responseAfterAction.isLoggedIn);
        } catch (error) {
            statusMessage.textContent = messages.actionFailed;
            console.error(error.message);
        } finally {
            authButton.disabled = false;
        }
    });
}

// --- Logique d'interactivité de la démo ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialise l'authentification
    initializeAuth();

    // OPTIMISATION: Traduction en batch
    function localizeStaticElements() {
        // Cache tous les messages nécessaires
        const translations = {
            extensionName: getI18nMessage('extensionName'),
            liveExample: getI18nMessage('popupLiveExampleTitle'),
            controls: getI18nMessage('popupControlsTitle'),
            classicHype: getI18nMessage('popupToggleClassicHypeTrain'),
            treasure: getI18nMessage('popupToggleTreasureTrain'),
            giftSub: getI18nMessage('popupToggleGiftSub'),
            kappa: getI18nMessage('popupToggleKappaTrain'),
            newStream: getI18nMessage('popupToggleNewStream')
        };

        // Applique les traductions
        document.title = translations.extensionName;
        document.querySelector('h3').textContent = translations.extensionName;
        document.querySelector('.live-example-showcase h5').textContent = translations.liveExample;
        document.querySelector('.controls-section h5').textContent = translations.controls;

        // OPTIMISATION: Map direct des IDs aux traductions
        const labelTranslations = {
            'toggle-hype-train': translations.classicHype,
            'toggle-treasure-train': translations.treasure,
            'toggle-gift-sub': translations.giftSub,
            'toggle-kappa-train': translations.kappa,
            'toggle-new-stream': translations.newStream
        };

        // Applique les traductions aux labels
        Object.entries(labelTranslations).forEach(([id, text]) => {
            const input = document.getElementById(id);
            if (input?.parentElement?.tagName === 'LABEL') {
                input.parentElement.childNodes[1].nodeValue = ' ' + text;
            }
        });
    }

    // Appelle la fonction de traduction
    localizeStaticElements();

    // Références aux éléments
    const exampleAvatar = document.getElementById('example-avatar');
    const exampleCard = document.getElementById('example-card');
    const levelText = document.getElementById('hype-train-level');

    const toggles = {
        hypeTrain: document.getElementById('toggle-hype-train'),
        treasureTrain: document.getElementById('toggle-treasure-train'),
        giftSub: document.getElementById('toggle-gift-sub'),
        kappaTrain: document.getElementById('toggle-kappa-train'),
        newStream: document.getElementById('toggle-new-stream')
    };

    const exclusiveToggles = [toggles.hypeTrain, toggles.treasureTrain, toggles.giftSub, toggles.kappaTrain];
    let hypeTrainInterval = null;
    let currentLevel = 1;
    
    // OPTIMISATION: Classes en constantes
    const HYPE_TRAIN_CLASSES = ['ht-blue', 'ht-green', 'ht-yellow', 'ht-orange', 'ht-red'];
    const CLASS_NAMES = {
        TREASURE: 'ht-treasure-effect',
        GIFT_SUB: 'ht-gift-sub-effect',
        GOLD: 'ht-gold',
        NEW_STREAM: 'new-stream-flash'
    };

    // OPTIMISATION: Fonction avec lookup table
    const LEVEL_COLOR_MAP = {
        1: 'ht-blue', 2: 'ht-blue', 3: 'ht-blue',
        4: 'ht-green', 5: 'ht-green', 6: 'ht-green', 7: 'ht-green',
        8: 'ht-yellow', 9: 'ht-yellow', 10: 'ht-yellow', 11: 'ht-yellow',
        12: 'ht-orange', 13: 'ht-orange', 14: 'ht-orange', 
        15: 'ht-orange', 16: 'ht-orange', 17: 'ht-orange'
    };
    
    const getHypeTrainColorClass = (level) => LEVEL_COLOR_MAP[level] || 'ht-red';
    
    function updateHypeTrainVisuals() {
        levelText.textContent = currentLevel;
        const newColorClass = getHypeTrainColorClass(currentLevel);
        // OPTIMISATION: Une seule opération classList
        exampleAvatar.classList.remove(...HYPE_TRAIN_CLASSES);
        exampleAvatar.classList.add(newColorClass);
    }

    function stopHypeTrainAnimation() {
        clearInterval(hypeTrainInterval);
        hypeTrainInterval = null;
        levelText.style.display = 'none';
        levelText.textContent = '';
        exampleAvatar.classList.remove(...HYPE_TRAIN_CLASSES);
        currentLevel = 1;
    }

    function startHypeTrainAnimation() {
        stopHypeTrainAnimation();
        levelText.style.display = 'block';

        updateHypeTrainVisuals(); 
        currentLevel++;

        hypeTrainInterval = setInterval(() => {
            updateHypeTrainVisuals();
            currentLevel = (currentLevel % 20) + 1;
        }, 3600);
    }
    
    function updateEffects() {
        // OPTIMISATION: Utilisation de toggle avec les constantes
        exampleAvatar.classList.toggle(CLASS_NAMES.TREASURE, toggles.treasureTrain.checked);
        exampleAvatar.classList.toggle(CLASS_NAMES.GIFT_SUB, toggles.giftSub.checked);
        exampleAvatar.classList.toggle(CLASS_NAMES.GOLD, toggles.kappaTrain.checked);
        
        exampleCard.classList.toggle(CLASS_NAMES.NEW_STREAM, toggles.newStream.checked);

        if (toggles.hypeTrain.checked || toggles.treasureTrain.checked) {
            startHypeTrainAnimation();
        } else {
            stopHypeTrainAnimation();
        }
    }

    // OPTIMISATION: Délégation d'événements
    exclusiveToggles.forEach(checkboxToListen => {
        checkboxToListen.addEventListener('change', (e) => {
            if (e.target.checked) {
                exclusiveToggles.forEach(otherCheckbox => {
                    if (otherCheckbox !== e.target) {
                        otherCheckbox.checked = false;
                    }
                });
            }
            updateEffects();
        });
    });

    toggles.newStream.addEventListener('change', updateEffects);

    updateEffects();
    
    // OPTIMISATION: Nettoyage lors du déchargement
    window.addEventListener('beforeunload', () => {
        if (hypeTrainInterval) {
            clearInterval(hypeTrainInterval);
        }
        i18nCache.clear();
    });
});
'use strict';

// --- Gestion de l'Authentification (logique existante) ---
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

    function updateUi(isLoggedIn) {
        currentUserIsLoggedIn = isLoggedIn;
        authButton.textContent = chrome.i18n.getMessage(isLoggedIn ? 'popupLogout' : 'popupLogin');
        statusMessage.textContent = chrome.i18n.getMessage(isLoggedIn ? 'popupStatusConnected' : 'popupStatusDisconnected');
        statusMessage.classList.toggle('status-connected', isLoggedIn);
        reloadMessage.style.display = isLoggedIn ? 'block' : 'none';
        if (isLoggedIn) reloadMessage.textContent = chrome.i18n.getMessage('popupReloadMessage');
    }

    authButton.textContent = chrome.i18n.getMessage('popupLoading');
    try {
        const response = await sendMessage({ type: 'GET_AUTH_STATUS' });
        updateUi(response.isLoggedIn);
    } catch (error) {
        statusMessage.textContent = chrome.i18n.getMessage('popupErrorCommunicating');
        console.error(error.message);
    }

    authButton.addEventListener('click', async () => {
        const actionType = currentUserIsLoggedIn ? 'LOGOUT' : 'LOGIN';
        authButton.textContent = chrome.i18n.getMessage('buttonInProgress');
        authButton.disabled = true;
        try {
            const responseAfterAction = await sendMessage({ type: actionType });
            updateUi(responseAfterAction.isLoggedIn);
        } catch (error) {
            statusMessage.textContent = chrome.i18n.getMessage('popupActionFailed');
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

    // **FONCTION DE TRADUCTION CORRIGÉE**
    function localizeStaticElements() {
        // Traduit les éléments simples par leur sélecteur
        document.title = chrome.i18n.getMessage('extensionName');
        document.querySelector('h3').textContent = chrome.i18n.getMessage('extensionName');
        document.querySelector('.live-example-showcase h5').textContent = chrome.i18n.getMessage('popupLiveExampleTitle');
        document.querySelector('.controls-section h5').textContent = chrome.i18n.getMessage('popupControlsTitle');

        // Traduit les labels des cases à cocher
        const labelKeys = {
            'toggle-hype-train': 'popupToggleClassicHypeTrain',
            'toggle-treasure-train': 'popupToggleTreasureTrain',
            'toggle-gift-sub': 'popupToggleGiftSub',
            'toggle-kappa-train': 'popupToggleKappaTrain',
            'toggle-new-stream': 'popupToggleNewStream'
        };

        for (const inputId in labelKeys) {
            const inputElement = document.getElementById(inputId);
            if (inputElement && inputElement.parentElement.tagName === 'LABEL') {
                const labelElement = inputElement.parentElement;
                // Cible et remplace le nœud de texte qui suit l'input
                labelElement.childNodes[1].nodeValue = ' ' + chrome.i18n.getMessage(labelKeys[inputId]);
            }
        }
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
    const HYPE_TRAIN_CLASSES = ['ht-blue', 'ht-green', 'ht-yellow', 'ht-orange', 'ht-red'];

    function getHypeTrainColorClass(level) {
        if (level <= 3) return 'ht-blue';
        if (level <= 7) return 'ht-green';
        if (level <= 11) return 'ht-yellow';
        if (level <= 17) return 'ht-orange';
        return 'ht-red';
    }
    
    function updateHypeTrainVisuals() {
        levelText.textContent = currentLevel;
        const newColorClass = getHypeTrainColorClass(currentLevel);
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
        exampleAvatar.classList.toggle('ht-treasure-effect', toggles.treasureTrain.checked);
        exampleAvatar.classList.toggle('ht-gift-sub-effect', toggles.giftSub.checked);
        exampleAvatar.classList.toggle('ht-gold', toggles.kappaTrain.checked);
        
        exampleCard.classList.toggle('new-stream-flash', toggles.newStream.checked);

        if (toggles.hypeTrain.checked || toggles.treasureTrain.checked) {
            startHypeTrainAnimation();
        } else {
            stopHypeTrainAnimation();
        }
    }

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

    toggles.newStream.addEventListener('change', () => {
        exampleCard.classList.toggle('new-stream-flash', toggles.newStream.checked);
    });

    updateEffects();
});
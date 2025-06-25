'use strict';

// Fonction utilitaire pour envoyer un message et recevoir une réponse via une Promise
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

document.addEventListener('DOMContentLoaded', () => {
    const authButton = document.getElementById('auth-button');
    const statusMessage = document.getElementById('status-message');
    const reloadMessage = document.getElementById('reload-message');

    let currentUserIsLoggedIn = false;

    /**
     * Met à jour l'interface utilisateur du popup en fonction de l'état de connexion.
     * @param {boolean} isLoggedIn - True si l'utilisateur est connecté.
     */
    function updateUi(isLoggedIn) {
        currentUserIsLoggedIn = isLoggedIn;
        if (isLoggedIn) {
            authButton.textContent = chrome.i18n.getMessage('popupLogout');
            statusMessage.textContent = chrome.i18n.getMessage('popupStatusConnected');
            reloadMessage.textContent = chrome.i18n.getMessage('popupReloadMessage');
            reloadMessage.style.display = 'block';
        } else {
            authButton.textContent = chrome.i18n.getMessage('popupLogin');
            statusMessage.textContent = chrome.i18n.getMessage('popupStatusDisconnected');
            reloadMessage.textContent = '';
            reloadMessage.style.display = 'none';
        }
    }

    /**
     * Initialise le popup en demandant le statut d'authentification actuel.
     */
    async function initializePopup() {
        authButton.textContent = chrome.i18n.getMessage('popupLoading');
        try {
            const response = await sendMessage({ type: 'GET_AUTH_STATUS' });
            updateUi(response.isLoggedIn);
        } catch (error) {
            statusMessage.textContent = chrome.i18n.getMessage('popupErrorCommunicating');
            console.error(error.message);
        }
    }

    /**
     * Gère le clic sur le bouton de connexion/déconnexion.
     */
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

    initializePopup();
});
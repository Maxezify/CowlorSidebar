// content.js
(function() {
    'use strict';

    console.log("--- Cowlor's Sidebar Extension Initializing (Final, i18n Ready) ---");

    // --- CONFIGURATION ---
    const CONFIG = {
        SELECTORS: {
            SIDEBAR_PRIMARY: () => 'div[data-test-selector="side-nav"]',
            CHANNEL_LINK_ITEM: () => 'a[data-test-selector*="followed-channel"]',
            LIVE_INDICATOR: () => '.tw-channel-status-indicator',
            LIVE_STATUS_ELEMENT: () => '[data-a-target="side-nav-live-status"]',
            GAME_TITLE_ELEMENT: () => '[data-a-target="side-nav-game-title"]',
            AVATAR_CONTAINER: () => '.tw-avatar',
            HYPE_TRAIN_TEXT_CONTAINER: () => '.side-nav-card__metadata',
            ANY_HYPE_TRAIN_TEXT: () => `p[title*="${getI18nMessage('selectorHypeTrainTitle')}"], p[title*="${getI18nMessage('selectorSharedHypeTrainTitle')}"]`,
            TREASURE_TRAIN_TEXT: () => `p[title*="${getI18nMessage('selectorTreasureTrainTitle')}"]`,
            KAPPA_TRAIN_TEXT: () => `p[title*="${getI18nMessage('selectorKappaTrainTitle')}"]`,
            DISCOUNT_TEXT_ELEMENT: () => `p`,
            SHOW_MORE_BUTTON: () => 'button[data-test-selector*="ShowMore"], a[data-test-selector*="ShowMore"]',
            SIDEBAR_TOGGLE_BUTTON: () => `button[data-a-target="side-nav-toggle"]`,
            PLAYER_MODE_BUTTON: () => `button[data-a-target*="player-theatre-mode-button"], button[data-a-target*="player-studio-mode-button"]`,
        },
        TIMINGS_MS: {
            API_UPDATE_INTERVAL: 30 * 1000,
            REINITIALIZE_DELAY: 1000,
            INITIAL_SETTLE_DELAY: 2000,
            EXPANSION_CLICK_DELAY: 1000,
            MUTATION_DEBOUNCE: 200,
            RESUME_IMMEDIATE_UPDATE_DELAY: 500, // Délai court pour l'update immédiat après sortie du mode studio
        },
        API: {
            EXPANSION_MAX_ATTEMPTS: 20,
            CACHE_DURATION: 15000,
        },
        CSS: {
             HYPE_TRAIN_CLASSES: {
                CONTAINER: 'hype-train-container',
                LEVEL_TEXT: 'hype-train-level-text',
                BLUE: 'ht-blue', GREEN: 'ht-green', YELLOW: 'ht-yellow',
                ORANGE: 'ht-orange', RED: 'ht-red', GOLD: 'ht-gold',
                TREASURE_EFFECT: 'ht-treasure-effect',
                GIFT_RAIN_CONTAINER: 'gift-rain-container'
            }
        },
        UPTIME_COUNTER_STYLE: {
            whiteSpace: 'nowrap', marginTop: '-2px', marginLeft: 'auto', overflow: 'hidden', fontSize: '1.4rem', lineHeight: '1.1', textAlign: 'right', textOverflow: 'ellipsis'
        },
        CSS_CLASSES: {
            BLINKING_ANIMATION: 'cowlor-blinking-text',
            HIDDEN_ELEMENT: 'tch-ext-hidden',
            CUSTOM_UPTIME_COUNTER: 'my-custom-uptime-counter'
        },
        MAX_SELECTOR_CACHE_SIZE: 50,
    };

    // --- CACHES ET ÉTAT GLOBAL ---
    const state = {
        liveChannelElements: new Map(),
        originalGameTitles: new Map(),
        domElements: { sidebar: null },
        observers: { mainObserver: null },
        mainUpdateTimeoutId: null,
        resumeUpdateTimeoutId: null, // Nouveau timeout pour l'update immédiat
        isPaused: false,
        previousPauseState: false, // Pour détecter les changements d'état
        isInitialized: false,
        animationFrameId: null,
    };

    const selectorCache = new Map();
    const apiCache = new Map();

    // --- FONCTIONS UTILITAIRES ---
    const getI18nMessage = (key) => chrome.i18n.getMessage(key) || key;
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    function getCachedSelector(key, builder) {
        if (selectorCache.size > CONFIG.MAX_SELECTOR_CACHE_SIZE) {
            const oldestKey = selectorCache.keys().next().value;
            selectorCache.delete(oldestKey);
        }
        if (!selectorCache.has(key)) {
            selectorCache.set(key, builder());
        }
        return selectorCache.get(key);
    }

    function extractChannelLogin(href) {
        if (!href || typeof href !== 'string') return null;
        try {
            const url = new URL(href);
            const pathParts = url.pathname.split('/').filter(Boolean);
            if (pathParts.length === 0) return null;
            const login = pathParts[0];
            return /^[a-zA-Z0-9_]{3,25}$/.test(login) ? login.toLowerCase() : null;
        } catch {
            return null;
        }
    }

    const formatUptime = (totalSeconds) => {
        if (totalSeconds === null || isNaN(totalSeconds)) return '...';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
    };

    // --- MANIPULATION DU DOM ET CSS ---
    function injectCss() {
        const styleId = 'cowlor-uptime-styles';
        if (document.getElementById(styleId)) return;
        const goldKappaImageUrl = chrome.runtime.getURL('gold_kappa.png');
        const css = `
            @keyframes blinking-text-anim { 0% { opacity: 1; } 50% { opacity: 0.15; } 100% { opacity: 1; } }
            .${CONFIG.CSS_CLASSES.BLINKING_ANIMATION} { animation: blinking-text-anim 1.8s infinite; }
            .${CONFIG.CSS_CLASSES.HIDDEN_ELEMENT} { display: none !important; }
            @keyframes ht-pulse-blue { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(35, 166, 213, 0.7); box-shadow: inset 0 0 8px 2px #23a6d5, 0 0 12px #23a6d5; } }
            @keyframes ht-pulse-green { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(35, 213, 171, 0.7); box-shadow: inset 0 0 8px 2px #23d5ab, 0 0 12px #23d5ab; } }
            @keyframes ht-pulse-yellow { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(226, 223, 11, 0.7); box-shadow: inset 0 0 8px 2px #E2DF0B, 0 0 12px #E2DF0B; } }
            @keyframes ht-pulse-orange { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(228, 117, 14, 0.7); box-shadow: inset 0 0 8px 2px #E4750E, 0 0 12px #E4750E; } }
            @keyframes ht-pulse-red { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(217, 48, 37, 0.7); box-shadow: inset 0 0 8px 2px #D93025, 0 0 12px #D93025; } }
            @keyframes sonar-wave { 0% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(2.2); opacity: 0; } }
            @keyframes legendary-sparkle { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.5); opacity: 1; } }
            @keyframes legendary-crown-float { 0% { transform: translate(-50%, -50%) translateY(-5px) scale(1.1); } 50% { transform: translate(-50%, -50%) translateY(0) scale(1.05); } 100% { transform: translate(-50%, -50%) translateY(-5px) scale(1.1); } }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER} { position: relative; border-radius: 9999px; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 9999px; pointer-events: none; animation-duration: 1.2s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT}::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 9999px; border: 2px solid; animation: sonar-wave 1.5s ease-out infinite; animation-delay: 0.5s; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE}::after { animation-name: ht-pulse-blue; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN}::after { animation-name: ht-pulse-green; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW}::after { animation-name: ht-pulse-yellow; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE}::after { animation-name: ht-pulse-orange; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.RED}::after { animation-name: ht-pulse-red; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE} { border-color: #23a6d5; color: #23a6d5; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN} { border-color: #23d5ab; color: #23d5ab; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW} { border-color: #E2DF0B; color: #E2DF0B; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE} { border-color: #E4750E; color: #E4750E; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.RED} { border-color: #D93025; color: #D93025; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD}::after { content: ''; background-image: url('${goldKappaImageUrl}'); background-size: 80%; background-position: center; background-repeat: no-repeat; opacity: 0.2; box-shadow: inset 0 0 10px 3px #FFD700, 0 0 20px 5px #FFD700; animation: legendary-sparkle 1.8s ease-in-out infinite; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}.ht-kappa-crown { content: ''; font-size: 28px; color: #FFD700; text-shadow: 0 0 4px black, 0 0 8px gold, 0 0 12px white; animation: legendary-crown-float 2.5s ease-in-out infinite; z-index: 12; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT} { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 800; color: white; text-shadow: 1px 1px 2px black, 0 0 5px black, 0 0 8px black; pointer-events: none; z-index: 10; }
            @keyframes gift-fall { 0% { transform: translateY(-20%) translateX(-50%); opacity: 1; } 100% { transform: translateY(120%) translateX(-50%); opacity: 0; } }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER} { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; border-radius: 9999px; z-index: 5; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER} span { position: absolute; top: 0; font-size: 18px; text-shadow: 0px 0px 5px rgba(0, 0, 0, 0.8); animation-name: gift-fall; animation-timing-function: linear; animation-iteration-count: infinite; opacity: 0; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER} span:nth-child(1) { left: 25%; animation-duration: 2.2s; animation-delay: 0s; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER} span:nth-child(2) { left: 60%; font-size: 15px; animation-duration: 2.8s; animation-delay: 0.8s; }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER} span:nth-child(3) { left: 80%; animation-duration: 2.5s; animation-delay: 1.5s; }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function createUptimeElement() {
        const uptimeDisplay = document.createElement('div');
        uptimeDisplay.className = CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER;
        Object.assign(uptimeDisplay.style, CONFIG.UPTIME_COUNTER_STYLE);
        return uptimeDisplay;
    }

    function setSecureTextContent(element, text) {
        if (element) {
            element.textContent = text;
        }
    }

    // --- LOGIQUE D'ANIMATION ET DE MISE À JOUR ---
    function animationLoop() {
        if (state.isPaused) return;
        const visibleElements = Array.from(state.liveChannelElements.values())
            .filter(el => el.offsetParent !== null);

        if (visibleElements.length === 0 && state.animationFrameId) {
            cancelAnimationFrame(state.animationFrameId);
            state.animationFrameId = null;
            return;
        }

        visibleElements.forEach(channelElement => {
            const uptimeDisplay = channelElement.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);
            if (uptimeDisplay?.dataset.startedAt) {
                const startedAt = new Date(uptimeDisplay.dataset.startedAt);
                const uptimeSeconds = (Date.now() - startedAt.getTime()) / 1000;
                requestAnimationFrame(() => {
                    if(uptimeDisplay) uptimeDisplay.textContent = formatUptime(uptimeSeconds);
                });
            }
        });

        if (!state.isPaused) {
            state.animationFrameId = requestAnimationFrame(animationLoop);
        } else {
            state.animationFrameId = null;
        }
    }

    function startAnimationIfNeeded() {
        if (!state.animationFrameId && state.liveChannelElements.size > 0 && !state.isPaused) {
            animationLoop();
        }
    }
    
    // --- GESTION DES APPELS API AVEC CACHE ---
    async function getUptimesWithCache(logins) {
        if (state.isPaused) return null;
        const cacheKey = logins.sort().join(',');
        const cached = apiCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp < CONFIG.API.CACHE_DURATION)) {
            return cached.data;
        }

        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_UPTIMES_FOR_CHANNELS', logins });
            if (response && response.success) {
                apiCache.set(cacheKey, { data: response, timestamp: Date.now() });
                return response;
            }
            console.error('[API Cache] Erreur de réponse du background:', response?.error || 'Réponse invalide');
            return null;
        } catch(error) {
            console.error('[API Cache] Échec de la communication avec le background script:', error.message);
            return null;
        }
    }

    async function executeBatchApiUpdate(channelsMap) {
        if (state.isPaused || channelsMap.size === 0) return;
        const logins = Array.from(channelsMap.keys());

        const response = await getUptimesWithCache(logins);
        if (!response) return;

        const uptimeData = new Map(response.data);
        
        for (const login of channelsMap.keys()) {
            if (!uptimeData.has(login.toLowerCase())) {
                uptimeData.set(login.toLowerCase(), null);
            }
        }

        for (const [login, element] of channelsMap.entries()) {
            if (document.body.contains(element)) {
                const startedAtString = uptimeData.get(login.toLowerCase()) || null;
                updateChannelDisplay(element, login, startedAtString);
            } else {
                state.liveChannelElements.delete(login);
                state.originalGameTitles.delete(login);
            }
        }
        startAnimationIfNeeded();
    }
    
    // --- LOGIQUE D'AFFICHAGE DES CHAÎNES ---
    function updateChannelDisplay(element, login, startedAt) {
        const liveStatusElement = element.querySelector(CONFIG.SELECTORS.LIVE_STATUS_ELEMENT());
        const gameTitleElement = element.querySelector(CONFIG.SELECTORS.GAME_TITLE_ELEMENT());
        let uptimeDisplay = element.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);

        if (startedAt) {
            element.classList.remove(CONFIG.CSS_CLASSES.BLINKING_ANIMATION);

            if (gameTitleElement && state.originalGameTitles.has(login)) {
                setSecureTextContent(gameTitleElement, state.originalGameTitles.get(login));
                state.originalGameTitles.delete(login);
            }
            if (liveStatusElement) {
                liveStatusElement.style.display = '';
            }
            
            if (!uptimeDisplay) {
                uptimeDisplay = createUptimeElement();
                if (liveStatusElement) {
                     Object.assign(liveStatusElement.style, {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        justifyItems: 'flex-end'
                    });
                    liveStatusElement.appendChild(uptimeDisplay);
                }
            }
            
            if(uptimeDisplay) uptimeDisplay.dataset.startedAt = startedAt;
            state.liveChannelElements.set(login, element);

        } else {
            element.classList.add(CONFIG.CSS_CLASSES.BLINKING_ANIMATION);
            uptimeDisplay?.remove();

            if (liveStatusElement) {
                liveStatusElement.style.display = 'none';
            }
            if (gameTitleElement) {
                if (!state.originalGameTitles.has(login)) {
                    state.originalGameTitles.set(login, gameTitleElement.textContent);
                }
                setSecureTextContent(gameTitleElement, getI18nMessage('contentOfflineMessage'));
            }
            state.liveChannelElements.delete(login);
        }
    }
    
    // --- LOGIQUE DES ÉVÉNEMENTS SPÉCIAUX (HYPE TRAIN, etc.) ---
    function getHypeTrainColorClass(level) {
        if (level <= 3) return CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE;
        if (level <= 7) return CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN;
        if (level <= 11) return CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW;
        if (level <= 17) return CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE;
        return CONFIG.CSS.HYPE_TRAIN_CLASSES.RED;
    }

    function cleanupHypeTrain(channelLink) {
        if (!channelLink) return;
        const avatarContainer = channelLink.querySelector(getCachedSelector('AVATAR_CONTAINER', CONFIG.SELECTORS.AVATAR_CONTAINER));
        
        if (channelLink.dataset.hypeTrainActive === 'true' && avatarContainer) {
            avatarContainer.classList.remove(...Object.values(CONFIG.CSS.HYPE_TRAIN_CLASSES).filter(cls => typeof cls === 'string' && cls.startsWith('ht-')));
            avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`)?.remove();
            channelLink.removeAttribute('data-hype-train-active');
        }
        if (channelLink.dataset.discountActive === 'true' && avatarContainer) {
            avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER}`)?.remove();
            channelLink.removeAttribute('data-discount-active');
        }

        const textContainer = channelLink.querySelector('[data-is-event-container="true"]');
        if (textContainer) {
            textContainer.classList.remove(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            textContainer.removeAttribute('data-is-event-container');
        }
    }

    function processSpecialEvents() {
        if (state.isPaused || !state.domElements.sidebar) return;

        const elementsToScan = state.domElements.sidebar.querySelectorAll(getCachedSelector('CHANNEL_LINK_ITEM', CONFIG.SELECTORS.CHANNEL_LINK_ITEM));

        for (const channelLink of elementsToScan) {
            cleanupHypeTrain(channelLink);

            const avatarContainer = channelLink.querySelector(getCachedSelector('AVATAR_CONTAINER', CONFIG.SELECTORS.AVATAR_CONTAINER));
            if (!avatarContainer) continue;

            const hypeTrainEl = channelLink.querySelector(`${getCachedSelector('ANY_HYPE_TRAIN_TEXT', CONFIG.SELECTORS.ANY_HYPE_TRAIN_TEXT)}, ${getCachedSelector('TREASURE_TRAIN_TEXT', CONFIG.SELECTORS.TREASURE_TRAIN_TEXT)}, ${getCachedSelector('KAPPA_TRAIN_TEXT', CONFIG.SELECTORS.KAPPA_TRAIN_TEXT)}`);
            
            const discountTerm = getI18nMessage('selectorDiscountTrainTitle');
            let discountEl = null;
            for (const p of channelLink.querySelectorAll(CONFIG.SELECTORS.DISCOUNT_TEXT_ELEMENT())) {
                if (p.textContent.includes(discountTerm)) {
                    discountEl = p;
                    break;
                }
            }

            if (hypeTrainEl) {
                const overlay = document.createElement('span');
                overlay.className = CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT;
                let colorClass;

                if (hypeTrainEl.matches(getCachedSelector('KAPPA_TRAIN_TEXT', CONFIG.SELECTORS.KAPPA_TRAIN_TEXT))) {
                    colorClass = CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD;
                    overlay.classList.add('ht-kappa-crown');
                    setSecureTextContent(overlay, '');
                } else {
                    const levelMatch = hypeTrainEl.title.match(/\d+/g);
                    const level = levelMatch ? parseInt(levelMatch[0], 10) : 1;
                    colorClass = getHypeTrainColorClass(level);
                    setSecureTextContent(overlay, level);
                    if (hypeTrainEl.matches(getCachedSelector('TREASURE_TRAIN_TEXT', CONFIG.SELECTORS.TREASURE_TRAIN_TEXT))) {
                        avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT);
                    }
                }
                channelLink.dataset.hypeTrainActive = 'true';
                avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER, colorClass);
                avatarContainer.appendChild(overlay);

                const textContainer = hypeTrainEl.parentElement;
                if (textContainer) {
                    textContainer.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
                    textContainer.dataset.isEventContainer = 'true';
                }
            }
            
            if(discountEl) {
                channelLink.dataset.discountActive = 'true';
                const giftContainer = document.createElement('div');
                giftContainer.className = CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_RAIN_CONTAINER;
                for(let i = 0; i < 3; i++) {
                    const gift = document.createElement('span');
                    setSecureTextContent(gift, '🎁');
                    giftContainer.appendChild(gift);
                }
                avatarContainer.appendChild(giftContainer);

                const textContainer = discountEl.parentElement;
                if (textContainer) {
                    textContainer.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
                    textContainer.dataset.isEventContainer = 'true';
                }
            }
        }
    }
    
    // --- FONCTION "AFFICHER PLUS" ---
    async function expandFollowedChannels() {
        if (!state.domElements.sidebar) return;
    
        const isElementLive = (el) => el?.querySelector(getCachedSelector('LIVE_INDICATOR', CONFIG.SELECTORS.LIVE_INDICATOR)) !== null;
    
        for (let i = 0; i < CONFIG.API.EXPANSION_MAX_ATTEMPTS; i++) {
            const showMoreButton = state.domElements.sidebar.querySelector(getCachedSelector('SHOW_MORE_BUTTON', CONFIG.SELECTORS.SHOW_MORE_BUTTON));
    
            if (!showMoreButton || showMoreButton.offsetParent === null) {
                break;
            }
    
            const allChannels = state.domElements.sidebar.querySelectorAll(getCachedSelector('CHANNEL_LINK_ITEM', CONFIG.SELECTORS.CHANNEL_LINK_ITEM));
            if (allChannels.length === 0) {
                break;
            }
    
            const lastChannel = allChannels[allChannels.length - 1];
    
            if (!isElementLive(lastChannel)) {
                break;
            }
    
            showMoreButton.click();
            await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.EXPANSION_CLICK_DELAY));
        }
    }

    // --- GESTION DE LA PAUSE (AMÉLIORÉE POUR LE MODE STUDIO) ---
    function updatePauseState() {
        const sidebarToggleButton = document.querySelector(CONFIG.SELECTORS.SIDEBAR_TOGGLE_BUTTON());
        const playerModeButton = document.querySelector(CONFIG.SELECTORS.PLAYER_MODE_BUTTON());

        const sidebarCollapsedText = getI18nMessage('selectorSidebarExpand'); 
        const playerModeExitText = getI18nMessage('selectorTheatreModeExit');
        const studioModeExitText = "Quitter le mode Studio"; // Texte spécifique au mode studio

        let isSidebarCollapsed = false;
        if (sidebarToggleButton) {
            isSidebarCollapsed = (sidebarToggleButton.getAttribute('aria-label') || '').includes(sidebarCollapsedText);
        }

        let isInPlayerMode = false;
        if (playerModeButton) {
            const playerLabel = playerModeButton.getAttribute('aria-label') || '';
            isInPlayerMode = playerLabel.includes(playerModeExitText) || playerLabel.includes(studioModeExitText);
        }
        
        // Sauvegarder l'état précédent pour détecter les changements
        state.previousPauseState = state.isPaused;
        const newPauseState = isSidebarCollapsed || isInPlayerMode;

        if (state.isPaused !== newPauseState) {
            state.isPaused = newPauseState;
            console.log(`[Cowlor's Sidebar] Pause state updated to: ${state.isPaused}`);
            
            if (!state.isPaused && state.previousPauseState) {
                // On sort du mode pause (notamment du mode studio)
                console.log("[Cowlor's Sidebar] Resuming operations - immediate update triggered.");
                
                // Annuler tout timeout de reprise en cours
                clearTimeout(state.resumeUpdateTimeoutId);
                
                // Programmer un appel API immédiat mais avec un petit délai pour que la sidebar soit bien affichée
                state.resumeUpdateTimeoutId = setTimeout(async () => {
                    if (!state.isPaused) { // Double vérification
                        console.log("[Cowlor's Sidebar] Executing immediate update after resume.");
                        
                        // Forcer l'invalidation du cache pour avoir des données fraîches
                        apiCache.clear();
                        
                        // Expansion et scan immédiat
                        await expandFollowedChannels();
                        await initialScan();
                        startAnimationIfNeeded();
                    }
                }, CONFIG.TIMINGS_MS.RESUME_IMMEDIATE_UPDATE_DELAY);
                
            } else if (state.isPaused) {
                console.log("[Cowlor's Sidebar] Pausing operations.");
                // Annuler les timeouts de reprise si on entre en pause
                clearTimeout(state.resumeUpdateTimeoutId);
            }
        }
    }

    // --- OBSERVATEUR DE MUTATIONS UNIQUE ET OPTIMISÉ ---
    const processMutations = debounce((mutations) => {
        updatePauseState();
        if (state.isPaused) return;

        const channelsForUpdate = new Map();
        let eventCheckNeeded = false;

        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const channelLinkSelector = getCachedSelector('CHANNEL_LINK_ITEM', CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
                    const matchingElements = node.matches(channelLinkSelector) ? [node] : node.querySelectorAll(channelLinkSelector);

                    matchingElements.forEach(el => {
                        const login = extractChannelLogin(el.href);
                        if (login && el.querySelector(getCachedSelector('LIVE_INDICATOR', CONFIG.SELECTORS.LIVE_INDICATOR))) {
                           channelsForUpdate.set(login, el);
                        }
                    });

                    if (node.querySelector(CONFIG.SELECTORS.HYPE_TRAIN_TEXT_CONTAINER())) {
                        eventCheckNeeded = true;
                    }
                }
                 if (mutation.target.closest(CONFIG.SELECTORS.HYPE_TRAIN_TEXT_CONTAINER())) {
                    eventCheckNeeded = true;
                }
            }
        }

        if (channelsForUpdate.size > 0) {
            executeBatchApiUpdate(channelsForUpdate);
        }
        if (eventCheckNeeded) {
            processSpecialEvents();
        }
    }, CONFIG.TIMINGS_MS.MUTATION_DEBOUNCE);

    // --- INITIALISATION ET GESTION DU CYCLE DE VIE ---
    function setupMainObserver() {
        if (state.observers.mainObserver) state.observers.mainObserver.disconnect();

        state.observers.mainObserver = new MutationObserver(processMutations);
        state.observers.mainObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-label']
        });
    }

    async function initialScan() {
        updatePauseState();
        if (state.isPaused || !state.domElements.sidebar) return;

        const channelsForApiUpdate = new Map();

        state.domElements.sidebar.querySelectorAll(getCachedSelector('CHANNEL_LINK_ITEM', CONFIG.SELECTORS.CHANNEL_LINK_ITEM)).forEach(el => {
            const login = extractChannelLogin(el.href);
            if (login && el.querySelector(getCachedSelector('LIVE_INDICATOR', CONFIG.SELECTORS.LIVE_INDICATOR))) {
                channelsForApiUpdate.set(login, el);
            }
        });

        if (channelsForApiUpdate.size > 0) {
            await executeBatchApiUpdate(channelsForApiUpdate);
        }
        processSpecialEvents();
    }

    function cleanup(isFullCleanup = false) {
        console.log(`[Cowlor's Sidebar] Nettoyage (Complet: ${isFullCleanup})...`);
        clearTimeout(state.mainUpdateTimeoutId);
        clearTimeout(state.resumeUpdateTimeoutId); // Nettoyer le nouveau timeout
        if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
        state.observers.mainObserver?.disconnect();
        state.liveChannelElements.clear();
        state.originalGameTitles.clear();
        selectorCache.clear();
        state.isInitialized = false;
        state.animationFrameId = null;
        state.previousPauseState = false;

        if (isFullCleanup) {
            apiCache.clear();
        }
    }

    async function initialize() {
        if (state.isInitialized) return;

        state.domElements.sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY());
        if (!state.domElements.sidebar) {
            setTimeout(initialize, 500);
            return;
        }

        state.isInitialized = true;
        console.log("[Cowlor's Sidebar] Initialisation principale...");
        injectCss();
        setupMainObserver();
        
        await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.INITIAL_SETTLE_DELAY));
        await expandFollowedChannels();
        
        await initialScan();

        const updateLoop = async () => {
            updatePauseState();
            if (!state.isPaused) {
                await initialScan();
            }
            state.mainUpdateTimeoutId = setTimeout(updateLoop, CONFIG.TIMINGS_MS.API_UPDATE_INTERVAL);
        };
        updateLoop();
    }

    const entryObserver = new MutationObserver((mutations, observer) => {
        if (document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY())) {
            initialize();
            observer.disconnect();
        }
    });

    if (document.body) {
         entryObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
             entryObserver.observe(document.body, { childList: true, subtree: true });
        });
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        cleanup();
        setTimeout(initialize, CONFIG.TIMINGS_MS.REINITIALIZE_DELAY);
      }
    }).observe(document.body, { subtree: true, childList: true });

})();
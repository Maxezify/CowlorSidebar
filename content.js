// content.js
(function() {
    'use strict';

    console.log("--- Cowlor's Sidebar Extension Initializing ---");

    // Obtenir les chaînes traduites une seule fois au début pour la performance
    const i18n = {
        hypeTrainTitle: chrome.i18n.getMessage('selectorHypeTrainTitle'),
        sharedHypeTrainTitle: chrome.i18n.getMessage('selectorSharedHypeTrainTitle'),
        treasureTrainTitle: chrome.i18n.getMessage('selectorTreasureTrainTitle'),
        kappaTrainTitle: chrome.i18n.getMessage('selectorKappaTrainTitle')
    };

    const CONFIG = {
        SELECTORS: {
            SIDEBAR_PRIMARY: 'div[data-test-selector="side-nav"]',
            CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"], a[data-test-selector="recommended-channel"], a[data-test-selector="similarity-channel"]',
            FOLLOWED_CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"]',
            LIVE_INDICATOR: '.tw-channel-status-indicator',
            AVATAR_CONTAINER: '.tw-avatar',
            ANY_HYPE_TRAIN_TEXT: `p[title*="${i18n.hypeTrainTitle}"], p[title*="${i18n.sharedHypeTrainTitle}"]`,
            TREASURE_TRAIN_TEXT: `p[title*="${i18n.treasureTrainTitle}"]`,
            KAPPA_TRAIN_TEXT: `p[title*="${i18n.kappaTrainTitle}"]`,
            SHOW_MORE_BUTTON: 'button[data-test-selector="ShowMore"], a[data-test-selector="ShowMore"]',
        },
        TIMINGS_MS: {
            INITIAL_SETTLE_DELAY: 2000,
            EXPANSION_CLICK_DELAY: 1000,
            EXPANSION_WAIT_DELAY: 500,
        },
        API: {
            EXPANSION_MAX_ATTEMPTS: 20,
        },
        CSS: {
             HYPE_TRAIN_CLASSES: {
                CONTAINER: 'hype-train-container',
                LEVEL_TEXT: 'hype-train-level-text',
                BLUE: 'ht-blue', GREEN: 'ht-green', YELLOW: 'ht-yellow',
                ORANGE: 'ht-orange', RED: 'ht-red', GOLD: 'ht-gold',
                TREASURE_EFFECT: 'ht-treasure-effect'
            }
        },
        UPTIME_COUNTER_STYLE: {
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            fontSize: '1.4rem',
            textAlign: 'right', 
            lineHeight: '1.4',
            marginLeft: 'auto',
            marginTop: '-4px'
        },
        CSS_CLASSES: {
            HIDDEN_ELEMENT: 'tch-ext-hidden',
            CUSTOM_UPTIME_COUNTER: 'my-custom-uptime-counter'
        }
    };

    const state = {
        liveChannelElements: new Map(),
        domCache: new Map(),
        domElements: { sidebar: null },
        observers: { sidebarObserver: null, mainObserver: null },
        isInitialized: false,
        animationFrameId: null,
    };

    const formatUptime = (totalSeconds) => {
        if (totalSeconds === null || isNaN(totalSeconds)) return '...';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        return `${String(h)}h ${String(m).padStart(2, '0')}m`;
    };

    function injectCss() {
        const styleId = 'cowlor-uptime-styles';
        if (document.getElementById(styleId)) return;
        const goldKappaImageUrl = chrome.runtime.getURL('gold_kappa.png');
        const css = `
            .${CONFIG.CSS_CLASSES.HIDDEN_ELEMENT} { display: none !important; }
            /* MODIFIÉ : Le contour s'inverse pour rester visible */
            @keyframes ht-text-color-anim {
                0%, 100% {
                    color: white;
                    text-shadow: -1px -1px 0 #1f1f23, 1px -1px 0 #1f1f23, -1px 1px 0 #1f1f23, 1px 1px 0 #1f1f23;
                }
                50% {
                    color: #1f1f23;
                    text-shadow: -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white;
                }
            }
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
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT} { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 900; color: white; text-shadow: -1px -1px 0 #1f1f23, 1px -1px 0 #1f1f23, -1px 1px 0 #1f1f23, 1px 1px 0 #1f1f23; pointer-events: none; z-index: 10; animation: ht-text-color-anim 1.2s ease-in-out infinite; }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function cleanupChannelDisplay(channelLogin, channelElement) {
        state.liveChannelElements.delete(channelLogin);
        channelElement?.removeAttribute('data-uptime-status');
        channelElement?.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`)?.remove();
    }
    
    function renderLiveState(channelElement, channelLogin, startedAtString) {
        channelElement.dataset.uptimeStatus = 'live';
        let uptimeDisplay = channelElement.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);
        if (!uptimeDisplay) {
            uptimeDisplay = document.createElement('div');
            uptimeDisplay.className = `${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER} tw-c-text-alt-2`;
            Object.assign(uptimeDisplay.style, CONFIG.UPTIME_COUNTER_STYLE);
            const insertionPoint = channelElement.querySelector('.side-nav-card__live-status') || channelElement.querySelector('.side-nav-card__meta');
            if (insertionPoint) {
                if (insertionPoint.classList.contains('side-nav-card__live-status')) {
                    Object.assign(insertionPoint.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' });
                }
                insertionPoint.appendChild(uptimeDisplay);
            }
        }
        uptimeDisplay.dataset.startedAt = startedAtString;
        state.liveChannelElements.set(channelLogin, channelElement);
    }

    function setupUptimeDisplay(channelElement, channelLogin, startedAtString) {
        if (startedAtString) {
            renderLiveState(channelElement, channelLogin, startedAtString);
        } else {
            cleanupChannelDisplay(channelLogin, channelElement);
            state.domCache.delete(channelLogin);
        }
    }

    function getHypeTrainColorClass(level) {
        if (level <= 3) return CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE;
        if (level <= 7) return CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN;
        if (level <= 11) return CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW;
        if (level <= 17) return CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE;
        return CONFIG.CSS.HYPE_TRAIN_CLASSES.RED;
    }

    function cleanupHypeTrain(channelLink) {
        if (!channelLink || channelLink.dataset.hypeTrainActive !== 'true') return;
        const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
        if (avatarContainer) {
            avatarContainer.classList.remove(...Object.values(CONFIG.CSS.HYPE_TRAIN_CLASSES));
            avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`)?.remove();
        }
        const hypeTrainTextContainer = channelLink.querySelector('[data-is-hype-train-container="true"]');
        if (hypeTrainTextContainer) {
            hypeTrainTextContainer.classList.remove(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            hypeTrainTextContainer.removeAttribute('data-is-hype-train-container');
        }
        channelLink.removeAttribute('data-hype-train-active');
    }

    function processHypeTrains() {
        if (!state.domElements.sidebar) return;
        
        document.querySelectorAll('[data-hype-train-active="true"]').forEach(containerLink => {
            if (!containerLink.querySelector(`${CONFIG.SELECTORS.ANY_HYPE_TRAIN_TEXT}, ${CONFIG.SELECTORS.TREASURE_TRAIN_TEXT}, ${CONFIG.SELECTORS.KAPPA_TRAIN_TEXT}`)) {
                cleanupHypeTrain(containerLink);
            }
        });

        const combinedSelector = `${CONFIG.SELECTORS.ANY_HYPE_TRAIN_TEXT}, ${CONFIG.SELECTORS.TREASURE_TRAIN_TEXT}, ${CONFIG.SELECTORS.KAPPA_TRAIN_TEXT}`;
        state.domElements.sidebar.querySelectorAll(combinedSelector).forEach(textEl => {
            const channelLink = textEl.closest(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
            if (!channelLink || channelLink.dataset.hypeTrainActive === 'true') return;
            const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
            if (!avatarContainer) return;
            
            const overlay = document.createElement('span');
            overlay.className = CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT;
            
            let colorClass;
            
            if (textEl.matches(CONFIG.SELECTORS.KAPPA_TRAIN_TEXT)) {
                colorClass = CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD;
                overlay.classList.add('ht-kappa-crown');
                overlay.textContent = '';
            } else {
                const levelMatch = textEl.title.match(/\d+/);
                const level = levelMatch ? parseInt(levelMatch[0], 10) : 1;
                colorClass = getHypeTrainColorClass(level);
                overlay.textContent = level;

                if (textEl.matches(CONFIG.SELECTORS.TREASURE_TRAIN_TEXT)) {
                    avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT);
                }
            }
            
            channelLink.dataset.hypeTrainActive = 'true';
            avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER, colorClass);
            avatarContainer.appendChild(overlay);
            
            const hypeTrainTextContainer = textEl.parentElement;
            if (hypeTrainTextContainer) {
                hypeTrainTextContainer.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
                hypeTrainTextContainer.dataset.isHypeTrainContainer = 'true';
            }
        });
    }

    function updateAllVisibleCounters() {
        if (state.liveChannelElements.size === 0) return;
        for (const channelElement of state.liveChannelElements.values()) {
            const uptimeDisplay = channelElement.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);
            if (uptimeDisplay && uptimeDisplay.dataset.startedAt) {
                const startedAt = new Date(uptimeDisplay.dataset.startedAt);
                if (isNaN(startedAt.getTime())) continue;
                const uptimeSeconds = (Date.now() - startedAt.getTime()) / 1000;
                uptimeDisplay.textContent = formatUptime(uptimeSeconds);
            }
        }
    }
    
    const isChannelElementLive = (el) => el?.querySelector(CONFIG.SELECTORS.LIVE_INDICATOR) !== null;
    
    async function executeBatchApiUpdate(channelsMap) {
        if (channelsMap.size === 0) return;
        const logins = Array.from(channelsMap.keys());
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_UPTIMES_FOR_CHANNELS', logins: logins });
            if (response && response.success) {
                const uptimeData = new Map(response.data);
                for (const [login, element] of channelsMap) {
                    const startedAtString = uptimeData.get(login.toLowerCase()) ?? null;
                    if (startedAtString) {
                        state.domCache.set(login, { startedAt: startedAtString });
                    }
                     if (document.body.contains(element)) {
                        setupUptimeDisplay(element, login, startedAtString);
                    }
                }
            } else {
                console.error('[API] La requête au background script a échoué:', response?.error);
            }
        } catch (error) {
            console.error('[API] Erreur de communication avec le background script:', error.message);
        }
    }
    
    function processNewChannelElement(element) {
        const channelLogin = element.href?.split('/').pop()?.toLowerCase();
        if (!channelLogin || state.liveChannelElements.has(channelLogin)) return;

        if (isChannelElementLive(element)) {
            const cachedData = state.domCache.get(channelLogin);
            if (cachedData) {
                setupUptimeDisplay(element, channelLogin, cachedData.startedAt);
            } else {
                const channelMap = new Map([[channelLogin, element]]);
                executeBatchApiUpdate(channelMap);
            }
        } else {
            element.dataset.uptimeStatus = 'offline';
        }
    }

    async function initialScanForChannels() {
        if (!state.domElements.sidebar) return;
        const channelsForApiUpdate = new Map();
        
        state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(el => {
            const channelLogin = el.href?.split('/').pop()?.toLowerCase();
            if (!channelLogin) return;
    
            if (isChannelElementLive(el)) {
                const cachedData = state.domCache.get(channelLogin);
                if (cachedData) {
                    setupUptimeDisplay(el, channelLogin, cachedData.startedAt);
                } else {
                    channelsForApiUpdate.set(channelLogin, el);
                }
            } else {
                cleanupChannelDisplay(channelLogin, el);
                state.domCache.delete(channelLogin);
                el.dataset.uptimeStatus = 'offline';
            }
        });
        
        if (channelsForApiUpdate.size > 0) {
            await executeBatchApiUpdate(channelsForApiUpdate);
        }
    }
    
    async function expandFollowedChannels() {
        for (let i = 0; i < CONFIG.API.EXPANSION_MAX_ATTEMPTS; i++) {
            const showMoreButton = state.domElements.sidebar?.querySelector(CONFIG.SELECTORS.SHOW_MORE_BUTTON);

            if (!showMoreButton || showMoreButton.offsetParent === null) {
                break;
            }

            const followedChannels = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.FOLLOWED_CHANNEL_LINK_ITEM);
            const numFollowedChannels = followedChannels.length;

            if (numFollowedChannels > 0) {
                const lastFollowedChannel = followedChannels[numFollowedChannels - 1];
                if (lastFollowedChannel && !isChannelElementLive(lastFollowedChannel)) {
                    break;
                }
            }

            showMoreButton.click();
            await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.EXPANSION_CLICK_DELAY));

            const followedChannelsAfterClick = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.FOLLOWED_CHANNEL_LINK_ITEM);
            if (followedChannelsAfterClick.length === numFollowedChannels) {
                break;
            }
        }
    }

    function animationLoop() {
        updateAllVisibleCounters();
        state.animationFrameId = requestAnimationFrame(animationLoop);
    }

    function setupSidebarObserver() {
        if (state.observers.sidebarObserver) state.observers.sidebarObserver.disconnect();
        
        state.observers.sidebarObserver = new MutationObserver((mutations) => {
            processHypeTrains(); 
            for (const mutation of mutations) {
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const processRemovedNode = (removedEl) => {
                            const channelLogin = removedEl.href?.split('/').pop()?.toLowerCase();
                            if (channelLogin) {
                                state.liveChannelElements.delete(channelLogin);
                            }
                        };
                        
                        if (node.matches(CONFIG.SELECTORS.CHANNEL_LINK_ITEM)) {
                            processRemovedNode(node);
                        }
                        node.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(processRemovedNode);
                    }
                });

                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches(CONFIG.SELECTORS.CHANNEL_LINK_ITEM)) {
                            processNewChannelElement(node);
                        }
                        node.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(processNewChannelElement);
                    }
                });
            }
        });
        state.observers.sidebarObserver.observe(state.domElements.sidebar, { childList: true, subtree: true });
    }
    
    async function initializeMainFunctionality() {
        if (state.isInitialized) return;
        
        const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY);
        if (!sidebar) {
            state.isInitialized = false;
            console.error("[Cowlor's Sidebar] CRITICAL: Sidebar not found for init.");
            return;
        }
        
        state.isInitialized = true;
        state.domElements.sidebar = sidebar;
        injectCss();
        if(state.animationFrameId === null) animationLoop();

        try {
            await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.INITIAL_SETTLE_DELAY));
            
            await expandFollowedChannels();
            await initialScanForChannels();
            setupSidebarObserver();
            processHypeTrains();

        } catch (error) {
            console.error('[Init] A critical error occurred during initialization:', error);
            state.isInitialized = false;
        }
    }
    
    async function init() {
        try {
            const initialStatus = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
            if (initialStatus && initialStatus.isLoggedIn) {
                const body = document.querySelector('body');
                if (!body) {
                    setTimeout(init, 500);
                    return;
                }

                if (document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY)) {
                    initializeMainFunctionality();
                }

                state.observers.mainObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE && node.matches(CONFIG.SELECTORS.SIDEBAR_PRIMARY)) {
                                console.log('[Main Observer] Sidebar detected. Initializing.');
                                initializeMainFunctionality();
                            }
                        });
                        mutation.removedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE && node.matches(CONFIG.SELECTORS.SIDEBAR_PRIMARY)) {
                                console.log('[Main Observer] Sidebar removed. De-initializing.');
                                state.isInitialized = false;
                                state.observers.sidebarObserver?.disconnect();
                            }
                        });
                    }
                });
                state.observers.mainObserver.observe(body, { childList: true, subtree: true });

            } else {
                console.log('[Auth] Initial status: Logged out. Waiting for login.');
            }
        } catch(error) {
            console.error('[Auth] Could not get auth status from background script. Retrying.', error.message);
            setTimeout(init, 2000);
        }
    }
    
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
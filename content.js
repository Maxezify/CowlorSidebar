// content.js
(function() {
    'use strict';

    console.log("--- Cowlor's Sidebar Extension Initializing (v.Final) ---");

    // --- UTILITIES ---

    const throttle = (func, limit) => {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    };

    class LRUCache {
        constructor(maxSize = 200) {
            this.cache = new Map();
            this.maxSize = maxSize;
        }
        set(key, value) {
            this.cache.delete(key);
            this.cache.set(key, value);
            if (this.cache.size > this.maxSize) {
                this.cache.delete(this.cache.keys().next().value);
            }
        }
        get(key) {
            const value = this.cache.get(key);
            if (value) {
                this.cache.delete(key);
                this.cache.set(key, value);
            }
            return value;
        }
    }

    // --- CONFIGURATION ---

    const i18n = {
        hypeTrainTitle: chrome.i18n.getMessage('selectorHypeTrainTitle'),
        sharedHypeTrainTitle: chrome.i18n.getMessage('selectorSharedHypeTrainTitle'),
        treasureTrainTitle: chrome.i18n.getMessage('selectorTreasureTrainTitle'),
        kappaTrainTitle: chrome.i18n.getMessage('selectorKappaTrainTitle'),
        giftSubTrainTitle: chrome.i18n.getMessage('selectorGiftSubHypeTrainTitle'),
        discountTrainTitle: chrome.i18n.getMessage('selectorDiscountTrainTitle')
    };
    
    const TWITCH_LOGIN_REGEX = /^[a-zA-Z0-9_]{3,25}$/;

    const CONFIG = {
        SELECTORS: {
            SIDEBAR_PRIMARY: 'div[data-test-selector="side-nav"]',
            CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"], a[data-test-selector="recommended-channel"], a[data-test-selector="similarity-channel"]',
            FOLLOWED_CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"]',
            LIVE_INDICATOR: '.tw-channel-status-indicator',
            AVATAR_CONTAINER: '.tw-avatar',
            TEXT_HYPE_TRAIN: `p[title*="${i18n.hypeTrainTitle}"], p[title*="${i18n.sharedHypeTrainTitle}"], p[title*="${i18n.treasureTrainTitle}"], p[title*="${i18n.kappaTrainTitle}"], p[title*="${i18n.discountTrainTitle}"]`,
            GIFT_SUB_TRAIN_ICON: `div[aria-label*="${i18n.giftSubTrainTitle}"]`,
            SHOW_MORE_BUTTON: 'button[data-test-selector="ShowMore"], a[data-test-selector="ShowMore"]',
            GUEST_AVATAR: '.primary-with-small-avatar__mini-avatar',
        },
        TIMINGS_MS: {
            INITIAL_SETTLE_DELAY: 1500,
            PROCESS_THROTTLE: 200
        },
        CSS: {
             HYPE_TRAIN_CLASSES: {
                CONTAINER: 'hype-train-container',
                LEVEL_TEXT: 'hype-train-level-text',
                SHIFTED: 'ht-shifted',
                BLUE: 'ht-blue', GREEN: 'ht-green', YELLOW: 'ht-yellow',
                ORANGE: 'ht-orange', RED: 'ht-red', GOLD: 'ht-gold',
                TREASURE_EFFECT: 'ht-treasure-effect',
                GIFT_SUB_EFFECT: 'ht-gift-sub-effect'
            },
            SQUAD_CLASSES: {
                INDICATOR_HIDDEN: 'squad-indicator-hidden',
                COUNT_CONTAINER: 'squad-count-container',
                COUNT_TEXT: 'squad-count-text'
            }
        },
        UPTIME_COUNTER_STYLE: {
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            fontSize: '1.4rem',
            textAlign: 'right', 
            lineHeight: '1.4',
            marginTop: '-4px'
        },
        CSS_CLASSES: {
            HIDDEN_ELEMENT: 'tch-ext-hidden',
            CUSTOM_UPTIME_COUNTER: 'my-custom-uptime-counter'
        }
    };

    // --- STATE MANAGEMENT ---

    const state = {
        liveChannelElements: new WeakMap(),
        domCache: new LRUCache(),
        domElements: { sidebar: null },
        observers: { sidebarObserver: null, mainObserver: null, uptimeObserver: null },
        isInitialized: false,
        animationFrameId: null,
        visibleUptimeElements: new Set()
    };

    // --- CORE FUNCTIONS ---

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
            .${CONFIG.CSS_CLASSES.HIDDEN_ELEMENT} { display: none !important; } @keyframes ht-text-color-anim { 0%, 100% { color: white; text-shadow: -1px -1px 0 #1f1f23, 1px -1px 0 #1f1f23, -1px 1px 0 #1f1f23, 1px 1px 0 #1f1f23; } 50% { color: #1f1f23; text-shadow: -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white; } } @keyframes ht-pulse-blue { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(35, 166, 213, 0.7); box-shadow: inset 0 0 8px 2px #23a6d5, 0 0 12px #23a6d5; } } @keyframes ht-pulse-green { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(35, 213, 171, 0.7); box-shadow: inset 0 0 8px 2px #23d5ab, 0 0 12px #23d5ab; } } @keyframes ht-pulse-yellow { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(226, 223, 11, 0.7); box-shadow: inset 0 0 8px 2px #E2DF0B, 0 0 12px #E2DF0B; } } @keyframes ht-pulse-orange { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(228, 117, 14, 0.7); box-shadow: inset 0 0 8px 2px #E4750E, 0 0 12px #E4750E; } } @keyframes ht-pulse-red { 0%, 100% { background-color: transparent; box-shadow: none; } 50% { background-color: rgba(217, 48, 37, 0.7); box-shadow: inset 0 0 8px 2px #D93025, 0 0 12px #D93025; } } @keyframes sonar-wave { 0% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(2.2); opacity: 0; } } @keyframes legendary-sparkle { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.5); opacity: 1; } } @keyframes legendary-crown-float { 0% { transform: translate(-50%, -50%) translateY(-5px) scale(1.1); } 50% { transform: translate(-50%, -50%) translateY(0) scale(1.05); } 100% { transform: translate(-50%, -50%) translateY(-5px) scale(1.1); } } @keyframes shimmer-background-pan { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
            .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER} { position: relative; border-radius: 9999px; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 9999px; pointer-events: none; animation-duration: 1.2s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; will-change: transform, opacity; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT}::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 9999px; border: 2px solid; animation: sonar-wave 1.2s ease-out infinite; animation-delay: 0.5s; will-change: transform, opacity; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_SUB_EFFECT}::before { content: ''; position: absolute; top: -2px; left: -2px; right: -2px; bottom: -2px; border-radius: 9999px; padding: 3px; background: linear-gradient(90deg, #6a0dad, #9146ff, #d7bfff, #9146ff, #6a0dad); background-size: 300% 100%; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: shimmer-background-pan 2.5s linear infinite; will-change: background-position; pointer-events: none; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE}::after { animation-name: ht-pulse-blue; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN}::after { animation-name: ht-pulse-green; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW}::after { animation-name: ht-pulse-yellow; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE}::after { animation-name: ht-pulse-orange; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.RED}::after { animation-name: ht-pulse-red; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE} { border-color: #23a6d5; color: #23a6d5; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN} { border-color: #23d5ab; color: #23d5ab; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW} { border-color: #E2DF0B; color: #E2DF0B; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE} { border-color: #E4750E; color: #E4750E; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.RED} { border-color: #D93025; color: #D93025; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD}::after { content: ''; background-image: url('${goldKappaImageUrl}'); background-size: 80%; background-position: center; background-repeat: no-repeat; opacity: 0.2; box-shadow: inset 0 0 10px 3px #FFD700, 0 0 20px 5px #FFD700; animation: legendary-sparkle 1.8s ease-in-out infinite; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}.ht-kappa-crown { content: ''; font-size: 28px; color: #FFD700; text-shadow: 0 0 4px black, 0 0 8px gold, 0 0 12px white; animation: legendary-crown-float 2.5s ease-in-out infinite; z-index: 12; will-change: transform; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT} { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 900; color: white; text-shadow: -1px -1px 0 #1f1f23, 1px -1px 0 #1f1f23, -1px 1px 0 #1f1f23, 1px 1px 0 #1f1f23; pointer-events: none; z-index: 10; animation: ht-text-color-anim 1.2s ease-in-out infinite; } .${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}.${CONFIG.CSS.HYPE_TRAIN_CLASSES.SHIFTED} { top: 35%; left: 35%; font-size: 13px; } .${CONFIG.CSS.SQUAD_CLASSES.INDICATOR_HIDDEN} { display: none !important; } .${CONFIG.CSS.SQUAD_CLASSES.COUNT_CONTAINER} { position: relative; } .${CONFIG.CSS.SQUAD_CLASSES.COUNT_TEXT} { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 13px; font-weight: bold; text-shadow: none; pointer-events: none; z-index: 1; background-color: rgba(0, 0, 0, 0.7); border-radius: 50%; padding: 0px 4px; line-height: 16px; }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    const isChannelElementLive = (el) => el?.querySelector(CONFIG.SELECTORS.LIVE_INDICATOR) !== null;

    // --- OPTIMIZED UPTIME COUNTER LOGIC ---

    function updateVisibleCountersLoop() {
        if (state.visibleUptimeElements.size === 0 || document.hidden) {
            state.animationFrameId = null;
            return;
        }
        for (const uptimeDisplay of state.visibleUptimeElements) {
            const startedAt = new Date(uptimeDisplay.dataset.startedAt);
            if (!isNaN(startedAt.getTime())) {
                const uptimeSeconds = (Date.now() - startedAt.getTime()) / 1000;
                uptimeDisplay.textContent = formatUptime(uptimeSeconds);
            }
        }
        state.animationFrameId = requestAnimationFrame(updateVisibleCountersLoop);
    }

    function setupUptimeObserver() {
        if (state.observers.uptimeObserver) state.observers.uptimeObserver.disconnect();
        state.observers.uptimeObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    state.visibleUptimeElements.add(entry.target);
                    if (state.animationFrameId === null) updateVisibleCountersLoop();
                } else {
                    state.visibleUptimeElements.delete(entry.target);
                }
            });
        }, { root: state.domElements.sidebar, threshold: 0.1 });
    }

    function cleanupChannelDisplay(channelElement) {
        const uptimeDisplay = channelElement.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);
        if (uptimeDisplay) {
            state.observers.uptimeObserver?.unobserve(uptimeDisplay);
            uptimeDisplay.remove();
        }
        state.liveChannelElements.delete(channelElement);
    }
    
    function renderLiveState(channelElement, channelLogin, startedAtString) {
        let uptimeDisplay = channelElement.querySelector(`.${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER}`);
        const insertionPoint = channelElement.querySelector('.side-nav-card__live-status') || channelElement.querySelector('.side-nav-card__meta');
        if (!uptimeDisplay) {
            if (insertionPoint) {
                Object.assign(insertionPoint.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' });
            }
            uptimeDisplay = document.createElement('div');
            uptimeDisplay.className = `${CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER} tw-c-text-alt-2`;
            Object.assign(uptimeDisplay.style, CONFIG.UPTIME_COUNTER_STYLE);
            insertionPoint?.appendChild(uptimeDisplay);
            state.observers.uptimeObserver?.observe(uptimeDisplay);
        }
        uptimeDisplay.dataset.startedAt = startedAtString;
        state.liveChannelElements.set(channelElement, { login: channelLogin, startedAt: startedAtString });
    }

    // --- HYPE TRAIN & SQUAD LOGIC ---

    const throttledProcessUI = throttle(() => {
        processHypeTrains();
        processSquadStreams();
    }, CONFIG.TIMINGS_MS.PROCESS_THROTTLE);

    function getHypeTrainColorClass(level) {
        if (level <= 3) return CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE;
        if (level <= 7) return CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN;
        if (level <= 11) return CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW;
        if (level <= 17) return CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE;
        return CONFIG.CSS.HYPE_TRAIN_CLASSES.RED;
    }

    function cleanupHypeTrain(channelLink) {
        const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
        if (avatarContainer) {
            avatarContainer.classList.remove(...Object.values(CONFIG.CSS.HYPE_TRAIN_CLASSES));
            avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`)?.remove();
        }
        channelLink.querySelectorAll(`.${CONFIG.CSS_CLASSES.HIDDEN_ELEMENT}`).forEach(el => {
            el.classList.remove(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
        });
        channelLink.removeAttribute('data-hype-train-active');
    }
    
    function processHypeTrains() {
        if (!state.domElements.sidebar) return;
        state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(channelLink => {
            const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
            if (!avatarContainer) return;
            const giftSubIcon = channelLink.querySelector(CONFIG.SELECTORS.GIFT_SUB_TRAIN_ICON);
            const textEl = channelLink.querySelector(CONFIG.SELECTORS.TEXT_HYPE_TRAIN);
            if (!giftSubIcon && !textEl) {
                if (channelLink.hasAttribute('data-hype-train-active')) cleanupHypeTrain(channelLink);
                return;
            }
            channelLink.dataset.hypeTrainActive = 'true';
            avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.CONTAINER);
            if (giftSubIcon) {
                avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_SUB_EFFECT);
                giftSubIcon.parentElement?.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            } else {
                avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_SUB_EFFECT);
            }
            if (textEl) {
                let overlay = avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`);
                if (!overlay) {
                    overlay = document.createElement('span');
                    overlay.className = CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT;
                    avatarContainer.appendChild(overlay);
                }
                const levelMatch = textEl.title.match(/\d+/);
                const level = levelMatch ? parseInt(levelMatch[0], 10) : 1;
                overlay.textContent = level;
                avatarContainer.classList.add(getHypeTrainColorClass(level));
                const guestAvatar = channelLink.querySelector(CONFIG.SELECTORS.GUEST_AVATAR);
                if (guestAvatar) {
                    overlay.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.SHIFTED);
                } else {
                    overlay.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.SHIFTED);
                }
                textEl.parentElement?.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            } else {
                const textClasses = [CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE, CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN, CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW, CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE, CONFIG.CSS.HYPE_TRAIN_CLASSES.RED];
                avatarContainer.classList.remove(...textClasses);
                avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`)?.remove();
            }
        });
    }

    function processSquadStreams() {
        if (!state.domElements.sidebar) return;
        state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(channelLink => {
            const guestAvatar = channelLink.querySelector(CONFIG.SELECTORS.GUEST_AVATAR);
            if (guestAvatar && !guestAvatar.querySelector(`.${CONFIG.CSS.SQUAD_CLASSES.COUNT_TEXT}`)) {
                const squadIndicator = Array.from(channelLink.querySelectorAll('p')).find(p => p.textContent.trim().startsWith('+'));
                if (squadIndicator) {
                    const count = squadIndicator.textContent.match(/\d+/)?.[0];
                    if (count) {
                        squadIndicator.classList.add(CONFIG.CSS.SQUAD_CLASSES.INDICATOR_HIDDEN);
                        const countText = document.createElement('span');
                        countText.className = CONFIG.CSS.SQUAD_CLASSES.COUNT_TEXT;
                        countText.textContent = count;
                        guestAvatar.classList.add(CONFIG.CSS.SQUAD_CLASSES.COUNT_CONTAINER);
                        guestAvatar.appendChild(countText);
                    }
                }
            }
        });
    }

    // --- API & INITIALIZATION LOGIC ---

    async function expandFollowedChannels() {
        return new Promise(resolve => {
            const checkAndClick = () => {
                const showMoreButton = state.domElements.sidebar?.querySelector(CONFIG.SELECTORS.SHOW_MORE_BUTTON);
                if (!showMoreButton || showMoreButton.offsetParent === null) return resolve();
                const followedChannels = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.FOLLOWED_CHANNEL_LINK_ITEM);
                if (followedChannels.length > 0 && !isChannelElementLive(followedChannels[followedChannels.length - 1])) {
                    return resolve();
                }
                const observer = new MutationObserver(() => {
                    observer.disconnect();
                    requestIdleCallback(checkAndClick);
                });
                observer.observe(state.domElements.sidebar, { childList: true, subtree: true });
                showMoreButton.click();
            };
            checkAndClick();
        });
    }

    async function initialScanForChannels() {
        if (!state.domElements.sidebar) return;
        const channelsForApiUpdate = new Map();
        state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(el => {
            const channelLogin = el.href?.split('/').pop()?.toLowerCase();
            if (channelLogin && TWITCH_LOGIN_REGEX.test(channelLogin) && isChannelElementLive(el)) {
                channelsForApiUpdate.set(channelLogin, el);
            }
        });
        if (channelsForApiUpdate.size > 0) await executeBatchApiUpdate(channelsForApiUpdate);
    }
    
    async function executeBatchApiUpdate(channelsMap) {
        if (channelsMap.size === 0) return;
        const logins = Array.from(channelsMap.keys());
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_UPTIMES_FOR_CHANNELS', logins });
            if (response?.success) {
                const uptimeData = new Map(response.data);
                for (const [login, element] of channelsMap) {
                    const startedAtString = uptimeData.get(login.toLowerCase());
                    if (document.body.contains(element)) {
                        renderLiveState(element, login, startedAtString);
                        if (startedAtString) state.domCache.set(login, { startedAt: startedAtString });
                    }
                }
            }
        } catch (error) { console.error('[API] Erreur de communication:', error.message); }
    }

    function processNewChannelElement(el) {
        if (state.liveChannelElements.has(el)) return;
        const channelLogin = el.href?.split('/').pop()?.toLowerCase();
        if (channelLogin && TWITCH_LOGIN_REGEX.test(channelLogin) && isChannelElementLive(el)) {
            const cachedData = state.domCache.get(channelLogin);
            if (cachedData) {
                renderLiveState(el, channelLogin, cachedData.startedAt);
            } else {
                const channelsForApiUpdate = new Map([[channelLogin, el]]);
                executeBatchApiUpdate(channelsForApiUpdate);
            }
        }
    }

    function setupSidebarObserver() {
        if (state.observers.sidebarObserver) state.observers.sidebarObserver.disconnect();
        
        const callback = (mutations) => {
            throttledProcessUI();
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        if (node.matches(CONFIG.SELECTORS.CHANNEL_LINK_ITEM)) {
                            processNewChannelElement(node);
                        }
                        node.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(processNewChannelElement);
                    });
                    mutation.removedNodes.forEach(node => {
                         if (node.nodeType !== Node.ELEMENT_NODE) return;
                        if (node.matches(CONFIG.SELECTORS.CHANNEL_LINK_ITEM)) {
                            cleanupChannelDisplay(node);
                        }
                        node.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(cleanupChannelDisplay);
                    });
                }
            }
        };
        
        state.observers.sidebarObserver = new MutationObserver(callback);
        state.observers.sidebarObserver.observe(state.domElements.sidebar, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'aria-label']
        });
    }

    async function initializeMainFunctionality() {
        if (state.isInitialized) return;
        const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY);
        if (!sidebar) { console.error("[Cowlor's Sidebar] CRITICAL: Sidebar not found."); return; }

        state.isInitialized = true;
        state.domElements.sidebar = sidebar;
        
        injectCss();
        setupUptimeObserver();
        
        await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.INITIAL_SETTLE_DELAY));
        
        await expandFollowedChannels();
        await initialScanForChannels();
        
        setupSidebarObserver();
        throttledProcessUI();
    }

    // --- LIFECYCLE & EVENT LISTENERS ---

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state.animationFrameId) {
            cancelAnimationFrame(state.animationFrameId);
            state.animationFrameId = null;
        } else if (!document.hidden && state.animationFrameId === null) {
            updateVisibleCountersLoop();
        }
    });

    async function init() {
        try {
            const initialStatus = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
            if (initialStatus?.isLoggedIn) {
                if (document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY)) {
                    initializeMainFunctionality();
                }
                const mainObserver = new MutationObserver(() => {
                    if (document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY) && !state.isInitialized) {
                        initializeMainFunctionality();
                    }
                });
                mainObserver.observe(document.body, { childList: true, subtree: true });
            }
        } catch (error) {
            console.error('[Auth] Could not get auth status. Retrying.', error.message);
            setTimeout(init, 2000);
        }
    }
    
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
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
    };
    
    const TWITCH_LOGIN_REGEX = /^[a-zA-Z0-9_]{3,25}$/;

    const CONFIG = {
        SELECTORS: {
            SIDEBAR_PRIMARY: 'div[data-test-selector="side-nav"]',
            CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"], a[data-test-selector="recommended-channel"], a[data-test-selector="similarity-channel"], a.side-nav-card__link--promoted-followed',
            FOLLOWED_CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"]',
            LIVE_INDICATOR: '.tw-channel-status-indicator',
            AVATAR_CONTAINER: '.tw-avatar',
            TEXT_HYPE_TRAIN: `p[title*="${i18n.hypeTrainTitle}"], p[title*="${i18n.sharedHypeTrainTitle}"], p[title*="${i18n.treasureTrainTitle}"], p[title*="${i18n.kappaTrainTitle}"]`,
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
                GIFT_SUB_EFFECT: 'ht-gift-sub-effect',
                KAPPA_CROWN: 'ht-kappa-crown'
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
            CUSTOM_UPTIME_COUNTER: 'cowlor-uptime-counter',
            NEW_STREAM_FLASH: 'new-stream-flash'
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
                const channelElement = uptimeDisplay.closest(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
                if (channelElement) {
                    if (uptimeSeconds < 660) {
                        channelElement.classList.add(CONFIG.CSS_CLASSES.NEW_STREAM_FLASH);
                    } else {
                        channelElement.classList.remove(CONFIG.CSS_CLASSES.NEW_STREAM_FLASH);
                    }
                }
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
        channelElement.classList.remove(CONFIG.CSS_CLASSES.NEW_STREAM_FLASH);
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
        channelLink.removeAttribute('data-hype-train-type');
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

            // Determine train type
            let trainType = 'classic';
            let isKappaTrain = false;
            let isTreasureTrain = false;
            
            if (textEl && textEl.title) {
                if (textEl.title.includes(i18n.kappaTrainTitle)) {
                    trainType = 'kappa';
                    isKappaTrain = true;
                } else if (textEl.title.includes(i18n.treasureTrainTitle)) {
                    trainType = 'treasure';
                    isTreasureTrain = true;
                }
            }
            
            channelLink.dataset.hypeTrainType = trainType;

            // Handle Gift Sub effect
            if (giftSubIcon) {
                avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_SUB_EFFECT);
                giftSubIcon.parentElement?.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            } else {
                avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.GIFT_SUB_EFFECT);
            }

            // Handle text-based hype trains
            if (textEl) {
                let overlay = avatarContainer.querySelector(`.${CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT}`);
                if (!overlay) {
                    overlay = document.createElement('span');
                    overlay.className = CONFIG.CSS.HYPE_TRAIN_CLASSES.LEVEL_TEXT;
                    avatarContainer.appendChild(overlay);
                }
                
                // Extract level from title
                const levelMatch = textEl.title.match(/\d+/);
                const level = levelMatch ? parseInt(levelMatch[0], 10) : 1;
                
                // Apply appropriate styling based on train type
                if (isKappaTrain) {
                    overlay.textContent = '';
                    overlay.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.KAPPA_CROWN);
                    avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD);
                    // Remove color classes for Kappa train
                    avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.RED);
                    avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT);
                } else {
                    overlay.textContent = level;
                    overlay.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.KAPPA_CROWN);
                    avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD);
                    
                    // Apply color class based on level
                    const colorClass = getHypeTrainColorClass(level);
                    avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE, 
                                                    CONFIG.CSS.HYPE_TRAIN_CLASSES.RED);
                    avatarContainer.classList.add(colorClass);
                    
                    // Apply treasure effect if it's a treasure train
                    if (isTreasureTrain) {
                        avatarContainer.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT);
                    } else {
                        avatarContainer.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT);
                    }
                }
                
                // Handle shifted positioning for squad streams
                const guestAvatar = channelLink.querySelector(CONFIG.SELECTORS.GUEST_AVATAR);
                if (guestAvatar) {
                    overlay.classList.add(CONFIG.CSS.HYPE_TRAIN_CLASSES.SHIFTED);
                } else {
                    overlay.classList.remove(CONFIG.CSS.HYPE_TRAIN_CLASSES.SHIFTED);
                }
                
                textEl.parentElement?.classList.add(CONFIG.CSS_CLASSES.HIDDEN_ELEMENT);
            } else {
                // No text element, remove all train-specific classes
                const textClasses = [CONFIG.CSS.HYPE_TRAIN_CLASSES.BLUE, 
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.GREEN, 
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.YELLOW, 
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.ORANGE, 
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.RED,
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.GOLD,
                                   CONFIG.CSS.HYPE_TRAIN_CLASSES.TREASURE_EFFECT];
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
    
    function scanForUnprocessedChannels() {
        if (!state.domElements.sidebar) return;
        const channelsToUpdate = new Map();
        state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(el => {
            if (isChannelElementLive(el) && !state.liveChannelElements.has(el)) {
                const channelLogin = el.href?.split('/').pop()?.toLowerCase();
                if (channelLogin && TWITCH_LOGIN_REGEX.test(channelLogin)) {
                    channelsToUpdate.set(channelLogin, el);
                }
            }
        });

        if (channelsToUpdate.size > 0) {
            console.log(`[Cowlor's Sidebar] Found ${channelsToUpdate.size} unprocessed live channel(s). Fetching uptime...`);
            executeBatchApiUpdate(channelsToUpdate);
        }
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
        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                console.log("Context invalidated during API call. This is expected during navigation.");
            } else {
                console.error('[API] Erreur de communication:', error.message);
            }
        }
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
        
        setupUptimeObserver();
        
        await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.INITIAL_SETTLE_DELAY));
        
        await expandFollowedChannels();
        await initialScanForChannels();
        
        setupSidebarObserver();
        throttledProcessUI();
    }

    // --- LIFECYCLE & EVENT LISTENERS ---
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (state.animationFrameId) {
                cancelAnimationFrame(state.animationFrameId);
                state.animationFrameId = null;
            }
        } else {
            // When the tab becomes visible
            if (null === state.animationFrameId) {
                updateVisibleCountersLoop(); // Restart the animation frame for uptime updates
            }

            if (state.domElements.sidebar) {
                const channelsToProcess = new Map();
                state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM).forEach(el => {
                    const login = el.href?.split("/").pop()?.toLowerCase();
                    // Check if it's a live channel and if it's already in our liveChannelElements map
                    // Also check if it's a valid login format
                    if (login && TWITCH_LOGIN_REGEX.test(login) && isChannelElementLive(el)) {
                        // If the element is not in liveChannelElements, or if its
                        // associated uptime element is missing (e.g., due to a Twitch DOM re-render)
                        const existingEntry = state.liveChannelElements.get(el);
                        const uptimeElement = el.querySelector("." + CONFIG.CSS_CLASSES.CUSTOM_UPTIME_COUNTER);

                        if (!existingEntry || !uptimeElement) {
                            // If we have it in domCache, use that data to re-render uptime immediately
                            const cachedData = state.domCache.get(login);
                            if (cachedData) {
                                renderLiveState(el, login, cachedData.startedAt); // Re-create/update the uptime counter
                            } else {
                                // Otherwise, add it to the list to fetch via API
                                channelsToProcess.set(login, el);
                            }
                        }
                    }
                });

                if (channelsToProcess.size > 0) {
                    console.log(`[Cowlor's Sidebar] Found ${channelsToProcess.size} unprocessed live channel(s) after visibility change. Fetching uptime...`);
                    executeBatchApiUpdate(channelsToProcess);
                }
            }
        }
    });

    async function init() {
        try {
            const initialStatus = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
            if (!initialStatus?.isLoggedIn) return;

            const mainObserver = new MutationObserver(() => {
                const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_PRIMARY);
                if (sidebar && !state.isInitialized) {
                    console.log("[Cowlor's Sidebar] Sidebar detected. Initializing...");
                    initializeMainFunctionality();
                } 
                else if (state.isInitialized && !document.body.contains(state.domElements.sidebar)) {
                    console.log("[Cowlor's Sidebar] Sidebar removed. Resetting state...");
                    if (state.observers.sidebarObserver) state.observers.sidebarObserver.disconnect();
                    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
                    
                    state.isInitialized = false;
                    state.domElements.sidebar = null;
                    state.liveChannelElements = new WeakMap(); // Clear the map when the sidebar is removed
                    state.visibleUptimeElements.clear();
                    // Optionally, clear domCache here if you want to refetch everything on next initialization
                    // state.domCache.clear();
                }
            });

            mainObserver.observe(document.body, { childList: true, subtree: true });

        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                console.log("Context invalidated during initial auth check. This is expected during navigation.");
            } else {
                console.error('[Auth] Could not get auth status. Retrying.', error.message);
                setTimeout(init, 2000);
            }
        }
    }
    
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
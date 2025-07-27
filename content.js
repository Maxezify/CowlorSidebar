// content.js - Version optimisée DOM, sélecteurs et chaînes
(function() {
    'use strict';

    console.log("--- Cowlor's Sidebar Extension Initializing (v.Final Ultra-Optimized) ---");

    // --- UTILITIES ---
    const throttle = (func, limit) => {
        let inThrottle;
        let lastArgs;
        let lastContext;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastArgs) {
                        func.apply(lastContext, lastArgs);
                        lastArgs = null;
                        lastContext = null;
                    }
                }, limit);
            } else {
                lastArgs = args;
                lastContext = context;
            }
        };
    };

    class LRUCache {
        constructor(maxSize = 150) {
            this.cache = new Map();
            this.maxSize = maxSize;
            this.cleanupCounter = 0;
        }
        
        set(key, value) {
            this.cache.delete(key);
            this.cache.set(key, {
                ...value,
                timestamp: Date.now()
            });
            
            if (this.cache.size > this.maxSize) {
                const toDelete = Math.floor(this.maxSize * 0.2);
                let deleted = 0;
                for (const [k, v] of this.cache) {
                    this.cache.delete(k);
                    deleted++;
                    if (deleted >= toDelete) break;
                }
            }
            
            this.cleanupCounter++;
            if (this.cleanupCounter >= 100) {
                this.cleanupCounter = 0;
                this.cleanup();
            }
        }
        
        get(key) {
            const value = this.cache.get(key);
            if (value) {
                if (Date.now() - value.timestamp > 30 * 60 * 1000) {
                    this.cache.delete(key);
                    return null;
                }
                this.cache.delete(key);
                this.cache.set(key, value);
                return value;
            }
            return value;
        }
        
        cleanup() {
            const now = Date.now();
            const maxAge = 30 * 60 * 1000;
            
            for (const [key, value] of this.cache) {
                if (now - value.timestamp > maxAge) {
                    this.cache.delete(key);
                }
            }
        }
        
        clear() {
            this.cache.clear();
            this.cleanupCounter = 0;
        }
    }

    // --- OPTIMISATION: Cache des messages i18n ---
    const i18nCache = {};
    const getI18nMessage = (key) => {
        if (!i18nCache[key]) {
            i18nCache[key] = chrome.i18n.getMessage(key);
        }
        return i18nCache[key];
    };

    // --- CONFIGURATION ---
    const i18n = {
        hypeTrainTitle: getI18nMessage('selectorHypeTrainTitle'),
        sharedHypeTrainTitle: getI18nMessage('selectorSharedHypeTrainTitle'),
        treasureTrainTitle: getI18nMessage('selectorTreasureTrainTitle'),
        kappaTrainTitle: getI18nMessage('selectorKappaTrainTitle'),
        giftSubTrainTitle: getI18nMessage('selectorGiftSubHypeTrainTitle'),
    };
    
    const TWITCH_LOGIN_REGEX = /^[a-zA-Z0-9_]{3,25}$/;

    // --- OPTIMISATION: Classes CSS en constantes ---
    const CSS_CLASSES = {
        // Classes simples pour sélecteurs optimisés
        SIDEBAR: 'side-nav',
        CHANNEL_ITEM: 'side-nav-card__link',
        LIVE_INDICATOR: 'tw-channel-status-indicator',
        AVATAR: 'tw-avatar',
        HIDDEN: 'tch-ext-hidden',
        UPTIME_COUNTER: 'cowlor-uptime-counter',
        NEW_STREAM: 'new-stream-flash',
        LIVE_STATUS: 'side-nav-card__live-status',
        META: 'side-nav-card__meta',
        GUEST_AVATAR: 'primary-with-small-avatar__mini-avatar',
        // Hype train classes
        HT_CONTAINER: 'hype-train-container',
        HT_LEVEL_TEXT: 'hype-train-level-text',
        HT_SHIFTED: 'ht-shifted',
        HT_BLUE: 'ht-blue',
        HT_GREEN: 'ht-green',
        HT_YELLOW: 'ht-yellow',
        HT_ORANGE: 'ht-orange',
        HT_RED: 'ht-red',
        HT_GOLD: 'ht-gold',
        HT_TREASURE: 'ht-treasure-effect',
        HT_GIFT_SUB: 'ht-gift-sub-effect',
        HT_KAPPA_CROWN: 'ht-kappa-crown',
        // Squad classes
        SQUAD_HIDDEN: 'squad-indicator-hidden',
        SQUAD_CONTAINER: 'squad-count-container',
        SQUAD_TEXT: 'squad-count-text'
    };

    const CONFIG = {
        SELECTORS: {
            // OPTIMISATION: Sélecteurs simplifiés
            SIDEBAR_PRIMARY: `div[data-test-selector="${CSS_CLASSES.SIDEBAR}"]`,
            CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"], a[data-test-selector="recommended-channel"], a[data-test-selector="similarity-channel"], a.side-nav-card__link--promoted-followed',
            FOLLOWED_CHANNEL_LINK_ITEM: 'a[data-test-selector="followed-channel"]',
            LIVE_INDICATOR: `.${CSS_CLASSES.LIVE_INDICATOR}`,
            AVATAR_CONTAINER: `.${CSS_CLASSES.AVATAR}`,
            TEXT_HYPE_TRAIN: `p[title*="${i18n.hypeTrainTitle}"], p[title*="${i18n.sharedHypeTrainTitle}"], p[title*="${i18n.treasureTrainTitle}"], p[title*="${i18n.kappaTrainTitle}"]`,
            GIFT_SUB_TRAIN_ICON: `div[aria-label*="${i18n.giftSubTrainTitle}"]`,
            SHOW_MORE_BUTTON: 'button[data-test-selector="ShowMore"], a[data-test-selector="ShowMore"]',
            GUEST_AVATAR: `.${CSS_CLASSES.GUEST_AVATAR}`,
        },
        TIMINGS_MS: {
            INITIAL_SETTLE_DELAY: 1500,
            PROCESS_THROTTLE: 200,
            CLEANUP_INTERVAL: 300000,
            API_BATCH_DELAY: 100
        },
        UPTIME_COUNTER_STYLE: {
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            fontSize: '1.4rem',
            textAlign: 'right', 
            lineHeight: '1.4',
            marginTop: '-4px'
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
        visibleUptimeElements: new Set(),
        cleanupInterval: null,
        pendingBatch: new Map(),
        batchTimer: null,
        animationsEnabled: !document.hidden, // OPTIMISATION: Désactive les animations si caché
        documentFragment: null // OPTIMISATION: Fragment réutilisable
    };

    // --- CLEANUP FUNCTIONS ---
    function schedulePeriodicCleanup() {
        if (state.cleanupInterval) return;
        
        state.cleanupInterval = setInterval(() => {
            state.domCache.cleanup();
            
            const toRemove = [];
            for (const element of state.visibleUptimeElements) {
                if (!element.isConnected) {
                    toRemove.push(element);
                }
            }
            toRemove.forEach(el => state.visibleUptimeElements.delete(el));
            
            if (window.gc) {
                window.gc();
            }
        }, CONFIG.TIMINGS_MS.CLEANUP_INTERVAL);
    }

    // --- CORE FUNCTIONS ---
    // OPTIMISATION: Template string réutilisable
    const uptimeTemplate = {
        hours: '',
        minutes: ''
    };
    
    const formatUptime = (totalSeconds) => {
        if (totalSeconds === null || isNaN(totalSeconds)) return '...';
        uptimeTemplate.hours = Math.floor(totalSeconds / 3600);
        uptimeTemplate.minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        return `${uptimeTemplate.hours}h ${uptimeTemplate.minutes}m`;
    };

    const isChannelElementLive = (el) => el?.querySelector(CONFIG.SELECTORS.LIVE_INDICATOR) !== null;

    // --- OPTIMIZED UPTIME COUNTER LOGIC ---
    let lastFrameTime = 0;
    const FRAME_BUDGET = 16;
    
    function updateVisibleCountersLoop(currentTime) {
        if (state.visibleUptimeElements.size === 0 || document.hidden || !state.animationsEnabled) {
            state.animationFrameId = null;
            return;
        }
        
        const deltaTime = currentTime - lastFrameTime;
        if (deltaTime < FRAME_BUDGET) {
            state.animationFrameId = requestAnimationFrame(updateVisibleCountersLoop);
            return;
        }
        
        lastFrameTime = currentTime;
        
        let processed = 0;
        const maxToProcess = Math.min(state.visibleUptimeElements.size, 50);
        const now = Date.now();
        
        for (const uptimeDisplay of state.visibleUptimeElements) {
            if (processed >= maxToProcess) break;
            
            const startedAt = uptimeDisplay._startedAtCache || (uptimeDisplay._startedAtCache = new Date(uptimeDisplay.dataset.startedAt).getTime());
            if (!isNaN(startedAt)) {
                const uptimeSeconds = (now - startedAt) / 1000;
                uptimeDisplay.textContent = formatUptime(uptimeSeconds);
                
                // OPTIMISATION: Cache le channelElement
                const channelElement = uptimeDisplay._channelElement || (uptimeDisplay._channelElement = uptimeDisplay.closest(CONFIG.SELECTORS.CHANNEL_LINK_ITEM));
                if (channelElement) {
                    if (uptimeSeconds < 660) {
                        channelElement.classList.add(CSS_CLASSES.NEW_STREAM);
                    } else {
                        channelElement.classList.remove(CSS_CLASSES.NEW_STREAM);
                    }
                }
            }
            processed++;
        }
        
        state.animationFrameId = requestAnimationFrame(updateVisibleCountersLoop);
    }

    function setupUptimeObserver() {
        if (state.observers.uptimeObserver) state.observers.uptimeObserver.disconnect();
        
        state.observers.uptimeObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    state.visibleUptimeElements.add(entry.target);
                    if (state.animationFrameId === null && state.animationsEnabled) {
                        state.animationFrameId = requestAnimationFrame(updateVisibleCountersLoop);
                    }
                } else {
                    state.visibleUptimeElements.delete(entry.target);
                    // OPTIMISATION: Nettoie le cache
                    delete entry.target._startedAtCache;
                    delete entry.target._channelElement;
                }
            });
        }, { 
            root: state.domElements.sidebar, 
            threshold: 0.1,
            rootMargin: '50px'
        });
    }

    function cleanupChannelDisplay(channelElement) {
        const uptimeDisplay = channelElement.querySelector(`.${CSS_CLASSES.UPTIME_COUNTER}`);
        if (uptimeDisplay) {
            state.observers.uptimeObserver?.unobserve(uptimeDisplay);
            state.visibleUptimeElements.delete(uptimeDisplay);
            delete uptimeDisplay._startedAtCache;
            delete uptimeDisplay._channelElement;
            uptimeDisplay.remove();
        }
        channelElement.classList.remove(CSS_CLASSES.NEW_STREAM);
        state.liveChannelElements.delete(channelElement);
    }
    
    function renderLiveState(channelElement, channelLogin, startedAtString) {
        let uptimeDisplay = channelElement.querySelector(`.${CSS_CLASSES.UPTIME_COUNTER}`);
        const insertionPoint = channelElement.querySelector(`.${CSS_CLASSES.LIVE_STATUS}`) || 
                             channelElement.querySelector(`.${CSS_CLASSES.META}`);
        
        if (!uptimeDisplay) {
            if (insertionPoint) {
                // OPTIMISATION: Modification DOM groupée
                Object.assign(insertionPoint.style, { 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'flex-end' 
                });
            }
            uptimeDisplay = document.createElement('div');
            uptimeDisplay.className = `${CSS_CLASSES.UPTIME_COUNTER} tw-c-text-alt-2`;
            Object.assign(uptimeDisplay.style, CONFIG.UPTIME_COUNTER_STYLE);
            insertionPoint?.appendChild(uptimeDisplay);
            state.observers.uptimeObserver?.observe(uptimeDisplay);
        }
        uptimeDisplay.dataset.startedAt = startedAtString;
        state.liveChannelElements.set(channelElement, { login: channelLogin, startedAt: startedAtString });
    }

    // --- HYPE TRAIN & SQUAD LOGIC ---
    const throttledProcessUI = throttle(() => {
        if (state.animationsEnabled) {
            processHypeTrains();
            processSquadStreams();
        }
    }, CONFIG.TIMINGS_MS.PROCESS_THROTTLE);

    // OPTIMISATION: Lookup table pour les couleurs
    const HYPE_TRAIN_COLOR_MAP = {
        1: CSS_CLASSES.HT_BLUE, 2: CSS_CLASSES.HT_BLUE, 3: CSS_CLASSES.HT_BLUE,
        4: CSS_CLASSES.HT_GREEN, 5: CSS_CLASSES.HT_GREEN, 6: CSS_CLASSES.HT_GREEN, 7: CSS_CLASSES.HT_GREEN,
        8: CSS_CLASSES.HT_YELLOW, 9: CSS_CLASSES.HT_YELLOW, 10: CSS_CLASSES.HT_YELLOW, 11: CSS_CLASSES.HT_YELLOW,
        12: CSS_CLASSES.HT_ORANGE, 13: CSS_CLASSES.HT_ORANGE, 14: CSS_CLASSES.HT_ORANGE, 
        15: CSS_CLASSES.HT_ORANGE, 16: CSS_CLASSES.HT_ORANGE, 17: CSS_CLASSES.HT_ORANGE
    };

    const getHypeTrainColorClass = (level) => HYPE_TRAIN_COLOR_MAP[level] || CSS_CLASSES.HT_RED;

    // OPTIMISATION: Array constant pour les classes à retirer
    const HYPE_TRAIN_COLOR_CLASSES = [
        CSS_CLASSES.HT_BLUE, CSS_CLASSES.HT_GREEN, CSS_CLASSES.HT_YELLOW,
        CSS_CLASSES.HT_ORANGE, CSS_CLASSES.HT_RED, CSS_CLASSES.HT_GOLD,
        CSS_CLASSES.HT_TREASURE
    ];

    function cleanupHypeTrain(channelLink) {
        const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
        if (avatarContainer) {
            // OPTIMISATION: Une seule opération classList
            avatarContainer.classList.remove(...HYPE_TRAIN_COLOR_CLASSES, CSS_CLASSES.HT_CONTAINER, CSS_CLASSES.HT_GIFT_SUB);
            const levelText = avatarContainer.querySelector(`.${CSS_CLASSES.HT_LEVEL_TEXT}`);
            if (levelText) levelText.remove();
        }
        const hiddenElements = channelLink.querySelectorAll(`.${CSS_CLASSES.HIDDEN}`);
        hiddenElements.forEach(el => el.classList.remove(CSS_CLASSES.HIDDEN));
        
        channelLink.removeAttribute('data-hype-train-active');
        channelLink.removeAttribute('data-hype-train-type');
    }
    
    function processHypeTrains() {
        if (!state.domElements.sidebar) return;
        
        const channelLinks = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
        
        let processed = 0;
        const maxToProcess = 100;
        
        for (const channelLink of channelLinks) {
            if (processed >= maxToProcess) break;
            
            const avatarContainer = channelLink.querySelector(CONFIG.SELECTORS.AVATAR_CONTAINER);
            if (!avatarContainer) continue;
            
            const giftSubIcon = channelLink.querySelector(CONFIG.SELECTORS.GIFT_SUB_TRAIN_ICON);
            const textEl = channelLink.querySelector(CONFIG.SELECTORS.TEXT_HYPE_TRAIN);

            if (!giftSubIcon && !textEl) {
                if (channelLink.hasAttribute('data-hype-train-active')) cleanupHypeTrain(channelLink);
                continue;
            }

            channelLink.dataset.hypeTrainActive = 'true';
            avatarContainer.classList.add(CSS_CLASSES.HT_CONTAINER);

            let trainType = 'classic';
            let isKappaTrain = false;
            let isTreasureTrain = false;
            
            if (textEl?.title) {
                if (textEl.title.includes(i18n.kappaTrainTitle)) {
                    trainType = 'kappa';
                    isKappaTrain = true;
                } else if (textEl.title.includes(i18n.treasureTrainTitle)) {
                    trainType = 'treasure';
                    isTreasureTrain = true;
                }
            }
            
            channelLink.dataset.hypeTrainType = trainType;

            if (giftSubIcon) {
                avatarContainer.classList.add(CSS_CLASSES.HT_GIFT_SUB);
                giftSubIcon.parentElement?.classList.add(CSS_CLASSES.HIDDEN);
            } else {
                avatarContainer.classList.remove(CSS_CLASSES.HT_GIFT_SUB);
            }

            if (textEl) {
                let overlay = avatarContainer.querySelector(`.${CSS_CLASSES.HT_LEVEL_TEXT}`);
                if (!overlay) {
                    overlay = document.createElement('span');
                    overlay.className = CSS_CLASSES.HT_LEVEL_TEXT;
                    avatarContainer.appendChild(overlay);
                }
                
                const levelMatch = textEl.title.match(/\d+/);
                const level = levelMatch ? parseInt(levelMatch[0], 10) : 1;
                
                if (isKappaTrain) {
                    overlay.textContent = '';
                    overlay.classList.add(CSS_CLASSES.HT_KAPPA_CROWN);
                    // OPTIMISATION: Une seule opération de classes
                    avatarContainer.classList.remove(...HYPE_TRAIN_COLOR_CLASSES);
                    avatarContainer.classList.add(CSS_CLASSES.HT_GOLD);
                } else {
                    overlay.textContent = level;
                    overlay.classList.remove(CSS_CLASSES.HT_KAPPA_CROWN);
                    
                    const colorClass = getHypeTrainColorClass(level);
                    avatarContainer.classList.remove(...HYPE_TRAIN_COLOR_CLASSES);
                    avatarContainer.classList.add(colorClass);
                    
                    if (isTreasureTrain) {
                        avatarContainer.classList.add(CSS_CLASSES.HT_TREASURE);
                    }
                }
                
                const guestAvatar = channelLink.querySelector(CONFIG.SELECTORS.GUEST_AVATAR);
                overlay.classList.toggle(CSS_CLASSES.HT_SHIFTED, !!guestAvatar);
                
                textEl.parentElement?.classList.add(CSS_CLASSES.HIDDEN);
            } else {
                avatarContainer.classList.remove(...HYPE_TRAIN_COLOR_CLASSES);
                avatarContainer.querySelector(`.${CSS_CLASSES.HT_LEVEL_TEXT}`)?.remove();
            }
            
            processed++;
        }
    }

    function processSquadStreams() {
        if (!state.domElements.sidebar) return;
        
        const channelLinks = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
        let processed = 0;
        const maxToProcess = 100;
        
        for (const channelLink of channelLinks) {
            if (processed >= maxToProcess) break;
            
            const guestAvatar = channelLink.querySelector(CONFIG.SELECTORS.GUEST_AVATAR);
            if (guestAvatar && !guestAvatar.querySelector(`.${CSS_CLASSES.SQUAD_TEXT}`)) {
                const squadIndicator = Array.from(channelLink.querySelectorAll('p')).find(p => p.textContent.trim().startsWith('+'));
                if (squadIndicator) {
                    const count = squadIndicator.textContent.match(/\d+/)?.[0];
                    if (count) {
                        squadIndicator.classList.add(CSS_CLASSES.SQUAD_HIDDEN);
                        const countText = document.createElement('span');
                        countText.className = CSS_CLASSES.SQUAD_TEXT;
                        countText.textContent = count;
                        guestAvatar.classList.add(CSS_CLASSES.SQUAD_CONTAINER);
                        guestAvatar.appendChild(countText);
                    }
                }
            }
            processed++;
        }
    }

    // --- OPTIMIZED API BATCH LOGIC ---
    function processBatch() {
        if (state.pendingBatch.size === 0) {
            state.batchTimer = null;
            return;
        }
        
        const batch = new Map(state.pendingBatch);
        state.pendingBatch.clear();
        state.batchTimer = null;
        
        executeBatchApiUpdate(batch);
    }

    function addToBatch(channelLogin, element) {
        state.pendingBatch.set(channelLogin, element);
        
        if (!state.batchTimer) {
            state.batchTimer = setTimeout(processBatch, CONFIG.TIMINGS_MS.API_BATCH_DELAY);
        }
        
        if (state.pendingBatch.size >= 50) {
            clearTimeout(state.batchTimer);
            processBatch();
        }
    }

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
        const channelLinks = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
        
        for (const el of channelLinks) {
            const channelLogin = el.href?.split('/').pop()?.toLowerCase();
            if (channelLogin && TWITCH_LOGIN_REGEX.test(channelLogin) && isChannelElementLive(el)) {
                channelsForApiUpdate.set(channelLogin, el);
            }
        }
        
        if (channelsForApiUpdate.size > 0) await executeBatchApiUpdate(channelsForApiUpdate);
    }
    
    function scanForUnprocessedChannels() {
        if (!state.domElements.sidebar) return;
        const channelsToUpdate = new Map();
        const channelLinks = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
        
        for (const el of channelLinks) {
            if (isChannelElementLive(el) && !state.liveChannelElements.has(el)) {
                const channelLogin = el.href?.split('/').pop()?.toLowerCase();
                if (channelLogin && TWITCH_LOGIN_REGEX.test(channelLogin)) {
                    channelsToUpdate.set(channelLogin, el);
                }
            }
        }

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
                // OPTIMISATION: Utilisation d'un DocumentFragment
                const fragment = state.documentFragment || (state.documentFragment = document.createDocumentFragment());
                
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
                addToBatch(channelLogin, el);
            }
        }
    }

    function setupSidebarObserver() {
        if (state.observers.sidebarObserver) state.observers.sidebarObserver.disconnect();
        
        let mutationBuffer = [];
        let processTimer = null;
        
        const processMutations = () => {
            processTimer = null;
            if (mutationBuffer.length === 0) return;
            
            const mutations = mutationBuffer.splice(0, 100);
            
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
            
            if (mutationBuffer.length > 0) {
                processTimer = setTimeout(processMutations, 50);
            }
        };
        
        const callback = (mutations) => {
            mutationBuffer.push(...mutations);
            
            if (mutationBuffer.length > 500) {
                mutationBuffer = mutationBuffer.slice(-250);
            }
            
            if (!processTimer) {
                processTimer = setTimeout(processMutations, 50);
            }
            
            throttledProcessUI();
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
        schedulePeriodicCleanup();
        
        await new Promise(res => setTimeout(res, CONFIG.TIMINGS_MS.INITIAL_SETTLE_DELAY));
        
        await expandFollowedChannels();
        await initialScanForChannels();
        
        setupSidebarObserver();
        throttledProcessUI();
    }

    // --- LIFECYCLE & EVENT LISTENERS ---
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // OPTIMISATION: Désactive les animations quand caché
            state.animationsEnabled = false;
            if (state.animationFrameId) {
                cancelAnimationFrame(state.animationFrameId);
                state.animationFrameId = null;
            }
            // Nettoie un peu quand la page est cachée
            if (state.visibleUptimeElements.size > 100) {
                const toKeep = new Set();
                let kept = 0;
                for (const el of state.visibleUptimeElements) {
                    if (kept < 50 && el.isConnected) {
                        toKeep.add(el);
                        kept++;
                    }
                }
                state.visibleUptimeElements = toKeep;
            }
        } else {
            // OPTIMISATION: Réactive les animations
            state.animationsEnabled = true;
            if (state.animationFrameId === null && state.visibleUptimeElements.size > 0) {
                state.animationFrameId = requestAnimationFrame(updateVisibleCountersLoop);
            }

            if (state.domElements.sidebar) {
                const channelsToProcess = new Map();
                const channelLinks = state.domElements.sidebar.querySelectorAll(CONFIG.SELECTORS.CHANNEL_LINK_ITEM);
                
                for (const el of channelLinks) {
                    const login = el.href?.split("/").pop()?.toLowerCase();
                    if (login && TWITCH_LOGIN_REGEX.test(login) && isChannelElementLive(el)) {
                        const existingEntry = state.liveChannelElements.get(el);
                        const uptimeElement = el.querySelector(`.${CSS_CLASSES.UPTIME_COUNTER}`);

                        if (!existingEntry || !uptimeElement) {
                            const cachedData = state.domCache.get(login);
                            if (cachedData) {
                                renderLiveState(el, login, cachedData.startedAt);
                            } else {
                                channelsToProcess.set(login, el);
                            }
                        }
                    }
                }

                if (channelsToProcess.size > 0) {
                    console.log(`[Cowlor's Sidebar] Found ${channelsToProcess.size} unprocessed live channel(s) after visibility change. Fetching uptime...`);
                    executeBatchApiUpdate(channelsToProcess);
                }
            }
        }
    });

    // Cleanup lors du déchargement
    window.addEventListener('beforeunload', () => {
        if (state.cleanupInterval) {
            clearInterval(state.cleanupInterval);
        }
        if (state.batchTimer) {
            clearTimeout(state.batchTimer);
        }
        if (state.animationFrameId) {
            cancelAnimationFrame(state.animationFrameId);
        }
        state.observers.sidebarObserver?.disconnect();
        state.observers.mainObserver?.disconnect();
        state.observers.uptimeObserver?.disconnect();
        // OPTIMISATION: Nettoie les caches
        Object.keys(i18nCache).forEach(key => delete i18nCache[key]);
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
                    state.liveChannelElements = new WeakMap();
                    state.visibleUptimeElements.clear();
                    
                    // Nettoie le batch en attente
                    if (state.batchTimer) {
                        clearTimeout(state.batchTimer);
                        state.batchTimer = null;
                    }
                    state.pendingBatch.clear();
                }
            });

            mainObserver.observe(document.body, { childList: true, subtree: true });
            state.observers.mainObserver = mainObserver;

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
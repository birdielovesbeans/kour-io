// VANILLA SDK MANAGER v2.0 - Clean Implementation
(function(){
    // Safety check - don't run if CrazyGames or MSN is active
    if (window.sdkVersion === 'CrazyGames' || window.sdkVersion === 'MSN') {
        console.error('[sdkManager] Skipping initialization - using ' + window.sdkVersion + ' SDK instead');
        return;
    }
    
    // Debug logging
    const DEBUG_ADS = !!(window && window.__ADS_DEBUG__);
    const log = (...args) => console.log(...args);
    const warn = (...args) => console.warn(...args);
    const error = (...args) => console.error(...args);
    const dlog = (...args) => { if (DEBUG_ADS) console.log(...args); };

    // Configuration
    window.AUTO_REFRESH_BANNERS = false; // Ad networks (Nitro/AdinPlay) handle auto-refresh themselves
    const REFRESH_INTERVAL_MS = 30000; // 30 seconds minimum between refreshes (unused if AUTO_REFRESH_BANNERS = false)
    const REQUEST_DEBOUNCE_MS = 2000; // 2 seconds between requests to same slot

    // Provider priorities
    const banner_priorities = ["adinplay", "local"];
    const video_priorities = ["cpmstar", "adinplay"];

    // Global banner dimensions
    window.bannerDimensions = {
        0: { width: '300px', height: '250px' },
        1: { width: '728px', height: '90px' },
        2: { width: '300px', height: '600px' }
    };

    // Banner state tracking
    const bannerState = {};  // containerId -> { lastRequest, lastRefresh, inflightRequest, timeoutId }
    const lastAdModes = {};  // track last modes to avoid duplicate requests

    // Helper functions
    function inferBannerType(width, height) {
        const w = parseInt(width, 10);
        const h = parseInt(height, 10);
        if (w === 300 && h === 250) return 0;
        if (w === 728 && h === 90) return 1;
        if (w === 300 && h === 600) return 2;
        return null;
    }

    function typeToAdTagString(bannerType) {
        const mapping = { 0: '300x250', 1: '728x90', 2: '300x600' };
        return mapping[bannerType] || '';
    }

    // Load script helper
    function loadScript(src, attrs = {}) {
        return new Promise((resolve, reject) => {
            const existing = Array.from(document.getElementsByTagName('script'))
                .find(s => s.src.includes(src));
            if (existing) { 
                resolve(); 
                return; 
            }
            const s = document.createElement('script');
            s.src = src;
            s.async = attrs.async !== undefined ? attrs.async : true;
            for (const [k, v] of Object.entries(attrs)) {
                if (k !== 'async') s.setAttribute(k, String(v));
            }
            s.onload = () => resolve();
            s.onerror = (e) => reject(e);
            document.head.appendChild(s);
        });
    }

    // Provider loading
    const loadedProviders = {};
    async function ensureProviderLoaded(name) {
        if (loadedProviders[name]) return true;
        try {
            await loadScript(`ads/adapters/${name}-ads.js`);
            loadedProviders[name] = true;
            return true;
        } catch (e) {
            warn(`[sdkManager] Failed to load provider ${name}:`, e);
            return false;
        }
    }


    // Clean up container before rendering
    function cleanContainer(containerId, keepExisting = false) {
        const container = document.getElementById(containerId);
        if (!container) return null;

        // Ensure container has relative positioning for absolute children
        if (!container.style.position || container.style.position === 'static') {
            container.style.position = 'relative';
        }

        // Check if there are Nitro divs we should preserve
        const hasNitroDiv = container.querySelector && container.querySelector('[id^="nitro-kour-"]');
        
        // Clear the container (unless keepExisting for seamless refresh or we have Nitro divs)
        if (!keepExisting && !hasNitroDiv) {
            container.innerHTML = '';
        } else if (hasNitroDiv) {
            // Hide Nitro divs instead of destroying them
            const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
            nitroDivs.forEach(div => {
                div.style.display = 'none';
            });
        }
        
        // Ensure all children are absolutely positioned to prevent stacking
        Array.from(container.children).forEach(child => {
            if (!child.style.position || child.style.position === 'static') {
                child.style.position = 'absolute';
                child.style.top = '50%';
                child.style.left = '50%';
                child.style.transform = 'translate(-50%, -50%)';
            }
        });
        
        // Clean up any stray siblings in parent
        try {
            const parent = document.getElementById(`${containerId}-parent`);
            if (parent) {
                const children = Array.from(parent.children);
                for (const child of children) {
                    if (child.id !== containerId) {
                        parent.removeChild(child);
                    }
                }
            }
        } catch(e) {}
        
        return container;
    }
    
    // Seamless refresh: preload new ad, then swap
    async function seamlessRefresh(containerId, width, height) {
        log(`[sdkManager] Seamless refresh for ${containerId}`);
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Create a temporary hidden container for preloading
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.width = `${width}px`;
        tempContainer.style.height = `${height}px`;
        tempContainer.style.visibility = 'hidden';
        tempContainer.style.pointerEvents = 'none';
        tempContainer.id = `${containerId}-temp`;
        document.body.appendChild(tempContainer);
        
        try {
            // Try to load new ad into temp container
            const bannerType = inferBannerType(width, height);
            if (bannerType === null) return;
            
            let filled = false;
            for (const provider of banner_priorities) {
                const loaded = await ensureProviderLoaded(provider);
                if (!loaded) continue;
                
                const providerObj = window.bannerAdProviders?.[provider];
                if (!providerObj?.displayBanner) continue;
                
                const param = provider === 'adinplay' ? typeToAdTagString(bannerType) : bannerType;
                filled = await Promise.race([
                    providerObj.displayBanner(param, tempContainer),
                    new Promise(resolve => setTimeout(() => resolve(false), 8000))
                ]);
                
                if (filled) {
                    log(`[sdkManager] Preloaded new ad via ${provider}, swapping...`);
                    // Swap: move temp content to real container (preserve Nitro divs)
                    const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
                    if (nitroDivs.length > 0) {
                        // Hide Nitro divs instead of destroying
                        nitroDivs.forEach(div => div.style.display = 'none');
                        // Remove non-Nitro content
                        Array.from(container.children).forEach(child => {
                            if (!child.id.startsWith('nitro-kour-')) {
                                container.removeChild(child);
                            }
                        });
                    } else {
                        container.innerHTML = '';
                    }
                    while (tempContainer.firstChild) {
                        container.appendChild(tempContainer.firstChild);
                    }
                    break;
                }
            }
            
            if (!filled) {
                log(`[sdkManager] Seamless refresh failed, keeping existing ad`);
            }
        } finally {
            // Remove temp container
            if (tempContainer.parentNode) {
                tempContainer.parentNode.removeChild(tempContainer);
            }
        }
    }


    // Request banner ad
    async function requestBanner(containerId, width, height) {
        log(`[sdkManager] requestBanner(${containerId}, ${width}x${height})`);
        const state = bannerState[containerId] || {};
        const now = Date.now();

        // Debounce check
        if (state.lastRequest && (now - state.lastRequest) < REQUEST_DEBOUNCE_MS) {
            const waitTime = REQUEST_DEBOUNCE_MS - (now - state.lastRequest);
            log(`[sdkManager] Skipping ${containerId} - debounce (${waitTime}ms remaining)`);
            return;
        }

        // Inflight check
        if (state.inflightRequest) {
            log(`[sdkManager] Skipping ${containerId} - request already in flight`);
            return;
        }

        state.lastRequest = now;
        state.inflightRequest = true;
        bannerState[containerId] = state;

        try {
            // Check parent container
            const parentId = `${containerId}-parent`;
            const parent = document.getElementById(parentId);
            if (!parent) {
                warn(`[sdkManager] Parent container not found: ${parentId}`);
            } else {
                const parentVisible = parent.style.display !== 'none' && 
                                      window.getComputedStyle(parent).display !== 'none';
                log(`[sdkManager] Parent ${parentId}: visible=${parentVisible}, display=${parent.style.display}`);
            }

            const container = cleanContainer(containerId);
            if (!container) {
                warn(`[sdkManager] Container not found: ${containerId}`);
                return;
            }

            // Ensure parent is visible before checking dimensions (if hidden, temporarily show for layout)
            let parentWasHidden = false;
            let originalParentDisplay = '';
            if (parent && (parent.style.display === 'none' || window.getComputedStyle(parent).display === 'none')) {
                warn(`[sdkManager] Parent ${parentId} is hidden, making it temporarily visible for dimension calculation`);
                parentWasHidden = true;
                originalParentDisplay = parent.style.display;
                parent.style.display = 'block';
                parent.style.visibility = 'hidden'; // Hide but keep layout
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => setTimeout(r, 50));
            }
            
            // Check container dimensions
            const containerWidth = container.offsetWidth || parseInt(container.style.width) || width;
            const containerHeight = container.offsetHeight || parseInt(container.style.height) || height;
            log(`[sdkManager] Container ${containerId}: found, dimensions=${containerWidth}x${containerHeight}, children=${container.children.length}`);
            
            // If container has 0 dimensions, wait for layout
            if (containerWidth === 0 || containerHeight === 0) {
                warn(`[sdkManager] Container ${containerId} has zero dimensions, waiting for layout...`);
                // Force dimensions from style if available
                if (container.style.width && container.style.height) {
                    container.style.width = `${width}px`;
                    container.style.height = `${height}px`;
                }
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => setTimeout(r, 100));
                const newWidth = container.offsetWidth || width;
                const newHeight = container.offsetHeight || height;
                log(`[sdkManager] After layout wait: ${containerId} dimensions=${newWidth}x${newHeight}`);
                
                if (newWidth === 0 || newHeight === 0) {
                    warn(`[sdkManager] Container ${containerId} still has zero dimensions, using provided dimensions ${width}x${height}`);
                    // Force set dimensions as fallback
                    container.style.width = `${width}px`;
                    container.style.height = `${height}px`;
                }
            }
            
            // Restore parent visibility if we changed it
            if (parentWasHidden && parent) {
                parent.style.display = originalParentDisplay || 'none';
                parent.style.visibility = '';
            }

            const bannerType = inferBannerType(width, height);
            if (bannerType === null) {
                warn(`[sdkManager] Unknown banner size: ${width}x${height}`);
                return;
            }

            log(`[sdkManager] Banner type: ${bannerType} (${width}x${height}), trying providers: ${banner_priorities.join(', ')}`);

            // Try providers in order
            for (const provider of banner_priorities) {
                try {
                    log(`[sdkManager] Trying provider: ${provider} for ${containerId}`);
                    
                    // Load provider if needed
                    log(`[sdkManager] Loading provider: ${provider}`);
                    const loaded = await ensureProviderLoaded(provider);
                    if (!loaded) {
                        warn(`[sdkManager] Provider ${provider} failed to load`);
                        continue;
                    }

                    const providerObj = window.bannerAdProviders?.[provider];
                    if (!providerObj) {
                        warn(`[sdkManager] Provider ${provider} not available in window.bannerAdProviders`);
                        continue;
                    }
                    if (!providerObj.displayBanner) {
                        warn(`[sdkManager] Provider ${provider} missing displayBanner method`);
                        continue;
                    }

                    const start = performance.now();
                    const param = provider === 'adinplay' ? 
                        typeToAdTagString(bannerType) : bannerType;
                    log(`[sdkManager] Calling ${provider}.displayBanner(${param}, container)`);
                    
                    // Cancel any existing timeout for this container
                    if (state.timeoutId) {
                        clearTimeout(state.timeoutId);
                        state.timeoutId = null;
                    }
                    
                    // Add timeout wrapper to prevent hanging
                    let timedOut = false;
                    const filled = await Promise.race([
                        providerObj.displayBanner(param, container),
                        new Promise(resolve => {
                            state.timeoutId = setTimeout(() => {
                                timedOut = true;
                                error(`[sdkManager] TIMEOUT: ${provider}.displayBanner for ${containerId} timed out after 10s`);
                                state.timeoutId = null;
                                resolve(false);
                            }, 10000);
                        })
                    ]);
                    
                    if (timedOut) {
                        error(`[sdkManager] Provider ${provider} timed out, will try next provider`);
                    }

                    const elapsed = Math.round(performance.now() - start);
                    
                    // Check container state after provider attempt
                    const hasChildren = container.children.length > 0;
                    const hasVisibleContent = container.querySelector('iframe, ins, img, svg');
                    log(`[sdkManager] ${provider} result: filled=${filled}, elapsed=${elapsed}ms, children=${container.children.length}, visibleContent=${!!hasVisibleContent}`);
                    
                    if (filled) {
                        log(`[ads] Filled ${containerId} via ${provider} in ${elapsed}ms`);
                        state.lastRefresh = now;
                        // Clear timeout on success
                        if (state.timeoutId) {
                            clearTimeout(state.timeoutId);
                            state.timeoutId = null;
                        }
                        return;
                                } else {
                        log(`[sdkManager] ${provider} no-fill in ${elapsed}ms, trying next provider`);
                        // Clean container for next provider (preserve Nitro divs)
                        const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
                        if (nitroDivs.length > 0) {
                            nitroDivs.forEach(div => div.style.display = 'none');
                            Array.from(container.children).forEach(child => {
                                if (!child.id.startsWith('nitro-kour-')) {
                                    container.removeChild(child);
                                }
                            });
                            } else {
                            container.innerHTML = '';
                        }
                    }
                } catch (e) {
                    error(`[sdkManager] Provider ${provider} error:`, e);
                    // Clean container (preserve Nitro divs)
                    const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
                    if (nitroDivs.length > 0) {
                        nitroDivs.forEach(div => div.style.display = 'none');
                        Array.from(container.children).forEach(child => {
                            if (!child.id.startsWith('nitro-kour-')) {
                                container.removeChild(child);
                            }
                        });
                    } else {
                        container.innerHTML = '';
                    }
                }
            }

            warn(`[sdkManager] All providers failed for ${containerId}`);
        } finally {
            state.inflightRequest = false;
            // Clear any remaining timeout
            if (state.timeoutId) {
                clearTimeout(state.timeoutId);
                state.timeoutId = null;
            }
            log(`[sdkManager] requestBanner completed for ${containerId}`);
        }
    }

    // Video ad implementation
    async function showVideoAd(adType) {
        log(`[sdkManager] showVideoAd(${adType}) - trying providers: ${video_priorities.join(', ')}`);
        for (const provider of video_priorities) {
            try {
                log(`[sdkManager] Attempting ${provider} for ${adType}...`);
                const loaded = await ensureProviderLoaded(provider);
                if (!loaded) {
                    warn(`[sdkManager] ${provider} provider failed to load, trying next provider`);
                    continue;
                }

                const providerObj = window.videoAdProviders?.[provider];
                if (!providerObj) {
                    warn(`[sdkManager] ${provider} provider object not found, trying next provider`);
                    continue;
                }

                const method = adType === 'rewarded' ? 'showRewarded' : 'showMidroll';
                if (!providerObj[method]) {
                    warn(`[sdkManager] ${provider} missing ${method} method, trying next provider`);
                    continue;
                }

                log(`[sdkManager] Calling ${provider}.${method}...`);
                const result = await new Promise((resolve) => {
                    providerObj[method](
                        () => resolve(true),  // success
                        () => resolve(false)  // failure
                    );
                });

                if (result) {
                    log(`[sdkManager] ${adType} shown successfully via ${provider}`);
                    if (typeof unityInstance !== 'undefined') {
                        unityInstance.SendMessage('MainManager', 'OnDaReveresedFinishedJS', 'Success');
                    }
                    return;
                } else {
                    warn(`[sdkManager] ${provider} ${method} returned false, trying next provider`);
                }
            } catch (e) {
                warn(`[sdkManager] Video provider ${provider} error:`, e);
            }
        }

        // All failed
        warn(`[sdkManager] All video providers failed for ${adType}`);
        if (typeof unityInstance !== 'undefined') {
            unityInstance.SendMessage('MainManager', 'OnDaReveresedFinishedJS', 'Failed');
        }
    }

    // SetAds implementation
    function setAds(preset728x90, preset300x600, preset300x250) {
        log(`[sdkManager] setAds(${preset728x90}, ${preset300x600}, ${preset300x250})`);
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // On mobile, only show 300x250
        if (isMobile) {
            log(`[sdkManager] Mobile detected, hiding 728x90 and 300x600`);
            preset728x90 = 'hidden';
            preset300x600 = 'hidden';
        }

        // Process each banner
        const banners = [
            { id: 'kour-io_728x90', parentId: 'kour-io_728x90-parent', preset: preset728x90, width: 728, height: 90 },
            { id: 'kour-io_300x600', parentId: 'kour-io_300x600-parent', preset: preset300x600, width: 300, height: 600 },
            { id: 'kour-io_300x250', parentId: 'kour-io_300x250-parent', preset: preset300x250, width: 300, height: 250 }
        ];

        for (const banner of banners) {
            const parent = document.getElementById(banner.parentId);
            if (!parent) {
                warn(`[sdkManager] Parent not found: ${banner.parentId}`);
                continue;
            }

            const mode = (banner.preset || 'hidden').toLowerCase();
            const lastMode = lastAdModes[banner.id];

            log(`[sdkManager] Banner ${banner.id}: mode=${mode}, lastMode=${lastMode || 'none'}`);

            if (mode === 'hidden') {
                log(`[sdkManager] Hiding ${banner.id}`);
                parent.style.display = 'none';
                // Don't destroy Nitro divs, just hide them
                const container = document.getElementById(banner.id);
                if (container) {
                    const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
                    nitroDivs.forEach(div => {
                        div.style.display = 'none';
                    });
                }
            } else {
                log(`[sdkManager] Showing ${banner.id} (mode: ${mode})`);
                parent.style.display = 'block';
                
                // Apply positioning based on mode
                if (banner.id === 'kour-io_300x600') {
                    if (mode === 'left') {
                        parent.style.transformOrigin = 'top left';
                        parent.style.top = '20%';
                        parent.style.left = '1%';
                        parent.style.removeProperty('right');
                        parent.style.removeProperty('bottom');
                    } else if (mode === 'right') {
                        parent.style.transformOrigin = 'top right';
                        parent.style.top = '20%';
                        parent.style.right = '1%';
                        parent.style.removeProperty('left');
                        parent.style.removeProperty('bottom');
                    } else if (mode === 'bottomright') {
                        parent.style.transformOrigin = 'bottom right';
                        parent.style.bottom = '2%';
                        parent.style.right = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('left');
                    } else if (mode === 'bottomleft') {
                        parent.style.transformOrigin = 'bottom left';
                        parent.style.bottom = '2%';
                        parent.style.left = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('right');
                    }
                } else if (banner.id === 'kour-io_300x250') {
                    if (mode === 'left') {
                        parent.style.transformOrigin = 'top left';
                        parent.style.top = '33%';
                        parent.style.left = '6%';
                        parent.style.removeProperty('right');
                        parent.style.removeProperty('bottom');
                    } else if (mode === 'right') {
                        parent.style.transformOrigin = 'top right';
                        parent.style.top = '20%';
                        parent.style.right = '10px';
                        parent.style.removeProperty('left');
                        parent.style.removeProperty('bottom');
                    } else if (mode === 'topleft') {
                        parent.style.transformOrigin = 'top left';
                        parent.style.top = '10%';
                        parent.style.left = '1%';
                        parent.style.removeProperty('right');
                        parent.style.removeProperty('bottom');
                    } else if (mode === 'bottomright') {
                        parent.style.transformOrigin = 'bottom right';
                        parent.style.bottom = '2%';
                        parent.style.right = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('left');
                    } else if (mode === 'bottomleft') {
                        parent.style.transformOrigin = 'bottom left';
                        parent.style.bottom = '2%';
                        parent.style.left = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('right');
                    }
                } else if (banner.id === 'kour-io_728x90') {
                    if (mode === 'bottom') {
                        // Reset to center bottom (default HTML position)
                        parent.style.transformOrigin = 'bottom center';
                        parent.style.bottom = '1%';
                        parent.style.left = '0px';
                        parent.style.right = '0px';
                        parent.style.marginLeft = 'auto';
                        parent.style.marginRight = 'auto';
                        parent.style.removeProperty('top');
                    } else if (mode === 'bottomright') {
                        parent.style.transformOrigin = 'bottom right';
                        parent.style.bottom = '2%';
                        parent.style.right = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('left');
                        parent.style.removeProperty('marginLeft');
                        parent.style.removeProperty('marginRight');
                    } else if (mode === 'bottomleft') {
                        parent.style.transformOrigin = 'bottom left';
                        parent.style.bottom = '2%';
                        parent.style.left = '2%';
                        parent.style.removeProperty('top');
                        parent.style.removeProperty('right');
                        parent.style.removeProperty('marginLeft');
                        parent.style.removeProperty('marginRight');
                    }
                }
                
                // Only request if mode changed or container is empty (excluding hidden Nitro divs)
                const container = document.getElementById(banner.id);
                let isEmpty = !container || container.children.length === 0;
                
                // Check if we only have hidden Nitro divs (not truly empty)
                if (container && container.children.length > 0) {
                    const visibleChildren = Array.from(container.children).filter(child => {
                        // Count as visible if it's not a Nitro div OR if it's a visible Nitro div
                        return !child.id.startsWith('nitro-kour-') || child.style.display !== 'none';
                    });
                    isEmpty = visibleChildren.length === 0;
                }
                
                log(`[sdkManager] ${banner.id}: isEmpty=${isEmpty}, modeChanged=${mode !== lastMode}`);
                if (mode !== lastMode || isEmpty) {
                    log(`[sdkManager] Requesting banner for ${banner.id}`);
                    requestBanner(banner.id, banner.width, banner.height);
                } else {
                    log(`[sdkManager] Skipping request for ${banner.id} (no change)`);
                }
            }

            lastAdModes[banner.id] = mode;
        }
    }

    // Auto-refresh timer (disabled - ad networks handle their own refresh)
    function startAutoRefresh() {
        if (!window.AUTO_REFRESH_BANNERS) {
            log('[sdkManager] Auto-refresh disabled - ad networks handle their own refresh');
            return;
        }
        
        log('[sdkManager] Auto-refresh timer started (checking every 5s, refresh interval: 30s)');
        setInterval(() => {
            const now = Date.now();
            for (const [containerId, state] of Object.entries(bannerState)) {
                if (state.lastRefresh && (now - state.lastRefresh) >= REFRESH_INTERVAL_MS) {
                    const parent = document.getElementById(`${containerId}-parent`);
                    if (!parent) {
                        dlog(`[sdkManager] Auto-refresh: parent not found for ${containerId}`);
                        continue;
                    }
                    const parentVisible = parent.style.display !== 'none' && 
                                          window.getComputedStyle(parent).display !== 'none';
                    if (parentVisible) {
                        const container = document.getElementById(containerId);
                        if (container && container.children.length > 0) {
                            const width = parseInt(container.style.width || container.offsetWidth || 0);
                            const height = parseInt(container.style.height || container.offsetHeight || 0);
                            const timeSinceRefresh = now - state.lastRefresh;
                            log(`[sdkManager] Auto-refresh: ${containerId} (${timeSinceRefresh}ms since last refresh)`);
                            if (width && height) {
                                log(`[sdkManager] Seamlessly refreshing ${containerId} (${width}x${height})`);
                                // Use seamless refresh to avoid blank gap
                                seamlessRefresh(containerId, width, height);
                                state.lastRefresh = now; // Update timestamp
                            } else {
                                warn(`[sdkManager] Auto-refresh: ${containerId} has invalid dimensions (${width}x${height})`);
                            }
                        } else {
                            dlog(`[sdkManager] Auto-refresh: container not found or empty for ${containerId}`);
                        }
                    } else {
                        dlog(`[sdkManager] Auto-refresh: ${containerId} parent not visible`);
                    }
                }
            }
        }, 5000); // Check every 5 seconds
    }

    // Legacy helper for AdinPlay
    window.waitForAdinPlay = function() {
        return new Promise((resolve) => {
            if (typeof window.aipDisplayTag !== 'undefined') {
                resolve(true);
                return;
            }
            const timeout = setTimeout(() => resolve(false), 5000);
            const interval = setInterval(() => {
                if (typeof window.aipDisplayTag !== 'undefined') {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve(true);
                }
            }, 100);
        });
    };

    // Initialize SDK
    window.sdk = {
        init: function() {
            log('[sdkManager] Initializing SDK...');
            log(`[sdkManager] Banner priorities: ${banner_priorities.join(', ')}`);
            log(`[sdkManager] Video priorities: ${video_priorities.join(', ')}`);
            startAutoRefresh();
            log('[sdkManager] SDK initialization complete');
        },
        ad: {
            showRewarded: () => showVideoAd('rewarded'),
            showMid: () => showVideoAd('midroll')
        },
        banner: {
            request: requestBanner,
            clear: (containerId) => cleanContainer(containerId),
            refresh: (containerId) => {
                        const container = document.getElementById(containerId);
                if (container) {
                    const width = parseInt(container.style.width || container.offsetWidth || 0);
                    const height = parseInt(container.style.height || container.offsetHeight || 0);
                    if (width && height) {
                        requestBanner(containerId, width, height);
                    }
                }
            },
            setAds: setAds
        }
    };

    // Global SetAds wrapper for Unity
    window.SetAds = function(preset728x90, preset300x600, preset300x250) {
        window.sdk.banner.setAds(preset728x90, preset300x600, preset300x250);
    };

    // Global video ad functions
    window.showRe = window.showMid = function() {
        window.sdk.ad.showMid();
    };
    
    // Add missing gameplay handlers to prevent ReferenceError
    window.gameplayStart = function(roomName, regionValue) {
        log('[sdkManager] gameplayStart called');
    };
    window.gameplayEnd = function() {
        log('[sdkManager] gameplayEnd called');
    };

    // Auto-init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.sdk.init());
    } else {
        window.sdk.init();
    }
})();

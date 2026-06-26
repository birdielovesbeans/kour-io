// AdinPlay Ad Provider Module
// This module handles all AdinPlay-specific ad functionality

(function() {
    const DEBUG_ADS = !!(window && window.__ADS_DEBUG__);
    const dlog = (...args) => { if (DEBUG_ADS) console.log(...args); };
    const dwarn = (...args) => { if (DEBUG_ADS) console.warn(...args); };
    const derror = (...args) => { if (DEBUG_ADS) console.error(...args); };

    dlog("[adinplay-ads.js] Module loading...");
    
    // AdinPlay tag mapping - can be customized per game
    const ADINPLAY_TAG_MAPPING = {
        "300x250": "kour-io_300x250",
        "728x90": "kour-io_728x90", 
        "300x600": "kour-io_300x600"
    };
    
    // Ensure global providers exist
    window.videoAdProviders = window.videoAdProviders || {};
    window.bannerAdProviders = window.bannerAdProviders || {};
    
    // AdinPlay initialization
    function initAdinPlay() {
        dlog("[adinplay-ads.js] Initializing AdinPlay...");
        
        window.aiptag = window.aiptag || { cmd: [] };
        aiptag.cmd.display = aiptag.cmd.display || [];
        aiptag.cmd.player = aiptag.cmd.player || [];
        aiptag.cmp = {
            show: true,
            position: "bottom",
            button: false,
            buttonText: "Privacy settings",
            buttonPosition: "bottom-left"
        };
        
        // aiptag.pageProtect = true;
        
        aiptag.cmd.player.push(function () {
            dlog("[adinplay-ads.js] Creating AdinPlay player...");
            aiptag.adplayer = new aipPlayer({
                AD_WIDTH: 960,
                AD_HEIGHT: 540,
                AD_DISPLAY: 'fullscreen',
                LOADING_TEXT: 'Loading advertisement',
                PREROLL_ELEM: function () { 
                    const elem = document.getElementById('videoad');
                    dlog(`[adinplay-ads.js] Preroll element: ${elem ? 'found' : 'not found'}`);
                    return elem;
                },
                AIP_COMPLETE: function (state) {
                    dlog(`[adinplay-ads.js] Video Ad Completed: ${state}`);
                    
                    const lowerCaseState = state.toLowerCase();
                    const isFailure = lowerCaseState.includes("adblock") ||
                        lowerCaseState.includes("failed") ||
                        lowerCaseState.includes("empty") ||
                        lowerCaseState.includes("error");
                    
                    if (isFailure) {
                        dlog("[adinplay-ads.js] Ad failed");
                        if (window._adinplayTempFailure) {
                            window._adinplayTempFailure();
                            delete window._adinplayTempFailure;
                            delete window._adinplayTempSuccess;
                        } else if (typeof unityInstance !== 'undefined') {
                            unityInstance.SendMessage("SDKManager", "OnVideoAdEnded", "false");
                        }
                    } else {
                        dlog("[adinplay-ads.js] Ad succeeded");
                        if (window._adinplayTempSuccess) {
                            window._adinplayTempSuccess();
                            delete window._adinplayTempSuccess;
                            delete window._adinplayTempFailure;
                        } else if (typeof unityInstance !== 'undefined') {
                            unityInstance.SendMessage("SDKManager", "OnVideoAdEnded", "true");
                        }
                    }
                }
            });
            dlog("[adinplay-ads.js] AdinPlay player created");
        });
        
        // Load the AdinPlay script
        dlog("[adinplay-ads.js] Loading AdinPlay script...");
        const adinplayScript = document.createElement('script');
        adinplayScript.type = "text/javascript";
        adinplayScript.src = '//api.adinplay.com/libs/aiptag/pub/LGP/kour.io/tag.min.js';
        adinplayScript.async = true;
        adinplayScript.onload = function() {
            dlog("[adinplay-ads.js] Script loaded successfully");
        };
        adinplayScript.onerror = function() {
            derror("[adinplay-ads.js] Failed to load script");
        };
        document.head.appendChild(adinplayScript);
    }
    
    // Video ad provider implementation
    window.videoAdProviders.adinplay = {
        showMidroll: function(onSuccess, onFailure) {
            dlog(`[adinplay-ads.js] showMidroll called`);
            
            if (typeof aiptag !== 'undefined' && typeof aiptag.adplayer !== 'undefined') {
                window._adinplayTempSuccess = onSuccess;
                window._adinplayTempFailure = onFailure;
                
                aiptag.cmd.player.push(function () {
                    dlog(`[adinplay-ads.js] Starting preroll`);
                    aiptag.adplayer.startPreRoll();
                });
            } else {
                dlog(`[adinplay-ads.js] API not available`);
                onFailure();
            }
        },
        showRewarded: function(onSuccess, onFailure) {
            dlog(`[adinplay-ads.js] showRewarded called (delegates to showMidroll)`);
            this.showMidroll(onSuccess, onFailure);
        }
    };
    
    // Banner ad provider implementation
    window.bannerAdProviders.adinplay = {
        displayBanner: async function(adTag, container) {
            dlog(`[adinplay-ads.js] displayBanner for tag: ${adTag}`);

            // Map generic adTag to AdinPlay-specific tag
            const adinplayTag = ADINPLAY_TAG_MAPPING[adTag];
            if (!adinplayTag) {
                derror(`[adinplay-ads.js] No mapping found for adTag: ${adTag}`);
                return false;
            }
            dlog(`[adinplay-ads.js] Using AdinPlay tag: ${adinplayTag}`);

            // Ensure our container has a proper placeholder element for AdinPlay
            try {
                // Remove any existing placeholder with the same id elsewhere
                const existing = document.getElementById(adinplayTag);
                // Important: do NOT remove the live child container itself
                if (existing && existing !== container && existing.parentNode) {
                    existing.parentNode.removeChild(existing);
                }
            } catch (e) {
                // ignore
            }

            // AdinPlay needs the container to have the specific tag ID
            // If container doesn't have the right ID, we need to ensure it does
            if (container.id !== adinplayTag) {
                // Preserve Nitro divs when creating AdinPlay placeholder
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
                    container.innerHTML = "";
                }
                const placeholder = document.createElement('div');
                placeholder.id = adinplayTag;
                placeholder.style.width = '100%';
                placeholder.style.height = '100%';
                placeholder.style.position = 'absolute';
                placeholder.style.top = '50%';
                placeholder.style.left = '50%';
                placeholder.style.transform = 'translate(-50%, -50%)';
                container.appendChild(placeholder);
            } else {
                // Container already has the right ID, preserve Nitro divs
                const nitroDivs = container.querySelectorAll('[id^="nitro-kour-"]');
                if (nitroDivs.length > 0) {
                    nitroDivs.forEach(div => div.style.display = 'none');
                    Array.from(container.children).forEach(child => {
                        if (!child.id.startsWith('nitro-kour-')) {
                            container.removeChild(child);
                        }
                    });
                } else {
                    container.innerHTML = "";
                }
            }

            // Wait for AdinPlay to be ready
            const isReady = await window.waitForAdinPlay();

            if (!(isReady && typeof aiptag !== "undefined" && typeof aipDisplayTag !== "undefined")) {
                dlog(`[adinplay-ads.js] Not available for banner`);
                return false;
            }

            // Display and verify fill. Resolve true only if creative appears; else false to allow fallback
            return await new Promise((resolve) => {
                let settled = false;

                const settle = (ok) => {
                    if (!settled) { settled = true; resolve(ok); }
                };

                // Find the actual render target
                const renderTarget = container.id === adinplayTag ? container : 
                                    document.getElementById(adinplayTag);
                
                if (!renderTarget) {
                    settle(false);
                    return;
                }

                // Observe for injected content
                const observer = new MutationObserver(() => {
                    // Ad networks typically inject iframes or images
                    const hasCreative = renderTarget.querySelector('iframe, img, ins');
                    if (hasCreative) {
                        observer.disconnect();
                        settle(true);
                    }
                });
                try {
                    observer.observe(renderTarget, { childList: true, subtree: true });
                } catch {}

                // Safety timeout in case nothing is injected (e.g., adblock)
                const timeoutMs = 5000;
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    // Check if ad was actually rendered
                    const hasContent = renderTarget.querySelector('iframe, img, ins');
                    settle(!!hasContent);
                }, timeoutMs);

                // Request display
                aiptag.cmd.display.push(function() {
                    try {
                        // Render into the element with id == adinplayTag
                        aipDisplayTag.display(adinplayTag);
                    } catch (e) {
                        clearTimeout(timeoutId);
                        observer.disconnect();
                        settle(false);
                    }
                });
            });
        }
    };
    
    // Initialize AdinPlay
    initAdinPlay();
    
    dlog("[adinplay-ads.js] Module loaded successfully");
})();

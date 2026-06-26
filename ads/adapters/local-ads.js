// Local Ads Fallback Provider Module
// This module provides local image fallbacks for ads
// 
// To enable clickable banners, set URLs in LOCAL_BANNER_LINKS:
// - Set to a URL string to make the banner clickable
// - Set to null to disable click functionality
// - Example: 0: 'https://example.com', 1: null, 2: 'https://another-site.com'

(function() {
    const DEBUG_ADS = !!(window && window.__ADS_DEBUG__);
    const dlog = (...args) => { if (DEBUG_ADS) console.log(...args); };

    dlog("[local-ads.js] Module loading...");
    
    // Ensure global providers exist
    window.videoAdProviders = window.videoAdProviders || {};
    window.bannerAdProviders = window.bannerAdProviders || {};
    
    // Local banner image paths (adblock-safe names)
    const LOCAL_BANNER_IMAGES = {
        0: 'ads/local-ads-assets/a.png', // 300x250
        1: 'ads/local-ads-assets/b.png', // 728x90
        2: 'ads/local-ads-assets/c.png'  // 300x600
    };
    
    // Optional banner links (set to null to disable click functionality)
    const LOCAL_BANNER_LINKS = {
        0: 'https://veck.io/?utm_source=kour&utm_medium=banner&utm_campaign=crosspromo', // 300x250
        1: 'https://veck.io/?utm_source=kour&utm_medium=banner&utm_campaign=crosspromo', // 728x90 
        2: 'https://poxel.io/?utm_source=kour&utm_medium=banner&utm_campaign=crosspromo'  // 300x600
    };
    
    // Video ad provider implementation (simulated)
    window.videoAdProviders.local = {
        showMidroll: function(onSuccess, onFailure) {
            console.log(`[local-ads.js] showMidroll called - failing immediately`);
            onFailure();
        },
        
        showRewarded: function(onSuccess, onFailure) {
            console.log(`[local-ads.js] showRewarded called - failing immediately`);
            onFailure();
        }
    };
    
    // Banner ad provider implementation
    window.bannerAdProviders.local = {
        displayBanner: async function(bannerType, container) {
            dlog(`[local-ads.js] displayBanner for type: ${bannerType}`);

            const imagePath = LOCAL_BANNER_IMAGES[bannerType];
            if (!imagePath) {
                console.log(`[local-ads.js] No local image for banner type ${bannerType}`);
                return false;
            }

            // Get dimensions from global bannerDimensions
            const dims = window.bannerDimensions[bannerType];
            if (!dims) {
                console.log(`[local-ads.js] No dimensions for banner type ${bannerType}`);
                return false;
            }

            // Preload image and resolve true on success, false on failure
            return await new Promise((resolve) => {
                const testImg = new Image();
                testImg.onload = async function() {
                    const img = document.createElement('img');
                    img.style.width = dims.width;
                    img.style.height = dims.height;
                    img.style.display = 'block';
                    img.style.cursor = 'pointer';
                    img.style.position = 'absolute';
                    img.style.top = '50%';
                    img.style.left = '50%';
                    img.style.transform = 'translate(-50%, -50%)';
                    img.alt = `Local Banner ${dims.width}x${dims.height}`;

                    // Try to mask the 'ads/' path from cosmetic filters by using a blob URL
                    // If this fails (e.g., CORS), fall back to the direct path.
                    try {
                        const response = await fetch(imagePath, { cache: 'force-cache' });
                        if (!response.ok) throw new Error('fetch failed');
                        const blob = await response.blob();
                        const objectUrl = URL.createObjectURL(blob);
                        img.src = objectUrl;
                        img.addEventListener('load', function() {
                            try { URL.revokeObjectURL(objectUrl); } catch(_) {}
                        }, { once: true });
                        dlog('[local-ads.js] Using blob URL for local banner');
                    } catch (e) {
                        img.src = imagePath;
                        dlog('[local-ads.js] Blob URL fallback to direct src');
                    }
                    
                    // Add click handler if link is configured
                    const bannerLink = LOCAL_BANNER_LINKS[bannerType];
                    if (bannerLink) {
                        img.addEventListener('click', function() {
                            dlog(`[local-ads.js] Banner clicked, opening: ${bannerLink}`);
                            window.open(bannerLink, '_blank', 'noopener,noreferrer');
                        });
                    } else {
                        // Still show pointer cursor but no click action
                        img.style.cursor = 'default';
                    }
                    
                    // Preserve Nitro divs when adding local ad
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
                    container.appendChild(img);
                    dlog(`[local-ads.js] Local banner displayed: ${imagePath}${bannerLink ? ` (clickable: ${bannerLink})` : ' (no link)'}`);
                    resolve(true);
                };
                testImg.onerror = function() {
                    dlog('[local-ads.js] Local image blocked/missing');
                    resolve(false);
                };
                testImg.src = imagePath;
            });
        }
    };
    
    dlog("[local-ads.js] Module loaded successfully");
})();

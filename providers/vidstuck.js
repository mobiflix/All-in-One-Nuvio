const PROVIDER_NAME = 'VidStuck';
const BASE_URL = 'https://embed.vidstuck.xyz';

// Headers na kailangan para gumana ang embed at stream
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://vidstuck.xyz/',
  'Origin': 'https://vidstuck.xyz'
};

// Helper para sa timeout
function fetchWithTimeout(url, options = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error('Request timeout'));
    }, timeout);
    
    fetch(url, { ...options, signal: controller ? controller.signal : undefined })
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

// Kunin ang m3u8 URL mula sa HTML gamit ang iba't ibang pattern
function extractM3U8(html) {
  // Pattern 1: file: '...m3u8' o file: "...m3u8"
  let match = html.match(/file\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]/i);
  if (match) return match[1];
  
  // Pattern 2: src="...m3u8" o src='...m3u8'
  match = html.match(/src\s*=\s*["']([^"']*\.m3u8[^"']*)["']/i);
  if (match) return match[1];
  
  // Pattern 3: data-src="...m3u8"
  match = html.match(/data-src\s*=\s*["']([^"']*\.m3u8[^"']*)["']/i);
  if (match) return match[1];
  
  // Pattern 4: source: '...m3u8'
  match = html.match(/["']source["']\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i);
  if (match) return match[1];
  
  // Pattern 5: url: '...m3u8'
  match = html.match(/["']url["']\s*:\s*["']([^"']*\.m3u8[^"']*)["']/i);
  if (match) return match[1];
  
  // Pattern 6: bare m3u8 URL sa text
  match = html.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i);
  if (match) return match[1];
  
  return null;
}

// Kunin ang metadata mula sa TMDB (opsyonal, para sa mas magandang display)
function getTmdbMetadata(tmdbId, type, season, episode) {
  const TMDB_API_KEY = 'e0a7266a5d0e95c36475f349d8bc0a5a'; // Palitan ng sarili mong TMDB API key
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return fetch(url)
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data) return { name: 'Unknown', year: 'N/A' };
      return {
        name: data.title || data.name || 'Unknown',
        year: (data.release_date || data.first_air_date || '').split('-')[0] || 'N/A'
      };
    })
    .catch(() => ({ name: 'Unknown', year: 'N/A' }));
}

// Pangunahing function
function getStreams(tmdbId, type, seasonNum, episodeNum) {
  return new Promise((resolve) => {
    const streams = [];
    
    if (!tmdbId) {
      console.log(`[${PROVIDER_NAME}] Missing TMDB ID`);
      return resolve([]);
    }
    
    const mediaType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
    const isTv = mediaType === 'tv';
    
    if (isTv && (!seasonNum || !episodeNum)) {
      console.log(`[${PROVIDER_NAME}] Missing season/episode for TV`);
      return resolve([]);
    }
    
    // Bumuo ng embed URL
    let embedUrl = `${BASE_URL}/embed/${mediaType}/${tmdbId}`;
    if (isTv) {
      embedUrl += `/${seasonNum}/${episodeNum}`;
    }
    
    console.log(`[${PROVIDER_NAME}] Fetching: ${embedUrl}`);
    
    // Kunin ang metadata at HTML nang sabay
    Promise.all([
      getTmdbMetadata(tmdbId, mediaType, seasonNum, episodeNum),
      fetchWithTimeout(embedUrl, { headers: HEADERS })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
    ])
    .then(([metadata, html]) => {
      const m3u8Url = extractM3U8(html);
      
      if (!m3u8Url) {
        console.log(`[${PROVIDER_NAME}] No m3u8 found`);
        return resolve([]);
      }
      
      // I-detect ang quality
      const lowerUrl = m3u8Url.toLowerCase() + html.toLowerCase();
      let quality = '1080P';
      let qualityLabel = '1080p FHD';
      
      if (lowerUrl.includes('4k') || lowerUrl.includes('2160')) {
        quality = '4K';
        qualityLabel = '4K UHD';
      } else if (lowerUrl.includes('720')) {
        quality = '720P';
        qualityLabel = '720p HD';
      }
      
      const title = isTv 
        ? `📺 ${metadata.name} - S${seasonNum}E${episodeNum} (${metadata.year})`
        : `🎬 ${metadata.name} (${metadata.year})`;
      
      const stream = {
        name: `${PROVIDER_NAME} - ${qualityLabel}`,
        title: `${title}\n💎 ${quality} | 🌍 Original Audio`,
        url: m3u8Url,
        quality: quality,
        headers: HEADERS,
        provider: 'vidstuck'
      };
      
      streams.push(stream);
      resolve(streams);
    })
    .catch(err => {
      console.log(`[${PROVIDER_NAME}] Error:`, err.message);
      resolve([]);
    });
  });
}

// Para sa Nuvio compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

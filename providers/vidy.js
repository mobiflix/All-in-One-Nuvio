const PROVIDER = "Vidy";
const BASE_URL = "https://vidy.st";
const ENC_API = "https://enc-dec.app/api/enc-vidy";
const DEC_API = "https://enc-dec.app/api/dec-vidy";
const BLOCKED_SERVERS = ["Horizon"];
const ALLOWED_QUALITIES = ["1080p", "720p"];

const DEFAULT_HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Origin": BASE_URL,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest"
};

function heightToQuality(height) {
    if (height >= 2160) return "2160p";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    return height + "p";
}

function parseQualityLabel(str) {
    if (/2160|4k/i.test(str)) return "2160p";
    if (/1440/i.test(str)) return "1440p";
    if (/1080/i.test(str)) return "1080p";
    if (/720/i.test(str)) return "720p";
    if (/480/i.test(str)) return "480p";
    if (/360/i.test(str)) return "360p";
    if (/auto|adaptive/i.test(str)) return "Auto";
    return null;
}

function extractStreamQuality(data) {
    if (data.quality) {
        var q = parseQualityLabel(data.quality);
        if (q) return q;
    }
    if (data.label) {
        var q2 = parseQualityLabel(data.label);
        if (q2) return q2;
    }
    var match = data.url ? data.url.match(/(\d{3,4})[pP]/) : null;
    if (match) return match[1] + "p";
    return "Auto";
}

function resWeight(quality) {
    var q = (quality || "").toLowerCase();
    if (q === "2160p" || q === "4k") return 5;
    if (q === "1440p") return 4;
    if (q === "1080p") return 3;
    if (q === "720p") return 2;
    if (q === "480p" || q === "360p") return 1;
    return 0;
}

function getInvertedSortTag(score, maxScore) {
    maxScore = maxScore || 999999;
    var inv = Math.max(0, maxScore - Math.max(0, parseInt(score, 10) || 0));
    var bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(function(b) { return b === "1" ? "\uFEFF" : "\u200B"; }).join("");
}

function fetchPlaylistVariants(playlistUrl) {
    return fetch(playlistUrl, {
        headers: {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Referer": BASE_URL + "/"
        }
    })
    .then(function(res) {
        if (!res.ok) return null;
        return res.text();
    })
    .then(function(text) {
        if (!text || text.indexOf("#EXT-X-STREAM-INF") === -1) return null;

        var tracks = [];
        var lines = text.split("\n");

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;

            var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
            var bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            var urlLine = lines[i + 1] ? lines[i + 1].trim() : null;

            if (!urlLine || urlLine.indexOf("#") === 0) continue;

            var url = urlLine.indexOf("http") === 0
                ? urlLine
                : playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1) + urlLine;

            tracks.push({
                url: url,
                quality: resMatch ? heightToQuality(parseInt(resMatch[2])) : null,
                bandwidth: bwMatch ? parseInt(bwMatch[1]) : 0
            });
        }

        if (tracks.length === 0) return null;

        tracks.sort(function(a, b) { return b.bandwidth - a.bandwidth; });

        for (var j = 0; j < tracks.length; j++) {
            if (!tracks[j].quality) {
                var m = tracks[j].url.match(/(\d{3,4})[pP]/);
                tracks[j].quality = m ? m[1] + "p" : heightToQuality(
                    j === 0 ? 2160 : j === 1 ? 1080 : 720
                );
            }
        }

        return tracks;
    })
    .catch(function() { return null; });
}

function decrypt(payload) {
    return fetch(DEC_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload })
    })
    .then(function(res) { return res.json(); })
    .catch(function() { return null; });
}

function resolvePageUrl(tmdbId, mediaType, season, episode) {
    return mediaType === "tv"
        ? BASE_URL + "/tv/" + tmdbId + "/" + season + "/" + episode + "/"
        : BASE_URL + "/movie/" + tmdbId + "/";
}

function extractEncryptedPayload(pageText) {
    var m = String(pageText || "").match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    return m ? m[1] : null;
}

function fetchRawStreams(tmdbId, mediaType, season, episode) {
    var pageUrl = resolvePageUrl(tmdbId, mediaType, season, episode);
    var headers = {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": BASE_URL + "/"
    };

    return fetch(pageUrl, { headers: headers })
    .then(function(pageRes) {
        if (!pageRes.ok) return null;
        return pageRes.text();
    })
    .then(function(pageText) {
        if (!pageText) return null;
        var payload = extractEncryptedPayload(pageText);
        if (!payload) return null;
        return fetch(ENC_API + "?text=" + encodeURIComponent(payload));
    })
    .then(function(encRes) {
        if (!encRes || !encRes.ok) return null;
        return encRes.json();
    })
    .then(function(encData) {
        if (!encData || encData.status !== 200 || !encData.result) return null;

        var serversUrl = encData.result.servers;
        var streamBase = encData.result.stream;
        var token = encData.result.token;

        var headers2 = {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Referer": BASE_URL + "/"
        };
        if (token) headers2["X-CSRF-Token"] = token;

        return fetch(serversUrl, { method: "POST", headers: headers2 })
            .then(function(res) { return res.text(); })
            .then(function(text) { return decrypt(text); })
            .then(function(decryptedServers) {
                if (!decryptedServers || !decryptedServers.result || !Array.isArray(decryptedServers.result) || decryptedServers.result.length === 0) return [];

                var promises = decryptedServers.result
                    .filter(function(s) { return BLOCKED_SERVERS.indexOf(s.name) === -1; })
                    .map(function(server, i) {
                        var name = server.name || ("Server " + (i + 1));
                        return fetch(streamBase + "/" + server.data, { method: "POST", headers: headers2 })
                            .then(function(res) {
                                if (!res.ok) return null;
                                return res.text();
                            })
                            .then(function(text) { return decrypt(text); })
                            .then(function(streamData) {
                                if (!streamData || !streamData.result || !streamData.result.url) return null;
                                var data = streamData.result;
                                return {
                                    name: name,
                                    url: data.url,
                                    quality: extractStreamQuality(data),
                                    isM3U8: data.url.indexOf(".m3u8") !== -1
                                };
                            })
                            .catch(function() { return null; });
                    });

                return Promise.all(promises)
                    .then(function(results) {
                        var settled = results.filter(function(r) { return r != null; });

                        var expandPromises = settled.map(function(stream) {
                            if (!stream.isM3U8) return Promise.resolve([stream]);
                            return fetchPlaylistVariants(stream.url).then(function(tracks) {
                                if (tracks && tracks.length > 0) {
                                    return tracks.map(function(t) {
                                        return {
                                            name: stream.name,
                                            url: t.url,
                                            quality: t.quality,
                                            isM3U8: false
                                        };
                                    });
                                }
                                return [stream];
                            });
                        });

                        return Promise.all(expandPromises)
                            .then(function(expandedArrays) {
                                var expanded = [];
                                for (var k = 0; k < expandedArrays.length; k++) {
                                    expanded = expanded.concat(expandedArrays[k]);
                                }

                                var seen = [];
                                var filtered = [];
                                for (var n = 0; n < expanded.length; n++) {
                                    var s = expanded[n];
                                    if (seen.indexOf(s.url) !== -1) continue;
                                    seen.push(s.url);
                                    if (ALLOWED_QUALITIES.indexOf(s.quality) === -1) continue;
                                    filtered.push(s);
                                }
                                return filtered;
                            });
                    });
            });
    })
    .catch(function() { return []; });
}

function sortAndTag(streams) {
    streams.sort(function(a, b) { return resWeight(b.quality) - resWeight(a.quality); });
    var total = streams.length;
    return streams.map(function(s, i) {
        var tag = getInvertedSortTag(total - i, total + 1);
        return {
            name: tag + s.name,
            title: tag + s.title,
            url: s.url,
            quality: s.quality,
            headers: s.headers
        };
    });
}

function normalizeStreams(streams) {
    var mapped = streams.map(function(stream) {
        return {
            name: PROVIDER + " • " + stream.name,
            title: PROVIDER + " • " + stream.name,
            url: stream.url,
            quality: stream.quality,
            headers: {
                "User-Agent": DEFAULT_HEADERS["User-Agent"],
                "Referer": BASE_URL + "/"
            }
        };
    });
    return sortAndTag(mapped);
}

function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType === "tv" && (season == null || episode == null)) {
        return Promise.resolve([]);
    }
    return fetchRawStreams(tmdbId, mediaType, season, episode)
        .then(function(streams) {
            if (!streams || streams.length === 0) return [];
            return normalizeStreams(streams);
        })
        .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };

import http from 'http';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';

const SCRAPE_NINJA_ENDPOINT = 'https://scrapeninja.p.rapidapi.com/scrape';
const SCRAPE_NINJA_HOST = 'scrapeninja.p.rapidapi.com';
const DEFAULT_SCRAPE_NINJA_API_KEY = '455e2a6556msheffc310f7420b51p102ea0jsn1c531be1e299';
const SCRAPE_NINJA_API_KEY = process.env.SCRAPE_NINJA_API_KEY || DEFAULT_SCRAPE_NINJA_API_KEY;
const DATABASE_BATCH_SIZE = 1000;
const DEFAULT_DATABASE_URL_MAX_LENGTH = 255;
const DIRECT_REQUEST_TIMEOUT_MS = 10000;
const DIRECT_REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://www.youtube.com/',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
};
let databaseUrlMaxLength = DEFAULT_DATABASE_URL_MAX_LENGTH;

dotenv.config();


function ensureFullYouTubeUrl(url) {
    if (!url) {
        return '';
    }

    let normalized = url.trim();
    if (!normalized) {
        return '';
    }

    if (/^https?:\/\//i.test(normalized)) {
        return normalized;
    }

    normalized = normalized.replace(/^\/+/, '');

    const lower = normalized.toLowerCase();
    if (/^www\./i.test(normalized)) {
        return `https://${normalized}`;
    }
    if (/^(?:[a-z0-9-]+\.)*youtube\.com\//.test(lower)) {
        return `https://${normalized}`;
    }

    return `https://www.youtube.com/${normalized}`;
}

function truncateForDatabaseUrl(url) {
    if (!url) {
        return '';
    }

    const limitCandidate = databaseUrlMaxLength;
    if (!Number.isFinite(limitCandidate)) {
        return url;
    }

    const normalizedLimit = Math.floor(limitCandidate);
    if (normalizedLimit <= 0) {
        return url;
    }

    if (url.length <= normalizedLimit) {
        return url;
    }

    console.warn(`URL exceeds database column limit (${normalizedLimit}). It will be truncated: ${url}`);
    return url.slice(0, normalizedLimit);
}

async function updateDatabaseUrlMaxLengthFromSchema(connection) {
    try {
        const [rows] = await connection.query(
            `SELECT CHARACTER_MAXIMUM_LENGTH AS max_length FROM information_schema.columns
            WHERE table_schema = DATABASE()
                AND table_name = 'channels_abouts'
                AND column_name = 'url'
            LIMIT 1`
        );

        if (Array.isArray(rows) && rows.length > 0) {
            const schemaLength = rows[0].max_length;
            if (schemaLength === null || typeof schemaLength === 'undefined') {
                databaseUrlMaxLength = Infinity;
                console.log('Detected unlimited length for channels_abouts.url column. URLs will not be truncated.');
                return;
            }

            const parsedLength = Math.floor(Number(schemaLength));
            if (Number.isFinite(parsedLength) && parsedLength > 0) {
                databaseUrlMaxLength = parsedLength;
                console.log(`Detected channels_abouts.url max length: ${parsedLength}`);
                return;
            }

            databaseUrlMaxLength = DEFAULT_DATABASE_URL_MAX_LENGTH;
            console.warn(
                `Unexpected CHARACTER_MAXIMUM_LENGTH (${schemaLength}) for channels_abouts.url. ` +
                `Using default limit ${DEFAULT_DATABASE_URL_MAX_LENGTH}.`
            );
            return;
        }

        databaseUrlMaxLength = DEFAULT_DATABASE_URL_MAX_LENGTH;
        console.warn(
            `Could not retrieve CHARACTER_MAXIMUM_LENGTH for channels_abouts.url. ` +
            `Using default limit ${DEFAULT_DATABASE_URL_MAX_LENGTH}.`
        );
    } catch (err) {
        databaseUrlMaxLength = DEFAULT_DATABASE_URL_MAX_LENGTH;
        console.warn(
            `Failed to determine channels_abouts.url length limit from database. ` +
            `Using default limit ${DEFAULT_DATABASE_URL_MAX_LENGTH}.`,
            err
        );
    }
}


function extractChannelInfo(html) {
    const channelInfo = {
        title: null,
        description: null,
        thumbnail: null,
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        joinedDate: null,
        country: null,
        category: null,
        channelId: null,
        canonicalUrl: null,
        externalLinks: [],
        linkToInstagram: null,
        linkToFacebook: null,
        linkToTwitter: null,
        linkToTiktok: null,
        otherLinks: [],
        verification: null,
        accessType: null,
        accessStatus: null
    };

    try {
        let match;
        if ((match = html.match(/"subscriberCountText":"([^"]+)"/))) {
            channelInfo.subscriberCount = match[1];
        }
        if ((match = html.match(/"viewCountText":"([^"]+)"/))) {
            channelInfo.viewCount = match[1];
        }
        if ((match = html.match(/"videoCountText":"([^"]+)"/))) {
            channelInfo.videoCount = match[1];
        }
        const joinDateFromSelectors = extractAboutChannelRowValue(html, 'info_outline');
        if (joinDateFromSelectors) {
            channelInfo.joinedDate = joinDateFromSelectors;
        } else if ((match = html.match(/"joinedDateText":\s*{\s*"content":"([^"]+)"/))) {
            channelInfo.joinedDate = match[1];
        }
        if ((match = html.match(/"category":"([^"]+)"/))) {
            channelInfo.category = match[1];
        }
        const countryFromSelectors = extractAboutChannelRowValue(html, 'privacy_public');
        if (countryFromSelectors) {
            channelInfo.country = countryFromSelectors;
        } else if ((match = html.match(/"country":"([^"]+)"/))) {
            channelInfo.country = match[1];
        }
        if ((match = html.match(/"canonicalChannelUrl":"([^"]+)"/))) {
            channelInfo.canonicalUrl = match[1];
        }
        if ((match = html.match(/"channelId":"([^"]+)"/))) {
            channelInfo.channelId = match[1];
        }
        if ((match = html.match(/<meta property="og:title" content="([^"]+)"/))) {
            channelInfo.title = match[1];
        }
        if ((match = html.match(/<meta property="og:description" content="([^"]+)"/))) {
            channelInfo.description = match[1];
        }
        if ((match = html.match(/<meta property="og:image" content="([^"]+)"/))) {
            channelInfo.thumbnail = match[1];
        }
        channelInfo.externalLinks = extractExternalLinks(html);
        const categorizedLinks = categorizeExternalLinks(channelInfo.externalLinks);
        channelInfo.linkToInstagram = categorizedLinks.instagram;
        channelInfo.linkToFacebook = categorizedLinks.facebook;
        channelInfo.linkToTwitter = categorizedLinks.twitter;
        channelInfo.linkToTiktok = categorizedLinks.tiktok;
        channelInfo.otherLinks = categorizedLinks.other;
        channelInfo.verification = extractVerificationStatus(html);
        channelInfo.accessStatus = extractAccessType(html);
        channelInfo.views = channelInfo.viewCount;
        channelInfo.videos = channelInfo.videoCount;
        channelInfo.joinDate = channelInfo.joinedDate;
    } catch (err) {
        console.error('Error extracting channel info:', err);
    }

    return channelInfo;
}

function extractAboutChannelRowValue(html, iconName) {
    if (typeof html !== 'string' || !html || typeof iconName !== 'string' || !iconName) {
        return '';
    }

    const iconPattern = new RegExp(`<yt-icon\\b[^>]*\\bicon\\s*=\\s*['"]${escapeForRegex(iconName)}['"]`, 'i');
    const rowRegex = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const attributes = rowMatch[1] || '';
        const rowContent = rowMatch[2] || '';
        const classMatch = attributes.match(/class\s*=\s*(["'])([^"']*)\1/i);

        if (!classMatch) {
            continue;
        }

        const classValue = classMatch[2];
        if (!/\bdescription-item\b/.test(classValue)) {
            continue;
        }

        if (!iconPattern.test(rowContent)) {
            continue;
        }

        const cellRegex = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        let previousCellContainsIcon = false;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const cellContent = cellMatch[2] || '';

            if (previousCellContainsIcon) {
                const cleaned = cleanAboutCellText(cellContent);
                if (cleaned) {
                    return cleaned;
                }
            }

            previousCellContainsIcon = iconPattern.test(cellContent);
        }
    }

    return '';
}

function cleanAboutCellText(fragment) {
    if (typeof fragment !== 'string' || !fragment) {
        return '';
    }

    let text = fragment;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<br\s*\/?\s*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = decodeBasicHtmlEntities(text);
    text = text.replace(/\s+/g, ' ');

    return text.trim();
}

function decodeBasicHtmlEntities(text) {
    if (typeof text !== 'string' || !text) {
        return '';
    }

    return text.replace(/&(#(?:x[0-9a-fA-F]+|\d+)|[a-zA-Z]+);/g, function (match, entity) {
        if (!entity) {
            return match;
        }

        if (entity.charAt(0) === '#') {
            const isHex = entity.charAt(1) === 'x' || entity.charAt(1) === 'X';
            const number = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);

            if (!Number.isNaN(number)) {
                return String.fromCodePoint(number);
            }

            return match;
        }

        switch (entity.toLowerCase()) {
            case 'amp':
                return '&';
            case 'lt':
                return '<';
            case 'gt':
                return '>';
            case 'quot':
                return '"';
            case 'apos':
                return "'";
            case 'nbsp':
                return ' ';
            default:
                return match;
        }
    });
}

function escapeForRegex(value) {
    if (typeof value !== 'string' || !value) {
        return '';
    }

    return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}


function extractExternalLinks(html) {
    const links = [];
    try {
        const regex = /"channelExternalLinkViewModel"\s*:\s*{[^}]*"title"\s*:\s*{\s*"content"\s*:\s*"([^"]+)"[^}]*}\s*[^}]*"link"\s*:\s*{\s*"content"\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            links.push({ title: match[1], url: match[2] });
        }
    } catch (err) {
        console.error('Error extracting external links:', err);
    }
    return links;
}

function categorizeExternalLinks(links = []) {
    const categorized = {
        instagram: null,
        facebook: null,
        twitter: null,
        tiktok: null,
        other: []
    };

    for (const link of links) {
        if (!link || !link.url) {
            continue;
        }

        const url = link.url;
        const lowerUrl = url.toLowerCase();
        const title = (link.title || '').toLowerCase();

        if (!categorized.instagram && (lowerUrl.includes('instagram.com') || title.includes('instagram'))) {
            categorized.instagram = url;
            continue;
        }
        if (!categorized.facebook && (lowerUrl.includes('facebook.com') || title.includes('facebook'))) {
            categorized.facebook = url;
            continue;
        }
        if (!categorized.twitter && (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com') || title.includes('twitter') || title === 'x')) {
            categorized.twitter = url;
            continue;
        }
        if (!categorized.tiktok && (lowerUrl.includes('tiktok.com') || title.includes('tiktok'))) {
            categorized.tiktok = url;
            continue;
        }

        categorized.other.push(link);
    }

    return categorized;
}

function extractVerificationStatus(html) {
    try {
        if (/BADGE_STYLE_TYPE_VERIFIED/.test(html) || /OFFICIAL_ARTIST_CHANNEL/.test(html)) {
            return 'Verified';
        }
    } catch (err) {
        console.error('Error determining verification status:', err);
    }
    return 'Unverified';
}

function extractAccessType(html) {
    try {
        if (/channel is private/i.test(html)) {
            return 'private';
        }
        if (/channel has been terminated/i.test(html) || /account has been terminated/i.test(html)) {
            return 'terminated';
        }
        if (/channel is unavailable/i.test(html) || /channel does not exist/i.test(html)) {
            return 'unavailable';
        }
    } catch (err) {
        console.error('Error determining access type:', err);
    }
    return 'public';
}

function isLikelyYouTubeChannelHtml(html) {
    if (!html) {
        return false;
    }

    const normalizedHtml = html.trim();
    if (!normalizedHtml) {
        return false;
    }

    if (!/<html/i.test(normalizedHtml)) {
        return false;
    }

    const markers = [
        'channelAboutFullMetadataRenderer',
        'ytInitialData',
        'channelMetadataRenderer',
        'ytInitialPlayerResponse'
    ];

    for (const marker of markers) {
        if (normalizedHtml.includes(marker)) {
            return true;
        }
    }

    return false;
}

async function fetchChannelDirectly(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, DIRECT_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: DIRECT_REQUEST_HEADERS,
            redirect: 'follow',
            signal: controller.signal
        });

        if (!response.ok) {
            return {
                ok: false,
                reason: `Direct request failed with status ${response.status} ${response.statusText}`
            };
        }

        const html = await response.text();
        if (!html || !html.trim()) {
            return { ok: false, reason: 'Direct request returned an empty response.' };
        }

        if (!isLikelyYouTubeChannelHtml(html)) {
            return {
                ok: false,
                reason: 'Direct response did not include recognizable channel markup.'
            };
        }

        return { ok: true, html };
    } catch (err) {
        const message =
            err && err.name === 'AbortError'
                ? 'Direct request timed out.'
                : err && err.message
                    ? err.message
                    : String(err);
        return { ok: false, reason: message };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithScrapeNinja(url) {
    if (!SCRAPE_NINJA_API_KEY) {
        return { ok: false, reason: 'ScrapeNinja API key is not configured.' };
    }

    try {
        const response = await fetch(SCRAPE_NINJA_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': SCRAPE_NINJA_HOST,
                'x-rapidapi-key': SCRAPE_NINJA_API_KEY
            },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            return {
                ok: false,
                reason: `ScrapeNinja responded with status ${response.status} ${response.statusText}`
            };
        }

        const responseText = await response.text();
        if (!responseText) {
            return { ok: false, reason: 'Empty response from ScrapeNinja.' };
        }

        let html = '';
        try {
            const json = JSON.parse(responseText);
            if (json && typeof json === 'object') {
                if (typeof json.body === 'string' && json.body.trim()) {
                    html = json.body;
                } else if (typeof json.html === 'string' && json.html.trim()) {
                    html = json.html;
                } else if (typeof json.result === 'string' && json.result.trim()) {
                    html = json.result;
                } else if (typeof json.content === 'string' && json.content.trim()) {
                    html = json.content;
                }
            }
        } catch (jsonParseError) {
            html = '';
        }

        if (!html) {
            html = responseText;
        }

        if (!html || !html.trim()) {
            return { ok: false, reason: 'ScrapeNinja response did not contain HTML content.' };
        }

        return { ok: true, html };
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return { ok: false, reason: message };
    }
}

async function fetchHtml(url) {
    const directResult = await fetchChannelDirectly(url);
    if (directResult.ok) {
        return { ok: true, html: directResult.html, accessType: 'DIRECT' };
    }

    if (directResult.reason) {
        console.warn(`Direct access failed for ${url}: ${directResult.reason}`);
    }

    const proxyResult = await fetchWithScrapeNinja(url);
    if (proxyResult.ok) {
        return { ok: true, html: proxyResult.html, accessType: 'PROXY' };
    }

    const reasons = [];
    if (directResult.reason) {
        reasons.push(`Direct: ${directResult.reason}`);
    }
    if (proxyResult.reason) {
        reasons.push(`ScrapeNinja: ${proxyResult.reason}`);
    }

    return {
        ok: false,
        reason: reasons.join(' | ') || 'Unknown error fetching channel HTML.'
    };
}


async function scrapeNotScrapedChannels() {
    let connection;
    let mysql;
    const parsedBatchSize = Math.floor(Number(DATABASE_BATCH_SIZE));
    const batchSize = Number.isNaN(parsedBatchSize) || parsedBatchSize <= 0 ? 0 : parsedBatchSize;
    if (batchSize <= 0) {
        console.warn(
            `DATABASE_BATCH_SIZE must be a positive integer. Current value: ${DATABASE_BATCH_SIZE}`
        );
        return;
    }
    try {
        mysql = (await import('mysql2/promise')).default;
    } catch (err) {
        console.error(
            'mysql2 module is required to scrape the database. Install it with "npm install" before enabling database scraping.'
        );
        return;
    }
    try {
        console.log('Starting database scraping process...');
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || '3.17.216.88',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'RootSecret1!',
            database: process.env.DB_NAME || 'youtube'
        });

        console.log('Database connected');

        await updateDatabaseUrlMaxLengthFromSchema(connection);

        let offset = 0;
        let batchNumber = 1;
        let totalProcessed = 0;

        while (true) {
            const normalizedOffsetCandidate = Math.floor(Number(offset));
            const normalizedOffset =
                Number.isNaN(normalizedOffsetCandidate) || normalizedOffsetCandidate < 0
                    ? 0
                    : normalizedOffsetCandidate;
            const selectOffset = normalizedOffset;
            const [rows] = await connection.query(
                `SELECT url, query FROM not_scraped_channels ORDER BY url LIMIT ${batchSize} OFFSET ${selectOffset}`
            );

            if (!rows.length) {
                if (totalProcessed === 0) {
                    console.log('No new records found to scrape.');
                }
                break;
            }

            console.log(
                `Fetch new records to scrape from database (batch ${batchNumber}, offset ${selectOffset}): ${rows.length}`
            );

            for (const row of rows) {
                const normalizedUrl = ensureFullYouTubeUrl(row.url);
                if (!normalizedUrl) {
                    continue;
                }

                let channelUrl = normalizedUrl.replace(/\/+$/, '');
                if (!channelUrl.includes('/about')) {
                    channelUrl += '/about';
                }

                console.log(`Scraping channel: ${channelUrl}`);
                const result = await fetchHtml(channelUrl);
                if (!result.ok) {
                    console.error(`Failed to fetch channel ${channelUrl}: ${result.reason}`);
                    continue;
                }

                const info = extractChannelInfo(result.html);
                info.accessType = result.accessType || 'DIRECT';
                if (!info.accessStatus) {
                    info.accessStatus = 'public';
                }
                const otherLinksJson = info.otherLinks?.length ? JSON.stringify(info.otherLinks) : null;
                try {
                    await connection.execute(
                        `INSERT INTO channels_abouts (
                        url,
                        description,
                        videos,
                        views,
                        join_date,
                        link_to_instagram,
                        link_to_facebook,
                        link_to_twitter,
                        link_to_tiktok,
                        other_links,
                        verification,
                        thumbnail,
                        access_type,
                        country
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        description = VALUES(description),
                        videos = VALUES(videos),
                        views = VALUES(views),
                        join_date = VALUES(join_date),
                        link_to_instagram = VALUES(link_to_instagram),
                        link_to_facebook = VALUES(link_to_facebook),
                        link_to_twitter = VALUES(link_to_twitter),
                        link_to_tiktok = VALUES(link_to_tiktok),
                        other_links = VALUES(other_links),
                        verification = VALUES(verification),
                        thumbnail = VALUES(thumbnail),
                        access_type = VALUES(access_type)`,
                        [
                            truncateForDatabaseUrl(normalizedUrl),
                            info.description || null,
                            info.videoCount || info.videos || null,
                            info.viewCount || info.views || null,
                            info.joinedDate || info.joinDate || null,
                            info.linkToInstagram || null,
                            info.linkToFacebook || null,
                            info.linkToTwitter || null,
                            info.linkToTiktok || null,
                            otherLinksJson,
                            info.verification || 'Unverified',
                            info.thumbnail || '',
                            info.accessType || 'DIRECT',
                            info.country || 'Unknown'
                        ]
                    );

                    console.log(`Channel ${channelUrl} was scraped via ${info.accessType} and stored.`);
                } catch (dbErr) {
                    console.error(
                        `Database error while storing channel ${channelUrl}. The scraper will continue with the next channel.`,
                        dbErr
                    );
                }
            }

            totalProcessed += rows.length;
            offset = selectOffset + rows.length;
            batchNumber += 1;

            if (rows.length < batchSize) {
                break;
            }
        }

        console.log(`SCRAPING PROCESS COMPLETED!!! Total processed: ${totalProcessed}`);
    } catch (err) {
        console.error('Database scraping error:', err);
    } finally {
        if (connection) {
            try {
                await connection.end();
                console.log('Database disconnected');
            } catch (endErr) {
                console.error('Error while disconnecting from database:', endErr);
            }
        }
    }
}

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ success: false, error: 'Only POST requests are allowed' }));
        return;
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk;
    });
    req.on('end', async () => {
        try {
            const input = JSON.parse(body || '{}');
            if (!input.channelUrl) {
                res.end(JSON.stringify({ success: false, error: 'Channel URL is required' }));
                return;
            }

            let channelUrl = input.channelUrl.trim();
            console.log(`Manual scrape request received for: ${channelUrl}`);
            try {
                new URL(channelUrl);
            } catch {
                res.end(JSON.stringify({ success: false, error: 'Invalid YouTube URL' }));
                return;
            }
            if (!channelUrl.includes('youtube.com') && !channelUrl.includes('youtu.be')) {
                res.end(JSON.stringify({ success: false, error: 'Invalid YouTube URL' }));
                return;
            }

            channelUrl = channelUrl.replace(/\/+$/, '');
            if (!channelUrl.includes('/about')) {
                channelUrl += '/about';
            }

            const result = await fetchHtml(channelUrl);
            if (result.ok) {
                const channelInfo = extractChannelInfo(result.html);
                channelInfo.accessType = result.accessType || 'DIRECT';
                if (!channelInfo.accessStatus) {
                    channelInfo.accessStatus = 'public';
                }
                if (!channelInfo.title && !channelInfo.channelId) {
                    res.end(JSON.stringify({
                        success: false,
                        error: 'Could not extract channel information. The channel may not exist or be private.'
                    }));
                } else {
                    console.log(`Manual scraping succeeded for: ${channelUrl}`);
                    res.end(JSON.stringify({ success: true, channelInfo }));
                }
            } else {
                console.warn(`Manual scraping failed for ${channelUrl}: ${result.reason}`);
                res.end(JSON.stringify({
                    success: false,
                    error: 'Failed to fetch channel page: ' + result.reason
                }));
            }
        } catch (err) {
            console.error('Channel processing error:', err);
            res.end(JSON.stringify({ success: false, error: 'Server error occurred while processing the channel' }));
        }
    });
});

const PORT = process.env.PORT || 3021;
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('Usage: node server.js [scrape|--no-scrape]');
        console.log('  scrape       Run the database scraping process and exit.');
        console.log('  --no-scrape  Start the HTTP server without triggering the database scrape.');
        process.exit(0);
    }

    if (args[0] === 'scrape') {
        scrapeNotScrapedChannels()
            .then(() => {
                console.log('Scraping completed.');
                process.exit(0);
            })
            .catch(err => {
                console.error('Scraping failed:', err);
                process.exit(1);
            });
    } else {
        const skipScrape = args.includes('--no-scrape');
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
        if (!skipScrape) {
            scrapeNotScrapedChannels().catch(err => {
                console.error('Initial scraping failed:', err);
            });
        }
    }
}

export default server;

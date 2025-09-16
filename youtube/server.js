import http from 'http';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';

dotenv.config();

const SCRAPE_NINJA_ENDPOINT = 'https://scrapeninja.p.rapidapi.com/scrape';
const SCRAPE_NINJA_HOST = 'scrapeninja.p.rapidapi.com';
const DEFAULT_SCRAPE_NINJA_API_KEY = '455e2a6556msheffc310f7420b51p102ea0jsn1c531be1e299';
const SCRAPE_NINJA_API_KEY = process.env.SCRAPE_NINJA_API_KEY || DEFAULT_SCRAPE_NINJA_API_KEY;
const SCRAPE_BATCH_SIZE_ENV = Number.parseInt(process.env.SCRAPE_BATCH_SIZE || '10', 10);
const SCRAPE_DB_LIMIT_ENV = Number.parseInt(
    process.env.SCRAPE_DB_LIMIT || process.env.SCRAPE_FETCH_LIMIT || '1000',
    10
);
const CHANNEL_BATCH_SIZE =
    Number.isNaN(SCRAPE_BATCH_SIZE_ENV) || SCRAPE_BATCH_SIZE_ENV <= 0 ? 10 : SCRAPE_BATCH_SIZE_ENV;
const CHANNEL_FETCH_LIMIT =
    Number.isNaN(SCRAPE_DB_LIMIT_ENV) || SCRAPE_DB_LIMIT_ENV <= 0 ? 1000 : SCRAPE_DB_LIMIT_ENV;
const DEFAULT_URL_MAX_LENGTH = 512;


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

function ensureAboutSectionUrl(url) {
    if (!url) {
        return '';
    }

    let sanitized = url.trim();
    if (!sanitized) {
        return '';
    }

    const hashIndex = sanitized.indexOf('#');
    let hash = '';
    if (hashIndex !== -1) {
        hash = sanitized.slice(hashIndex);
        sanitized = sanitized.slice(0, hashIndex);
    }

    sanitized = sanitized.replace(/\/+$/, '');
    if (!sanitized.toLowerCase().includes('/about')) {
        sanitized += '/about';
    }

    return `${sanitized}${hash}`;
}

function stripAboutSuffix(url) {
    if (!url) {
        return '';
    }
    return url.replace(/\/about(?:\/)?$/i, '');
}

function buildStorageUrl(normalizedUrl, info, urlMaxLength) {
    const sanitizedNormalized = stripAboutSuffix(normalizedUrl);
    const candidates = [];

    if (info && info.canonicalUrl) {
        candidates.push(stripAboutSuffix(ensureFullYouTubeUrl(info.canonicalUrl)));
    }
    if (info && info.channelId) {
        candidates.push(stripAboutSuffix(`https://www.youtube.com/channel/${info.channelId}`));
    }
    candidates.push(sanitizedNormalized);

    for (const candidate of candidates) {
        if (candidate && (!urlMaxLength || candidate.length <= urlMaxLength)) {
            return candidate;
        }
    }

    const fallback = candidates.find(candidate => candidate) || sanitizedNormalized;
    if (urlMaxLength && fallback.length > urlMaxLength) {
        const truncated = fallback.slice(0, urlMaxLength);
        console.warn(
            `Channel URL exceeded maximum length (${urlMaxLength}). Truncating to fit database column. Original length: ${fallback.length}.`
        );
        return truncated;
    }

    return fallback;
}

async function getColumnMaximumLength(connection, schema, table, column) {
    if (!connection || !schema || !table || !column) {
        return null;
    }

    try {
        const [rows] = await connection.execute(
            `SELECT CHARACTER_MAXIMUM_LENGTH AS maxLength
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ? AND column_name = ?
             LIMIT 1`,
            [schema, table, column]
        );
        if (rows && rows.length) {
            const value = Number(rows[0].maxLength);
            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }
    } catch (err) {
        console.warn(
            `Unable to determine maximum length for ${table}.${column}: ${err && err.message ? err.message : err}`
        );
    }

    return null;
}

async function scrapeChannelRow(connection, row, urlMaxLength) {
    if (!row) {
        return false;
    }

    const normalizedUrl = ensureFullYouTubeUrl(row.url);
    if (!normalizedUrl) {
        console.warn('Skipping entry with empty URL from not_scraped_channels.');
        return false;
    }

    const channelUrl = ensureAboutSectionUrl(normalizedUrl);
    console.log(`Scraping channel: ${channelUrl}`);

    const result = await fetchHtml(channelUrl);
    if (!result.ok) {
        console.error(`Failed to fetch channel ${channelUrl}: ${result.reason}`);
        return false;
    }

    const info = extractChannelInfo(result.html);
    const otherLinksJson = info.otherLinks && info.otherLinks.length ? JSON.stringify(info.otherLinks) : null;
    const storageUrl = buildStorageUrl(normalizedUrl, info, urlMaxLength);

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
                    access_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                storageUrl,
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
                info.accessType || 'public'
            ]
        );
        console.log(`Channel ${channelUrl} was scraped and stored.`);
        return true;
    } catch (err) {
        console.error(`Failed to store channel ${channelUrl}: ${err && err.message ? err.message : err}`);
        return false;
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
        accessType: null
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
        if ((match = html.match(/"joinedDateText":\s*{\s*"content":"([^"]+)"/))) {
            channelInfo.joinedDate = match[1];
        }
        if ((match = html.match(/"category":"([^"]+)"/))) {
            channelInfo.category = match[1];
        }
        if ((match = html.match(/"country":"([^"]+)"/))) {
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
        channelInfo.accessType = extractAccessType(html);
        channelInfo.views = channelInfo.viewCount;
        channelInfo.videos = channelInfo.videoCount;
        channelInfo.joinDate = channelInfo.joinedDate;
    } catch (err) {
        console.error('Error extracting channel info:', err);
    }

    return channelInfo;
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

async function fetchHtml(url) {
    try {
        if (!SCRAPE_NINJA_API_KEY) {
            return { ok: false, reason: 'ScrapeNinja API key is not configured.' };
        }

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
        } catch {
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


async function scrapeNotScrapedChannels() {
    let connection;
    let mysql;
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
        const dbConfig = {
            host: process.env.DB_HOST || '3.17.216.88',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'RootSecret1!',
            database: process.env.DB_NAME || 'youtube'
        };

        connection = await mysql.createConnection(dbConfig);

        console.log('Database connected');

        const urlMaxLength =
            (await getColumnMaximumLength(connection, dbConfig.database, 'channels_abouts', 'url')) ||
            DEFAULT_URL_MAX_LENGTH;

        let totalStored = 0;
        let iteration = 0;

        while (true) {
            iteration += 1;
            const [rows] = await connection.execute('SELECT url, query FROM not_scraped_channels LIMIT ?', [
                CHANNEL_FETCH_LIMIT
            ]);
            console.log(`Fetch new records to scrape from database: ${rows.length}`);

            if (!rows.length) {
                if (iteration === 1) {
                    console.log('No new records found to scrape.');
                }
                break;
            }

            const iterationStart = totalStored;
            const totalBatches = Math.ceil(rows.length / CHANNEL_BATCH_SIZE) || 1;

            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
                const batchStart = batchIndex * CHANNEL_BATCH_SIZE;
                const batch = rows.slice(batchStart, batchStart + CHANNEL_BATCH_SIZE);
                console.log(
                    `Processing batch ${batchIndex + 1} of ${totalBatches} (${batch.length} channels)...`
                );

                let batchSuccesses = 0;

                for (const row of batch) {
                    const success = await scrapeChannelRow(connection, row, urlMaxLength);
                    if (success) {
                        batchSuccesses += 1;
                        totalStored += 1;
                    }
                }

                console.log(
                    `Batch ${batchIndex + 1} completed. Successful scrapes: ${batchSuccesses}/${batch.length}.`
                );
            }

            const processedInIteration = totalStored - iterationStart;
            if (processedInIteration === 0) {
                console.warn(
                    'No channels were stored during this iteration. Halting further attempts to avoid repetition.'
                );
                break;
            }

            if (rows.length < CHANNEL_FETCH_LIMIT) {
                break;
            }
        }

        console.log('SCRAPING PROCESS COMPLETED!!!');
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

            channelUrl = ensureAboutSectionUrl(channelUrl);

            const result = await fetchHtml(channelUrl);
            if (result.ok) {
                const channelInfo = extractChannelInfo(result.html);
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

const EXTINF_REGEX = /#EXTINF:-1\s+([^,]*),\s*(.*)/i;

function parseAttributes(attrString) {
    const attrs = {};
    const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(attrString)) !== null) {
        attrs[match[1]] = match[2];
    }
    return attrs;
}

function parseM3U(content = "") {
    const lines = content.split(/\r?\n/);
    const entries = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("#EXTINF")) continue;

        const match = line.match(EXTINF_REGEX);
        if (!match) continue;

        const [, attrString, channelName] = match;
        const attrs = parseAttributes(attrString);

        const urlLine = lines[i + 1]?.trim();
        if (!urlLine || urlLine.startsWith("#")) continue;

        entries.push({
            name: channelName?.trim() || null,
            url: urlLine,
            tvg_id: attrs["tvg-id"] || null,
            tvg_chno: attrs["tvg-chno"] || null,
            tvg_logo: attrs["tvg-logo"] || null,
            tvg_name: attrs["tvg-name"] || channelName?.trim() || null,
            group_title: attrs["group-title"] || null,
        });
    }

    return entries;
}

module.exports = { parseM3U };

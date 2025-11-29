// m3uParser.js
// Small helper to turn pasted M3U playlist text into stream records

function parseAttributes(extinfLine) {
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(extinfLine)) !== null) {
        attrs[match[1]] = match[2];
    }
    return attrs;
}

function normalizeNumber(value) {
    if (value === undefined || value === null) return null;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

function parseM3UContent(m3uContent = "") {
    const trimmed = m3uContent.trim();
    if (!trimmed) {
        return [];
    }

    const normalized = trimmed
        // Handle cases where #EXTINF entries are jammed together on one line
        .replace(/\s+#EXTINF/g, "\n#EXTINF");

    const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines[0]?.startsWith("#EXTM3U")) {
        throw new Error("Invalid M3U header");
    }

    const entries = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith("#EXTINF")) continue;

        const attributes = parseAttributes(line);
        const commaIndex = line.indexOf(",");
        let displayName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : null;
        const urlLine = lines[i + 1];

        let urlCandidate = urlLine && !urlLine.startsWith("#") ? urlLine.trim() : null;

        if (!urlCandidate) {
            const inline = line.match(/https?:\/\/\S+/);
            urlCandidate = inline ? inline[0] : null;
        }

        if (!urlCandidate) {
            continue;
        }

        if (displayName && displayName.includes(urlCandidate)) {
            displayName = displayName.replace(urlCandidate, "").trim();
        }

        entries.push({
            name: displayName || attributes["tvg-name"] || null,
            url: urlCandidate,
            tvg_id: attributes["tvg-id"] || null,
            tvg_chno: normalizeNumber(attributes["tvg-chno"]),
            tvg_logo: attributes["tvg-logo"] || null,
            tvg_name: attributes["tvg-name"] || displayName || null,
        });

        if (urlLine && !urlLine.startsWith("#")) {
            i++; // skip URL line when it occupies its own row
        }
    }

    return entries;
}

module.exports = {
    parseM3UContent,
};

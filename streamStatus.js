// =============================================================
// streamStatus.js — Strict, Correct HLS Stream Checker
// - Works with protected HLS (e.g., Bloomberg, Akamai/Fastly)
// - Uses original URL for Referer/Origin
// - Collects cookies across all redirects
// - Parses master playlist variants, probes one via ffmpeg
// - Compatible with ffmpeg 5.1 (Debian 12) — uses `-t`, no `-read_intervals`
// =============================================================

const { spawn } = require("child_process");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const DEBUG = true; // set to false in production if you want quieter logs
const REQUEST_TIMEOUT_MS = 15000;

// ===================================================================
// A. HTTP request with full redirect + cookie persistence
// ===================================================================
function httpGetWithRedirects(rawUrl, headers = {}, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    const cookies = []; // store ALL cookies across hops

    function doRequest(url, redirectsLeft) {
      if (redirectsLeft < 0) {
        return reject(new Error("Too many redirects"));
      }

      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return reject(new Error("Invalid URL: " + url));
      }

      const client = parsed.protocol === "https:" ? https : http;
      const cookieHeader = cookies.length ? cookies.join("; ") : "";

      const options = {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          ...headers,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      };

      const req = client.request(options, (res) => {
        const setCookies = res.headers["set-cookie"] || [];
        for (const c of setCookies) {
          const base = c.split(";")[0].trim();
          if (base && !cookies.includes(base)) {
            cookies.push(base);
          }
        }

        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          return doRequest(nextUrl, redirectsLeft - 1);
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            finalUrl: url,
            body,
            cookies,
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });
      req.end();
    }

    doRequest(rawUrl, maxRedirects);
  });
}

// ===================================================================
// B. Parse master playlist and extract variants
// ===================================================================
function extractVariantsFromMaster(body, baseUrl) {
  const lines = body.split(/\r?\n/);
  const variants = [];
  let pendingBandwidth = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      pendingBandwidth = bwMatch ? parseInt(bwMatch[1], 10) : null;
      continue;
    }

    if (pendingBandwidth !== null && line && !line.startsWith("#")) {
      let variantUrl;
      try {
        variantUrl = new URL(line, baseUrl).toString();
      } catch {
        pendingBandwidth = null;
        continue;
      }

      let fallbackQuality = null;
      const match = variantUrl.match(/BP-HD-(\d+)/i);
      if (match) {
        fallbackQuality = parseInt(match[1], 10);
      }

      variants.push({
        url: variantUrl,
        bandwidth: pendingBandwidth,
        fallbackQuality,
      });

      pendingBandwidth = null;
      continue;
    }
  }

  return variants;
}

// ===================================================================
// C. Cookie header builder
// ===================================================================
function buildCookieHeader(cookies) {
  if (!cookies || !cookies.length) return "";
  return cookies.join("; ");
}

// ===================================================================
// D. ffmpeg probe for a specific variant playlist
// ===================================================================
async function ffmpegProbeVariant(variantUrl, { ua, referer, origin, cookieHeader }) {
  const uaPart = ua ? `-user_agent "${ua}"` : "";
  const refPart = referer ? `-headers "Referer: ${referer}"` : "";
  const originPart = origin ? `-headers "Origin: ${origin}"` : "";
  const cookiePart = cookieHeader ? `-headers "Cookie: ${cookieHeader}"` : "";

  const cmd = `
    ffmpeg -v error
      ${uaPart}
      ${refPart}
      ${originPart}
      ${cookiePart}
      -t 8
      -i "${variantUrl}"
      -map 0:v:0
      -an
      -f null -
  `.replace(/\s+/g, " ");

  return new Promise((resolve) => {
    if (DEBUG) {
      console.log("\n===== FFMPEG DEBUG START =====");
      console.log("Variant URL:", variantUrl);
      console.log("Headers passed to ffmpeg:");
      console.log("UA:", ua);
      console.log("Referer:", referer);
      console.log("Origin:", origin);
      console.log("Cookie:", cookieHeader);
      console.log("CMD:", cmd);
      console.log("--------------------------------\n");
    }

    const child = spawn(cmd, {
      shell: true,
      env: process.env,
    });

    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 45000);

    const logChunk = (prefix, data) => {
      const text = data.toString();
      output += text;
      if (DEBUG) {
        console.log(`[ffmpeg ${prefix}] ${text.trimEnd()}`);
      }
    };

    child.stdout.on("data", (data) => logChunk("stdout", data));
    child.stderr.on("data", (data) => logChunk("stderr", data));

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (DEBUG) {
        console.log("ffmpeg spawn error:", error.message);
      }
      resolve({ reachable: false, frameCount: 0 });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);

      const matches = [...output.matchAll(/frame=\s*([0-9]+)/g)];
      const frameCount = matches.length
        ? parseInt(matches[matches.length - 1][1], 10)
        : 0;

      if (DEBUG) {
        console.log("\n===== FFMPEG DEBUG END =====");
        console.log("Exit code:", code, "Signal:", signal);
        if (timedOut) {
          console.log("ffmpeg terminated due to timeout (45s).");
        }
        console.log("Captured output (truncated):");
        console.log(output.substring(0, 4000));
        console.log("============================\n");
      }

      resolve({
        reachable: !timedOut && frameCount > 0,
        frameCount,
      });
    });
  });
}

// ===================================================================
// E. Main exported function: checkStreamStatus(originalUrlStr)
// ===================================================================
async function checkStreamStatus(originalUrlStr) {
  let originalUrl;
  try {
    originalUrl = new URL(originalUrlStr);
  } catch {
    return {
      isOnline: false,
      quality: "unverified",
      frameCount: 0,
      expectedFrameRate: null,
    };
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36";

  // IMPORTANT: Referer/Origin are ALWAYS derived from the ORIGINAL URL,
  // not from CDN variants. This is critical for sites like Bloomberg.
  const referer = `${originalUrl.protocol}//${originalUrl.hostname}/`;
  const origin = `${originalUrl.protocol}//${originalUrl.hostname}`;

  const baseHeaders = {
    "User-Agent": ua,
    Referer: referer,
    Origin: origin,
  };

  // STEP 1: Fetch master/variant playlist with headers + cookies
  let master;
  try {
    master = await httpGetWithRedirects(originalUrlStr, baseHeaders);
  } catch (err) {
    if (DEBUG) {
      console.error("Error fetching master playlist:", err.message);
    }
    return {
      isOnline: false,
      quality: "unverified",
      frameCount: 0,
      expectedFrameRate: null,
    };
  }

  const cookieHeader = buildCookieHeader(master.cookies);

  // STEP 2: Try to parse as master playlist (multi-variant)
  const variants = extractVariantsFromMaster(master.body || "", master.finalUrl);

  let variantToProbe;

  if (variants.length > 0) {
    variants.sort((a, b) => {
      const aa = a.bandwidth ?? a.fallbackQuality ?? 999999999;
      const bb = b.bandwidth ?? b.fallbackQuality ?? 999999999;
      return aa - bb;
    });

    variantToProbe = variants[0].url;
  } else {
    // Not a master playlist; treat finalUrl as a direct media playlist
    variantToProbe = master.finalUrl || originalUrlStr;
  }

  // STEP 3: Probe with ffmpeg
  const probe = await ffmpegProbeVariant(variantToProbe, {
    ua,
    referer,
    origin,
    cookieHeader,
  });

  if (!probe.reachable) {
    return {
      isOnline: false,
      quality: "unverified",
      frameCount: probe.frameCount || 0,
      expectedFrameRate: null,
    };
  }

  // Simple quality heuristic based on frames in 8 seconds
  const frames = probe.frameCount || 0;
  let quality = "good";

  if (frames < 100) quality = "degraded";
  if (frames < 5) quality = "stalled";

  return {
    isOnline: true,
    quality,
    frameCount: frames,
    expectedFrameRate: null,
  };
}

module.exports = {
  checkStreamStatus,
};

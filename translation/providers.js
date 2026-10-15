const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MYMEMORY_MAX_QUERY_BYTES = 480;
const REQUEST_TIMEOUT_MS = 20_000;

export const PROVIDERS = Object.freeze({
  mymemory: Object.freeze({
    id: "mymemory",
    name: "MyMemory (no API key)",
    translate: translateWithMyMemory
  })
});

export async function translate(text, sourceLanguage, targetLanguage, providerId = "mymemory") {
  const provider = PROVIDERS[providerId];

  if (!provider) {
    throw new Error("The selected translation provider is not supported.");
  }

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("There is no text to translate.");
  }

  if (sourceLanguage === targetLanguage) {
    return text;
  }

  return provider.translate(text, sourceLanguage, targetLanguage);
}

async function translateWithMyMemory(text, sourceLanguage, targetLanguage) {
  const translatedChunks = [];

  for (const line of text.split(/(\r\n|\n|\r)/u)) {
    if (!line || /^(?:\r\n|\n|\r)$/u.test(line)) {
      translatedChunks.push(line);
      continue;
    }

    for (const chunk of splitByUtf8Bytes(line, MYMEMORY_MAX_QUERY_BYTES)) {
      translatedChunks.push(
        await translateChunkPreservingWhitespace(chunk, sourceLanguage, targetLanguage)
      );
    }
  }

  return translatedChunks.join("");
}

async function translateChunkPreservingWhitespace(chunk, sourceLanguage, targetLanguage) {
  const leadingWhitespace = chunk.match(/^\s*/u)?.[0] ?? "";
  const trailingWhitespace = chunk.match(/\s*$/u)?.[0] ?? "";
  const contentEnd = chunk.length - trailingWhitespace.length;
  const content = chunk.slice(leadingWhitespace.length, contentEnd);

  if (!content) {
    return chunk;
  }

  const url = new URL(MYMEMORY_ENDPOINT);
  url.searchParams.set("q", content);
  url.searchParams.set("langpair", `${sourceLanguage}|${targetLanguage}`);
  url.searchParams.set("mt", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Translation service returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    const serviceStatus = Number(result.responseStatus);
    const translatedText = result.responseData?.translatedText;

    if (serviceStatus && serviceStatus !== 200) {
      throw new Error(cleanServiceError(result.responseDetails));
    }

    if (typeof translatedText !== "string" || !translatedText.trim()) {
      throw new Error("The translation service returned an empty result.");
    }

    if (/^MYMEMORY WARNING:/iu.test(translatedText)) {
      throw new Error(translatedText);
    }

    return `${leadingWhitespace}${decodeHtmlEntities(translatedText)}${trailingWhitespace}`;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The translation request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function splitByUtf8Bytes(text, maxBytes) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;

  while (offset < text.length) {
    let end = offset;
    let lastNaturalBreak = -1;
    let byteCount = 0;

    for (const character of text.slice(offset)) {
      const characterBytes = encoder.encode(character).length;

      if (byteCount + characterBytes > maxBytes) {
        break;
      }

      byteCount += characterBytes;
      end += character.length;

      if (/\s|[.!?;,:]/u.test(character)) {
        lastNaturalBreak = end;
      }
    }

    if (end === offset) {
      throw new Error("Unable to split the text for translation.");
    }

    const chunkEnd = end < text.length && lastNaturalBreak > offset
      ? lastNaturalBreak
      : end;

    chunks.push(text.slice(offset, chunkEnd));
    offset = chunkEnd;
  }

  return chunks;
}

function cleanServiceError(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "The translation service rejected the request.";
  }

  return decodeHtmlEntities(value.trim());
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\""
  };

  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|quot));/giu,
    (match, decimal, hexadecimal, named) => {
      if (decimal) {
        return codePointOrOriginal(Number(decimal), match);
      }

      if (hexadecimal) {
        return codePointOrOriginal(Number.parseInt(hexadecimal, 16), match);
      }

      return namedEntities[named.toLowerCase()] ?? match;
    }
  );
}

function codePointOrOriginal(codePoint, original) {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return original;
  }
}

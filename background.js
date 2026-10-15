import { LANGUAGE_CODES } from "./translation/languages.js";
import { PROVIDERS, translate } from "./translation/providers.js";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  targetLanguage: "ar",
  provider: "mymemory"
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({
    enabled: Boolean(stored.enabled),
    targetLanguage: LANGUAGE_CODES.has(stored.targetLanguage)
      ? stored.targetLanguage
      : DEFAULT_SETTINGS.targetLanguage,
    provider: PROVIDERS[stored.provider]
      ? stored.provider
      : DEFAULT_SETTINGS.provider
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "translate") {
    return false;
  }

  handleTranslationRequest(message)
    .then((translatedText) => sendResponse({ ok: true, translatedText }))
    .catch((error) => sendResponse({
      ok: false,
      error: userFacingError(error)
    }));

  return true;
});

async function handleTranslationRequest(message) {
  const { text, sourceLanguage = "en", targetLanguage } = message;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("There is no text to translate.");
  }

  if (sourceLanguage !== "en") {
    throw new Error("Only English source text is supported right now.");
  }

  if (!LANGUAGE_CODES.has(targetLanguage)) {
    throw new Error("Choose a supported target language in the extension popup.");
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  if (!settings.enabled) {
    throw new Error("Input Translator is disabled.");
  }

  const providerId = PROVIDERS[settings.provider]
    ? settings.provider
    : DEFAULT_SETTINGS.provider;

  return translate(text, sourceLanguage, targetLanguage, providerId);
}

function userFacingError(error) {
  if (error instanceof TypeError) {
    return "Could not reach the translation service. Check your connection.";
  }

  return error?.message || "Translation failed. Please try again.";
}

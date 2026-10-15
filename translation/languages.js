export const LANGUAGES = Object.freeze([
  { code: "ar", name: "Arabic" },
  { code: "tr", name: "Turkish" },
  { code: "no", name: "Norwegian" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "fa", name: "Persian" },
  { code: "ur", name: "Urdu" },
  { code: "hi", name: "Hindi" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" }
]);

export const LANGUAGE_CODES = new Set(LANGUAGES.map(({ code }) => code));

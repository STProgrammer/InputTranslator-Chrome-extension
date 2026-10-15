import { LANGUAGES } from "./translation/languages.js";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  targetLanguage: "ar",
  provider: "mymemory"
});

const enabledInput = document.querySelector("#enabled");
const enabledLabel = document.querySelector("#enabled-label");
const targetLanguageSelect = document.querySelector("#target-language");
const providerSelect = document.querySelector("#provider");
const saveStatus = document.querySelector("#save-status");

for (const language of LANGUAGES) {
  const option = document.createElement("option");
  option.value = language.code;
  option.textContent = language.name;
  targetLanguageSelect.append(option);
}

initialize();

enabledInput.addEventListener("change", saveSettings);
targetLanguageSelect.addEventListener("change", saveSettings);
providerSelect.addEventListener("change", saveSettings);

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  targetLanguageSelect.value = settings.targetLanguage;
  providerSelect.value = settings.provider;
  updateEnabledLabel();
}

async function saveSettings() {
  await chrome.storage.sync.set({
    enabled: enabledInput.checked,
    targetLanguage: targetLanguageSelect.value,
    provider: providerSelect.value
  });

  updateEnabledLabel();
  saveStatus.textContent = "Saved";
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1_200);
}

function updateEnabledLabel() {
  enabledLabel.textContent = enabledInput.checked ? "Enabled" : "Disabled";
}

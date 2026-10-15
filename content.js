(() => {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    targetLanguage: "ar",
    provider: "mymemory"
  });
  const SUPPORTED_INPUT_TYPES = new Set(["text", "search"]);
  const EDITABLE_SELECTOR = [
    "input:focus",
    "textarea:focus",
    "[contenteditable]:focus",
    '[role="textbox"]:focus',
    '[role="searchbox"]:focus',
    '[data-lexical-editor="true"]:focus',
    ".ProseMirror:focus"
  ].join(", ");

  let settings = { ...DEFAULT_SETTINGS, enabled: false };
  let translationStates = new WeakMap();
  let compositionActive = false;
  let suppressEnterUntilKeyUp = false;
  let lastFocusedEditable = null;
  let toastHost = null;
  let toastText = null;
  let toastTimer = null;

  void loadSettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    const previousTarget = settings.targetLanguage;
    const previousProvider = settings.provider;

    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        settings[key] = change.newValue ?? DEFAULT_SETTINGS[key];
      }
    }

    if (
      settings.targetLanguage !== previousTarget ||
      settings.provider !== previousProvider
    ) {
      translationStates = new WeakMap();
    }
  });

  window.addEventListener("focusin", rememberFocusedEditable, true);
  window.addEventListener("compositionstart", () => {
    compositionActive = true;
  }, true);
  window.addEventListener("compositionend", () => {
    compositionActive = false;
  }, true);
  window.addEventListener("blur", () => {
    suppressEnterUntilKeyUp = false;
    compositionActive = false;
  }, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keypress", suppressFollowupEnterEvent, true);
  window.addEventListener("keyup", suppressFollowupEnterEvent, true);

  async function loadSettings() {
    try {
      settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    } catch {
      settings = { ...DEFAULT_SETTINGS, enabled: false };
    }
  }

  function rememberFocusedEditable(event) {
    const editable = getEditableFromEvent(event);

    if (editable && isUsableEditable(editable)) {
      lastFocusedEditable = editable;
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && suppressEnterUntilKeyUp) {
      if (event.repeat) {
        interceptEnter(event);
        return;
      }

      suppressEnterUntilKeyUp = false;
    }

    if (!settings.enabled || !isPlainEnter(event)) {
      return;
    }

    const editable = getEditableFromEvent(event);

    if (!editable || !isUsableEditable(editable)) {
      return;
    }

    const currentText = getEditableText(editable);

    if (!currentText.trim()) {
      return;
    }

    const state = getTranslationState(editable);

    if (!state.inProgress && state.lastTranslatedText === currentText) {
      return;
    }

    interceptEnter(event);

    if (state.inProgress) {
      showToast("Translation already in progress…", "pending");
      return;
    }

    void translateEditable(editable, currentText, state);
  }

  function suppressFollowupEnterEvent(event) {
    if (event.key !== "Enter" || !suppressEnterUntilKeyUp) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type === "keyup") {
      suppressEnterUntilKeyUp = false;
    }
  }

  function isPlainEnter(event) {
    return event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.isComposing &&
      !compositionActive &&
      event.keyCode !== 229;
  }

  function interceptEnter(event) {
    suppressEnterUntilKeyUp = true;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  async function translateEditable(editable, originalText, state) {
    const requestedTargetLanguage = settings.targetLanguage;
    state.inProgress = true;
    showToast("Translating…", "pending");

    try {
      const response = await sendTranslationRequest(originalText, requestedTargetLanguage);

      if (!response?.ok) {
        throw new Error(response?.error || "Translation failed. Please try again.");
      }

      if (typeof response.translatedText !== "string" || !response.translatedText.trim()) {
        throw new Error("The translation service returned an empty result.");
      }

      if (!settings.enabled || settings.targetLanguage !== requestedTargetLanguage) {
        showToast("Settings changed — press Enter to translate", "info");
        return;
      }

      if (!editable.isConnected || getEditableText(editable) !== originalText) {
        showToast("Text changed — press Enter to translate it", "info");
        return;
      }

      replaceEditableText(editable, response.translatedText);
      const replacedText = getEditableText(editable);

      if (!replacedText.trim()) {
        throw new Error("The editor did not accept the translated text.");
      }

      state.lastTranslatedText = replacedText;
      showToast("Translated — press Enter again", "success");
    } catch (error) {
      showToast(error?.message || "Translation failed. Please try again.", "error");
    } finally {
      state.inProgress = false;
    }
  }

  function sendTranslationRequest(text, targetLanguage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "translate",
        text,
        sourceLanguage: "en",
        targetLanguage
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("The extension was reloaded. Refresh this page and try again."));
          return;
        }

        resolve(response ?? {
          ok: false,
          error: "The translation service did not respond."
        });
      });
    });
  }

  function getTranslationState(editable) {
    let state = translationStates.get(editable);

    if (!state) {
      state = { inProgress: false, lastTranslatedText: null };
      translationStates.set(editable, state);
    }

    return state;
  }

  function getEditableFromEvent(event) {
    const path = typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];

    for (const node of path) {
      if (!isElement(node)) {
        continue;
      }

      if (isNativeTextControl(node)) {
        return node;
      }

      if (node.hasAttribute("contenteditable")) {
        return node.isContentEditable ? getEditingHost(node) : null;
      }
    }

    const activeEditable = getDeepActiveElement(document);

    if (isNativeTextControl(activeEditable) || activeEditable?.isContentEditable) {
      return getEditingHost(activeEditable);
    }

    const target = isElement(event.target) ? event.target : event.target?.parentElement;
    const targetEditable = findEditableAround(target);

    if (targetEditable) {
      return targetEditable;
    }

    const selectionEditable = findEditableAround(getSelectionElement());

    if (selectionEditable) {
      return selectionEditable;
    }

    const focusedEditable = document.querySelector(EDITABLE_SELECTOR);

    if (focusedEditable) {
      const nestedEditable = findEditableInside(focusedEditable);
      return getEditingHost(nestedEditable || focusedEditable);
    }

    if (
      lastFocusedEditable?.isConnected &&
      (lastFocusedEditable === document.activeElement || lastFocusedEditable.contains(target))
    ) {
      return lastFocusedEditable;
    }

    return null;
  }

  function isElement(value) {
    return value?.nodeType === Node.ELEMENT_NODE;
  }

  function isNativeTextControl(element) {
    return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA";
  }

  function getDeepActiveElement(root) {
    let activeElement = root.activeElement ?? null;

    while (activeElement?.shadowRoot?.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement;
  }

  function getSelectionElement() {
    const anchorNode = document.getSelection()?.anchorNode;

    if (!anchorNode) {
      return null;
    }

    return isElement(anchorNode) ? anchorNode : anchorNode.parentElement;
  }

  function findEditableAround(element) {
    if (!element) {
      return null;
    }

    if (isNativeTextControl(element)) {
      return element;
    }

    const contentEditable = element.closest?.("[contenteditable]");

    if (contentEditable) {
      return contentEditable.isContentEditable ? getEditingHost(contentEditable) : null;
    }

    if (isTextboxRole(element)) {
      return findEditableInside(element);
    }

    const roleContainer = element.closest?.('[role="textbox"], [role="searchbox"]');
    return roleContainer ? findEditableInside(roleContainer) : null;
  }

  function findEditableInside(container) {
    if (!container) {
      return null;
    }

    const shadowActiveElement = container.shadowRoot
      ? getDeepActiveElement(container.shadowRoot)
      : null;

    if (isNativeTextControl(shadowActiveElement) || shadowActiveElement?.isContentEditable) {
      return shadowActiveElement;
    }

    return container.querySelector?.(
      'input:focus, textarea:focus, [contenteditable]:focus, input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable]:not([contenteditable="false"])'
    ) ?? null;
  }

  function isTextboxRole(element) {
    const role = element.getAttribute?.("role")?.toLowerCase();
    return role === "textbox" || role === "searchbox";
  }

  function getEditingHost(element) {
    if (!element || isNativeTextControl(element)) {
      return element;
    }

    let host = element;

    while (host.parentElement?.isContentEditable) {
      host = host.parentElement;
    }

    return host;
  }

  function isUsableEditable(editable) {
    if (editable.tagName === "INPUT") {
      return SUPPORTED_INPUT_TYPES.has(editable.type.toLowerCase()) &&
        !editable.disabled &&
        !editable.readOnly &&
        !editable.matches(":disabled");
    }

    if (editable.tagName === "TEXTAREA") {
      return !editable.disabled &&
        !editable.readOnly &&
        !editable.matches(":disabled");
    }

    return editable.isContentEditable &&
      editable.getAttribute("aria-disabled")?.toLowerCase() !== "true" &&
      editable.getAttribute("aria-readonly")?.toLowerCase() !== "true";
  }

  function getEditableText(editable) {
    if (isNativeTextControl(editable)) {
      return editable.value;
    }

    return editable.innerText ?? editable.textContent ?? "";
  }

  function replaceEditableText(editable, translatedText) {
    if (editable.tagName === "INPUT" || editable.tagName === "TEXTAREA") {
      replaceFormControlText(editable, translatedText);
      return;
    }

    replaceContentEditableText(editable, translatedText);
  }

  function replaceFormControlText(editable, translatedText) {
    const prototype = editable.tagName === "INPUT"
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (!valueSetter) {
      throw new Error("This field does not allow its value to be replaced.");
    }

    valueSetter.call(editable, translatedText);
    editable.dispatchEvent(buildInputEvent(translatedText));

    try {
      editable.setSelectionRange(translatedText.length, translatedText.length);
    } catch {
      // Some custom controls expose the input API without supporting selection.
    }
  }

  function replaceContentEditableText(editable, translatedText) {
    editable.focus({ preventScroll: true });
    selectContents(editable);

    let inputEventObserved = false;
    const observeInput = () => {
      inputEventObserved = true;
    };

    editable.addEventListener("input", observeInput, { capture: true, once: true });

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, translatedText);
    } catch {
      inserted = false;
    }

    editable.removeEventListener("input", observeInput, true);

    if (!inserted || !contentMatches(editable, translatedText)) {
      editable.replaceChildren(document.createTextNode(translatedText));
      inputEventObserved = false;
    }

    if (!inputEventObserved) {
      editable.dispatchEvent(buildInputEvent(translatedText));
    }

    placeCaretAtEnd(editable);
  }

  function contentMatches(editable, expectedText) {
    return normalizeLineEndings(getEditableText(editable)) ===
      normalizeLineEndings(expectedText);
  }

  function normalizeLineEndings(value) {
    return value.replace(/\r\n/gu, "\n");
  }

  function buildInputEvent(data) {
    try {
      return new InputEvent("input", {
        bubbles: true,
        composed: true,
        data,
        inputType: "insertReplacementText"
      });
    } catch {
      return new Event("input", { bubbles: true, composed: true });
    }
  }

  function selectContents(editable) {
    const selection = getSelectionForEditable(editable);
    const range = editable.ownerDocument.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtEnd(editable) {
    const selection = getSelectionForEditable(editable);
    const range = editable.ownerDocument.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getSelectionForEditable(editable) {
    const root = editable.getRootNode();

    if (typeof root.getSelection === "function") {
      return root.getSelection();
    }

    return editable.ownerDocument.getSelection();
  }

  function showToast(message, status) {
    ensureToast();
    toastText.textContent = message;
    toastText.dataset.status = status;
    toastText.hidden = false;

    clearTimeout(toastTimer);

    if (status === "pending") {
      return;
    }

    const duration = status === "error" ? 5_000 : 2_500;
    toastTimer = setTimeout(() => {
      toastText.hidden = true;
    }, duration);
  }

  function ensureToast() {
    if (toastHost?.isConnected) {
      return;
    }

    toastHost = document.createElement("div");
    toastHost.setAttribute("data-input-translator-ui", "");
    const shadowRoot = toastHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      [role="status"] {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        box-sizing: border-box;
        max-width: min(340px, calc(100vw - 32px));
        padding: 9px 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 8px;
        background: #202124;
        color: #f8f9fa;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
        overflow-wrap: anywhere;
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      [data-status="success"] { border-color: #58a86b; }
      [data-status="error"] { border-color: #e07171; }
      [hidden] { display: none !important; }
    `;

    toastText = document.createElement("div");
    toastText.setAttribute("role", "status");
    toastText.setAttribute("aria-live", "polite");
    toastText.hidden = true;

    shadowRoot.append(style, toastText);
    (document.documentElement || document).appendChild(toastHost);
  }
})();

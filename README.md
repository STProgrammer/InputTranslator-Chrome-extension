# Input Translator

Input Translator is a small Chrome Manifest V3 extension that translates English text in an editable field before a website receives Enter.

Chrome 119 or newer is required.

## How it works

1. Type English in a supported field.
2. Press plain **Enter**. The extension stops that key event, translates the current text, replaces it, and does not submit anything.
3. Press **Enter** again without changing the translated text. The extension leaves the event untouched, so the website searches, sends, or submits normally.
4. If the text changes, the next plain Enter translates again.

Shift+Enter, Ctrl+Enter, Alt+Enter, Command+Enter, and IME composition input are not intercepted.

Supported fields are text/search inputs, textareas, contenteditable editors (including the editor style used by ChatGPT), ARIA textbox/searchbox wrappers, and editable controls inside open JavaScript shadow roots. Password, email, URL, telephone, number, disabled, and read-only controls are ignored.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Reload any already-open pages where you want to use the extension.
6. Open the extension popup, choose a target language, and make sure it is enabled.

When updating the unpacked extension, click its **Reload** button on `chrome://extensions`, then refresh every test page. Chrome cannot replace an old content-script instance in a tab that is already open.

Chrome does not allow extensions to run on browser-internal pages such as `chrome://` pages. Some sites can also prohibit extensions in protected or sandboxed frames.

## Page-translation compatibility

The extension never translates webpage contents. It reads and replaces only the supported field in which plain Enter was pressed. Chrome webpage translation and extensions such as Google Translate therefore remain independent and can translate the resulting page as usual.

## Translation provider

The initial provider is [MyMemory](https://mymemory.translated.net/doc/spec.php). It does not require an API key. Text is sent to MyMemory only when you press plain Enter in a supported, non-empty field while the extension is enabled. MyMemory has usage limits and its own terms/privacy policy; avoid sending sensitive text.

Provider-specific network code lives in `translation/providers.js` behind this interface:

```js
translate(text, sourceLanguage, targetLanguage, providerId)
```

This makes it straightforward to add a different backend later. No secret or API key is hard-coded in the extension.

## Manual test checklist

For each applicable test, type `best restaurants in Casablanca` and use a non-English target language.

- [ ] Google Search: first Enter replaces the query and does not search; second Enter searches.
- [ ] YouTube Search: first Enter replaces the query and stays on the current page; second Enter opens the search results.
- [ ] ChatGPT: first Enter replaces the draft and does not send; second Enter sends.
- [ ] A normal `<input type="text">`: first Enter translates; second Enter follows the form's normal behavior.
- [ ] A `<textarea>`: first Enter translates; second Enter follows the site's normal behavior.
- [ ] A `contenteditable` element: translation appears and the framework/editor recognizes it.
- [ ] Edit the translated value, then press Enter: it translates again instead of submitting.
- [ ] Press Enter repeatedly while a request is running: only one translation request is made and nothing submits.
- [ ] Cause a network failure: the original text remains, an unobtrusive error appears, and nothing submits.
- [ ] Shift+Enter inserts a newline where the site supports it and is never translated.
- [ ] Ctrl+Enter, Alt+Enter, and Command+Enter remain untouched.
- [ ] Password, email, URL, telephone, number, disabled, read-only, empty, and whitespace-only fields remain untouched.

## Files

- `manifest.json` — Manifest V3 permissions, service worker, and content-script registration.
- `content.js` — early Enter interception, editable detection, per-element state, framework-compatible replacement, shadow-root lookup, translation requests, and status messages.
- `background.js` — validates translation requests and invokes the selected provider.
- `translation/providers.js` — provider abstraction and MyMemory implementation.
- `translation/languages.js` — shared, easily extended language list.
- `popup.html`, `popup.js`, `popup.css` — persisted enable/language/provider settings.

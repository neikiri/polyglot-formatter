// --- HIGHLIGHT ---

/**
 * Highlights the output code using Prism.js.
 * @param {string} code - The formatted code string
 * @param {string} language - One of the supported language keys
 */
function highlightOutput(code, language) {
  const outputEl = document.getElementById('output-code');
  const outputWrapper = outputEl.closest('.output-wrapper');
  const prismLang = APP_CONFIG.prismLanguages[language] || 'markup';
  const grammar = Prism.languages[prismLang] || Prism.languages.markup;

  code = String(code || '').replace(/^\s*\n/, '').replace(/\s+$/, '');

  outputEl.textContent = code;

  outputEl.className = 'language-' + prismLang;
  outputEl.parentElement.className = 'language-' + prismLang;

  outputEl.innerHTML = grammar ? Prism.highlight(code, grammar, prismLang) : outputEl.textContent;

  if (outputWrapper) {
    outputWrapper.scrollTop = 0;
    outputWrapper.scrollLeft = 0;
  }
}

/**
 * Shows an error banner in the output panel.
 * @param {string} message - Error message to display
 */
function showOutputError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.style.display = 'block';
  banner.classList.remove('success');
}

/**
 * Shows a success banner in the output panel.
 * @param {string} message - Success message to display
 */
function showOutputSuccess(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.style.display = 'block';
  banner.classList.add('success');
}

/**
 * Hides the error banner.
 */
function hideOutputError() {
  const banner = document.getElementById('error-banner');
  banner.style.display = 'none';
  banner.textContent = '';
  banner.classList.remove('success');
}

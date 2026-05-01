// --- UI INIT ---

(function () {
  'use strict';

  let cmEditor = null;
  let currentEditorLanguage = 'php';

  function getCodeMirrorMode(language) {
    switch (language) {
      case 'php':
        return 'application/x-httpd-php';
      case 'html':
        return 'htmlmixed';
      case 'css':
        return 'css';
      case 'javascript':
        return 'javascript';
      case 'json':
        return { name: 'javascript', json: true };
      default:
        return 'htmlmixed';
    }
  }

  function setInputMode(language) {
    if (!cmEditor || language === currentEditorLanguage) return;
    currentEditorLanguage = language;
    cmEditor.setOption('mode', getCodeMirrorMode(language));
  }

  function updateInputMode() {
    if (!cmEditor || typeof detectLanguage !== 'function') return;
    const code = cmEditor.getValue();
    let language = code.trim() ? detectLanguage(code) : 'php';
    if (language === 'html' && typeof containsPHPBlock === 'function' && containsPHPBlock(code)) {
      language = 'php';
    }
    setInputMode(language);
  }

  // --- Initialize CodeMirror ---
  function initEditor() {
    const textarea = document.getElementById('input-editor');
    cmEditor = CodeMirror.fromTextArea(textarea, {
      mode: getCodeMirrorMode(currentEditorLanguage),
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: true
    });
    cmEditor.setSize('100%', '100%');
    cmEditor.on('change', updateInputMode);
  }

  // --- Get current options from UI ---
  function getOptions() {
    const deepModeEl = document.getElementById('opt-deep-mode');
    const quotedKeysEl = document.getElementById('opt-quoted-keys');
    const deepMode = deepModeEl ? deepModeEl.checked : false;

    return {
      indentSize: parseInt(document.getElementById('opt-indent').value, 10) || 2,
      preserveNewlines: document.getElementById('opt-newlines').checked,
      wrapLineLength: parseInt(document.getElementById('opt-wrap').value, 10) || 120,
      safeMode: !deepMode,
      deepMode: deepMode,
      preserveQuotedKeys: quotedKeysEl ? quotedKeysEl.checked : true,
      deepStringValues: false
    };
  }

  // --- Event: Beautify ---
  function onBeautify() {
    const code = cmEditor ? cmEditor.getValue() : '';
    if (!code.trim()) return;

    const options = getOptions();
    const result = beautifyCode(code, options);

    hideOutputError();

    if (result.error) {
      showOutputError(result.error);
    }

    // Run post-formatting validation
    const warnings = validateOutput(result.code, result.detectedLanguage, code, options);
    if (warnings.length > 0) {
      const msg = (result.error ? result.error + '\n' : '') +
        'Validation: ' + warnings.join(' | ');
      showOutputError(msg);
    } else if (!result.error) {
      showOutputSuccess('Validation: OK');
    }

    // Use detected language for syntax highlighting in output
    highlightOutput(result.code, result.detectedLanguage || 'html');

    // Show detected language badge
    updateDetectedBadge(result.detectedLanguage);
  }

  // --- Update detected language indicator ---
  function updateDetectedBadge(language) {
    const badge = document.getElementById('detected-lang');
    if (badge && language) {
      badge.textContent = language.toUpperCase();
      badge.style.display = 'inline-block';
    }
  }

  // --- Event: Copy output ---
  function onCopy() {
    const outputEl = document.getElementById('output-code');
    const text = outputEl.textContent || '';
    if (!text.trim()) return;

    navigator.clipboard.writeText(text).then(function () {
      const btn = document.getElementById('btn-copy');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = orig; }, 1500);
    }).catch(function () {
      // Fallback: select and copy
      const range = document.createRange();
      range.selectNodeContents(outputEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    });
  }

  // --- Event: Clear ---
  function onClear() {
    if (cmEditor) cmEditor.setValue('');
    const outputEl = document.getElementById('output-code');
    outputEl.textContent = '';
    outputEl.className = '';
    hideOutputError();
    const badge = document.getElementById('detected-lang');
    if (badge) badge.style.display = 'none';
  }

  // --- Toggle Deep mode warning ---
  function onDeepModeToggle() {
    var checkbox = document.getElementById('opt-deep-mode');
    var warning = document.getElementById('deep-mode-warning');
    if (warning) {
      warning.style.display = checkbox.checked ? 'block' : 'none';
    }
  }

  // --- Bind events ---
  function bindEvents() {
    document.getElementById('btn-beautify').addEventListener('click', onBeautify);
    document.getElementById('btn-copy').addEventListener('click', onCopy);
    document.getElementById('btn-clear').addEventListener('click', onClear);
    document.getElementById('opt-deep-mode').addEventListener('change', onDeepModeToggle);
  }

  // --- Boot ---
  function boot() {
    initEditor();
    bindEvents();
    onDeepModeToggle();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

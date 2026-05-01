// --- BEAUTIFY ---
// Universal formatter — auto-detects the dominant language and formats
// the STRUCTURAL code at each nesting level.
//
// CRITICAL RULE: safe mode never changes runtime string values and never
// formats string payloads. Deep mode may format nested string payloads only
// after decoding and re-escaping them for the host language.
//
// Nesting handled:
// 1. HTML structure + real <style> blocks (CSS) + real <script> blocks (JS)
// 2. PHP files: format PHP logic structure; if mixed with HTML, format
//    the top-level HTML structure and leave PHP blocks intact
// 3. JSON: pretty-print structure; string values stay exact by default
// 4. JS: format JS structure; deep mode can format nested strings/templates
// 5. CSS: format CSS structure; content:"..." values stay untouched by default

/**
 * Auto-detects the dominant language and formats structural code.
 * Returns { code: string, error: string|null, detectedLanguage: string }
 */
function beautifyCode(code, options) {
  options = options || {};

  const opts = {
    indent_size: options.indentSize || 2,
    preserve_newlines: options.preserveNewlines !== false,
    wrap_line_length: options.wrapLineLength || 120,
    end_with_newline: true,
    safeMode: options.safeMode !== false && options.deepMode !== true,
    deepMode: options.deepMode === true,
    preserveQuotedKeys: options.preserveQuotedKeys !== false,
    deepStringValues: options.deepStringValues === true,
    // RULE: Deep mode does NOT format CSS content:"..." strings.
    // Newlines inside CSS content change the rendered output, making it unsafe.
    _nestedDepth: 0
  };

  const detected = detectLanguage(code);

  try {
    switch (detected) {
      case 'php':
        return { code: beautifyPHP(code, opts), error: null, detectedLanguage: 'php' };
      case 'html':
        return { code: beautifyHTML(code, opts), error: null, detectedLanguage: 'html' };
      case 'json':
        return beautifyJSON(code, opts);
      case 'javascript':
        return { code: beautifyJS(code, opts), error: null, detectedLanguage: 'javascript' };
      case 'css':
        return { code: beautifyCSS(code, opts), error: null, detectedLanguage: 'css' };
      default:
        return { code: beautifyHTML(code, opts), error: null, detectedLanguage: 'html' };
    }
  } catch (e) {
    return { code: code, error: 'Beautification failed: ' + e.message, detectedLanguage: detected };
  }
}

// =============================================================================
// AUTO-DETECTION
// =============================================================================
function detectLanguage(code) {
  var trimmed = code.trim();

  // PHP: starts with <?php or contains <?php/<?= at top level (not inside a string)
  if (/^<\?(php|=)/i.test(trimmed)) {
    return 'php';
  }

  // JSON: starts with { or [ and is valid JSON
  if (/^[\[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch (e) { /* not JSON */ }
  }

  // HTML: starts with < (tag or comment or doctype)
  if (/^(<[!a-z])/i.test(trimmed)) {
    return 'html';
  }

  // CSS: starts with comment or selector-like pattern, no JS keywords
  if (/^(\/\*|[.#@:a-z[])/i.test(trimmed) &&
      !/(^|\n)\s*(const|let|var|function|import|export|class|document|window|console)\b/m.test(trimmed)) {
    return 'css';
  }

  // JavaScript: has JS keywords
  if (/\b(const|let|var|function|import|export|class|document|window|console)\b/.test(trimmed)) {
    return 'javascript';
  }

  // If has HTML tags at all, treat as HTML
  if (/<[a-z][^>]*>/i.test(trimmed)) {
    return 'html';
  }

  return 'html';
}

// =============================================================================
// SHARED HELPERS
// =============================================================================
function getChildOptions(opts) {
  var child = {};
  Object.keys(opts).forEach(function(key) {
    child[key] = opts[key];
  });
  child._nestedDepth = (opts._nestedDepth || 0) + 1;
  return child;
}

function canFormatNested(opts) {
  return opts.deepMode === true && (opts._nestedDepth || 0) < 4;
}

function protectPHPBlocks(code, opts) {
  var blocks = [];
  var forceInline = opts && opts._cssValueContext;
  var protectedCode = code.replace(/<\?(?:php\b|=)[\s\S]*?(?:\?>|$)/gi, function(block) {
    var idx = blocks.length;
    var stored = (opts && opts.deepMode) ? formatInlinePHPBlock(block, forceInline) : block;
    blocks.push(stored);
    return '___PHP_BLOCK_' + idx + '___';
  });

  return {
    code: protectedCode,
    restore: function(text) {
      return text.replace(/___PHP_BLOCK_(\d+)___/g, function(match, idx) {
        return blocks[parseInt(idx, 10)] || match;
      });
    }
  };
}

function protectPHPBlocksInsideJSStrings(code) {
  var blocks = [];
  var out = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '/' && next === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      if (lineEnd === -1) lineEnd = code.length;
      out += code.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) commentEnd = code.length - 2;
      out += code.slice(i, commentEnd + 2);
      i = commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var quoted = readQuotedLiteral(code, i, ch);
      if (!quoted) {
        out += ch;
        i++;
        continue;
      }

      out += protectPHPBlocksInText(quoted.raw, blocks);
      i = quoted.end;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(code, i);
      if (!template) {
        out += ch;
        i++;
        continue;
      }

      out += protectPHPBlocksInText(template.raw, blocks);
      i = template.end;
      continue;
    }

    out += ch;
    i++;
  }

  return {
    code: out,
    restore: function(text) {
      return restorePHPStringBlockPlaceholders(text, blocks);
    }
  };
}

function protectPHPBlocksInText(text, blocks) {
  return text.replace(/<\?(?:php\b|=)[\s\S]*?(?:\?>|$)/gi, function(block) {
    var idx = blocks.length;
    blocks.push(block);
    return '___PHP_STRING_BLOCK_' + idx + '___';
  });
}

function restorePHPStringBlockPlaceholders(text, blocks) {
  return text.replace(/___PHP_STRING_BLOCK_(\d+)___/g, function(match, idx) {
    return blocks[parseInt(idx, 10)] || match;
  });
}

/**
 * Formats an inline PHP block (<?php ... ?>) for readability in Deep mode.
 * Adds spaces around operators and after semicolons, breaks multi-statement
 * blocks into multiple lines.
 */
function formatInlinePHPBlock(block, forceInline) {
  // Short tags like <?= expr ?> — leave as-is
  if (/^<\?=/.test(block)) return block;
  if (forceInline) return block;

  var openMatch = block.match(/^(<\?php\s*)/i);
  if (!openMatch) return block;

  var hasClose = /\?>\s*$/.test(block);
  var inner = block.slice(openMatch[0].length);
  if (hasClose) {
    inner = inner.replace(/\s*\?>\s*$/, '');
  }

  inner = inner.trim();
  if (!inner) return block;

  // Split PHP into statements by semicolons, respecting strings
  var statements = splitPHPStatements(inner);
  if (statements.length <= 1) {
    // Single statement — just add spaces
    var formatted = formatPHPStatement(inner);
    return '<?php ' + formatted + (hasClose ? '; ?>' : ';');
  }

  // Multi-statement — format each, put on separate lines with indentation
  var lines = [];
  var phpIndent = '  ';
  for (var i = 0; i < statements.length; i++) {
    var stmt = formatPHPStatement(statements[i].trim());
    if (stmt) lines.push(phpIndent + stmt + ';');
  }

  if (hasClose) {
    return '<?php\n' + lines.join('\n') + '\n?>';
  }
  return '<?php\n' + lines.join('\n');
}

/**
 * Splits PHP code by semicolons, respecting string literals.
 */
function splitPHPStatements(code) {
  var statements = [];
  var current = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);

    // Skip string literals
    if (ch === '"' || ch === "'") {
      var end = findPHPStringEnd(code, i, ch);
      current += code.slice(i, end);
      i = end;
      continue;
    }

    if (ch === ';') {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

/**
 * Finds the end of a PHP string literal starting at pos.
 */
function findPHPStringEnd(code, start, quote) {
  var i = start + 1;
  while (i < code.length) {
    var ch = code.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i++;
  }
  return code.length;
}

/**
 * Adds spaces around = operators and after commas in a single PHP statement.
 */
function formatPHPStatement(stmt) {
  // Remove trailing semicolons
  stmt = stmt.replace(/;\s*$/, '');

  var out = '';
  var i = 0;

  while (i < stmt.length) {
    var ch = stmt.charAt(i);

    // Protect strings
    if (ch === '"' || ch === "'") {
      var end = findPHPStringEnd(stmt, i, ch);
      out += stmt.slice(i, end);
      i = end;
      continue;
    }

    // Space around => in PHP arrays
    if (ch === '=' && stmt.charAt(i + 1) === '>') {
      if (out.length > 0 && out.charAt(out.length - 1) !== ' ') {
        out += ' ';
      }
      out += '=>';
      i += 2;
      if (i < stmt.length && stmt.charAt(i) !== ' ') {
        out += ' ';
      }
      continue;
    }

    // Space around = but not ==, !=, <=, >=, .= etc.
    if (ch === '=' && stmt.charAt(i + 1) !== '=') {
      var prev = stmt.charAt(i - 1);
      if (prev !== '!' && prev !== '<' && prev !== '>' && prev !== '.' && prev !== '=') {
        // Ensure space before =
        if (out.length > 0 && out.charAt(out.length - 1) !== ' ') {
          out += ' ';
        }
        out += '=';
        // Ensure space after =
        if (i + 1 < stmt.length && stmt.charAt(i + 1) !== ' ') {
          out += ' ';
        }
        i++;
        continue;
      }
    }

    // Space after comma
    if (ch === ',' && i + 1 < stmt.length && stmt.charAt(i + 1) !== ' ') {
      out += ', ';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function protectRawTagContents(code) {
  var blocks = [];
  var protectedCode = code.replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, function(match, open, tag, content, close) {
    var idx = blocks.length;
    blocks.push(content);
    return open + '___RAW_TAG_CONTENT_' + idx + '___' + close;
  });

  return {
    code: protectedCode,
    restore: function(text) {
      return text.replace(/___RAW_TAG_CONTENT_(\d+)___/g, function(match, idx) {
        return blocks[parseInt(idx, 10)] || match;
      });
    }
  };
}

function protectWholeTagBlocks(code, tagName) {
  var blocks = [];
  var pattern = new RegExp('(<(' + tagName + ')\\b[^>]*>[\\s\\S]*?<\\/\\2>)', 'gi');
  var protectedCode = code.replace(pattern, function(block) {
    var idx = blocks.length;
    blocks.push(block);
    return '___WHOLE_' + tagName.toUpperCase() + '_BLOCK_' + idx + '___';
  });
  var restorePattern = new RegExp('___WHOLE_' + tagName.toUpperCase() + '_BLOCK_(\\d+)___', 'g');

  return {
    code: protectedCode,
    restore: function(text) {
      return text.replace(restorePattern, function(match, idx) {
        return blocks[parseInt(idx, 10)] || match;
      });
    }
  };
}

function getBlockIndents(content, opts) {
  var closeMatch = content.match(/\n([ \t]*)$/);
  var closeIndent = closeMatch ? closeMatch[1] : '';
  var contentIndent = closeIndent + repeatString(' ', opts.indent_size);
  var lines = content.split(/\r?\n/);

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      contentIndent = (lines[i].match(/^[ \t]*/) || [''])[0];
      break;
    }
  }

  return {
    content: contentIndent,
    close: closeIndent
  };
}

function indentMultiline(text, indent) {
  if (!text) return '';
  return text.split('\n').map(function(line) {
    return line ? indent + line : '';
  }).join('\n');
}

function repeatString(str, count) {
  return new Array(count + 1).join(str);
}

function looksLikeHTML(value) {
  var trimmed = value.trim();
  return /^<!doctype\b/i.test(trimmed) ||
    /^<(html|head|body|style|script|section|div|main|article|template)\b/i.test(trimmed) ||
    (/^<[a-z][\w:-]*(?:\s|>)/i.test(trimmed) && /<\/[a-z][\w:-]*>/i.test(trimmed));
}

function looksLikeCSS(value) {
  var trimmed = value.trim();
  return /[{}]/.test(trimmed) &&
    (/^[.#@:[\]a-z0-9_\-\s,*>"'=]+{/i.test(trimmed) || /^@(?:media|supports|keyframes|font-face)\b/i.test(trimmed));
}

function looksLikeJSON(value) {
  var trimmed = value.trim();
  if (!/^[\[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch (e) {
    return false;
  }
}

function beautifyNestedStringValue(value, opts) {
  if (!canFormatNested(opts)) return value;

  var leading = (value.match(/^\s*/) || [''])[0];
  var trailing = (value.match(/\s*$/) || [''])[0];
  var core = value.slice(leading.length, value.length - trailing.length);
  var trimmed = core.trim();
  var childOpts = getChildOptions(opts);
  var formatted = null;

  if (!trimmed) return value;

  try {
    if (looksLikeHTML(trimmed)) {
      formatted = beautifyHTML(trimmed, childOpts);
    } else if (looksLikeCSS(trimmed)) {
      formatted = beautifyCSS(trimmed, childOpts);
    } else if (looksLikeJSON(trimmed)) {
      var parsedJSON = JSON.parse(trimmed);
      var nestedJSON = opts.deepStringValues ? formatNestedJSONValue(parsedJSON, childOpts) : parsedJSON;
      formatted = JSON.stringify(nestedJSON, null, opts.indent_size);
    }
  } catch (e) {
    return value;
  }

  if (!formatted || formatted === trimmed) return value;
  if (opts.preserve_newlines && !hasLineBreak(value) && hasLineBreak(formatted)) return value;
  return leading + formatted + trailing;
}

function hasLineBreak(value) {
  return /[\r\n]/.test(value);
}

/**
 * Returns true if text contains a PHP open tag (<?php or <?=).
 * Used by validation and parse guards for hybrid snippets.
 */
function containsPHPBlock(text) {
  return /<\?(?:php\b|=)/i.test(text);
}

// =============================================================================
// HTML — formats HTML structure including real <style> and <script> blocks.
// Does NOT touch string contents (attribute values like content:"...", etc.)
// =============================================================================
function beautifyHTML(code, opts) {
  var rawTags = protectRawTagContents(code);
  var php = protectPHPBlocks(rawTags.code, opts);

  // Use js-beautify html_beautify for the structural pass, then run the
  // app's safer CSS/JS formatters over real <style>/<script> blocks.
  var result = html_beautify(rawTags.code, {
    indent_size: opts.indent_size,
    indent_char: ' ',
    preserve_newlines: false,
    max_preserve_newlines: 0,
    wrap_line_length: 0,
    indent_inner_html: true,
    indent_body_inner_html: true,
    indent_head_inner_html: true,
    indent_scripts: 'normal',
    extra_liners: [],
    content_unformatted: ['pre', 'textarea'],
    unformatted: [],
    end_with_newline: false
  });

  result = php.restore(result);
  result = rawTags.restore(result);
  result = postProcessStyleBlocks(result, opts);
  result = postProcessScriptBlocks(result, opts);

  // Remove blank lines before closing </style> and </script> tags
  result = result.replace(/\n\s*\n(\s*<\/(style|script)>)/gi, '\n$1');

  return result;
}

/**
 * Post-process CSS inside <style> blocks:
 * - Add missing semicolons before closing braces
 * - Keep a blank line between CSS rules
 * - Ensure space after content:
 */
function postProcessStyleBlocks(html, opts) {
  var scripts = protectWholeTagBlocks(html, 'script');
  var processed = scripts.code.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, function(match, open, css, close) {
    var trimmed = css.trim();
    if (!trimmed) return open + close;

    var indents = getBlockIndents(css, opts);
    var formatted = beautifyCSS(trimmed, opts);
    return open + '\n' + indentMultiline(formatted, indents.content) + '\n' + indents.close + close;
  });

  return scripts.restore(processed);
}

function postProcessScriptBlocks(html, opts) {
  var styles = protectWholeTagBlocks(html, 'style');
  var processed = styles.code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, function(match, open, js, close) {
    if (!isJavaScriptScriptTag(open)) return match;

    var trimmed = js.trim();
    if (!trimmed) return open + close;

    var indents = getBlockIndents(js, opts);
    var formatted = beautifyJS(trimmed, opts);
    return open + '\n' + indentMultiline(formatted, indents.content) + '\n' + indents.close + close;
  });

  return styles.restore(processed);
}

function isJavaScriptScriptTag(openTag) {
  var typeMatch = openTag.match(/\btype\s*=\s*(['"]?)([^'"\s>]+)\1/i);
  if (!typeMatch) return true;

  var type = typeMatch[2].toLowerCase();
  return type === 'text/javascript' ||
    type === 'application/javascript' ||
    type === 'module' ||
    type === 'text/ecmascript' ||
    type === 'application/ecmascript';
}

// =============================================================================
// CSS — formats CSS structure and safely protects content strings.
// =============================================================================
function beautifyCSS(code, opts) {
  // Protect every CSS string literal before PHP formatting. This makes
  // content:"..." byte-stable and also prevents PHP/HTML/JS nested inside any
  // CSS string from being touched in Deep mode.
  var cssStrings = protectCSSStringLiterals(code);

  // In CSS, PHP blocks inside property values must stay inline to avoid
  // breaking CSS parsers (e.g. color: <?php ... ?>; must not become multiline).
  var cssOpts = getChildOptions(opts);
  cssOpts._nestedDepth = opts._nestedDepth || 0; // don't increment depth for same-level
  cssOpts._cssValueContext = true;
  var php = protectPHPBlocks(cssStrings.code, cssOpts);

  var result = css_beautify(php.code, {
    indent_size: opts.indent_size,
    indent_char: ' ',
    preserve_newlines: false,
    newline_between_rules: true,
    selector_separator_newline: true,
    end_with_newline: false
  });

  result = php.restore(result);
  result = cssStrings.restore(result);

  // Ensure semicolons after every declaration before closing braces
  result = result.replace(/([^;\s{}\/\*])\s*\n(\s*})/g, '$1;\n$2');

  return result;
}

function protectCSSStringLiterals(code) {
  var strings = [];
  var out = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '"' || ch === "'") {
      var literal = readCSSStringLiteral(code, i, ch);
      if (!literal) {
        out += ch;
        i++;
        continue;
      }

      var idx = strings.length;
      var token = '___CSS_STRING_' + idx + '___';
      strings.push(literal.raw);
      out += literal.quote + token + literal.quote;
      i = literal.end;
      continue;
    }

    out += ch;
    i++;
  }

  return {
    code: out,
    restore: function(text) {
      return text.replace(/(["'])___CSS_STRING_(\d+)___\1/g, function(match, quote, idx) {
        return strings[parseInt(idx, 10)] || match;
      });
    }
  };
}

function readCSSStringLiteral(code, start, quote) {
  var i = start + 1;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === quote) {
      return {
        raw: code.slice(start, i + 1),
        quote: quote,
        content: code.slice(start + 1, i),
        end: i + 1
      };
    }

    if (ch === '\n' || ch === '\r') return null;
    i++;
  }

  return null;
}

// CSS string helpers
// Deep mode intentionally skips CSS content strings.
function decodeCSSStringContent(content) {
  return content
    .replace(/\\A\s?/gi, '\n')
    .replace(/\\(["'\\])/g, '$1');
}

// =============================================================================
// JavaScript — formats JS structure and nested HTML/CSS/JSON strings.
// =============================================================================
function beautifyJS(code, opts) {
  var stringPHP = protectPHPBlocksInsideJSStrings(code);
  var php = protectPHPBlocks(stringPHP.code, opts);

  var result = js_beautify(php.code, {
    indent_size: opts.indent_size,
    indent_char: ' ',
    preserve_newlines: opts.preserve_newlines,
    max_preserve_newlines: 2,
    wrap_line_length: 0,
    space_in_empty_paren: false,
    e4x: false,
    end_with_newline: false,
    operator_position: 'after-newline'
  });

  result = stringPHP.restore(result);
  result = formatNestedJSStrings(result, opts);
  if (!opts.preserveQuotedKeys) {
    result = unquoteJSPropertyKeys(result);
  }
  result = addMissingJSSemicolons(result);

  // Remove blank lines before closing </script> if present
  result = result.replace(/\n\s*\n(\s*<\/(script)>)/gi, '\n$1');

  return php.restore(result);
}

// =============================================================================
// PHP — two modes: pure PHP, or PHP mixed with HTML
// =============================================================================
function formatNestedJSStrings(code, opts) {
  var out = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '/' && next === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      if (lineEnd === -1) lineEnd = code.length;
      out += code.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) commentEnd = code.length - 2;
      out += code.slice(i, commentEnd + 2);
      i = commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var quoted = readQuotedLiteral(code, i, ch);
      if (!quoted) {
        out += ch;
        i++;
        continue;
      }

      out += formatJSQuotedLiteral(quoted, opts);
      i = quoted.end;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(code, i);
      if (!template) {
        out += ch;
        i++;
        continue;
      }

      out += formatJSTemplateLiteral(template, opts);
      i = template.end;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function readQuotedLiteral(code, start, quote) {
  var i = start + 1;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === quote) {
      return {
        raw: code.slice(start, i + 1),
        content: code.slice(start + 1, i),
        quote: quote,
        end: i + 1
      };
    }

    if (ch === '\n' || ch === '\r') return null;
    i++;
  }

  return null;
}

function formatJSQuotedLiteral(literal, opts) {
  if (!opts.deepMode) {
    return escapeClosingScriptInRawLiteral(literal.raw);
  }

  var decoded = decodeJSStringContent(literal.content);
  if (decoded === null) return literal.raw;

  var formatted = beautifyNestedStringValue(decoded, opts);
  if (formatted === decoded) return escapeClosingScriptInRawLiteral(literal.raw);

  return literal.quote + escapeJSStringContent(formatted, literal.quote, true) + literal.quote;
}

function decodeJSStringContent(content) {
  var out = '';

  for (var i = 0; i < content.length; i++) {
    var ch = content.charAt(i);
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    if (i + 1 >= content.length) return null;
    var next = content.charAt(++i);

    switch (next) {
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\\': out += '\\'; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case '/': out += '/'; break;
      case '\n': break;
      case '\r':
        if (content.charAt(i + 1) === '\n') i++;
        break;
      case 'x':
        if (/^[0-9a-fA-F]{2}$/.test(content.slice(i + 1, i + 3))) {
          out += String.fromCharCode(parseInt(content.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          return null;
        }
        break;
      case 'u':
        if (content.charAt(i + 1) === '{') {
          var close = content.indexOf('}', i + 2);
          if (close === -1) return null;
          var codePoint = content.slice(i + 2, close);
          if (!/^[0-9a-fA-F]+$/.test(codePoint)) return null;
          out += String.fromCodePoint(parseInt(codePoint, 16));
          i = close;
        } else if (/^[0-9a-fA-F]{4}$/.test(content.slice(i + 1, i + 5))) {
          out += String.fromCharCode(parseInt(content.slice(i + 1, i + 5), 16));
          i += 4;
        } else {
          return null;
        }
        break;
      default:
        return null;
    }
  }

  return out;
}

function escapeJSStringContent(value, quote, escapeClosingScript) {
  var escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  if (quote === '"') {
    escaped = escaped.replace(/"/g, '\\"');
  } else {
    escaped = escaped.replace(/'/g, "\\'");
  }

  if (escapeClosingScript) {
    escaped = escaped.replace(/<\/script/gi, '<\\/script');
  }

  return escaped;
}

function readJSTemplateLiteral(code, start) {
  var i = start + 1;
  var hasExpression = false;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '`') {
      return {
        raw: code.slice(start, i + 1),
        content: code.slice(start + 1, i),
        end: i + 1,
        hasExpression: hasExpression
      };
    }

    if (ch === '$' && code.charAt(i + 1) === '{') {
      hasExpression = true;
      var exprEnd = findTemplateExpressionEnd(code, i + 2);
      if (exprEnd === -1) return null;
      i = exprEnd + 1;
      continue;
    }

    i++;
  }

  return null;
}

function findTemplateExpressionEnd(code, start) {
  var depth = 1;
  var i = start;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '"' || ch === "'") {
      var quoted = readQuotedLiteral(code, i, ch);
      if (!quoted) return -1;
      i = quoted.end;
      continue;
    }

    if (ch === '`') {
      var nestedTemplate = readJSTemplateLiteral(code, i);
      if (!nestedTemplate) return -1;
      i = nestedTemplate.end;
      continue;
    }

    if (ch === '/' && next === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      if (lineEnd === -1) return -1;
      i = lineEnd + 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) return -1;
      i = commentEnd + 2;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }

    i++;
  }

  return -1;
}

function formatJSTemplateLiteral(template, opts) {
  if (!opts.deepMode) {
    return escapeClosingScriptInRawLiteral(template.raw);
  }

  if (template.hasExpression) return escapeClosingScriptInRawLiteral(template.raw);

  var formatted = beautifyNestedStringValue(template.content, opts);
  if (formatted === template.content) return escapeClosingScriptInRawLiteral(template.raw);

  return '`' + escapeTemplateContent(formatted) + '`';
}

function escapeTemplateContent(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/<\/script/gi, '<\\/script');
}

function escapeClosingScriptInRawLiteral(raw) {
  return raw.replace(/<\/script/gi, '<\\/script');
}

function unquoteJSPropertyKeys(code) {
  var out = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '/' && next === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      if (lineEnd === -1) lineEnd = code.length;
      out += code.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) commentEnd = code.length - 2;
      out += code.slice(i, commentEnd + 2);
      i = commentEnd + 2;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(code, i);
      if (!template) {
        out += ch;
        i++;
      } else {
        out += template.raw;
        i = template.end;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      var literal = readQuotedLiteral(code, i, ch);
      if (!literal) {
        out += ch;
        i++;
        continue;
      }

      var nextIndex = skipWhitespace(code, literal.end);
      if (/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(literal.content) && code.charAt(nextIndex) === ':') {
        out += literal.content;
      } else {
        out += literal.raw;
      }

      i = literal.end;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function addMissingJSSemicolons(code) {
  var lines = code.split('\n');
  var state = { blockComment: false, template: false };

  for (var i = 0; i < lines.length; i++) {
    var lineState = { blockComment: state.blockComment, template: state.template };
    state = scanJSMultilineState(lines[i], state);

    if (!lineState.blockComment && !lineState.template) {
      lines[i] = addSemicolonToJSLine(lines[i], lines, i);
    }
  }

  return lines.join('\n');
}

function scanJSMultilineState(line, state) {
  var blockComment = state.blockComment;
  var template = state.template;
  var i = 0;

  while (i < line.length) {
    var ch = line.charAt(i);
    var next = line.charAt(i + 1);

    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (template) {
      if (ch === '\\') {
        i += 2;
      } else if (ch === '`') {
        template = false;
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var literal = readQuotedLiteral(line, i, ch);
      if (!literal) break;
      i = literal.end;
      continue;
    }

    if (ch === '`') {
      template = true;
      i++;
      continue;
    }

    i++;
  }

  return { blockComment: blockComment, template: template };
}

function addSemicolonToJSLine(line, lines, lineIndex) {
  var commentIndex = findLineCommentOutsideStrings(line);
  var codePart = commentIndex === -1 ? line : line.slice(0, commentIndex);
  var commentPart = commentIndex === -1 ? '' : line.slice(commentIndex);
  var trimmed = codePart.trim();

  if (!trimmed) return line;
  if (/^(if|for|while|switch|catch|function|class|else|do|try|finally|case|default)\b/.test(trimmed)) return line;
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*)\s*:/.test(trimmed)) return line;
  if (/[;,{:}]$/.test(trimmed)) return line;
  if (/[+\-*\/%&|^!?<>=.]$/.test(trimmed)) return line;
  if (/^[)\]}]*\)$/.test(trimmed) && !isClosingControlCondition(lines, lineIndex)) {
    return codePart.replace(/\s*$/, ';') + (commentPart ? ' ' + commentPart.replace(/^\s*/, '') : '');
  }
  if (!isLikelyJSStatement(trimmed)) return line;

  return codePart.replace(/\s*$/, ';') + (commentPart ? ' ' + commentPart.replace(/^\s*/, '') : '');
}

function isClosingControlCondition(lines, lineIndex) {
  for (var i = lineIndex - 1; i >= 0; i--) {
    var trimmed = lines[i].trim();
    if (!trimmed) continue;
    return /^(if|for|while|switch|catch)\s*\(/.test(trimmed);
  }

  return false;
}

function isLikelyJSStatement(trimmed) {
  if (/^(const|let|var)\s+/.test(trimmed)) return true;
  if (/^(return|throw|break|continue)\b/.test(trimmed)) return true;
  if (/^(await\s+)?[A-Za-z_$][\w$]*(?:[.\[][\s\S]*)?\([^{};]*\)$/.test(trimmed)) return true;
  if (/^[A-Za-z_$][\w$]*(?:[.\[][\s\S]*)?\s*(?:[+\-*\/%]?=|\+\+|--)/.test(trimmed)) return true;
  return false;
}

function findLineCommentOutsideStrings(line) {
  var i = 0;

  while (i < line.length - 1) {
    var ch = line.charAt(i);
    var next = line.charAt(i + 1);

    if (ch === '"' || ch === "'") {
      var literal = readQuotedLiteral(line, i, ch);
      if (!literal) return -1;
      i = literal.end;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(line, i);
      if (!template) return -1;
      i = template.end;
      continue;
    }

    if (ch === '/' && next === '/') return i;
    i++;
  }

  return -1;
}

function skipWhitespace(code, start) {
  var i = start;
  while (i < code.length && /\s/.test(code.charAt(i))) i++;
  return i;
}

function beautifyPHP(code, opts) {
  var trimmed = code.trim();

  // Check if it's purely PHP (no HTML outside PHP tags)
  // Pure PHP: starts with <?php, may have ?> at end, no HTML tags outside PHP blocks
  var withoutPHP = trimmed.replace(/<\?(?:php|=)[\s\S]*?(?:\?>|$)/gi, '');
  var hasSurroundingHTML = /<[a-z][^>]*>/i.test(withoutPHP.trim());

  if (!hasSurroundingHTML) {
    return beautifyPurePHP(trimmed, opts);
  }

  return beautifyMixedPHP(trimmed, opts);
}

/**
 * Pure PHP: format the PHP code structure.
 * Preserves string contents (echo "..." stays on one line).
 */
function beautifyPurePHP(code, opts) {
  var inner = code;
  var prefix = '';
  var suffix = '';

  // Extract <?php
  var openMatch = inner.match(/^(<\?php\b\s*)/i);
  if (openMatch) {
    prefix = '<?php\n';
    inner = inner.slice(openMatch[0].length);
  }

  // Extract ?>
  var closeMatch = inner.match(/(\s*\?>)\s*$/);
  if (closeMatch) {
    suffix = '\n?>';
    inner = inner.slice(0, inner.length - closeMatch[0].length);
  }

  // Format PHP as C-like code using js_beautify
  // js_beautify handles strings correctly — doesn't modify their contents
  // wrap_line_length=0 prevents breaking long echo "..." statements
  var formatted = js_beautify(inner.trim(), {
    indent_size: opts.indent_size,
    indent_char: ' ',
    preserve_newlines: opts.preserve_newlines,
    max_preserve_newlines: 2,
    wrap_line_length: 0,
    space_in_empty_paren: false,
    end_with_newline: false,
    operator_position: 'after-newline'
  });

  formatted = formatNestedPHPStrings(formatted, opts);

  return prefix + formatted + suffix + '\n';
}

/**
 * Mixed PHP+HTML: protect PHP blocks, format the HTML/CSS/JS structure,
 * then restore PHP blocks EXACTLY as they were.
 */
function formatNestedPHPStrings(code, opts) {
  var out = '';
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if ((ch === '/' && next === '/') || ch === '#') {
      var lineEnd = code.indexOf('\n', i + 1);
      if (lineEnd === -1) lineEnd = code.length;
      out += code.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) commentEnd = code.length - 2;
      out += code.slice(i, commentEnd + 2);
      i = commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var literal = readPHPStringLiteral(code, i, ch);
      if (!literal) {
        out += ch;
        i++;
        continue;
      }

      out += formatPHPStringLiteral(literal, opts);
      i = literal.end;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function readPHPStringLiteral(code, start, quote) {
  var i = start + 1;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === quote) {
      return {
        raw: code.slice(start, i + 1),
        content: code.slice(start + 1, i),
        quote: quote,
        end: i + 1
      };
    }

    i++;
  }

  return null;
}

function formatPHPStringLiteral(literal, opts) {
  if (!opts.deepMode) return literal.raw;
  if (literal.quote === "'") return literal.raw;

  var decoded = literal.quote === '"' ?
    decodePHPDoubleStringContent(literal.content) :
    decodePHPSingleStringContent(literal.content);
  var formatted = beautifyNestedStringValue(decoded, opts);

  if (formatted === decoded) return literal.raw;

  return literal.quote + (
    literal.quote === '"' ?
      escapePHPDoubleStringContent(formatted) :
      escapePHPSingleStringContent(formatted)
  ) + literal.quote;
}

function decodePHPDoubleStringContent(content) {
  var out = '';

  for (var i = 0; i < content.length; i++) {
    var ch = content.charAt(i);
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    if (i + 1 >= content.length) {
      out += ch;
      continue;
    }

    var next = content.charAt(++i);
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'v': out += '\v'; break;
      case 'e': out += '\x1B'; break;
      case 'f': out += '\f'; break;
      case '\\': out += '\\'; break;
      case '$': out += '$'; break;
      case '"': out += '"'; break;
      default:
        out += '\\' + next;
        break;
    }
  }

  return out;
}

function decodePHPSingleStringContent(content) {
  return content.replace(/\\(['\\])/g, '$1');
}

function escapePHPDoubleStringContent(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\$/g, '\\$')
    .replace(/"/g, '\\"');
}

function escapePHPSingleStringContent(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function beautifyMixedPHP(code, opts) {
  return beautifyHTML(code, opts);
}

// =============================================================================
// JSON - pretty-prints JSON structure. Deep mode skips string values by
// default to preserve exact runtime content; opt into deepStringValues for the
// riskier recursive string formatting path.
// =============================================================================
function beautifyJSON(code, opts) {
  try {
    var parsed = JSON.parse(code);
    var value = (opts.deepMode && opts.deepStringValues) ? formatNestedJSONValue(parsed, opts) : parsed;
    var formatted = JSON.stringify(value, null, opts.indent_size);
    formatted = escapeClosingScriptInJSONOutput(formatted);
    return { code: formatted, error: null, detectedLanguage: 'json' };
  } catch (e) {
    var posMatch = e.message.match(/position\s+(\d+)/i);
    var detail = e.message;
    if (posMatch) {
      var pos = parseInt(posMatch[1], 10);
      var lines = code.substring(0, pos).split('\n');
      var line = lines.length;
      var col = lines[lines.length - 1].length + 1;
      detail += ' (line ' + line + ', column ' + col + ')';
    }
    return { code: code, error: 'JSON Parse Error: ' + detail, detectedLanguage: 'json' };
  }
}

function escapeClosingScriptInJSONOutput(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function formatNestedJSONValue(value, opts) {
  if (typeof value === 'string') {
    return beautifyNestedStringValue(value, opts);
  }

  if (Array.isArray(value)) {
    return value.map(function(item) {
      return formatNestedJSONValue(item, opts);
    });
  }

  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function(key) {
      result[key] = formatNestedJSONValue(value[key], opts);
    });
    return result;
  }

  return value;
}

// =============================================================================
// VALIDATION — post-formatting checks to catch regressions.
// Returns an array of warning strings (empty = all OK).
// =============================================================================
function validateOutput(code, language, inputCode, options) {
  var warnings = [];
  inputCode = inputCode || '';
  options = options || {};

  // 1. JSON: output must be valid JSON if input was valid JSON
  if (language === 'json') {
    try {
      JSON.parse(code);
    } catch (e) {
      warnings.push('JSON validation failed: ' + e.message);
    }
  }

  if (language === 'javascript' && !containsPHPBlock(code)) {
    var jsSyntax = validateJSSyntax(code);
    if (jsSyntax) warnings.push('JS parse failed: ' + jsSyntax);
  }

  if (language === 'php') {
    var phpSyntax = validatePHPSyntax(code);
    if (phpSyntax) warnings.push('PHP syntax check failed: ' + phpSyntax);
  }

  if (language === 'css') {
    var cssSyntax = validateCSSSyntax(code);
    if (cssSyntax) warnings.push('CSS parse failed: ' + cssSyntax);
  }

  // 2. PHP blocks must not disappear
  var inputPHPCount = (inputCode.match(/<\?(?:php\b|=)/gi) || []).length;
  var outputPHPCount = (code.match(/<\?(?:php\b|=)/gi) || []).length;
  if (inputPHPCount > 0 && outputPHPCount < inputPHPCount) {
    warnings.push('PHP block(s) missing: input had ' + inputPHPCount + ', output has ' + outputPHPCount);
  }

  // 3. JSON strings must not contain raw newlines (unescaped) in source text
  if (language === 'json') {
    var rawNL = checkJSONRawNewlines(code);
    if (rawNL) {
      warnings.push('JSON string contains raw newline (should be \\n): ' + rawNL);
    }
  }

  if (language === 'javascript') {
    var jsRawNL = checkJSRawNewlines(code);
    if (jsRawNL) warnings.push('JS string contains raw newline: ' + jsRawNL);
  }

  if (language === 'css') {
    var cssRawNL = checkCSSRawNewlines(code);
    if (cssRawNL) warnings.push('CSS string contains raw newline: ' + cssRawNL);
  }

  // 4. </script> inside strings should be escaped as <\/script>
  if (language === 'json' || language === 'javascript') {
    var unescapedScriptClose = checkUnescapedClosingScriptInStrings(code, language);
    if (unescapedScriptClose) warnings.push('Unescaped </script> found in ' + language + ' string output - should be <\\/script>');
  }

  // 5. CSS brace balance
  if (language === 'css') {
    var cssBalance = checkCSSBalanceOutsideStrings(code);
    if (cssBalance) warnings.push('CSS balance issue: ' + cssBalance);
  }

  // 6. JS basic syntax check — balanced braces/parens/brackets
  if (language === 'javascript') {
    var balance = checkJSBalance(code);
    if (balance) {
      warnings.push('JS balance issue: ' + balance);
    }
  }

  // 7. HTML tag balance check — opening vs closing tags
  if (language === 'html') {
    var htmlBalance = checkHTMLTagBalance(code);
    if (htmlBalance) {
      warnings.push('HTML tag issue: ' + htmlBalance);
    }
  }

  // 8. Gross string-length sanity check (deep mode)
  // If output is drastically longer/shorter, something may be wrong.
  if (inputCode && Math.abs(code.length - inputCode.length) > inputCode.length * 3) {
    warnings.push('Output size changed dramatically (' + inputCode.length + ' → ' + code.length + ' chars)');
  }

  if (options.safeMode === true || options.deepMode !== true) {
    var stringCheck = validateSafeModeStringValues(inputCode || '', code, language);
    if (stringCheck) warnings.push(stringCheck);
  }

  return warnings;
}

function validateJSSyntax(code) {
  if (/\b(import|export)\b/.test(code)) return null;
  try {
    // Browser-safe script parse check. Module syntax is skipped above because
    // Function cannot parse it even when it is valid JavaScript.
    new Function(code);
    return null;
  } catch (e) {
    return e.message;
  }
}

function validatePHPSyntax(code) {
  // The browser build cannot execute php -l, so this catches structural
  // balance regressions client-side. The Node regression suite covers the
  // higher-risk PHP-in-CSS cases around the formatter itself.
  return checkJSBalance(code);
}

function validateCSSSyntax(code) {
  if (typeof CSSStyleSheet !== 'undefined') {
    try {
      var sheet = new CSSStyleSheet();
      if (typeof sheet.replaceSync === 'function') {
        sheet.replaceSync(code);
        return null;
      }
    } catch (e) {
      return e.message;
    }
  }

  return checkCSSBalanceOutsideStrings(code);
}

function checkCSSBalanceOutsideStrings(code) {
  var depth = 0;
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '"' || ch === "'") {
      var literal = readCSSStringLiteral(code, i, ch);
      if (!literal) return 'unterminated string';
      i = literal.end;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      if (commentEnd === -1) return 'unterminated comment';
      i = commentEnd + 2;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth < 0) return 'unexpected }';
    }

    i++;
  }

  return depth === 0 ? null : 'unclosed {';
}

function checkJSRawNewlines(code) {
  return checkRawNewlinesInQuotedStrings(code, readQuotedLiteral);
}

function checkCSSRawNewlines(code) {
  return checkRawNewlinesInQuotedStrings(code, readCSSStringLiteral);
}

function checkRawNewlinesInQuotedStrings(code, reader) {
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);

    if (ch === '"' || ch === "'") {
      var literal = reader(code, i, ch);
      if (literal) {
        i = literal.end;
        continue;
      }

      var lineEnd = code.indexOf('\n', i + 1);
      if (lineEnd === -1) lineEnd = code.indexOf('\r', i + 1);
      if (lineEnd !== -1) return code.slice(i, Math.min(lineEnd, i + 40)) + '...';
      return code.slice(i, Math.min(code.length, i + 40)) + '...';
    }

    i++;
  }

  return null;
}

function checkUnescapedClosingScriptInStrings(code, language) {
  if (language === 'json') return checkUnescapedClosingScriptInJSONStrings(code);
  if (language === 'javascript') return checkUnescapedClosingScriptInJSStrings(code);
  return null;
}

function checkUnescapedClosingScriptInJSONStrings(code) {
  var i = 0;

  while (i < code.length) {
    if (code.charAt(i) !== '"') {
      i++;
      continue;
    }

    i++;
    while (i < code.length) {
      var ch = code.charAt(i);
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        break;
      }
      if (code.slice(i, i + 8).toLowerCase() === '</script') return '</script>';
      i++;
    }
  }

  return null;
}

function checkUnescapedClosingScriptInJSStrings(code) {
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);
    var next = code.charAt(i + 1);

    if (ch === '/' && next === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      i = lineEnd === -1 ? code.length : lineEnd + 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      i = commentEnd === -1 ? code.length : commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var quoted = readQuotedLiteral(code, i, ch);
      if (!quoted) return null;
      if (containsUnescapedClosingScript(quoted.content)) return quoted.raw;
      i = quoted.end;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(code, i);
      if (!template) return null;
      if (containsUnescapedClosingScript(template.content)) return template.raw;
      i = template.end;
      continue;
    }

    i++;
  }

  return null;
}

function containsUnescapedClosingScript(value) {
  return /(^|[^\\])<\/script/i.test(value);
}

function validateSafeModeStringValues(inputCode, outputCode, language) {
  var before = collectStringLiteralValues(inputCode, language);
  var after = collectStringLiteralValues(outputCode, language);

  if (!before || !after) return null;
  if (before.length !== after.length) {
    return 'Safe Mode string literal data values changed: input had ' + before.length + ', output has ' + after.length;
  }

  for (var i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) {
      return 'Safe Mode string literal values changed at index ' + i;
    }
  }

  return null;
}

function collectStringLiteralValues(source, language) {
  if (language === 'json') return collectJSONStrings(source);
  if (language === 'javascript') return collectJSStringValues(source);
  if (language === 'css') return collectCSSStringValues(source);
  if (language === 'php') return collectPHPStringValues(source);
  if (language === 'html') return collectHTMLStringValues(source);
  return collectGenericQuotedValues(source);
}

function collectJSONStrings(source) {
  try {
    var values = [];
    collectJSONStringsFromValue(JSON.parse(source), values);
    return values;
  } catch (e) {
    return null;
  }
}

function collectJSONStringsFromValue(value, values) {
  if (typeof value === 'string') {
    values.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(function(item) {
      collectJSONStringsFromValue(item, values);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function(key) {
      values.push(key);
      collectJSONStringsFromValue(value[key], values);
    });
  }
}

function collectJSStringValues(source) {
  var values = [];
  var i = 0;

  while (i < source.length) {
    var ch = source.charAt(i);
    var next = source.charAt(i + 1);

    if (ch === '/' && next === '/') {
      var lineEnd = source.indexOf('\n', i + 2);
      i = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = source.indexOf('*/', i + 2);
      i = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var quoted = readQuotedLiteral(source, i, ch);
      if (!quoted) return null;
      if (!isJSQuotedObjectKey(source, quoted)) {
        var decoded = decodeJSStringContent(quoted.content);
        values.push(decoded === null ? quoted.content : decoded);
      }
      i = quoted.end;
      continue;
    }

    if (ch === '`') {
      var template = readJSTemplateLiteral(source, i);
      if (!template) return null;
      values.push(decodeJSTemplateContentForCompare(template.content));
      i = template.end;
      continue;
    }

    i++;
  }

  return values;
}

function isJSQuotedObjectKey(source, literal) {
  if (source.charAt(skipWhitespace(source, literal.end)) !== ':') return false;
  var before = findPreviousNonWhitespaceIndex(source, literal.rawStart || literal.start || source.lastIndexOf(literal.raw, literal.end));
  return before === -1 || source.charAt(before) === '{' || source.charAt(before) === ',';
}

function findPreviousNonWhitespaceIndex(source, start) {
  var i = start - 1;
  while (i >= 0 && /\s/.test(source.charAt(i))) i--;
  return i;
}

function decodeJSTemplateContentForCompare(content) {
  return content
    .replace(/\\\//g, '/')
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\');
}

function collectCSSStringValues(source) {
  var values = [];
  var i = 0;

  while (i < source.length) {
    var ch = source.charAt(i);

    if (ch === '"' || ch === "'") {
      var literal = readCSSStringLiteral(source, i, ch);
      if (!literal) return null;
      values.push(decodeCSSStringContent(literal.content));
      i = literal.end;
      continue;
    }

    i++;
  }

  return values;
}

function collectPHPStringValues(source) {
  var values = [];
  var i = 0;

  while (i < source.length) {
    var ch = source.charAt(i);
    var next = source.charAt(i + 1);

    if ((ch === '/' && next === '/') || ch === '#') {
      var lineEnd = source.indexOf('\n', i + 1);
      i = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      var commentEnd = source.indexOf('*/', i + 2);
      i = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      var literal = readPHPStringLiteral(source, i, ch);
      if (!literal) return null;
      values.push(ch === '"' ? decodePHPDoubleStringContent(literal.content) : decodePHPSingleStringContent(literal.content));
      i = literal.end;
      continue;
    }

    i++;
  }

  return values;
}

function collectHTMLStringValues(source) {
  var values = collectHTMLAttributeValues(source);

  source.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function(match, css) {
    var cssValues = collectCSSStringValues(css);
    if (cssValues) values = values.concat(cssValues);
    return match;
  });

  source.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(match, js) {
    var jsValues = collectJSStringValues(js);
    if (jsValues) values = values.concat(jsValues);
    return match;
  });

  source.replace(/<\?(?:php\b|=)[\s\S]*?(?:\?>|$)/gi, function(block) {
    var phpValues = collectPHPStringValues(block);
    if (phpValues) values = values.concat(phpValues);
    return block;
  });

  return values;
}

function collectHTMLAttributeValues(source) {
  var values = [];
  var withoutRaw = source
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  var pattern = /\s[\w:-]+\s*=\s*("([^"]*)"|'([^']*)')/g;
  var match;

  while ((match = pattern.exec(withoutRaw)) !== null) {
    values.push(match[2] !== undefined ? match[2] : match[3]);
  }

  return values;
}

function collectGenericQuotedValues(source) {
  var values = [];
  var pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  var match;

  while ((match = pattern.exec(source)) !== null) {
    values.push(match[1] !== undefined ? match[1] : match[2]);
  }

  return values;
}

function checkJSONRawNewlines(jsonSource) {
  // Scan the raw JSON source text for literal (unescaped) newlines inside
  // string literals.  A conforming JSON string must escape newlines as \n;
  // a literal newline byte inside quotes means the output is broken.
  var i = 0;
  while (i < jsonSource.length) {
    var ch = jsonSource.charAt(i);

    // Enter a JSON string literal
    if (ch === '"') {
      var start = i;
      i++; // skip opening quote
      while (i < jsonSource.length) {
        var sc = jsonSource.charAt(i);
        if (sc === '\\') {
          i += 2; // skip escaped character
          continue;
        }
        if (sc === '"') {
          i++; // skip closing quote
          break;
        }
        if (sc === '\n' || sc === '\r') {
          // Found a raw newline inside a JSON string — that's the bug
          var snippet = jsonSource.slice(start + 1, Math.min(start + 51, jsonSource.length));
          return snippet.replace(/\n/g, ' ') + '...';
        }
        i++;
      }
      continue;
    }

    i++;
  }
  return null;
}

function checkJSBalance(code) {
  var stack = [];
  var pairs = { '(': ')', '[': ']', '{': '}' };
  var i = 0;

  while (i < code.length) {
    var ch = code.charAt(i);

    // Skip strings
    if (ch === '"' || ch === "'") {
      var lit = readQuotedLiteral(code, i, ch);
      if (lit) { i = lit.end; continue; }
      i++;
      continue;
    }
    if (ch === '`') {
      var tmpl = readJSTemplateLiteral(code, i);
      if (tmpl) { i = tmpl.end; continue; }
      i++;
      continue;
    }

    // Skip comments
    if (ch === '/' && code.charAt(i + 1) === '/') {
      var lineEnd = code.indexOf('\n', i + 2);
      i = lineEnd === -1 ? code.length : lineEnd + 1;
      continue;
    }
    if (ch === '/' && code.charAt(i + 1) === '*') {
      var commentEnd = code.indexOf('*/', i + 2);
      i = commentEnd === -1 ? code.length : commentEnd + 2;
      continue;
    }

    if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0) {
        return 'unexpected ' + ch;
      }
      var expected = stack.pop();
      if (ch !== expected) {
        return 'expected ' + expected + ' but found ' + ch;
      }
    }

    i++;
  }

  if (stack.length > 0) {
    return 'unclosed ' + stack[stack.length - 1];
  }

  return null;
}

/**
 * Basic HTML tag balance check — counts opening vs closing tags for common
 * non-void elements and reports mismatches.
 */
function checkHTMLTagBalance(code) {
  // Strip PHP, raw tag bodies, and quoted attribute/string values to avoid
  // treating embedded snippets as real top-level HTML tags.
  var cleaned = code
    .replace(/<\?(?:php\b|=)[\s\S]*?(?:\?>|$)/gi, '')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
    .replace(/"[^"]*"|'[^']*'/g, '');

  var voidTags = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  var stack = [];
  var tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi;
  var match;

  while ((match = tagPattern.exec(cleaned)) !== null) {
    var full = match[0];
    var tagName = match[1].toLowerCase();

    if (voidTags.test(tagName)) continue;
    if (/\/>$/.test(full)) continue; // self-closing

    if (full.charAt(1) === '/') {
      // Closing tag
      if (stack.length === 0) {
        return 'unexpected </' + tagName + '>';
      }
      var expectedTag = stack.pop();
      if (tagName !== expectedTag) {
        return 'expected </' + expectedTag + '> but found </' + tagName + '>';
      }
    } else {
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    return 'unclosed <' + stack[stack.length - 1] + '>';
  }

  return null;
}

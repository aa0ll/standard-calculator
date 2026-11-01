/**
 * 标准计算器 — 交互层
 */
(function () {
  'use strict';

  const { evaluateExpression, balanceParens, formatNumber, prettyExpr } = window.CalcCore;

  // 屏幕上的负号统一用排版减号 −，与算式的显示保持一致
  function displayNumber(value, grouping = true) {
    return formatNumber(value, grouping).replace(/-/g, '−');
  }

  // 生成写回算式里的数字字面量：15 位有效数字既不丢精度，也不会让算式过长。
  function literalOf(value) {
    if (!Number.isFinite(value)) return '0';
    return String(Number(value.toPrecision(15)));
  }

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */
  const calculator = document.getElementById('calculator');
  const screen = document.getElementById('screen');
  const screenTag = document.getElementById('screenTag');
  const angleChip = document.getElementById('angleChip');
  const resultLine = document.getElementById('resultLine');
  const exprLine = document.getElementById('exprLine');
  const display = document.getElementById('display');
  const matrixResult = document.getElementById('matrixResult');
  const basicPad = document.getElementById('basicPad');
  const matrixPanel = document.getElementById('matrixPanel');
  const switchThumb = document.getElementById('switchThumb');
  const modeButtons = Array.from(document.querySelectorAll('.switch-btn'));
  const sizeA = document.getElementById('sizeA');
  const sizeB = document.getElementById('sizeB');
  const gridA = document.getElementById('gridA');
  const gridB = document.getElementById('gridB');

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    mode: 'basic',
    angle: 'DEG',
    expr: '',
    solved: false,
    lastExpr: '',
    ans: 0,
    error: false,
    errMsg: '',
    // 算式中的编辑点：caret 为源码下标，sel 为 [{start,end}] 形式的选中区间
    caret: null,
    sel: null,
  };

  const matrixState = {
    // 初次打开时矩阵为空，避免一进来就看到默认数字；null 表示空白单元格
    A: { size: 2, data: [[null, null], [null, null]] },
    B: { size: 2, data: [[null, null], [null, null]] },
  };

  let matrixLast = null;
  // 矩阵模式下 Enter 重复最近一次运算；还没算过时按默认的 A × B
  let lastMatrixOp = 'mul';

  /* ------------------------------------------------------------------ *
   * 显示
   * ------------------------------------------------------------------ */
  function fitExpr(text) {
    return text.length > 34 ? '…' + text.slice(-33) : text;
  }

  function fitResult() {
    const length = resultLine.textContent.length;
    resultLine.classList.toggle('len-m', length > 11 && length <= 14);
    resultLine.classList.toggle('len-s', length > 14 && length <= 18);
    resultLine.classList.toggle('len-xs', length > 18);
  }

  function previewValue(expr) {
    if (!expr) return null;
    let source = expr.replace(/[+\-*/^]+$/, '').replace(/\.$/, '');
    if (!source || /[.(]$/.test(source)) return null;
    try {
      return evaluateExpression(balanceParens(source), state.angle);
    } catch (error) {
      return null;
    }
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let swapAnim = null;
  let exprAnim = null;

  /* ------------------------------------------------------------------ *
   * 算式中的光标与选中（点击算式即可在对应位置编辑）
   * ------------------------------------------------------------------ */
  /**
   * 把内部算式（* / - pi）拆成带源码下标的显示片段（× ÷ − π）。
   * 下标用于把点击/光标位置映射回 state.expr。
   */
  function prettyTokens(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === 'p' && source[i + 1] === 'i') {
        tokens.push({ text: 'π', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      const glyph = ch === '*' ? '×' : ch === '/' ? '÷' : ch === '-' ? '−' : ch;
      tokens.push({ text: glyph, start: i, end: i + 1 });
      i += 1;
    }
    return tokens;
  }

  function hasSelection() {
    return Boolean(state.sel && state.sel.end > state.sel.start);
  }

  function clearEditingPoint() {
    state.caret = null;
    state.sel = null;
  }

  function replaceRange(start, end, text) {
    state.expr = state.expr.slice(0, start) + text + state.expr.slice(end);
    state.sel = null;
    state.caret = start + text.length;
  }

  function insertAtEditingPoint(text) {
    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, text);
      return;
    }
    const position = state.caret == null ? state.expr.length : state.caret;
    replaceRange(position, position, text);
  }

  function caretAtEnd() {
    return state.caret == null || state.caret >= state.expr.length;
  }

  function renderEditableExpr() {
    const tokens = prettyTokens(state.expr);
    const fragment = document.createDocumentFragment();
    const addCaret = () => {
      const caret = document.createElement('span');
      caret.className = 'expr-caret';
      caret.setAttribute('aria-hidden', 'true');
      fragment.appendChild(caret);
    };

    tokens.forEach((token) => {
      if (!hasSelection() && state.caret === token.start) addCaret();
      const span = document.createElement('span');
      const selected = hasSelection() && token.start >= state.sel.start && token.end <= state.sel.end;
      span.className = selected ? 'ch is-selected' : 'ch';
      span.dataset.start = String(token.start);
      span.dataset.end = String(token.end);
      span.textContent = token.text;
      fragment.appendChild(span);
    });

    if (!hasSelection() && state.caret === state.expr.length) addCaret();
    exprLine.replaceChildren(fragment);
  }

  function tokenAtBoundary(position, side) {
    const tokens = prettyTokens(state.expr);
    if (side === 'before') {
      return tokens.filter((token) => token.end === position).pop() || null;
    }
    return tokens.find((token) => token.start === position) || null;
  }

  function moveCaret(key) {
    const boundaries = [0];
    prettyTokens(state.expr).forEach((token) => boundaries.push(token.end));

    let position = hasSelection()
      ? state.sel.start
      : state.caret == null
        ? state.expr.length
        : state.caret;
    state.sel = null;

    if (key === 'Home') {
      position = 0;
    } else if (key === 'End') {
      position = state.expr.length;
    } else if (key === 'ArrowLeft') {
      const previous = boundaries.filter((boundary) => boundary < position).pop();
      position = previous == null ? 0 : previous;
    } else {
      const next = boundaries.find((boundary) => boundary > position);
      position = next == null ? state.expr.length : next;
    }

    state.caret = position;
    render();
  }

  exprLine.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'basic' || state.solved || state.error) return;
    if (!state.expr) {
      state.caret = 0;
      state.sel = null;
      render();
      return;
    }

    const char = event.target.closest('.ch');
    if (char) {
      const start = Number(char.dataset.start);
      const end = Number(char.dataset.end);
      state.sel = { start, end };
      state.caret = null;
    } else {
      const chars = exprLine.querySelectorAll('.ch');
      if (chars.length && event.clientX < chars[0].getBoundingClientRect().left) {
        state.caret = 0;
      } else {
        state.caret = state.expr.length;
      }
      state.sel = null;
    }
    event.preventDefault();
    screen.focus({ preventScroll: true });
    render();
  });

  function fitExprLine() {
    const length = exprLine.textContent.length;
    exprLine.classList.toggle('expr-len-m', length > 21 && length <= 26);
    exprLine.classList.toggle('expr-len-s', length > 26 && length <= 31);
    exprLine.classList.toggle('expr-len-xs', length > 31);
  }

  /**
   * 结果在“下方实时值”与“上方最终值”之间平滑移动。
   * 用 WAAPI 做位移 + 颜色过渡，结束后自动回落到 CSS 静态样式。
   */
  function animateResultSwap(from, nextState) {
    if (reduceMotion.matches) return;

    const box = resultLine.getBoundingClientRect();
    const style = getComputedStyle(resultLine);
    const dy = from.top - box.top;
    const solved = nextState === 'solved';

    swapAnim = resultLine.animate(
      [
        { transform: `translateY(${dy}px)`, color: from.color, opacity: from.opacity },
        { transform: 'translateY(0px)', color: style.color, opacity: style.opacity },
      ],
      {
        duration: solved ? 480 : 320,
        easing: solved ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.22, 0.9, 0.3, 1)',
      }
    );
    swapAnim.onfinish = () => {
      swapAnim = null;
    };

    if (solved) {
      exprAnim = exprLine.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        {
          duration: 300,
          delay: 190,
          easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)',
          fill: 'backwards',
        }
      );
      exprAnim.onfinish = () => {
        exprAnim = null;
      };
    }
  }

  function renderBasic() {
    screenTag.textContent = state.error ? '出错了' : state.solved ? '结果' : '标准运算';
    screen.classList.toggle('is-error', state.error);

    const nextState = state.solved && !state.error ? 'solved' : 'editing';
    const changed = display.dataset.state !== nextState;
    let snapshot = null;

    if (changed) {
      const box = resultLine.getBoundingClientRect();
      const style = getComputedStyle(resultLine);
      snapshot = { top: box.top, color: style.color, opacity: style.opacity };
      if (swapAnim) swapAnim.cancel();
      if (exprAnim) exprAnim.cancel();
      swapAnim = null;
      exprAnim = null;
    }

    if (state.error) {
      resultLine.textContent = '错误';
      exprLine.textContent = fitExpr(state.errMsg || '无法计算');
      resultLine.classList.remove('is-preview');
    } else if (state.solved) {
      resultLine.textContent = displayNumber(state.ans);
      exprLine.textContent = fitExpr(prettyExpr(state.lastExpr) + ' =');
      resultLine.classList.remove('is-preview');
    } else {
      const preview = previewValue(state.expr);
      resultLine.textContent = preview === null ? '0' : displayNumber(preview);
      resultLine.classList.toggle('is-preview', Boolean(state.expr));
      if (state.expr || state.caret != null) {
        renderEditableExpr();
      } else {
        exprLine.textContent = '\u00a0';
      }
    }

    fitResult();
    fitExprLine();
    display.dataset.state = nextState;

    if (snapshot) animateResultSwap(snapshot, nextState);
  }

  function render() {
    if (state.mode === 'basic') renderBasic();
  }

  function pulseResult() {
    if (state.mode !== 'basic') return;
    resultLine.classList.remove('pop');
    void resultLine.offsetWidth;
    resultLine.classList.add('pop');
  }

  function shakeScreen() {
    screen.classList.remove('shake');
    void screen.offsetWidth;
    screen.classList.add('shake');
  }

  screen.addEventListener('animationend', () => {
    screen.classList.remove('shake');
  });

  /* ------------------------------------------------------------------ *
   * 屏幕粘贴（标准模式）
   * ------------------------------------------------------------------ */
  function normalizePaste(text) {
    return String(text)
      .replace(/[\s\u00a0]/g, '')
      .replace(/[，,]/g, '')
      .replace(/[×xX]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–—]/g, '-')
      .replace(/π/g, 'pi')
      .replace(/[=＝]/g, '');
  }

  function failPaste(message) {
    state.error = true;
    state.solved = false;
    state.errMsg = message;
    render();
    shakeScreen();
  }

  function pasteIntoDisplay(raw) {
    if (state.mode !== 'basic') return;
    const text = normalizePaste(raw);
    if (!text) return;
    if (text.length > 64) {
      failPaste('粘贴内容过长（最多 64 个字符）');
      return;
    }
    if (/[^0-9a-zA-Z.+\-*/^()]/.test(text)) {
      failPaste('只能粘贴数字、运算符或函数');
      return;
    }
    const names = text.match(/[a-zA-Z]+/g) || [];
    const allowedNames = ['sin', 'cos', 'tan', 'sqrt', 'pi', 'e'];
    if (names.some((name) => !allowedNames.includes(name))) {
      failPaste('只能粘贴数字、运算符或函数');
      return;
    }

    let value;
    try {
      value = evaluateExpression(balanceParens(text), state.angle);
    } catch (error) {
      failPaste(error.message || '粘贴的内容无法计算');
      return;
    }
    if (!Number.isFinite(value)) {
      failPaste('粘贴的内容无法计算');
      return;
    }

    state.expr = text;
    state.solved = false;
    state.lastExpr = '';
    state.error = false;
    state.errMsg = '';
    state.caret = text.length;
    state.sel = null;
    render();
    pulseResult();
  }

  screen.addEventListener('click', () => screen.focus());
  window.addEventListener('paste', (event) => {
    if (state.mode !== 'basic') return;
    const data = event.clipboardData;
    if (!data) return;
    const text = data.getData('text');
    if (!text) return;
    event.preventDefault();
    pasteIntoDisplay(text);
  });

  /* ------------------------------------------------------------------ *
   * 算式编辑
   * ------------------------------------------------------------------ */
  function resetBasic() {
    state.expr = '';
    state.solved = false;
    state.lastExpr = '';
    state.ans = 0;
    state.error = false;
    state.errMsg = '';
    clearEditingPoint();
  }

  function startFresh() {
    state.expr = '';
    state.solved = false;
    state.lastExpr = '';
    state.error = false;
    state.errMsg = '';
    clearEditingPoint();
  }

  function pressDigit(digit) {
    if (state.error) resetBasic();
    if (state.solved) startFresh();

    // 选中了算式中的字符，或光标停在中间：直接在该位置写入
    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, digit);
      render();
      return;
    }
    if (!caretAtEnd()) {
      replaceRange(state.caret, state.caret, digit);
      render();
      return;
    }

    if (/(^|[+\-*/^(])0$/.test(state.expr)) {
      state.expr = state.expr.slice(0, -1);
    }

    const tail = /(\d+)$/.exec(state.expr);
    if (tail && tail[1].length >= 14) return;

    state.expr += digit;
    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressDot() {
    if (state.error) resetBasic();
    if (state.solved) startFresh();

    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, '.');
      render();
      return;
    }
    if (!caretAtEnd()) {
      replaceRange(state.caret, state.caret, '.');
      render();
      return;
    }

    const last = state.expr.slice(-1);
    if (last === ')' || /[a-zA-Z]$/.test(last)) return;

    const currentNumber = /(\d+\.?\d*)$/.exec(state.expr);
    if (currentNumber && currentNumber[0].includes('.')) return;

    if (!state.expr || /[+\-*/^(]$/.test(state.expr)) state.expr += '0.';
    else state.expr += '.';
    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressOperator(op) {
    if (state.error) resetBasic();

    if (state.solved) {
      // 计算完成后按 + − × ÷：把上一次的结果作为新算式的开头，例如 64 + …
      const base = literalOf(state.ans);
      state.solved = false;
      state.error = false;
      state.errMsg = '';
      state.lastExpr = '';
      state.expr = base + op;
      state.caret = state.expr.length;
      state.sel = null;
      render();
      return;
    }

    // 选中一个字符（例如 ×）后按运算符：直接替换它
    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, op);
      render();
      return;
    }

    // 单独一个负号是“负数的符号”，不是 0 减某个数
    if (state.expr === '-') {
      if (op === '-') return;
      state.expr = '0' + op;
      state.caret = state.expr.length;
      render();
      return;
    }

    if (!caretAtEnd()) {
      const next = state.expr[state.caret];
      if (next && '+-*/^'.includes(next)) {
        replaceRange(state.caret, state.caret + 1, op);
      } else {
        insertAtEditingPoint(op);
      }
      render();
      return;
    }

    if (!state.expr) {
      if (op === '-') {
        state.expr = '-';
        state.caret = 1;
        render();
        return;
      }
      state.expr = '0';
    }

    const base = state.expr.replace(/[+\-*/^]+$/, '').replace(/\.$/, '');

    if (!base) {
      state.expr = '0' + op;
    } else if (base.endsWith('(')) {
      if (op === '-') state.expr = base + '-';
      else return;
    } else {
      state.expr = base + op;
    }

    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressFunction(name) {
    if (state.error) resetBasic();
    // 计算完成后按函数键：从空白算式开始，例如直接显示 sin(，而不是 sin(上一次的结果)
    if (state.solved) startFresh();

    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, `${name}(`);
      render();
      return;
    }
    if (!caretAtEnd()) {
      insertAtEditingPoint(`${name}(`);
      render();
      return;
    }

    const last = state.expr.slice(-1);
    state.expr += (last && /[a-zA-Z]$/.test(last) ? '*' : '') + `${name}(`;
    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressConstant(name) {
    if (state.error) resetBasic();
    if (state.solved) startFresh();

    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, name);
      render();
      return;
    }
    if (!caretAtEnd()) {
      const before = state.expr[state.caret - 1] || '';
      // 数字或字母后插入乘号：避免 2e3 被解析成科学计数法、pie 被当成未知函数
      const prefix = /[a-zA-Z0-9]/.test(before) ? '*' : '';
      replaceRange(state.caret, state.caret, prefix + name);
      render();
      return;
    }

    const last = state.expr.slice(-1);
    const needsMultiply = /[a-zA-Z0-9]$/.test(last);
    state.expr += (needsMultiply ? '*' : '') + name;
    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressParen(paren) {
    if (state.error) resetBasic();
    if (state.solved) startFresh();

    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, paren);
      render();
      return;
    }
    if (!caretAtEnd()) {
      insertAtEditingPoint(paren);
      render();
      return;
    }

    if (paren === '(') {
      state.expr += '(';
      state.caret = state.expr.length;
      render();
      return;
    }

    const open = (state.expr.match(/\(/g) || []).length;
    const close = (state.expr.match(/\)/g) || []).length;
    if (open <= close) return;

    const last = state.expr.slice(-1);
    if (!last || last === '(' || '+-*/^'.includes(last)) return;

    state.expr += ')';
    state.caret = state.expr.length;
    state.sel = null;
    render();
  }

  function pressBack() {
    if (state.solved || state.error) {
      resetBasic();
      render();
      return;
    }
    if (!state.expr) return;

    // 选中了一段：直接删掉
    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, '');
      if (!state.expr) clearEditingPoint();
      render();
      return;
    }

    // 光标在中间：删除光标左边的一个片段（pi、函数名按整体删）
    if (state.caret != null && state.caret > 0 && state.caret < state.expr.length) {
      const token = tokenAtBoundary(state.caret, 'before');
      if (!token) return;
      replaceRange(token.start, token.end, '');
      if (!state.expr) clearEditingPoint();
      render();
      return;
    }

    // 光标在末尾：保留原有的整段后缀删除（sin(、pi 等）
    const suffix = ['sin(', 'cos(', 'tan(', 'sqrt(', 'pi'].find((token) =>
      state.expr.endsWith(token)
    );
    state.expr = suffix
      ? state.expr.slice(0, -suffix.length)
      : state.expr.slice(0, -1);
    state.caret = state.expr.length;
    state.sel = null;
    if (!state.expr) clearEditingPoint();
    render();
  }

  function pressForwardDelete() {
    if (state.solved || state.error) {
      resetBasic();
      render();
      return;
    }
    if (!state.expr) return;

    if (hasSelection()) {
      replaceRange(state.sel.start, state.sel.end, '');
      if (!state.expr) clearEditingPoint();
      render();
      return;
    }
    if (state.caret == null || state.caret >= state.expr.length) return;

    const token = tokenAtBoundary(state.caret, 'after');
    if (!token) return;
    replaceRange(token.start, token.end, '');
    if (!state.expr) clearEditingPoint();
    render();
  }

  function pressEquals() {
    if (state.error) {
      resetBasic();
      render();
      return;
    }
    if (!state.expr) return;

    const original = state.expr;
    try {
      const value = evaluateExpression(balanceParens(original), state.angle);
      state.ans = value;
      state.lastExpr = original;
      state.solved = true;
      state.expr = '';
      state.error = false;
      state.errMsg = '';
      clearEditingPoint();
      render();
    } catch (error) {
      state.error = true;
      state.errMsg = error.message || '无法计算';
      clearEditingPoint();
      render();
      shakeScreen();
    }
  }

  function handleAction(action, value) {
    if (state.mode !== 'basic') return;

    switch (action) {
      case 'digit':
        pressDigit(value);
        break;
      case 'dot':
        pressDot();
        break;
      case 'op':
        pressOperator(value);
        break;
      case 'fn':
        pressFunction(value);
        break;
      case 'const':
        pressConstant(value);
        break;
      case 'paren':
        pressParen(value);
        break;
      case 'back':
        pressBack();
        break;
      case 'clear':
        resetBasic();
        render();
        break;
      case 'equals':
        pressEquals();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   * 键盘
   * ------------------------------------------------------------------ */
  function flashKey(selector) {
    if (state.mode !== 'basic') return;
    const key = basicPad.querySelector(selector);
    if (!key) return;
    key.classList.add('is-pressed');
    window.setTimeout(() => key.classList.remove('is-pressed'), 130);
  }

  const OPERATOR_KEYS = { '+': '+', '-': '-', '*': '*', '/': '/', x: '*', X: '*' };

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.mode === 'matrix') {
      event.preventDefault();
      clearMatrices();
      return;
    }

    if (state.mode === 'matrix') {
      if (event.key === 'Enter' || event.key === '=') {
        event.preventDefault();
        applyMatrixOp(lastMatrixOp);
      }
      return;
    }

    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
      if (!state.expr) return;
      event.preventDefault();
      moveCaret(key);
      return;
    }

    if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      pressDigit(key);
      flashKey(`[data-action="digit"][data-value="${key}"]`);
      return;
    }

    if (OPERATOR_KEYS[key]) {
      event.preventDefault();
      const op = OPERATOR_KEYS[key];
      pressOperator(op);
      flashKey(`[data-action="op"][data-value="${op}"]`);
      return;
    }

    switch (key) {
      case '.':
        event.preventDefault();
        pressDot();
        flashKey('[data-action="dot"]');
        break;
      case 'Enter':
      case '=':
        event.preventDefault();
        pressEquals();
        flashKey('[data-action="equals"]');
        break;
      case 'Backspace':
        event.preventDefault();
        pressBack();
        flashKey('[data-action="back"]');
        break;
      case 'Escape':
        event.preventDefault();
        resetBasic();
        render();
        flashKey('[data-action="clear"]');
        break;
      case 'Delete':
        event.preventDefault();
        if (state.expr && (hasSelection() || (state.caret != null && state.caret < state.expr.length))) {
          pressForwardDelete();
          flashKey('[data-action="back"]');
        } else {
          resetBasic();
          render();
          flashKey('[data-action="clear"]');
        }
        break;
      case '(':
      case ')':
        event.preventDefault();
        pressParen(key);
        flashKey(`[data-action="paren"][data-value="${key}"]`);
        break;
      case 'p':
      case 'P':
        event.preventDefault();
        pressConstant('pi');
        flashKey('[data-action="const"][data-value="pi"]');
        break;
      case 'e':
      case 'E':
        event.preventDefault();
        pressConstant('e');
        flashKey('[data-action="const"][data-value="e"]');
        break;
      default:
        break;
    }
  });

  /* ------------------------------------------------------------------ *
   * 按键绑定
   * ------------------------------------------------------------------ */
  basicPad.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key) return;
    handleAction(key.dataset.action, key.dataset.value);
  });

  basicPad.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.key')) return;
    if (navigator.vibrate) navigator.vibrate(8);
  });

  angleChip.addEventListener('click', () => {
    state.angle = state.angle === 'DEG' ? 'RAD' : 'DEG';
    angleChip.textContent = state.angle;
    angleChip.dataset.angle = state.angle;
    angleChip.setAttribute('aria-label', `角度制 ${state.angle}，点击切换`);
    if (state.mode === 'basic' && !state.solved && !state.error) renderBasic();
  });

  /* ------------------------------------------------------------------ *
   * 矩阵
   * ------------------------------------------------------------------ */
  const cloneMatrix = (matrix) => matrix.map((row) => row.slice());

  function inputText(value) {
    if (!Number.isFinite(value)) return '0';
    if (Object.is(value, -0)) return '0';
    return String(Number(value.toFixed(6)));
  }

  function buildMatrixGrid(key) {
    const model = matrixState[key];
    const grid = key === 'A' ? gridA : gridB;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${model.size}, minmax(0, 1fr))`;

    for (let row = 0; row < model.size; row += 1) {
      for (let col = 0; col < model.size; col += 1) {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.spellcheck = false;
        const cell = model.data[row][col];
        input.value = cell == null || cell === '' ? '' : inputText(cell);
        input.placeholder = '—';
        input.dataset.matrix = key;
        input.dataset.row = String(row);
        input.dataset.col = String(col);
        input.setAttribute('aria-label', `矩阵 ${key} 第 ${row + 1} 行第 ${col + 1} 列`);
        input.addEventListener('input', () => {
          input.classList.remove('is-invalid');
          const raw = input.value.replace(/[,，\s]/g, '');
          if (!raw) {
            model.data[row][col] = null;
            return;
          }
          const parsed = parseFloat(raw);
          model.data[row][col] = Number.isFinite(parsed) ? parsed : null;
        });
        input.addEventListener('focus', () => input.select());
        grid.appendChild(input);
      }
    }
  }

  function setMatrixSize(key, size) {
    const model = matrixState[key];
    if (model.size === size) return;

    const old = model.data;
    model.size = size;
    model.data = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => {
        if (old[row] && old[row][col] != null && Number.isFinite(old[row][col])) return old[row][col];
        return null;
      })
    );

    buildMatrixGrid(key);
    matrixLast = null;
    showMatrixIdle();
  }

  function multiply(a, b) {
    const n = a.length;
    const output = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        let sum = 0;
        for (let k = 0; k < n; k += 1) sum += a[row][k] * b[k][col];
        output[row][col] = sum;
      }
    }
    return output;
  }

  function determinant(matrix) {
    const n = matrix.length;
    if (n === 1) return matrix[0][0];
    if (n === 2) {
      return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
    }
    return (
      matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
      matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
      matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    );
  }

  function transpose(matrix) {
    return matrix.map((row, r) => row.map((_, c) => matrix[c][r]));
  }

  function inverse(matrix) {
    const n = matrix.length;
    const det = determinant(matrix);
    if (Math.abs(det) < 1e-12) throw new Error('该矩阵不可逆（det = 0）');

    if (n === 2) {
      return [
        [matrix[1][1] / det, -matrix[0][1] / det],
        [-matrix[1][0] / det, matrix[0][0] / det],
      ];
    }

    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ];
  }

  function tidyCell(value) {
    return Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(10));
  }

  function fmtCell(value) {
    const n = tidyCell(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e7 || abs < 1e-4)) {
      return n.toExponential(3).replace('e+', 'e');
    }
    return String(Number(n.toFixed(4)));
  }

  function showMatrix(label, matrix) {
    screen.classList.remove('is-error');
    matrixResult.hidden = false;
    matrixResult.innerHTML = '';

    const labelEl = document.createElement('div');
    labelEl.className = 'mr-label';
    labelEl.textContent = label;
    matrixResult.appendChild(labelEl);

    const grid = document.createElement('div');
    grid.className = 'mr-grid';
    grid.style.gridTemplateColumns = `repeat(${matrix.length}, minmax(26px, auto))`;

    let longest = 0;
    matrix.forEach((row) => {
      row.forEach((value) => {
        const text = fmtCell(value);
        longest = Math.max(longest, text.length);
        const cell = document.createElement('span');
        cell.className = 'mr-cell';
        cell.textContent = text;
        grid.appendChild(cell);
      });
    });
    grid.classList.toggle('compact', longest >= 7);

    matrixResult.appendChild(grid);
    screenTag.textContent = '矩阵结果';
    matrixLast = { type: 'matrix', label, matrix: cloneMatrix(matrix) };
  }

  function showMatrixScalar(label, value) {
    screen.classList.remove('is-error');
    matrixResult.hidden = false;
    matrixResult.innerHTML = '';

    const labelEl = document.createElement('div');
    labelEl.className = 'mr-label';
    labelEl.textContent = label;
    matrixResult.appendChild(labelEl);

    const output = document.createElement('div');
    output.className = 'mr-scalar';
    output.textContent = displayNumber(value, false);
    matrixResult.appendChild(output);

    screenTag.textContent = '矩阵结果';
    matrixLast = { type: 'scalar', label, value };
  }

  function showMatrixError(message) {
    screen.classList.add('is-error');
    matrixResult.hidden = false;
    matrixResult.innerHTML = '';

    const labelEl = document.createElement('div');
    labelEl.className = 'mr-label';
    labelEl.textContent = '无法计算';
    matrixResult.appendChild(labelEl);

    const detail = document.createElement('div');
    detail.className = 'mr-error';
    detail.textContent = message;
    matrixResult.appendChild(detail);

    screenTag.textContent = '矩阵运算';
    matrixLast = null;
    shakeScreen();
  }

  function showMatrixIdle() {
    screen.classList.remove('is-error');
    matrixResult.hidden = false;
    matrixResult.innerHTML = '<div class="mr-hint">输入矩阵后<br>点击下方运算查看结果</div>';
    screenTag.textContent = '矩阵运算';
  }

  function restoreMatrixLast() {
    if (!matrixLast) {
      showMatrixIdle();
      return;
    }
    if (matrixLast.type === 'scalar') showMatrixScalar(matrixLast.label, matrixLast.value);
    else showMatrix(matrixLast.label, matrixLast.matrix);
  }

  function clearMatrices() {
    ['A', 'B'].forEach((key) => {
      const model = matrixState[key];
      model.data = Array.from({ length: model.size }, () => new Array(model.size).fill(null));
      buildMatrixGrid(key);
    });
    matrixLast = null;
    showMatrixIdle();
  }

  function clearMatrixMarks() {
    gridA.querySelectorAll('input.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    gridB.querySelectorAll('input.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  }

  function markMatrixInvalid(input) {
    clearMatrixMarks();
    if (!input) return;
    input.classList.add('is-invalid');
    input.focus();
    input.select();
  }

  function readMatrix(key) {
    const grid = key === 'A' ? gridA : gridB;
    const model = matrixState[key];
    const inputs = Array.from(grid.querySelectorAll('input'));
    const data = [];

    for (let row = 0; row < model.size; row += 1) {
      const line = [];
      for (let col = 0; col < model.size; col += 1) {
        const input = inputs[row * model.size + col];
        const raw = input.value.trim().replace(/[,，\s]/g, '');
        const where = `矩阵 ${key} 第 ${row + 1} 行第 ${col + 1} 列`;
        if (!raw) return { error: `${where}为空，请填写数字`, input };
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
          return { error: `${where}不是数字，请输入纯数字`, input };
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) return { error: `${where}超出可计算范围`, input };
        line.push(value);
        input.value = inputText(value);
      }
      data.push(line);
    }

    model.data = data;
    return { data };
  }

  function applyMatrixOp(op) {
    const sizeAValue = matrixState.A.size;
    const sizeBValue = matrixState.B.size;

    if (op === 'clear') {
      clearMatrices();
      return;
    }

    lastMatrixOp = op;

    const needsB = op === 'add' || op === 'sub' || op === 'mul';
    const parsedA = readMatrix('A');
    if (parsedA.error) {
      markMatrixInvalid(parsedA.input);
      showMatrixError(parsedA.error);
      return;
    }

    let parsedB = null;
    if (needsB) {
      parsedB = readMatrix('B');
      if (parsedB.error) {
        markMatrixInvalid(parsedB.input);
        showMatrixError(parsedB.error);
        return;
      }
    }

    clearMatrixMarks();
    const A = cloneMatrix(parsedA.data);
    const B = cloneMatrix(parsedB ? parsedB.data : matrixState.B.data);

    try {
      switch (op) {
        case 'add':
        case 'sub': {
          if (sizeAValue !== sizeBValue) {
            throw new Error(
              `尺寸不一致：A 为 ${sizeAValue}×${sizeAValue}，B 为 ${sizeBValue}×${sizeBValue}`
            );
          }
          const sign = op === 'add' ? 1 : -1;
          const sum = A.map((row, r) => row.map((value, c) => value + sign * B[r][c]));
          showMatrix(op === 'add' ? 'A + B =' : 'A − B =', sum);
          break;
        }
        case 'mul': {
          if (sizeAValue !== sizeBValue) {
            throw new Error(
              `无法相乘：A 为 ${sizeAValue}×${sizeAValue}，B 为 ${sizeBValue}×${sizeBValue}`
            );
          }
          showMatrix('A × B =', multiply(A, B));
          break;
        }
        case 'det':
          showMatrixScalar('det A =', determinant(A));
          break;
        case 'transpose':
          showMatrix('Aᵀ =', transpose(A));
          break;
        case 'inverse':
          showMatrix('A⁻¹ =', inverse(A));
          break;
        default:
          break;
      }
    } catch (error) {
      showMatrixError(error.message || '无法计算');
    }
  }

  matrixPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mop]');
    if (!button) return;
    applyMatrixOp(button.dataset.mop);
  });

  sizeA.addEventListener('change', () => setMatrixSize('A', Number(sizeA.value)));
  sizeB.addEventListener('change', () => setMatrixSize('B', Number(sizeB.value)));

  /* ------------------------------------------------------------------ *
   * 模式切换
   * ------------------------------------------------------------------ */
  function setMode(mode) {
    state.mode = mode;
    calculator.dataset.mode = mode;
    const isMatrix = mode === 'matrix';

    switchThumb.style.transform = isMatrix ? 'translateX(100%)' : 'translateX(0)';
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-selected', String(active));
    });

    basicPad.hidden = isMatrix;
    matrixPanel.hidden = !isMatrix;
    display.hidden = isMatrix;
    matrixResult.hidden = !isMatrix;

    if (isMatrix) {
      screen.classList.remove('is-error');
      restoreMatrixLast();
    } else {
      render();
    }
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */
  buildMatrixGrid('A');
  buildMatrixGrid('B');
  setMode('basic');
  render();
})();
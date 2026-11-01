/**
 * 标准计算器 — 计算核心
 * 不含任何 DOM 依赖，可同时运行在浏览器与 Node 中。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalcCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class CalcError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CalcError';
    }
  }

  const NUMBER_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  const NAME_RE = /[a-zA-Z]+/y;
  const OP_RE = /[+\-*/^()]/y;

  function tokenize(src) {
    const tokens = [];
    const source = String(src);
    let i = 0;

    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        i += 1;
        continue;
      }

      let match;
      NUMBER_RE.lastIndex = i;
      if ((match = NUMBER_RE.exec(source)) && match.index === i) {
        tokens.push({ type: 'num', value: parseFloat(match[0]) });
        i = NUMBER_RE.lastIndex;
        continue;
      }

      NAME_RE.lastIndex = i;
      if ((match = NAME_RE.exec(source)) && match.index === i) {
        tokens.push({ type: 'name', value: match[0] });
        i = NAME_RE.lastIndex;
        continue;
      }

      OP_RE.lastIndex = i;
      if ((match = OP_RE.exec(source)) && match.index === i) {
        tokens.push({ type: 'op', value: match[0] });
        i = OP_RE.lastIndex;
        continue;
      }

      throw new CalcError('算式包含无效字符');
    }

    return tokens;
  }

  /**
   * 递归下降求值器。
   * 支持 + − × ÷、括号、乘方、一元正负号、隐式乘法、sin/cos/tan/sqrt、pi/e。
   * @param {string} src 表达式（ASCII 运算符）
   * @param {'DEG'|'RAD'} angle 三角函数角度制
   */
  function evaluateExpression(src, angle) {
    const tokens = tokenize(src);
    if (!tokens.length) throw new CalcError('算式为空');

    const useDegrees = angle !== 'RAD';
    let pos = 0;

    const peek = () => tokens[pos];
    const isOp = (value) => {
      const token = tokens[pos];
      return Boolean(token) && token.type === 'op' && token.value === value;
    };
    const eatOp = (value) => {
      if (!isOp(value)) return false;
      pos += 1;
      return true;
    };
    const toRadians = (x) => (useDegrees ? (x * Math.PI) / 180 : x);
    const clean = (value) => (Math.abs(value) < 1e-12 ? 0 : value);

    function applyFunction(name, x) {
      switch (name) {
        case 'sin':
          return clean(Math.sin(toRadians(x)));
        case 'cos':
          return clean(Math.cos(toRadians(x)));
        case 'tan': {
          const radians = toRadians(x);
          if (Math.abs(Math.cos(radians)) < 1e-12) {
            throw new CalcError('该角度下 tan 无定义');
          }
          return clean(Math.tan(radians));
        }
        case 'sqrt':
          if (x < 0) throw new CalcError('负数不能开平方');
          return Math.sqrt(x);
        default:
          throw new CalcError('未知函数 ' + name);
      }
    }

    function parseExpression() {
      let value = parseTerm();
      for (;;) {
        if (eatOp('+')) value += parseTerm();
        else if (eatOp('-')) value -= parseTerm();
        else return value;
      }
    }

    function startsImplicitFactor() {
      const token = peek();
      if (!token) return false;
      return (
        token.type === 'num' ||
        token.type === 'name' ||
        (token.type === 'op' && token.value === '(')
      );
    }

    function parseTerm() {
      let value = parseUnary();
      for (;;) {
        if (eatOp('*')) {
          value *= parseUnary();
        } else if (eatOp('/')) {
          const divisor = parseUnary();
          if (divisor === 0) throw new CalcError('除数不能为 0');
          value /= divisor;
        } else if (startsImplicitFactor()) {
          value *= parseUnary();
        } else {
          return value;
        }
      }
    }

    function parseUnary() {
      if (eatOp('-')) return -parseUnary();
      if (eatOp('+')) return parseUnary();
      return parsePower();
    }

    function parsePower() {
      const base = parsePrimary();
      if (eatOp('^')) return Math.pow(base, parseUnary());
      return base;
    }

    function parsePrimary() {
      const token = peek();
      if (!token) throw new CalcError('算式不完整');

      if (token.type === 'num') {
        pos += 1;
        return token.value;
      }

      if (token.type === 'name') {
        pos += 1;
        if (token.value === 'pi') return Math.PI;
        if (token.value === 'e') return Math.E;
        if (!eatOp('(')) throw new CalcError(token.value + ' 后需要括号');
        const argument = parseExpression();
        if (!eatOp(')')) throw new CalcError('括号不匹配');
        return applyFunction(token.value, argument);
      }

      if (token.type === 'op' && token.value === '(') {
        pos += 1;
        const value = parseExpression();
        if (!eatOp(')')) throw new CalcError('括号不匹配');
        return value;
      }

      throw new CalcError('算式有误');
    }

    const result = parseExpression();
    if (pos < tokens.length) throw new CalcError('算式有误');
    if (!Number.isFinite(result)) throw new CalcError('结果超出范围');
    return result;
  }

  /** 自动补齐右侧括号，多余的右括号则报错。 */
  function balanceParens(expr) {
    let depth = 0;
    for (const ch of expr) {
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth < 0) throw new CalcError('括号不匹配');
      }
    }
    return depth > 0 ? expr + ')'.repeat(depth) : expr;
  }

  /** 千分位分组（仅处理普通十进制数字字符串）。 */
  function addGrouping(text) {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return text;
    const sign = match[1];
    const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decimals = match[3] ? '.' + match[3] : '';
    return sign + integer + decimals;
  }

  /** 把数值格式化为计算器屏显文本。 */
  function formatNumber(value, grouping) {
    let n = value;
    if (Object.is(n, -0)) n = 0;
    if (Math.abs(n) < 5e-13) n = 0;
    if (!Number.isFinite(n)) return '错误';

    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) {
      return n
        .toExponential(6)
        .replace(/(\.\d*?[1-9])0+e/, '$1e')
        .replace(/\.0+e/, 'e')
        .replace('e+', 'e');
    }

    let text = n.toPrecision(12);
    if (text.includes('e')) text = String(Number(text));
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');

    return grouping === false ? text : addGrouping(text);
  }

  /** 屏幕表达式里的 × ÷ − 与 π 美化。 */
  function prettyExpr(expr) {
    return String(expr)
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/-/g, '−')
      .replace(/pi/g, 'π');
  }

  return {
    CalcError,
    tokenize,
    evaluateExpression,
    balanceParens,
    addGrouping,
    formatNumber,
    prettyExpr,
  };
});
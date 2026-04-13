// src/path.js
class Step {
  lookup(_v, dval = null) {
    return dval;
  }
  setValue(root, _v) {
    return root;
  }
  updateBindings(_v, _o) {}
  isFrame = true;
}

class BindStep extends Step {
  constructor(binds) {
    super();
    this.binds = binds;
  }
  lookup(v, _dval) {
    return v;
  }
  setValue(_root, v) {
    return v;
  }
  withIndex(i) {
    return new BindStep({ ...this.binds, key: i });
  }
  withKey(key) {
    return new BindStep({ ...this.binds, key });
  }
  updateBindings(_v, o) {
    Object.assign(o, this.binds);
  }
  isFrame = false;
}

class FieldStep extends Step {
  constructor(field) {
    super();
    this.field = field;
  }
  lookup(v, dval = null) {
    return v?.get ? v.get(this.field, dval) : dval;
  }
  setValue(root, v) {
    return root.set(this.field, v);
  }
  withIndex(i) {
    return new SeqIndexStep(this.field, i);
  }
  withKey(k) {
    return new SeqKeyStep(this.field, k);
  }
}

class FieldSeqStep extends Step {
  constructor(field, key) {
    super();
    this.field = field;
    this.key = key;
  }
  lookup(v, dval = null) {
    const o = v?.get(this.field, null);
    return o?.get ? o.get(this.key, dval) : dval;
  }
  setValue(root, v) {
    return root.set(this.field, root.get(this.field).set(this.key, v));
  }
  updateBindings(_v, o) {
    o.key = this.key;
  }
}

class SeqKeyStep extends FieldSeqStep {
}

class SeqIndexStep extends FieldSeqStep {
}
var NONE = Symbol("NONE");

class SeqAccessStep extends Step {
  constructor(seqField, keyField) {
    super();
    this.seqField = seqField;
    this.keyField = keyField;
  }
  lookup(v, dval = null) {
    const seq = v?.get(this.seqField, NONE);
    const key = v?.get(this.keyField, NONE);
    return key !== NONE && seq?.get ? seq.get(key, dval) : dval;
  }
  setValue(root, v) {
    const seq = root?.get(this.seqField, NONE);
    const key = root?.get(this.keyField, NONE);
    return seq === NONE || key === NONE ? root : root.set(this.seqField, seq.set(key, v));
  }
  updateBindings(v, o) {
    o.key = v?.get(this.keyField, null);
  }
}

class Path {
  constructor(steps = []) {
    this.steps = steps;
  }
  concat(steps) {
    return new Path(this.steps.concat(steps));
  }
  popStep() {
    return new Path(this.steps.slice(0, -1));
  }
  lookup(v, dval = null) {
    let curVal = v;
    for (const step of this.steps) {
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) {
        return dval;
      }
    }
    return curVal;
  }
  setValue(root, v) {
    const intermediates = new Array(this.steps.length);
    let curVal = root;
    for (let i = 0;i < this.steps.length; i++) {
      intermediates[i] = curVal;
      curVal = this.steps[i].lookup(curVal, NONE);
      if (curVal === NONE) {
        return root;
      }
    }
    let newVal = v;
    for (let i = this.steps.length - 1;i >= 0; i--) {
      newVal = this.steps[i].setValue(intermediates[i], newVal);
      intermediates[i] = newVal;
    }
    return newVal;
  }
  buildStack(stack) {
    const root = stack.it;
    let curVal = root;
    for (const step of this.steps) {
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) {
        console.warn(`bad PathItem`, { root, curVal, step, path: this });
        return null;
      }
      step.updateBindings(curVal, stack.binds.head.bindings);
      stack = stack.enter(curVal, {}, step.isFrame);
    }
    return stack;
  }
  static fromNodeAndEventName(node, eventName, rootNode, maxDepth, comps, stopOnNoEvent = true) {
    const pathSteps = [];
    let depth = 0;
    let eventIds = [];
    let handlers = null;
    let nodeIds = [];
    let isLeafComponent = true;
    while (node && node !== rootNode && depth < maxDepth) {
      if (node?.dataset) {
        const { nid, si, sk } = parseMetaComment(node.previousSibling);
        const { eid, cid, vid } = node.dataset;
        if (eid !== undefined)
          eventIds.push(eid);
        if (cid !== undefined) {
          const comp = comps.getComponentForId(+cid, vid);
          if (isLeafComponent) {
            handlers = findHandlers(comp, eventIds, vid, eventName);
            if (handlers === null && stopOnNoEvent)
              return NO_EVENT_INFO;
            isLeafComponent = false;
          }
          const step = resolvePathStep(comp, nodeIds, vid);
          if (step)
            pathSteps.push(step);
          eventIds = [];
          nodeIds = [];
        }
        if (nid !== undefined)
          nodeIds.push({ nid, si, sk });
      }
      depth += 1;
      node = node.parentNode;
    }
    return [new Path(pathSteps.reverse()), handlers];
  }
  static fromEvent(e, rNode, maxDepth, comps, stopOnNoEvent = true) {
    const { type, target } = e;
    return Path.fromNodeAndEventName(target, type, rNode, maxDepth, comps, stopOnNoEvent);
  }
}
var EMPTY_META = {};
function parseMetaComment(n) {
  if (n?.nodeType === 8 && n.textContent[0] === "§") {
    const m = parseMetaComment(n.previousSibling);
    if (m !== EMPTY_META) {
      return m;
    }
    try {
      return JSON.parse(n.textContent.slice(1, -1));
    } catch (err) {
      console.warn(err, n);
    }
  }
  return EMPTY_META;
}
function findHandlers(comp, eventIds, vid, eventName) {
  for (const eid of eventIds) {
    const handlers = comp.getEventForId(+eid, vid).getHandlersFor(eventName);
    if (handlers !== null)
      return handlers;
  }
  return null;
}
function resolvePathStep(comp, nodeIds, vid) {
  for (let i = 0;i < nodeIds.length; i++) {
    const node = comp.getNodeForId(+nodeIds[i].nid, vid);
    const j = node.pathInNext ? i + 1 : i;
    const { si, sk, nid: nodeId } = nodeIds[j];
    const pi = node.pathInNext ? comp.getNodeForId(+nodeId, vid).val.toPathItem() : node.toPathItem();
    if (pi !== null) {
      return si !== undefined ? pi.withIndex(+si) : sk ? pi.withKey(sk) : pi;
    }
  }
  return null;
}
var NO_EVENT_INFO = [null, null];

class PathBuilder {
  constructor() {
    this.pathChanges = [];
  }
  add(pathChange) {
    this.pathChanges.push(pathChange);
    return this;
  }
  field(name) {
    return this.add(new FieldStep(name));
  }
  index(name, index) {
    return this.add(new SeqIndexStep(name, index));
  }
  key(name, key) {
    return this.add(new SeqKeyStep(name, key));
  }
}

// src/value.js
var VALID_VAL_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
var isValidValId = (name) => VALID_VAL_ID_RE.test(name);
var VALID_FLOAT_RE = /^-?[0-9]+(\.[0-9]+)?$/;
var parseStrTemplate = (v, px) => StrTplVal.parse(v, px);
var parseConst = (v, _) => new ConstVal(v);
var parseName = (v, _) => isValidValId(v) ? new NameVal(v) : null;
var parseType = (v, _) => isValidValId(v) ? new TypeVal(v) : null;
var parseBind = (v, _) => isValidValId(v) ? new BindVal(v) : null;
var parseDyn = (v, _) => isValidValId(v) ? new DynVal(v) : null;
var parseField = (v, _) => isValidValId(v) ? new FieldVal(v) : null;
var parseComp = (v, _) => isValidValId(v) ? new ComputedVal(v) : null;
var parseReq = (v, _) => isValidValId(v) ? new RequestVal(v) : null;

class ValParser {
  constructor() {
    this.allowFieldOnly();
    this.bindValIt = new BindVal("it");
    this.nullConstVal = new ConstVal(null);
  }
  const(v) {
    return new ConstVal(v);
  }
  allowFieldOnly() {
    this.okField = true;
    this.okBind = false;
    this.okComputed = false;
    this.okDyn = false;
    this.okType = false;
    this.okRequest = false;
    this.okName = false;
    this.okConst = false;
    this.okStrTpl = false;
    this.okSeqAccess = false;
  }
  parseIfOk(s, px, isOk, parseFn) {
    return isOk ? parseFn(s, px) : null;
  }
  _parseSeqAccess(s, px) {
    if (!this.okSeqAccess) {
      return null;
    }
    const openSquareBracketIndex = s.indexOf("[");
    this.allowFieldOnly();
    const left = this.parse(s.slice(0, openSquareBracketIndex), px);
    const right = this.parse(s.slice(openSquareBracketIndex + 1, -1), px);
    return left && right ? new SeqAccessVal(left, right) : null;
  }
  parse(s, px) {
    switch (getValSubType(s)) {
      case VAL_SUB_TYPE_STRING_TEMPLATE:
        return this.parseIfOk(s, px, this.okStrTpl, parseStrTemplate);
      case VAL_SUB_TYPE_CONST_STRING:
        return this.parseIfOk(s, px, this.okStrTpl, parseConst);
      case VAL_SUB_TYPE_SEQ_ACCESS:
        return this._parseSeqAccess(s, px);
      case VAL_SUB_TYPE_INVALID:
        return this.parseIfOk(s, px, this.okStrTpl, parseStrTemplate);
    }
    const charCode = s.charCodeAt(0);
    switch (charCode) {
      case 94: {
        const newS = px.frame.macroVars?.[s.slice(1)];
        if (newS !== undefined) {
          return this.parse(newS, px);
        }
        return null;
      }
      case 126:
        return this.parseIfOk(s.slice(1), px, this.okStrTpl, parseConst);
      case 39:
        return this.parseIfOk(s.slice(1, -1), px, this.okStrTpl, parseConst);
      case 64:
        return this.parseIfOk(s.slice(1), px, this.okBind, parseBind);
      case 42:
        return this.parseIfOk(s.slice(1), px, this.okDyn, parseDyn);
      case 46:
        return this.parseIfOk(s.slice(1), px, this.okField, parseField);
      case 36:
        return this.parseIfOk(s.slice(1), px, this.okComputed, parseComp);
      case 33:
        return this.parseIfOk(s.slice(1), px, this.okRequest, parseReq);
    }
    const num = VALID_FLOAT_RE.test(s) ? parseFloat(s) : null;
    if (Number.isFinite(num)) {
      return this.parseIfOk(num, px, this.okConst, parseConst);
    } else if (s === "true" || s === "false") {
      return this.parseIfOk(s === "true", px, this.okConst, parseConst);
    } else if (charCode >= 97 && charCode <= 122) {
      return this.parseIfOk(s, px, this.okName, parseName);
    } else if (charCode >= 65 && charCode <= 90) {
      return this.parseIfOk(s, px, this.okType, parseType);
    }
    return null;
  }
  parseDynamic(s, px) {
    this.allowFieldOnly();
    this.okComputed = true;
    return this.parse(s, px);
  }
  parseEach(s, px) {
    this.allowFieldOnly();
    this.okComputed = true;
    this.okDyn = true;
    return this.parse(s, px);
  }
  allowHandlerArg() {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okType = true;
    this.okRequest = true;
    this.okName = true;
    this.okConst = true;
  }
  parseHandlerArg(s, px) {
    this.allowHandlerArg();
    return this.parse(s, px);
  }
  _parseHandler(s, px, HandlerClass) {
    this.allowFieldOnly();
    this.okName = true;
    const val = this.parse(s, px);
    return val && (val.toRawFieldVal ? val.toRawFieldVal() : new HandlerClass(val.name));
  }
  parseHandlerName(s, px) {
    return this._parseHandler(s, px, InputHandlerNameVal);
  }
  parseAlter(s, px) {
    return this._parseHandler(s, px, AlterHandlerNameVal);
  }
  parseAttr(s, px) {
    return this.parseText(s, px);
  }
  parseAll(s, px) {
    this.allowHandlerArg();
    this.okStrTpl = true;
    this.okSeqAccess = true;
    return this.parse(s, px);
  }
  parseCondValue(s, px) {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okConst = true;
    return this.parse(s, px);
  }
  parseText(s, px) {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okConst = true;
    this.okStrTpl = true;
    return this.parse(s, px);
  }
  parseRender(s, px) {
    this.allowFieldOnly();
    this.okSeqAccess = true;
    return this.parse(s, px);
  }
}

class BaseVal {
  render(_stack, _rx) {}
  eval(_stack) {}
  toPathItem() {
    return null;
  }
}

class ConstVal extends BaseVal {
  constructor(value) {
    super();
    this.value = value;
  }
  render(_stack, _rx) {
    return this.value;
  }
  eval(_stack) {
    return this.value;
  }
  toString() {
    const v = this.value;
    return typeof v === "string" ? `'${v}'` : `${v}`;
  }
}

class VarVal extends BaseVal {
}

class StrTplVal extends VarVal {
  constructor(vals) {
    super();
    this.vals = vals;
  }
  render(stack, _rx) {
    return this.eval(stack);
  }
  eval(stack) {
    const strs = new Array(this.vals.length);
    for (let i = 0;i < this.vals.length; i++) {
      strs[i] = this.vals[i]?.eval(stack, "");
    }
    return strs.join("");
  }
  static parse(s, px) {
    const parts = s.split(/(\{[^}]+\})/g);
    const vals = new Array(parts.length);
    let allConsts = true;
    for (let i = 0;i < parts.length; i++) {
      const s2 = parts[i];
      const isExpr = s2[0] === "{" && s2.at(-1) === "}";
      const val = isExpr ? vp.parseText(s2.slice(1, -1), px) : new ConstVal(s2);
      vals[i] = val;
      allConsts &&= val instanceof ConstVal;
    }
    return allConsts ? new ConstVal(vals.map((v) => v.value).join("")) : new StrTplVal(vals);
  }
}

class NameVal extends VarVal {
  constructor(name) {
    super();
    this.name = name;
  }
  eval(stack) {
    return stack.lookupName(this.name);
  }
  toString() {
    return this.name;
  }
}

class InputHandlerNameVal extends NameVal {
  eval(stack) {
    return stack.getInputHandler(this.name) ?? mk404Handler("input", this.name);
  }
}

class AlterHandlerNameVal extends NameVal {
  eval(stack) {
    return stack.getAlterHandler(this.name) ?? mk404Handler("alter", this.name);
  }
}
var mk404Handler = (type, name) => function(...args) {
  console.warn("handler not found", { type, name, args }, this);
  return this;
};

class TypeVal extends NameVal {
  eval(stack) {
    return stack.lookupType(this.name);
  }
}

class RequestVal extends NameVal {
  eval(stack) {
    return stack.lookupRequest(this.name);
  }
  toString() {
    return `!${this.name}`;
  }
}

class RawFieldVal extends NameVal {
  eval(stack) {
    return stack.lookupFieldRaw(this.name);
  }
  toString() {
    return `.${this.name}`;
  }
}

class RenderVal extends BaseVal {
  render(stack, _rx) {
    return this.eval(stack);
  }
}

class RenderNameVal extends RenderVal {
  constructor(name) {
    super();
    this.name = name;
  }
}

class BindVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupBind(this.name);
  }
  toString() {
    return `@${this.name}`;
  }
}

class DynVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupDynamic(this.name);
  }
  toPathItem() {
    return null;
  }
  toString() {
    return `*${this.name}`;
  }
}

class FieldVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupField(this.name);
  }
  toPathItem() {
    return new FieldStep(this.name);
  }
  toRawFieldVal() {
    return new RawFieldVal(this.name);
  }
  toString() {
    return `.${this.name}`;
  }
}

class ComputedVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupComputed(this.name);
  }
  toString() {
    return `$${this.name}`;
  }
}

class SeqAccessVal extends RenderVal {
  constructor(seqVal, keyVal) {
    super();
    this.seqVal = seqVal;
    this.keyVal = keyVal;
  }
  toPathItem() {
    return new SeqAccessStep(this.seqVal.name, this.keyVal.name);
  }
  eval(stack) {
    const key = this.keyVal.eval(stack);
    return this.seqVal.eval(stack).get(key, null);
  }
  toString() {
    return `${this.seqVal}[${this.keyVal}]`;
  }
}
var VAL_SUB_TYPE_STRING_TEMPLATE = 0;
var VAL_SUB_TYPE_SEQ_ACCESS = 1;
var VAL_SUB_TYPE_INVALID = 2;
var VAL_SUB_TYPE_CONST_STRING = 3;
function getValSubType(s) {
  let open = 0;
  let close = 0;
  for (let i = 0;i < s.length; i++) {
    switch (s.charCodeAt(i)) {
      case 91:
        if (open > 0) {
          return VAL_SUB_TYPE_INVALID;
        }
        open += 1;
        break;
      case 93:
        if (close > 0 || open === 0) {
          return VAL_SUB_TYPE_INVALID;
        }
        close += 1;
        break;
      case 123:
        return VAL_SUB_TYPE_STRING_TEMPLATE;
      case 125:
        return VAL_SUB_TYPE_CONST_STRING;
    }
  }
  if (open > 0 || close > 0) {
    return open === 1 && close === 1 ? VAL_SUB_TYPE_SEQ_ACCESS : VAL_SUB_TYPE_INVALID;
  }
  return -1;
}
var vp = new ValParser;

// src/attribute.js
class Attributes {
  constructor(items) {
    this.items = items;
  }
  eval(_stack) {
    return {};
  }
  static parse(attributes, px, parseAll = false) {
    return getAttrParser(px).parse(attributes, parseAll);
  }
  isConstant() {
    return false;
  }
}
var booleanAttrsRaw = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly,async,autofocus,autoplay,controls,default,defer,disabled,hidden,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected";
var booleanAttrs = new Set(booleanAttrsRaw.split(","));

class AttrParser {
  constructor(px) {
    this.clear(px);
  }
  clear(px) {
    this.px = px;
    this.attrs = null;
    this.hasDynamic = false;
    this.wrapperAttrs = null;
    this.textChild = null;
    this.eachAttr = null;
    this.ifAttr = null;
    this.events = null;
  }
  parseAttr(name, value, parseAll = false) {
    const val = parseAll ? vp.parseAll(value, this.px) : vp.parseAttr(value, this.px);
    if (val !== null) {
      this.attrs ??= [];
      this.attrs.push(new Attr(name, val));
      this.hasDynamic ||= !(val instanceof ConstVal);
    }
  }
  pushWrapper(name, raw, val) {
    const node = { name, val, raw };
    this.wrapperAttrs ??= [];
    this.wrapperAttrs.push(node);
    return node;
  }
  parseIf(directiveName, value) {
    const dynVal = vp.parseCondValue(value, this.px);
    if (dynVal) {
      this.ifAttr = new IfAttr(directiveName.slice(3), dynVal);
      this.attrs ??= [];
      this.attrs.push(this.ifAttr);
      this.hasDynamic = true;
    }
  }
  parseThen(s) {
    if (this.ifAttr) {
      this.ifAttr.thenVal = vp.parseAttr(s, this.px) ?? NOT_SET_VAL;
    }
  }
  parseElse(value) {
    if (this.ifAttr) {
      this.ifAttr.elseVal = vp.parseAttr(value, this.px) ?? NOT_SET_VAL;
    }
  }
  parseEvent(directiveName, value) {
    const [eventName, ...modifiers] = directiveName.slice(3).split("+");
    const handler = EventHandler.parse(value, this.px);
    if (handler) {
      if (this.events === null) {
        this.events = this.px.registerEvents();
        this.attrs ??= [];
        this.attrs.push(new ConstAttr("data-eid", vp.const(this.events.id)));
      }
      this.events.add(eventName, handler, modifiers);
    }
  }
  parseDirective(s, directiveName) {
    switch (directiveName) {
      case "dangerouslysetinnerhtml":
        this.attrs ??= [];
        this.attrs.push(new RawHtmlAttr(vp.parseText(s, this.px)));
        this.hasDynamic = true;
        return;
      case "slot":
        this.pushWrapper("slot", s, vp.const(s));
        return;
      case "push-view":
        this.pushWrapper("push-view", s, vp.parseText(s, this.px));
        return;
      case "text":
        this.textChild = vp.parseText(s, this.px);
        return;
      case "show":
        this.pushWrapper("show", s, vp.parseCondValue(s, this.px));
        return;
      case "hide":
        this.pushWrapper("hide", s, vp.parseCondValue(s, this.px));
        return;
      case "each":
        this.eachAttr = this.pushWrapper("each", s, vp.parseEach(s, this.px));
        return;
      case "enrich-with":
        if (this.eachAttr !== null) {
          this.eachAttr.enrichWithVal = vp.parseAlter(s, this.px);
        } else {
          this.pushWrapper("scope", s, vp.parseAlter(s, this.px));
        }
        return;
      case "when":
        this._parseWhen(s);
        return;
      case "loop-with":
        this._parseLoopWith(s);
        return;
      case "then":
        this.parseThen(s);
        return;
      case "else":
        this.parseElse(s);
        return;
    }
    if (directiveName.startsWith("on.")) {
      this.parseEvent(directiveName, s);
    } else if (directiveName.startsWith("if.")) {
      this.parseIf(directiveName, s);
    } else if (directiveName.startsWith("then.")) {
      this.parseThen(s);
    } else if (directiveName.startsWith("else.")) {
      this.parseElse(s);
    }
  }
  _parseWhen(s) {
    if (this.eachAttr !== null) {
      this.eachAttr.whenVal = vp.parseAlter(s, this.px);
    }
  }
  _parseLoopWith(s) {
    if (this.eachAttr !== null) {
      this.eachAttr.loopWithVal = vp.parseAlter(s, this.px);
    }
  }
  parse(attributes, parseAll = false) {
    for (const { name, value } of attributes) {
      const charCode = name.charCodeAt(0);
      if (charCode === 58) {
        this.parseAttr(name === ":viewbox" ? "viewBox" : name.slice(1), value, parseAll);
      } else if (charCode === 64) {
        this.parseDirective(value, name.slice(1));
      } else {
        this.attrs ??= [];
        const constVal = value === "" && booleanAttrs.has(name) ? true : value;
        this.attrs.push(new ConstAttr(name, vp.const(constVal)));
      }
    }
    const { attrs, hasDynamic } = this;
    const pAttrs = hasDynamic ? new DynAttrs(attrs) : ConstAttrs.fromAttrs(attrs ?? []);
    return [pAttrs, this.wrapperAttrs, this.textChild];
  }
}

class ConstAttrs extends Attributes {
  eval(_stack) {
    return this.items;
  }
  static fromAttrs(attrs) {
    const attrsObj = {};
    for (const attr of attrs) {
      attrsObj[attr.name] = attr.value.eval(null);
    }
    return new ConstAttrs(attrsObj);
  }
  setDataAttr(key, val) {
    this.items[key] = val;
  }
  toMacroVars() {
    const r = {};
    for (const name in this.items) {
      r[name] = `'${this.items[name]}'`;
    }
    return r;
  }
  isConstant() {
    return true;
  }
}

class DynAttrs extends Attributes {
  eval(stack) {
    const attrs = {};
    for (const attr of this.items) {
      attrs[attr.name] = attr.eval(stack);
    }
    return attrs;
  }
  setDataAttr(key, val) {
    this.items.push(new ConstAttr(key, new ConstVal(val)));
  }
  toMacroVars() {
    const r = {};
    for (const attr of this.items) {
      r[attr.name] = attr.value.toString();
    }
    return r;
  }
}

class BaseAttr {
  constructor(name) {
    this.name = name;
  }
}

class Attr extends BaseAttr {
  constructor(name, value) {
    super(name);
    this.value = value;
  }
  eval(stack) {
    return this.value.eval(stack);
  }
}

class ConstAttr extends Attr {
}
class RawHtmlAttr extends Attr {
  constructor(value) {
    super("dangerouslySetInnerHTML", value ?? vp.nullConstVal);
  }
  eval(stack) {
    return { __html: `${this.value.eval(stack)}` };
  }
}
var NOT_SET_VAL = vp.nullConstVal;

class IfAttr extends BaseAttr {
  constructor(name, condVal) {
    super(name);
    this.condVal = condVal;
    this.thenVal = this.elseVal = NOT_SET_VAL;
  }
  get anyBranchIsSet() {
    return this.thenVal !== NOT_SET_VAL || this.elseVal !== NOT_SET_VAL;
  }
  eval(stack) {
    return this.condVal.eval(stack) ? this.thenVal.eval(stack) : this.elseVal.eval(stack);
  }
}
var _attrParser = null;
function getAttrParser(px) {
  _attrParser ??= new AttrParser(px);
  _attrParser.clear(px);
  return _attrParser;
}

class EventHandler {
  constructor(handlerVal, args = []) {
    this.handlerVal = handlerVal;
    this.args = args;
  }
  getHandlerAndArgs(stack, _event) {
    const argValues = new Array(this.args.length);
    for (let i = 0;i < argValues.length; i++) {
      argValues[i] = this.args[i].eval(stack);
    }
    return [this.handlerVal.eval(stack), argValues];
  }
  static parse(s, px) {
    const [handlerName, ...rawArgs] = s.trim().split(/\s+/);
    const handlerVal = vp.parseHandlerName(handlerName, px);
    if (handlerVal === null) {
      return null;
    }
    const args = new Array(rawArgs.length);
    vp.allowHandlerArg();
    for (let i = 0;i < rawArgs.length; i++) {
      const val = vp.parse(rawArgs[i], px);
      args[i] = val !== null ? val : vp.nullConstVal;
    }
    return new EventHandler(handlerVal, args);
  }
}

class RequestHandler {
  constructor(name, fn) {
    this.name = name;
    this.fn = fn;
  }
  toHandlerArg(disp) {
    const f = (...args) => disp.request(this.name, args);
    f.withOpts = (...args) => disp.request(this.name, args.slice(0, -1), args.at(-1));
    return f;
  }
}

// src/anode.js
class BaseNode {
  render(_stack, rx) {
    return rx.renderEmpty();
  }
  setDataAttr(key, val) {
    console.warn("setDataAttr not implemented for", this, { key, val });
  }
  isConstant() {
    return false;
  }
  optimize() {}
}

class TextNode extends BaseNode {
  constructor(v) {
    super();
    this.v = v;
  }
  render(_stack, rx) {
    return rx.renderText(this.v);
  }
  isWhiteSpace() {
    for (let i = 0;i < this.v.length; i++) {
      const c = this.v.charCodeAt(i);
      if (!(c === 32 || c === 10 || c === 9 || c === 13)) {
        return false;
      }
    }
    return true;
  }
  hasNewLine() {
    for (let i = 0;i < this.v.length; i++) {
      const c = this.v.charCodeAt(i);
      if (c === 10 || c === 13) {
        return true;
      }
    }
    return false;
  }
  condenseWhiteSpace() {
    this.v = "";
  }
  isConstant() {
    return true;
  }
  setDataAttr(_key, _val) {}
}

class CommentNode extends TextNode {
  render(_stack, rx) {
    return rx.renderComment(this.v);
  }
}
function optimizeChilds(childs) {
  for (let i = 0;i < childs.length; i++) {
    const child = childs[i];
    if (child.isConstant()) {
      childs[i] = new RenderOnceNode(child);
    } else {
      child.optimize();
    }
  }
}
function optimizeNode(node) {
  if (node.isConstant()) {
    return new RenderOnceNode(node);
  }
  node.optimize();
  return node;
}

class ChildsNode extends BaseNode {
  constructor(childs) {
    super();
    this.childs = childs;
  }
  isConstant() {
    return this.childs.every((v) => v.isConstant());
  }
  optimize() {
    optimizeChilds(this.childs);
  }
}

class DomNode extends ChildsNode {
  constructor(tagName, attrs, childs) {
    super(childs);
    this.tagName = tagName;
    this.attrs = attrs;
  }
  render(stack, rx) {
    const childNodes = new Array(this.childs.length);
    for (let i = 0;i < childNodes.length; i++) {
      childNodes[i] = this.childs[i]?.render?.(stack, rx) ?? null;
    }
    return rx.renderTag(this.tagName, this.attrs.eval(stack), childNodes);
  }
  setDataAttr(key, val) {
    this.attrs.setDataAttr(key, val);
  }
  isConstant() {
    return this.attrs.isConstant() && super.isConstant();
  }
}

class FragmentNode extends ChildsNode {
  render(stack, rx) {
    return rx.renderFragment(this.childs.map((c) => c?.render(stack, rx)));
  }
  setDataAttr(key, val) {
    for (const child of this.childs) {
      child.setDataAttr(key, val);
    }
  }
}
var maybeFragment = (xs) => xs.length === 1 ? xs[0] : new FragmentNode(xs);
var VALID_NODE_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
var _parser = null;

class ANode extends BaseNode {
  constructor(nodeId, val) {
    super();
    this.nodeId = nodeId;
    this.val = val;
  }
  toPathItem() {
    return this.val.toPathItem();
  }
  static parse(html, px) {
    _parser ??= px.newDOMParser();
    const nodes = _parser.parseFromString(html, "text/html").body.childNodes;
    return ANode.fromDOM(nodes[0] ?? new px.Text(""), px);
  }
  static fromDOM(node, px) {
    if (px.isTextNode(node)) {
      return new TextNode(node.textContent);
    } else if (px.isCommentNode(node)) {
      return new CommentNode(node.textContent);
    }
    const { childNodes, attributes: attrs, tagName: tag } = node;
    const childs = new Array(childNodes.length);
    for (let i = 0;i < childNodes.length; i++) {
      childs[i] = ANode.fromDOM(childNodes[i], px);
    }
    if (tag === "X") {
      if (attrs.length === 0) {
        return maybeFragment(childs);
      }
      const { name, value } = attrs[0];
      const as = attrs.getNamedItem("as")?.value ?? null;
      switch (name) {
        case "slot":
          return new SlotNode(null, vp.const(value), maybeFragment(childs));
        case "text": {
          const v = vp.parseText(value, px);
          return v !== null ? new RenderTextNode(null, v) : null;
        }
        case "render":
          return px.addNodeIf(RenderNode, vp.parseRender(value, px), as);
        case "render-it":
          return px.addNodeIf(RenderItNode, vp.bindValIt, as);
        case "render-each":
          return RenderEachNode.parse(px, vp, value, as, attrs);
        case "show":
          return px.addNodeIf(ShowNode, vp.parseCondValue(value, px), maybeFragment(childs));
        case "hide":
          return px.addNodeIf(HideNode, vp.parseCondValue(value, px), maybeFragment(childs));
      }
      return new CommentNode(`Error: InvalidSpecialTagOp ${name}=${value}`);
    } else if (tag.charCodeAt(1) === 58 && tag.charCodeAt(0) === 88) {
      const macroName = tag.slice(2).toLowerCase();
      if (macroName === "slot") {
        const slotName = attrs.getNamedItem("name")?.value ?? "_";
        return px.frame.macroSlots[slotName] ?? maybeFragment(childs);
      }
      const [nAttrs, wrappers] = Attributes.parse(attrs, px, true);
      px.onAttributes(nAttrs, wrappers, null);
      return wrap(px.newMacroNode(macroName, nAttrs.toMacroVars(), childs), px, wrappers);
    } else if (VALID_NODE_RE.test(tag)) {
      const [nAttrs, wrappers, textChild] = Attributes.parse(attrs, px);
      px.onAttributes(nAttrs, wrappers, textChild);
      if (textChild) {
        childs.unshift(new RenderTextNode(null, textChild));
      }
      const domChilds = tag !== "PRE" ? condenseChildsWhites(childs) : childs;
      return wrap(new DomNode(tag.toLowerCase(), nAttrs, domChilds), px, wrappers);
    }
    return new CommentNode(`Error: InvalidTagName ${tag}`);
  }
}
function wrap(node, px, wrappers) {
  if (wrappers) {
    for (let i = wrappers.length - 1;i >= 0; i--) {
      const wrapperNode = makeWrapperNode(wrappers[i], px);
      if (wrapperNode) {
        wrapperNode.wrapNode(node);
        node = wrapperNode;
      }
    }
  }
  return node;
}
function makeWrapperNode(data, px) {
  const Cls = WRAPPER_NODES[data.name];
  const node = Cls.register ? px.addNodeIf(Cls, data.val) : data.val && new Cls(null, data.val);
  if (node !== null && data.name === "each") {
    node.iterInfo.enrichWithVal = data.enrichWithVal ?? null;
    node.iterInfo.whenVal = data.whenVal ?? null;
    node.iterInfo.loopWithVal = data.loopWithVal ?? null;
  }
  return node;
}

class MacroNode extends BaseNode {
  constructor(name, attrs, slots, px) {
    super();
    this.name = name;
    this.attrs = attrs;
    this.slots = slots;
    this.px = px;
    this.node = null;
    this.dataAttrs = {};
  }
  compile(scope) {
    const { name, attrs, slots } = this;
    if (this.px.isInsideMacro(name)) {
      throw new Error(`Recursive macro expansion: ${name}`);
    }
    const macro = scope.lookupMacro(name);
    if (macro === null) {
      this.node = new CommentNode(`bad macro: ${name}`);
    } else {
      const vars = { ...macro.defaults, ...attrs };
      this.node = macro.expand(this.px.enterMacro(name, vars, slots));
      for (const key in this.dataAttrs) {
        this.node.setDataAttr(key, this.dataAttrs[key]);
      }
    }
  }
  render(stack, rx) {
    return this.node.render(stack, rx);
  }
  setDataAttr(key, val) {
    this.dataAttrs[key] = val;
  }
  isConstant() {
    return this.node.isConstant();
  }
  optimize() {
    this.node = optimizeNode(this.node);
  }
}

class Macro {
  constructor(defaults, rawView) {
    this.defaults = defaults;
    this.rawView = rawView;
  }
  expand(px) {
    return ANode.parse(this.rawView, px);
  }
}

class RenderViewId extends ANode {
  constructor(nodeId, val, viewId) {
    super(nodeId, val);
    this.viewId = viewId;
  }
}

class RenderNode extends RenderViewId {
  render(stack, rx) {
    const newStack = stack.enter(this.val.eval(stack), {}, true);
    return rx.renderIt(newStack, this.nodeId, "", this.viewId);
  }
}

class RenderItNode extends RenderViewId {
  render(stack, rx) {
    return rx.renderIt(stack, this.nodeId, "", this.viewId);
  }
  pathInNext = true;
}

class RenderEachNode extends RenderViewId {
  constructor(nodeId, val, viewId) {
    super(nodeId, val, viewId);
    this.iterInfo = new IterInfo(val, null, null, null);
  }
  render(stack, rx) {
    return rx.renderEach(stack, this.iterInfo, this.nodeId, this.viewId);
  }
  static parse(px, vp2, s, as, attrs) {
    const node = px.addNodeIf(RenderEachNode, vp2.parseEach(s, px), as);
    if (node !== null) {
      const attrParser = getAttrParser(px);
      attrParser.eachAttr = attrParser.pushWrapper("each", s, node.val);
      const when = attrs.getNamedItem("when");
      when && attrParser._parseWhen(when.value);
      const lWith = attrs.getNamedItem("loop-with");
      lWith && attrParser._parseLoopWith(lWith.value);
      node.iterInfo.whenVal = attrParser.eachAttr.whenVal ?? null;
      node.iterInfo.loopWithVal = attrParser.eachAttr.loopWithVal ?? null;
    }
    return node;
  }
}

class RenderTextNode extends ANode {
  render(stack, rx) {
    return rx.renderText(this.val.eval(stack));
  }
}

class RenderOnceNode extends BaseNode {
  constructor(node) {
    super();
    this.node = node;
    this._render = (stack, rx) => {
      const dom = node.render(stack, rx);
      this._render = (_stack, _rx) => dom;
      return dom;
    };
  }
  render(stack, rx) {
    return this._render(stack, rx);
  }
}

class WrapperNode extends ANode {
  constructor(nodeId, val, node = null) {
    super(nodeId, val);
    this.node = node;
  }
  wrapNode(node) {
    this.node = node;
  }
  setDataAttr(key, val) {
    this.node.setDataAttr(key, val);
  }
  optimize() {
    this.node = optimizeNode(this.node);
  }
  static register = false;
}

class ShowNode extends WrapperNode {
  render(stack, rx) {
    return this.val.eval(stack) ? this.node.render(stack, rx) : rx.renderEmpty();
  }
}

class HideNode extends WrapperNode {
  render(stack, rx) {
    return this.val.eval(stack) ? rx.renderEmpty() : this.node.render(stack, rx);
  }
}

class PushViewNameNode extends WrapperNode {
  render(stack, rx) {
    return this.node.render(stack.pushViewName(this.val.eval(stack)), rx);
  }
}

class SlotNode extends WrapperNode {
  optimize() {
    this.node.optimize();
  }
}

class ScopeNode extends WrapperNode {
  render(stack, rx) {
    const bindings = this.val.eval(stack)?.call(stack.it) ?? {};
    return this.node.render(stack.enter(stack.it, bindings, false), rx);
  }
  toPathItem() {
    return new BindStep({});
  }
  wrapNode(node) {
    this.node = node;
    this.node.setDataAttr("data-nid", this.nodeId);
  }
  static register = true;
}

class EachNode extends WrapperNode {
  constructor(nodeId, val) {
    super(nodeId, val);
    this.iterInfo = new IterInfo(val, null, null, null);
  }
  render(stack, rx) {
    return rx.renderEachWhen(stack, this.iterInfo, this.node, this.nodeId);
  }
  toPathItem() {
    return new BindStep({});
  }
  static register = true;
}

class IterInfo {
  constructor(val, whenVal, loopWithVal, enrichWithVal) {
    this.val = val;
    this.whenVal = whenVal;
    this.loopWithVal = loopWithVal;
    this.enrichWithVal = enrichWithVal;
  }
  eval(stack) {
    const seq = this.val.eval(stack) ?? [];
    const filter = this.whenVal?.eval(stack) ?? filterAlwaysTrue;
    const loopWith = this.loopWithVal?.eval(stack) ?? nullLoopWith;
    const enricher = this.enrichWithVal?.eval(stack) ?? null;
    return { seq, filter, loopWith, enricher };
  }
}
var filterAlwaysTrue = (_v, _k, _seq) => true;
var nullLoopWith = (seq) => ({ seq });
var WRAPPER_NODES = {
  slot: SlotNode,
  show: ShowNode,
  hide: HideNode,
  each: EachNode,
  scope: ScopeNode,
  "push-view": PushViewNameNode
};

class ParseContext {
  constructor(DOMParser, Text, Comment, nodes, events, macroNodes, frame, parent) {
    this.nodes = nodes ?? [];
    this.events = events ?? [];
    this.macroNodes = macroNodes ?? [];
    this.parent = parent ?? null;
    this.frame = frame ?? {};
    this.DOMParser = DOMParser ?? globalThis.DOMParser;
    this.Text = Text ?? globalThis.Text;
    this.Comment = Comment ?? globalThis.Comment;
    this.cacheConstNodes = true;
  }
  isInsideMacro(name) {
    return this.frame.macroName === name || this.parent?.isInsideMacro(name);
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { DOMParser: DP, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    return new ParseContext(DP, Text, Comment, nodes, events, macroNodes, frame, this);
  }
  newDOMParser() {
    return new this.DOMParser;
  }
  isTextNode(v) {
    return v instanceof this.Text;
  }
  isCommentNode(v) {
    return v instanceof this.Comment;
  }
  addNodeIf(Class, val, extra) {
    if (val !== null) {
      const nodeId = this.nodes.length;
      const node = new Class(nodeId, val, extra);
      this.nodes.push(node);
      return node;
    }
    return null;
  }
  registerEvents() {
    const id = this.events.length;
    const events = new NodeEvents(id);
    this.events.push(events);
    return events;
  }
  newMacroNode(macroName, mAttrs, childs) {
    const anySlot = [];
    const slots = { _: new FragmentNode(anySlot) };
    for (const child of childs) {
      if (child instanceof SlotNode) {
        slots[child.val.value] = child.node;
      } else if (!(child instanceof TextNode) || !child.isWhiteSpace()) {
        anySlot.push(child);
      }
    }
    const node = new MacroNode(macroName, mAttrs, slots, this);
    this.macroNodes.push(node);
    return node;
  }
  compile(scope) {
    for (let i = 0;i < this.macroNodes.length; i++) {
      this.macroNodes[i].compile(scope);
    }
  }
  *genEventNames() {
    for (const event of this.events)
      yield* event.genEventNames();
  }
  getEventForId(id) {
    return this.events[id] ?? null;
  }
  getNodeForId(id) {
    return this.nodes[id] ?? null;
  }
  onAttributes(_attrs, _wrapperAttrs, _textChild) {}
}
var isTextNodeAllBlanks = (n) => n instanceof TextNode && n.isWhiteSpace();
var isFirstDomNode = (n) => n instanceof DomNode || n instanceof FragmentNode && n.childs[0] instanceof DomNode;
function condenseChildsWhites(childs) {
  let end = childs.length;
  if (end === 0) {
    return childs;
  }
  let start = 0;
  let changed = false;
  if (isTextNodeAllBlanks(childs[0])) {
    start = 1;
    changed = true;
  }
  if (end > 1 && isTextNodeAllBlanks(childs[end - 1])) {
    end -= 1;
    changed = true;
  }
  for (let i = 1;i < end - 1; i++) {
    const cur = childs[i];
    if (isTextNodeAllBlanks(cur) && isFirstDomNode(childs[i - 1]) && isFirstDomNode(childs[i + 1]) && cur.hasNewLine()) {
      cur.condenseWhiteSpace();
    }
  }
  return changed ? childs.slice(start, end) : childs;
}

class View {
  constructor(name, rawView, style = "", anode = null, ctx = null) {
    this.name = name;
    this.anode = anode;
    this.style = style;
    this.ctx = ctx;
    this.rawView = rawView;
  }
  compile(ctx, scope, cid) {
    this.ctx = ctx;
    this.anode = ANode.parse(this.rawView, ctx);
    this.anode.setDataAttr("data-cid", cid);
    this.anode.setDataAttr("data-vid", this.name);
    this.ctx.compile(scope);
    if (ctx.cacheConstNodes) {
      this.anode = optimizeNode(this.anode);
    }
  }
  render(stack, rx) {
    return this.anode.render(stack, rx);
  }
}

class NodeEvents {
  constructor(id) {
    this.id = id;
    this.handlers = [];
  }
  add(name, handlerCall, modifiers) {
    this.handlers.push(new NodeEvent(name, handlerCall, modifiers));
  }
  *genEventNames() {
    for (const handler of this.handlers)
      yield handler.name;
  }
  getHandlersFor(eventName) {
    let r = null;
    for (const handler of this.handlers) {
      if (handler.handlesEventName(eventName)) {
        r ??= [];
        r.push(handler);
      }
    }
    return r;
  }
}

class NodeEvent {
  constructor(name, handlerCall, modifiers) {
    this.name = name;
    this.handlerCall = handlerCall;
    this.modifierWrapper = compileModifiers(name, modifiers);
    this.modifiers = modifiers;
  }
  handlesEventName(name) {
    return this.name === name;
  }
  getHandlerAndArgs(stack, event) {
    const r = this.handlerCall.getHandlerAndArgs(stack, event);
    r[0] = this.modifierWrapper(r[0], event);
    return r;
  }
}
var isMac = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
var fwdIfCtxPred = (pred) => (w) => (that, f, args, ctx) => pred(ctx) ? w(that, f, args, ctx) : that;
var fwdIfKey = (keyName) => fwdIfCtxPred((ctx) => ctx.e.key === keyName);
var fwdCtrl = fwdIfCtxPred(({ e }) => isMac && e.metaKey || e.ctrlKey);
var fwdMeta = fwdIfCtxPred(({ e }) => e.metaKey);
var fwdAlt = fwdIfCtxPred(({ e }) => e.altKey);
var metaWraps = { ctrl: fwdCtrl, cmd: fwdCtrl, meta: fwdMeta, alt: fwdAlt };
var MOD_WRAPPERS_BY_EVENT = {
  keydown: {
    send: fwdIfKey("Enter"),
    cancel: fwdIfKey("Escape"),
    ...metaWraps
  },
  click: { ...metaWraps }
};
var identityModifierWrapper = (f, _ctx) => f;
function compileModifiers(eventName, names) {
  if (names.length === 0) {
    return identityModifierWrapper;
  }
  const wrappers = MOD_WRAPPERS_BY_EVENT[eventName] ?? {};
  let w = (that, f, args, _ctx) => f.apply(that, args);
  for (const name of names) {
    const wrapper = wrappers[name];
    if (wrapper !== undefined) {
      w = wrapper(w);
    }
  }
  return (f, ctx) => function(...args) {
    return w(this, f, args, ctx);
  };
}

// src/cache.js
class NullDomCache {
  get(_k, _cacheKey) {}
  set(_k, _cacheKey, _v) {}
  get2(_k1, _k2, _cacheKey) {}
  set2(_k1, _k2, _cacheKey, _v) {}
  evict() {
    return { hit: 0, miss: 0, badKey: 0 };
  }
}

class WeakMapDomCache {
  constructor() {
    this.hit = this.miss = this.badKey = 0;
    this.map = new WeakMap;
  }
  _returnValue(r) {
    if (r === undefined) {
      this.miss += 1;
    } else {
      this.hit += 1;
    }
    return r;
  }
  get(k, cacheKey) {
    return this._returnValue(this.map.get(k)?.[cacheKey]);
  }
  set(k, cacheKey, v) {
    const cur = this.map.get(k);
    if (cur) {
      cur[cacheKey] = v;
    } else if (typeof k === "object") {
      this.map.set(k, { [cacheKey]: v });
    } else {
      this.badKey += 1;
    }
  }
  get2(k1, k2, cacheKey) {
    return this._returnValue(this.map.get(k1)?.get?.(k2)?.[cacheKey]);
  }
  set2(k1, k2, cacheKey, v) {
    const cur1 = this.map.get(k1);
    if (cur1) {
      const cur = cur1.get(k2);
      if (cur) {
        cur[cacheKey] = v;
      } else {
        cur1.set(k2, { [cacheKey]: v });
      }
    } else if (typeof k1 === "object" && typeof k2 === "object") {
      const cur = new WeakMap;
      cur.set(k2, { [cacheKey]: v });
      this.map.set(k1, cur);
    } else {
      this.badKey += 1;
    }
  }
  evict() {
    const { hit, miss, badKey } = this;
    this.hit = this.miss = this.badKey = 0;
    this.map = new WeakMap;
    return { hit, miss, badKey };
  }
}

class NullComputedCache {
  getKey(v, _key, fn) {
    return fn.call(v);
  }
}

class WeakMapComputedCache {
  constructor() {
    this.map = new WeakMap;
  }
  getKey(v, key, fn) {
    const cur = this.map.get(v);
    if (cur) {
      const curValue = cur[key];
      if (curValue !== undefined) {
        return curValue;
      }
      const newValue2 = fn.call(v) ?? null;
      cur[key] = newValue2;
      return newValue2;
    }
    const newValue = fn.call(v) ?? null;
    this.map.set(v, { [key]: newValue });
    return newValue;
  }
}

// src/components.js
class Components {
  constructor() {
    this.getComponentSymbol = Symbol("getComponent");
    this.byId = new Map;
    this.computedCache = new WeakMapComputedCache;
  }
  setNullComputedCache() {
    this.computedCache = new NullComputedCache;
  }
  registerComponent(comp) {
    comp.Class.prototype[this.getComponentSymbol] = () => comp;
    this.byId.set(comp.id, comp);
  }
  getComponentForId(id) {
    return this.byId.get(id) ?? null;
  }
  getCompFor(v) {
    return v?.[this.getComponentSymbol]?.() ?? null;
  }
  getOnEnterFor(v) {
    const comp = this.getCompFor(v);
    return comp ? comp.on.stackEnter : defaultOnStackEnter;
  }
  getInputHandlerFor(v, name) {
    return this.getCompFor(v)?.input[name] ?? null;
  }
  getAlterHandlerFor(v, name) {
    return this.getCompFor(v)?.alter[name] ?? null;
  }
  getRequestFor(v, name) {
    const comp = this.getCompFor(v);
    return comp ? comp.scope.lookupRequest(name) : null;
  }
  lookupComputed(v, name) {
    const fn = this.getCompFor(v)?.computed[name];
    return fn ? this.computedCache.getKey(v, name, fn) : null;
  }
  compileStyles() {
    const styles = [];
    for (const comp of this.byId.values()) {
      styles.push(comp.compileStyle());
    }
    return styles.join(`
`);
  }
}

class ComponentStack {
  constructor(comps = new Components, parent = null) {
    this.comps = comps;
    this.parent = parent;
    this.byName = {};
    this.reqsByName = {};
    this.macros = {};
  }
  enter() {
    return new ComponentStack(this.comps, this);
  }
  registerComponents(comps, aliases = {}) {
    for (let i = 0;i < comps.length; i++) {
      const comp = comps[i];
      comp.scope = this.enter();
      this.comps.registerComponent(comp);
      this.byName[comp.name] = comp;
      const alias = aliases[comp.name];
      if (alias) {
        this.byName[alias] = comp;
      }
    }
  }
  registerMacros(macros) {
    Object.assign(this.macros, macros);
  }
  getCompFor(v) {
    return this.comps.getCompFor(v);
  }
  registerRequestHandlers(handlers) {
    for (const name in handlers) {
      this.reqsByName[name] = new RequestHandler(name, handlers[name]);
    }
  }
  lookupRequest(name) {
    return this.reqsByName[name] ?? this.parent?.lookupRequest(name) ?? null;
  }
  lookupComponent(name) {
    return this.byName[name] ?? this.parent?.lookupComponent(name) ?? null;
  }
  lookupMacro(name) {
    return this.macros[name] ?? this.parent?.lookupMacro(name) ?? null;
  }
}

class Dynamic {
  constructor(name, val, symbol) {
    this.name = name;
    this.val = val;
    this.symbol = symbol;
  }
  getSymbol(_stack) {
    return this.symbol;
  }
  evalAndBind(stack, binds) {
    binds[this.getSymbol(stack)] = this.val.eval(stack);
  }
}

class DynamicAlias extends Dynamic {
  constructor(name, val, compName, dynName) {
    super(name, val, null);
    this.compName = compName;
    this.dynName = dynName;
  }
  _resolveSymbol(stack) {
    const t = stack.lookupType(this.compName);
    return t?.dynamic[this.dynName]?.symbol ?? null;
  }
  getSymbol(stack) {
    this.symbol ??= this._resolveSymbol(stack);
    return this.symbol;
  }
}
var isString = (v) => typeof v === "string";
var _compId = 0;

class Component {
  constructor(name, Class, view, views = {}, style = "", commonStyle = "", globalStyle = "", computed = {}, input = {}, logic = {}, bubble = {}, response = {}, alter = {}, dynamic = {}, on = {}) {
    this.id = _compId++;
    this.name = name;
    this.Class = Class;
    this.views = { main: new View("main", view, style) };
    this.commonStyle = commonStyle;
    this.globalStyle = globalStyle;
    this.computed = computed;
    this.input = input;
    this.logic = logic;
    this.bubble = bubble;
    this.response = response;
    this.alter = alter;
    this.on = { stackEnter: on?.stackEnter ?? defaultOnStackEnter };
    for (const name2 in views) {
      const v = views[name2];
      const { view: view2, style: style2 } = isString(v) ? { view: v } : v;
      this.views[name2] = new View(name2, view2, style2);
    }
    this._rawDynamic = dynamic;
    this.dynamic = {};
    this.scope = null;
  }
  compile(ParseContext2) {
    for (const key in this._rawDynamic) {
      const dinfo = this._rawDynamic[key];
      if (isString(dinfo)) {
        const val = vp.parseDynamic(dinfo, this.views.main.ctx);
        this.dynamic[key] = new Dynamic(key, val, Symbol(key));
      } else if (isString(dinfo?.default) && isString(dinfo?.for)) {
        const val = vp.parseDynamic(dinfo.default, this.views.main.ctx);
        const [compName, dynName] = dinfo.for.split(".");
        if (isString(compName) && isString(dynName)) {
          this.dynamic[key] = new DynamicAlias(key, val, compName, dynName);
        }
      }
    }
    for (const name in this.views) {
      this.views[name].compile(new ParseContext2, this.scope, this.id);
    }
  }
  make(args, opts) {
    return this.Class.make(args, opts);
  }
  getView(name) {
    return this.views[name] ?? this.views.main;
  }
  getEventForId(id, name = "main") {
    return this.getView(name).ctx.getEventForId(id);
  }
  getNodeForId(id, name = "main") {
    return this.getView(name).ctx.getNodeForId(id);
  }
  compileStyle() {
    const { id, commonStyle, globalStyle, views } = this;
    const styles = commonStyle ? [`[data-cid="${id}"]{${commonStyle}}`] : [];
    if (globalStyle !== "") {
      styles.push(globalStyle);
    }
    for (const name in views) {
      const { style } = views[name];
      if (style !== "") {
        styles.push(`[data-cid="${id}"][data-vid="${name}"]{${style}}`);
      }
    }
    return styles.join(`
`);
  }
}
function defaultOnStackEnter(stack) {
  return stack;
}

// src/stack.js
var STOP = Symbol("STOP");
var NEXT = Symbol("NEXT");

class Pair {
  constructor(head, tail) {
    this.head = head;
    this.tail = tail;
  }
  push(v) {
    return new Pair(v, this);
  }
  lookup(v, dv = null) {
    const { tail } = this;
    const r = this.head.lookup(v);
    return r === STOP ? dv : r === NEXT ? tail !== null ? tail.lookup(v, dv) : dv : r;
  }
  *[Symbol.iterator]() {
    let v = this;
    while (v !== null) {
      yield v.head;
      v = v.tail;
    }
  }
}

class BindFrame {
  constructor(it, bindings, isFrame) {
    this.it = it;
    this.bindings = bindings;
    this.isFrame = isFrame;
  }
  lookup(name) {
    const v = this.bindings[name];
    return v === undefined ? this.isFrame ? STOP : NEXT : v;
  }
}

class ObjectFrame {
  constructor(bindings) {
    this.bindings = bindings;
  }
  lookup(key) {
    const v = this.bindings[key];
    return v === undefined ? NEXT : v;
  }
}

class Stack {
  constructor(comps, it, binds, dynBinds, views, ctx = null) {
    this.comps = comps;
    this.it = it;
    this.binds = binds;
    this.dynBinds = dynBinds;
    this.views = views;
    this.ctx = ctx;
    const viewsId = [...views].join("");
    this.viewsId = viewsId === "main" ? "" : viewsId;
  }
  _enrichOnEnter() {
    return this.comps.getOnEnterFor(this.it).call(this.it, this) ?? this;
  }
  upToFrameBinds() {
    const { comps, binds, dynBinds, views, ctx } = this;
    return binds.head.isFrame ? this : new Stack(comps, binds.tail.head.it, binds.tail, dynBinds, views, ctx);
  }
  static root(comps, it, ctx) {
    const binds = new Pair(new BindFrame(it, { it }, true), null);
    const dynBinds = new Pair(new ObjectFrame({}), null);
    const views = new Pair("main", null);
    return new Stack(comps, it, binds, dynBinds, views, ctx)._enrichOnEnter();
  }
  enter(it, bindings = {}, isFrame = true) {
    const { comps, binds, dynBinds, views, ctx } = this;
    const newBinds = binds.push(new BindFrame(it, bindings, isFrame));
    return new Stack(comps, it, newBinds, dynBinds, views, ctx)._enrichOnEnter();
  }
  pushViewName(name) {
    const { comps, it, binds, dynBinds, views, ctx } = this;
    return new Stack(comps, it, binds, dynBinds, views.push(name), ctx);
  }
  withDynamicBindings(dynamics) {
    const dynObj = {};
    const comp = this.comps.getCompFor(this.it);
    for (const dynName of dynamics) {
      comp.dynamic[dynName].evalAndBind(this, dynObj);
    }
    const { comps, it, binds, views, ctx } = this;
    const newDynBinds = this.dynBinds.push(new ObjectFrame(dynObj));
    return new Stack(comps, it, binds, newDynBinds, views, ctx);
  }
  lookupDynamic(name) {
    const d = this.comps.getCompFor(this.it)?.dynamic[name];
    return d ? this.dynBinds.lookup(d.getSymbol(this)) ?? d.val.eval(this) : null;
  }
  lookupBind(name) {
    return this.binds.lookup(name);
  }
  lookupType(name) {
    return this.comps.getCompFor(this.it).scope.lookupComponent(name);
  }
  lookupFieldRaw(name) {
    return this.it[name] ?? null;
  }
  lookupField(name) {
    const v = this.lookupFieldRaw(name);
    return v instanceof Function ? v.call(this.it) : v;
  }
  lookupName(name) {
    return this.ctx.lookupName(name);
  }
  lookupComputed(name) {
    const node = this.binds.head.isFrame ? this.binds.head : this.binds.tail.head;
    return this.comps.lookupComputed(node.it, name);
  }
  getInputHandler(name) {
    return this.comps.getInputHandlerFor(this.it, name);
  }
  getAlterHandler(name) {
    return this.comps.getAlterHandlerFor(this.it, name);
  }
  lookupRequest(name) {
    return this.comps.getRequestFor(this.it, name);
  }
  lookupBestView(views, defaultViewName) {
    for (const viewName of this.views) {
      const view = views[viewName];
      if (view !== undefined) {
        return view;
      }
    }
    return views[defaultViewName];
  }
}

// src/transactor.js
class State {
  constructor(value) {
    this.value = value;
    this.changeSubs = [];
  }
  onChange(cb) {
    this.changeSubs.push(cb);
  }
  set(value, info) {
    const old = this.value;
    this.value = value;
    for (const sub of this.changeSubs) {
      sub({ value, old, info, timestamp: Date.now() });
    }
  }
  update(fn, info) {
    return this.set(fn(this.value), info);
  }
}

class Transactor {
  constructor(comps, rootValue) {
    this.comps = comps;
    this.transactions = [];
    this.state = new State(rootValue);
    this.onTransactionPushed = () => {};
  }
  pushTransaction(t) {
    this.transactions.push(t);
    this.onTransactionPushed(t);
    return t;
  }
  pushLogic(path, name, args = [], opts = {}, parent = null) {
    return this.pushTransaction(new LogicEvent(path, this, name, args, parent, opts));
  }
  pushBubble(path, name, args = [], opts = {}, parent = null) {
    const newOpts = opts.skipSelf ? { ...opts, skipSelf: false } : opts;
    return this.pushTransaction(new BubbleEvent(path, this, name, args, parent, newOpts));
  }
  async pushRequest(path, name, args = [], opts = {}, parent = null) {
    const curRoot = this.state.value;
    const curLeaf = path.lookup(curRoot);
    const handler = this.comps.getRequestFor(curLeaf, name) ?? mkReq404(name);
    const resHandlerName = opts?.onResName ?? name;
    const push = (specificName, baseName, singleArg, result, error) => {
      const resArgs = specificName ? [singleArg] : [result, error];
      const t = new ResponseEvent(path, this, specificName ?? baseName, resArgs, parent);
      return this.pushTransaction(t);
    };
    try {
      const result = await handler.fn.apply(null, args);
      return push(opts?.onOkName, resHandlerName, result, result, null);
    } catch (error) {
      return push(opts?.onErrorName, resHandlerName, error, null, error);
    }
  }
  get hasPendingTransactions() {
    return this.transactions.length > 0;
  }
  transactNext() {
    if (this.hasPendingTransactions) {
      this.transact(this.transactions.shift());
    }
  }
  transactAll() {
    while (this.hasPendingTransactions) {
      this.transact(this.transactions.shift());
    }
  }
  transact(transaction) {
    const curState = this.state.value;
    const newState = transaction.run(curState, this.comps);
    if (newState !== undefined) {
      this.state.set(newState, { transaction });
      transaction.afterTransaction();
    } else {
      console.warn("undefined new state", { curState, transaction });
    }
  }
  transactInputNow(path, event, eventHandler, dragInfo) {
    this.transact(new InputEvent(path, event, eventHandler, this, dragInfo));
  }
}
function mkReq404(name) {
  return () => {
    throw new Error(`Request not found: ${name}`);
  };
}
function nullHandler() {
  return this;
}

class Transaction {
  constructor(path, transactor) {
    this.path = path;
    this.transactor = transactor;
    this.parentTransaction = null;
    this._task = null;
  }
  get task() {
    this._task ??= new Task;
    return this._task;
  }
  getCompletionPromise() {
    return this.task.promise;
  }
  setParent(parentTransaction) {
    this.parentTransaction = parentTransaction;
    parentTransaction.task.addDep(this.task);
  }
  run(rootValue, comps) {
    return this.updateRootValue(rootValue, comps);
  }
  afterTransaction() {}
  buildRootStack(root, comps) {
    return Stack.root(comps, root);
  }
  buildStack(root, comps) {
    const stack = this.path.buildStack(this.buildRootStack(root, comps));
    return stack ? stack.upToFrameBinds() : null;
  }
  callHandler(root, instance, comps) {
    const [handler, args] = this.getHandlerAndArgs(root, instance, comps);
    return handler.apply(instance, args);
  }
  getHandlerAndArgs(_root, _instance, _comps) {
    return null;
  }
  updateRootValue(curRoot, comps) {
    const curLeaf = this.path.lookup(curRoot);
    const newLeaf = this.callHandler(curRoot, curLeaf, comps);
    this._task?.complete?.({ value: newLeaf, old: curLeaf });
    return curLeaf !== newLeaf ? this.path.setValue(curRoot, newLeaf) : curRoot;
  }
  lookupName(_name) {
    return null;
  }
}
var isMac2 = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
var toNullIfNaN = (v) => Number.isNaN(v) ? null : v;
function getValue(e) {
  return e.target.type === "checkbox" ? e.target.checked : (e instanceof CustomEvent ? e.detail : e.target.value) ?? null;
}

class InputEvent extends Transaction {
  constructor(path, e, handler, transactor, dragInfo) {
    super(path, transactor);
    this.e = e;
    this.handler = handler;
    this.dragInfo = dragInfo;
  }
  buildRootStack(root, comps) {
    return Stack.root(comps, root, this);
  }
  getHandlerAndArgs(root, _instance, comps) {
    const stack = this.buildStack(root, comps);
    const [handler, args] = this.handler.getHandlerAndArgs(stack, this);
    let dispatcher;
    for (let i = 0;i < args.length; i++) {
      if (args[i]?.toHandlerArg) {
        dispatcher ??= new Dispatcher(this.path, this.transactor, this);
        args[i] = args[i].toHandlerArg(dispatcher);
      }
    }
    return [handler, args];
  }
  lookupName(name) {
    const { e } = this;
    switch (name) {
      case "value":
        return getValue(e);
      case "valueAsInt":
        return toNullIfNaN(parseInt(getValue(e), 10));
      case "valueAsFloat":
        return toNullIfNaN(parseFloat(getValue(e)));
      case "target":
        return e.target;
      case "event":
        return e;
      case "isAlt":
        return e.altKey;
      case "isShift":
        return e.shiftKey;
      case "isCtrl":
      case "isCmd":
        return isMac2 && e.metaKey || e.ctrlKey;
      case "key":
        return e.key;
      case "keyCode":
        return e.keyCode;
      case "isUpKey":
        return e.key === "ArrowUp";
      case "isDownKey":
        return e.key === "ArrowDown";
      case "isSend":
        return e.key === "Enter";
      case "isCancel":
        return e.key === "Escape";
      case "isTabKey":
        return e.key === "Tab";
      case "ctx":
        return new EventContext(this.path, this.transactor, this);
      case "dragInfo":
        return this.dragInfo;
    }
    return null;
  }
}

class NameArgsTransaction extends Transaction {
  constructor(path, transactor, name, args, parentTransaction, opts = {}) {
    super(path, transactor, parentTransaction);
    this.name = name;
    this.args = args;
    this.opts = opts;
  }
  handlerProp = null;
  getHandlerForName(comp) {
    return comp?.[this.handlerProp]?.[this.name] ?? nullHandler;
  }
  getHandlerAndArgs(_root, instance, comps) {
    const handler = this.getHandlerForName(comps.getCompFor(instance));
    return [handler, [...this.args, new EventContext(this.path, this.transactor, this)]];
  }
}

class ResponseEvent extends NameArgsTransaction {
  handlerProp = "response";
}

class LogicEvent extends NameArgsTransaction {
  handlerProp = "logic";
  run(rootVal, comps) {
    return this.opts.skipSelf ? rootVal : this.updateRootValue(rootVal, comps);
  }
  afterTransaction() {
    const { path, name, args, opts } = this;
    if (opts.bubbles && path.steps.length > 0) {
      this.transactor.pushBubble(path.popStep(), name, args, opts, this);
    }
  }
}

class BubbleEvent extends LogicEvent {
  handlerProp = "bubble";
  stopPropagation() {
    this.opts.bubbles = false;
  }
}

class Task {
  constructor(info) {
    this.info = info;
    this.deps = [];
    this.value = this.resolve = this.reject = null;
    this.promise = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.isCompleted = false;
  }
  addDep(task) {
    console.assert(!this.isCompleted, "addDep for completed task", this, task);
    this.deps.push(task);
    task.promise.then((_) => this._check());
  }
  complete(value) {
    this.value = value;
    this._check();
  }
  _check() {
    if (this.deps.every((task) => task.isCompleted)) {
      this.isCompleted = true;
      this.resolve(this);
    }
  }
}

class Dispatcher {
  constructor(path, transactor, parentTransaction = null) {
    this.path = path;
    this.transactor = transactor;
    this.parent = parentTransaction;
  }
  get at() {
    return new PathChanges(this);
  }
  logic(name, args, opts) {
    return this.logicAtPath(this.path, name, args, opts);
  }
  bubble(name, args, opts) {
    return this.logic(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  logicAtPath(path, name, args, opts) {
    return this.transactor.pushLogic(path, name, args, opts, this.parent);
  }
  request(name, args, opts) {
    return this.requestAtPath(this.path, name, args, opts);
  }
  requestAtPath(path, name, args, opts) {
    return this.transactor.pushRequest(path, name, args, opts, this.parent);
  }
  lookupTypeFor(name, inst) {
    return this.transactor.comps.getCompFor(inst).scope.lookupComponent(name);
  }
}

class EventContext extends Dispatcher {
  stopPropagation() {
    return this.parent.stopPropagation();
  }
}

class PathChanges extends PathBuilder {
  constructor(dispatcher) {
    super();
    this.dispatcher = dispatcher;
  }
  logic(name, args, opts) {
    return this.dispatcher.logicAtPath(this.buildPath(), name, args, opts);
  }
  bubble(name, args, opts) {
    return this.logic(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  buildPath() {
    return this.dispatcher.path.concat(this.pathChanges);
  }
}

// src/app.js
class App {
  constructor(rootNode, renderFn, comps, renderer, ParseContext2) {
    this.rootNode = rootNode;
    this.comps = comps;
    this.compStack = new ComponentStack(comps);
    this.transactor = new Transactor(comps, null);
    this.ParseContext = ParseContext2;
    this.renderer = renderer;
    this.renderFn = renderFn;
    this.maxEventNodeDepth = Infinity;
    this._transactNextBatchId = this._evictCacheId = null;
    this._eventNames = new Set(["dragstart", "dragover", "dragend"]);
    this.dragInfo = this.curDragOver = null;
    this.transactor.onTransactionPushed = (_transaction) => {
      if (this._transactNextBatchId === null) {
        this._scheduleNextTransactionBatchExecution();
      }
    };
    this._compiled = false;
  }
  get state() {
    return this.transactor.state;
  }
  handleEvent(e) {
    const isDragStart = e.type === "dragstart";
    const isDragOver = e.type === "dragover";
    const isDragEnd = e.type === "dragend";
    const { rootNode: root, maxEventNodeDepth: maxDepth, comps } = this;
    const stopOnNoEvent = !(isDragOver || isDragStart || isDragEnd);
    const [path, handlers] = Path.fromEvent(e, root, maxDepth, comps, stopOnNoEvent);
    if (isDragOver) {
      const dropTarget = getClosestDropTarget(e.target, this.rootNode, 50);
      if (dropTarget !== null) {
        e.preventDefault();
        this._cleanDragOverAttrs();
        this.curDragOver = dropTarget;
        dropTarget.dataset.draggingover = this.dragInfo.type;
      }
    } else if (isDragStart) {
      e.target.dataset.dragging = 1;
      const rootValue = this.state.value;
      const value = path.lookup(rootValue);
      const type = e.target.dataset.dragtype ?? "?";
      const stack = path.buildStack(this.makeStack(rootValue));
      this.dragInfo = new DragInfo(path, stack, e, value, type, e.target);
    } else if (isDragEnd) {
      delete this.dragInfo.node.dataset.dragging;
      this.dragInfo = null;
      this._cleanDragOverAttrs();
    }
    if (path !== null && handlers !== null) {
      for (const handler of handlers) {
        this.transactor.transactInputNow(path, e, handler, this.dragInfo);
      }
    }
  }
  makeStack(rootValue) {
    return Stack.root(this.comps, rootValue);
  }
  _cleanDragOverAttrs() {
    if (this.curDragOver !== null) {
      delete this.curDragOver.dataset.draggingover;
      this.curDragOver = null;
    }
  }
  render() {
    const root = this.state.value;
    const stack = this.makeStack(root);
    return this.renderFn(this.renderer.renderRoot(stack, root), this.rootNode);
  }
  onChange(callback) {
    this.transactor.state.onChange(callback);
  }
  compile() {
    for (const Comp of this.comps.byId.values()) {
      Comp.compile(this.ParseContext);
      for (const key in Comp.views) {
        for (const name of Comp.views[key].ctx.genEventNames()) {
          this._eventNames.add(name);
        }
      }
    }
    this._compiled = true;
  }
  start(opts) {
    if (!this._compiled) {
      this.compile();
    }
    for (const name of this._eventNames) {
      this.rootNode.addEventListener(name, this);
    }
    this.onChange((info) => {
      if (info.value !== info.old) {
        this.render();
      }
    });
    injectCss("tutuca-app", this.comps.compileStyles(), opts?.head ?? document.head);
    if (opts?.noCache) {
      this.renderer.setNullCache();
      this.comps.setNullComputedCache();
    } else {
      this.startCacheEvictionInterval();
    }
    this.render();
  }
  stop() {
    this.stopCacheEvictionInterval();
    for (const name of this._eventNames) {
      this.rootNode.removeEventListener(name, this);
    }
  }
  dispatchLogicAtRoot(name, args, opts) {
    return this.transactor.pushLogic(new Path([]), name, args, opts);
  }
  registerComponents(comps, aliases) {
    const scope = this.compStack.enter();
    scope.registerComponents(comps, aliases);
    return scope;
  }
  _transactNextBatch(maxRunTimeMs = 10) {
    this._transactNextBatchId = null;
    const startTs = Date.now();
    const t = this.transactor;
    while (t.hasPendingTransactions && Date.now() - startTs < maxRunTimeMs) {
      t.transactNext();
    }
    if (t.hasPendingTransactions) {
      this._scheduleNextTransactionBatchExecution();
    }
  }
  _scheduleNextTransactionBatchExecution() {
    this._transactNextBatchId = setTimeout(() => this._transactNextBatch(), 0);
  }
  startCacheEvictionInterval(intervalMs = 30000) {
    this._evictCacheId = setInterval(() => this.renderer.cache.evict(), intervalMs);
  }
  stopCacheEvictionInterval() {
    clearInterval(this._evictCacheId);
    this._evictCacheId = null;
  }
}
function injectCss(nodeId, style, styleTarget = document.head) {
  const styleNode = document.createElement("style");
  const currentNodeWithId = styleTarget.querySelector(`#${nodeId}`);
  if (currentNodeWithId) {
    styleTarget.removeChild(currentNodeWithId);
  }
  styleNode.id = nodeId;
  styleNode.innerHTML = style;
  styleTarget.appendChild(styleNode);
}
function getClosestDropTarget(target, rootNode, count) {
  let node = target;
  while (count-- > 0 && node !== rootNode) {
    if (node.dataset?.droptarget !== undefined) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

class DragInfo {
  constructor(path, stack, e, value, type, node) {
    this.path = path;
    this.stack = stack;
    this.e = e;
    this.value = value;
    this.type = type;
    this.node = node;
  }
  lookupBind(name) {
    return this.stack.lookupBind(name);
  }
}

// deps/immutable.js
function invariant(condition, error) {
  if (!condition)
    throw new Error(error);
}
function assertNotInfinite(size) {
  invariant(size !== Infinity, "Cannot perform this action with an infinite size.");
}
function reduce(collection, reducer, reduction, context, useFirst, reverse) {
  assertNotInfinite(collection.size);
  collection.__iterate((v, k, c) => {
    if (useFirst) {
      useFirst = false;
      reduction = v;
    } else {
      reduction = reducer.call(context, reduction, v, k, c);
    }
  }, reverse);
  return reduction;
}
var keyMapper = (v, k) => k;
var entryMapper = (v, k) => [k, v];
var not = (predicate) => function(...args) {
  return !predicate.apply(this, args);
};
var neg = (predicate) => function(...args) {
  return -predicate.apply(this, args);
};
function defaultComparator(a, b) {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}
var defaultNegComparator = (a, b) => a < b ? 1 : a > b ? -1 : 0;
var DONE = {
  done: true,
  value: undefined
};

class Iter {
  constructor(next) {
    this.next = next;
  }
  [Symbol.iterator]() {
    return this;
  }
}
function makeIterator(next) {
  return new Iter(next);
}
function makeEntryIterator(next) {
  const entry = [undefined, undefined];
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    if (next(entry)) {
      result.value = [entry[0], entry[1]];
      return result;
    }
    return DONE;
  });
}
var EMPTY_ITERATOR = makeIterator(() => DONE);
var emptyIterator = () => EMPTY_ITERATOR;
function makeIndexKeys(size) {
  let i = 0;
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    if (i === size)
      return DONE;
    result.value = i++;
    return result;
  });
}
function mapEntries(source, transform) {
  return makeEntryIterator((entry) => {
    const step = source.next();
    if (step.done)
      return false;
    transform(step.value[0], step.value[1], entry);
    return true;
  });
}
function hasIterator(maybeIterable) {
  if (Array.isArray(maybeIterable)) {
    return true;
  }
  return !!getIteratorFn(maybeIterable);
}
var isIterator = (maybeIterator) => typeof maybeIterator?.next === "function";
function getIterator(iterable) {
  const iteratorFn = getIteratorFn(iterable);
  return iteratorFn?.call(iterable);
}
function getIteratorFn(iterable) {
  const iteratorFn = iterable?.[Symbol.iterator];
  if (typeof iteratorFn === "function") {
    return iteratorFn;
  }
}
function isEntriesIterable(maybeIterable) {
  const iteratorFn = getIteratorFn(maybeIterable);
  return iteratorFn && iteratorFn === maybeIterable.entries;
}
function isKeysIterable(maybeIterable) {
  const iteratorFn = getIteratorFn(maybeIterable);
  return iteratorFn && iteratorFn === maybeIterable.keys;
}
var DELETE = "delete";
var SHIFT = 5;
var SIZE = 1 << SHIFT;
var MASK = SIZE - 1;
var NOT_SET = {};
var MakeRef = () => ({
  value: false
});
function SetRef(ref) {
  if (ref) {
    ref.value = true;
  }
}

class OwnerID {
}
function ensureSize(iter) {
  if (iter.size === undefined) {
    iter.size = iter.__iterate(returnTrue);
  }
  return iter.size;
}
function wrapIndex(iter, index) {
  if (typeof index !== "number") {
    const uint32Index = index >>> 0;
    if (String(uint32Index) !== index || uint32Index === 4294967295) {
      return NaN;
    }
    index = uint32Index;
  }
  return index < 0 ? ensureSize(iter) + index : index;
}
var returnTrue = () => true;
var isNeg = (value) => value < 0 || Object.is(value, -0);
var wholeSlice = (begin, end, size) => (begin === 0 && !isNeg(begin) || size !== undefined && (begin ?? 0) <= -size) && (end === undefined || size !== undefined && end >= size);
var resolveIndex = (index, size, defaultIndex) => index === undefined ? defaultIndex : isNeg(index) ? size === Infinity ? size : Math.max(0, size + index) | 0 : size === undefined || size === index ? index : Math.min(size, index) | 0;
var resolveBegin = (begin, size) => resolveIndex(begin, size, 0);
var resolveEnd = (end, size) => resolveIndex(end, size, size);
var IS_COLLECTION_SYMBOL = "@@__IMMUTABLE_ITERABLE__@@";
var IS_KEYED_SYMBOL = "@@__IMMUTABLE_KEYED__@@";
var IS_INDEXED_SYMBOL = "@@__IMMUTABLE_INDEXED__@@";
var IS_ORDERED_SYMBOL = "@@__IMMUTABLE_ORDERED__@@";
var IS_SEQ_SYMBOL = "@@__IMMUTABLE_SEQ__@@";
var IS_LIST_SYMBOL = "@@__IMMUTABLE_LIST__@@";
var IS_MAP_SYMBOL = "@@__IMMUTABLE_MAP__@@";
var IS_SET_SYMBOL = "@@__IMMUTABLE_SET__@@";
var IS_STACK_SYMBOL = "@@__IMMUTABLE_STACK__@@";
var IS_RECORD_SYMBOL = "@@__IMMUTABLE_RECORD__@@";
function hasSymbol(v, symbol) {
  return typeof v === "object" && v !== null && symbol in v;
}
var isCollection = (v) => hasSymbol(v, IS_COLLECTION_SYMBOL);
var isKeyed = (v) => hasSymbol(v, IS_KEYED_SYMBOL);
var isIndexed = (v) => hasSymbol(v, IS_INDEXED_SYMBOL);
var isAssociative = (v) => isKeyed(v) || isIndexed(v);
var isOrdered = (v) => hasSymbol(v, IS_ORDERED_SYMBOL);
var isSeq = (v) => hasSymbol(v, IS_SEQ_SYMBOL);
var isList = (v) => hasSymbol(v, IS_LIST_SYMBOL);
var isMap = (v) => hasSymbol(v, IS_MAP_SYMBOL);
var isSet = (v) => hasSymbol(v, IS_SET_SYMBOL);
var isStack = (v) => hasSymbol(v, IS_STACK_SYMBOL);
var isRecord = (v) => hasSymbol(v, IS_RECORD_SYMBOL);
var isImmutable = (v) => isCollection(v) || isRecord(v);
var isOrderedMap = (v) => isMap(v) && isOrdered(v);
var isOrderedSet = (v) => isSet(v) && isOrdered(v);
var isValueObject = (v) => typeof v === "object" && v !== null && typeof v.equals === "function" && typeof v.hashCode === "function";
function flipFactory(collection) {
  const flipSequence = makeSequence(collection);
  flipSequence._iter = collection;
  flipSequence.size = collection.size;
  flipSequence.flip = () => collection;
  flipSequence.reverse = function() {
    const reversedSequence = collection.reverse.call(this);
    reversedSequence.flip = () => collection.reverse();
    return reversedSequence;
  };
  flipSequence.has = (key) => collection.includes(key);
  flipSequence.includes = (key) => collection.has(key);
  flipSequence.cacheResult = cacheResultThrough;
  flipSequence.__iterate = function(fn, reverse) {
    return collection.__iterate((v, k) => fn(k, v, this), reverse);
  };
  flipSequence.__iteratorUncached = (reverse) => mapEntries(collection.__iterator(reverse), (k, v, entry) => {
    entry[0] = v;
    entry[1] = k;
  });
  return flipSequence;
}
function mapFactory(collection, mapper, context) {
  const mappedSequence = makeSequence(collection);
  mappedSequence.size = collection.size;
  mappedSequence.has = (key) => collection.has(key);
  mappedSequence.get = (key, notSetValue) => {
    const v = collection.get(key, NOT_SET);
    return v === NOT_SET ? notSetValue : mapper.call(context, v, key, collection);
  };
  mappedSequence.__iterate = function(fn, reverse) {
    return collection.__iterate((v, k) => fn(mapper.call(context, v, k, collection), k, this), reverse);
  };
  mappedSequence.__iteratorUncached = (reverse) => mapEntries(collection.__iterator(reverse), (k, v, entry) => {
    entry[0] = k;
    entry[1] = mapper.call(context, v, k, collection);
  });
  return mappedSequence;
}
function reverseFactory(collection, useKeys) {
  const reversedSequence = makeSequence(collection);
  reversedSequence._iter = collection;
  reversedSequence.size = collection.size;
  reversedSequence.reverse = () => collection;
  if (collection.flip) {
    reversedSequence.flip = function() {
      const flipSequence = flipFactory(collection);
      flipSequence.reverse = () => collection.flip();
      return flipSequence;
    };
  }
  reversedSequence.get = (key, notSetValue) => collection.get(useKeys ? key : -1 - key, notSetValue);
  reversedSequence.has = (key) => collection.has(useKeys ? key : -1 - key);
  reversedSequence.includes = (value) => collection.includes(value);
  reversedSequence.cacheResult = cacheResultThrough;
  reversedSequence.__iterate = function(fn, reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(collection);
    }
    return collection.__iterate((v, k) => fn(v, useKeys ? k : reverse ? this.size - ++i : i++, this), !reverse);
  };
  reversedSequence.__iteratorUncached = function(reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(collection);
    }
    const size = this.size;
    return mapEntries(collection.__iterator(!reverse), (k, v, entry) => {
      entry[0] = useKeys ? k : reverse ? size - ++i : i++;
      entry[1] = v;
    });
  };
  return reversedSequence;
}
function sliceFactory(collection, begin, end, useKeys) {
  const originalSize = collection.size;
  if (wholeSlice(begin, end, originalSize)) {
    return collection;
  }
  if (originalSize === undefined && (begin < 0 || end < 0)) {
    return sliceFactory(collection.toSeq().cacheResult(), begin, end, useKeys);
  }
  const resolvedBegin = resolveBegin(begin, originalSize);
  const resolvedEnd = resolveEnd(end, originalSize);
  const resolvedSize = resolvedEnd - resolvedBegin;
  let sliceSize;
  if (!Number.isNaN(resolvedSize)) {
    sliceSize = Math.max(0, resolvedSize);
  }
  const sliceSeq = makeSequence(collection);
  sliceSeq.size = sliceSize === 0 ? sliceSize : collection.size && sliceSize || undefined;
  if (!useKeys && isSeq(collection) && sliceSize >= 0) {
    sliceSeq.get = function(index, notSetValue) {
      index = wrapIndex(this, index);
      return index >= 0 && index < sliceSize ? collection.get(index + resolvedBegin, notSetValue) : notSetValue;
    };
  }
  sliceSeq.__iterateUncached = function(fn, reverse) {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    if (sliceSize === 0) {
      return 0;
    }
    let skipped = 0;
    let iterations = 0;
    collection.__iterate((v, k) => {
      if (skipped < resolvedBegin) {
        skipped++;
        return;
      }
      if (sliceSize !== undefined && iterations >= sliceSize) {
        return false;
      }
      iterations++;
      if (fn(v, useKeys ? k : iterations - 1, this) === false) {
        return false;
      }
    }, reverse);
    return iterations;
  };
  sliceSeq.__iteratorUncached = function(reverse) {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    if (sliceSize === 0) {
      return emptyIterator();
    }
    const iterator = collection.__iterator(reverse);
    let skipped = 0;
    let iterations = 0;
    if (useKeys) {
      return makeIterator(() => {
        while (skipped < resolvedBegin) {
          skipped++;
          iterator.next();
        }
        if (sliceSize !== undefined && iterations >= sliceSize) {
          return DONE;
        }
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        iterations++;
        return step;
      });
    }
    return makeEntryIterator((entry) => {
      while (skipped < resolvedBegin) {
        skipped++;
        iterator.next();
      }
      if (sliceSize !== undefined && iterations >= sliceSize) {
        return false;
      }
      const step = iterator.next();
      if (step.done) {
        return false;
      }
      iterations++;
      entry[0] = iterations - 1;
      entry[1] = step.value[1];
      return true;
    });
  };
  return sliceSeq;
}
function sortFactory(collection, comparator, mapper) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  const isKeyedCollection = isKeyed(collection);
  let index = 0;
  const entries = collection.toSeq().map((v, k) => [k, v, index++, mapper ? mapper(v, k, collection) : v]).valueSeq().toArray();
  entries.sort((a, b) => comparator(a[3], b[3]) || a[2] - b[2]).forEach(isKeyedCollection ? (v, i) => {
    entries[i].length = 2;
  } : (v, i) => {
    entries[i] = v[1];
  });
  return isKeyedCollection ? KeyedSeq(entries) : isIndexed(collection) ? IndexedSeq(entries) : SetSeq(entries);
}
function maxFactory(collection, comparator, mapper) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  if (mapper) {
    const entry = collection.toSeq().map((v, k) => [v, mapper(v, k, collection)]).reduce((a, b) => maxCompare(comparator, a[1], b[1]) ? b : a);
    return entry?.[0];
  }
  return collection.reduce((a, b) => maxCompare(comparator, a, b) ? b : a);
}
function maxCompare(comparator, a, b) {
  const comp = comparator(b, a);
  return comp === 0 && b !== a && (b === undefined || b === null || Number.isNaN(b)) || comp > 0;
}
function zipWithFactory(keyIter, zipper, iters, zipAll) {
  const zipSequence = makeSequence(keyIter);
  const sizes = new ArraySeq(iters).map((i) => i.size);
  zipSequence.size = zipAll ? sizes.max() : sizes.min();
  zipSequence.__iterate = function(fn, reverse) {
    const iterator = this.__iterator(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      if (fn(step.value[1], iterations++, this) === false) {
        break;
      }
    }
    return iterations;
  };
  zipSequence.__iteratorUncached = function(reverse) {
    const iterators = iters.map((i) => {
      const col = Collection(i);
      return getIterator(reverse ? col.reverse() : col);
    });
    let iterations = 0;
    const steps = new Array(iterators.length);
    const values = new Array(iterators.length);
    return makeEntryIterator((entry) => {
      let done = zipAll;
      for (let i = 0;i < iterators.length; i++) {
        steps[i] = iterators[i].next();
        done = zipAll ? done && steps[i].done : done || steps[i].done;
      }
      if (done) {
        return false;
      }
      for (let i = 0;i < steps.length; i++) {
        values[i] = steps[i].value;
      }
      entry[0] = iterations++;
      entry[1] = zipper(...values);
      return true;
    });
  };
  return zipSequence;
}
function isArrayLike(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return true;
  }
  return value && typeof value === "object" && Number.isInteger(value.length) && value.length >= 0 && (value.length === 0 ? Object.keys(value).length === 1 : Object.hasOwn(value, value.length - 1));
}
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  let parentProto = proto;
  let nextProto = Object.getPrototypeOf(proto);
  while (nextProto !== null) {
    parentProto = nextProto;
    nextProto = Object.getPrototypeOf(parentProto);
  }
  return parentProto === proto;
}
var isDataStructure = (value) => typeof value === "object" && (isImmutable(value) || Array.isArray(value) || isPlainObject(value));
function coerceKeyPath(keyPath) {
  if (isArrayLike(keyPath) && typeof keyPath !== "string") {
    return keyPath;
  }
  if (isOrdered(keyPath)) {
    return keyPath.toArray();
  }
  throw new TypeError(`Invalid keyPath: expected Ordered Collection or Array: ${keyPath}`);
}
var has = (collection, key) => isImmutable(collection) ? collection.has(key) : isDataStructure(collection) && Object.hasOwn(collection, key);
function get(collection, key, notSetValue) {
  return isImmutable(collection) ? collection.get(key, notSetValue) : !has(collection, key) ? notSetValue : typeof collection.get === "function" ? collection.get(key) : collection[key];
}
function getIn$1(collection, searchKeyPath, notSetValue) {
  const keyPath = coerceKeyPath(searchKeyPath);
  let i = 0;
  while (i !== keyPath.length) {
    collection = get(collection, keyPath[i++], NOT_SET);
    if (collection === NOT_SET) {
      return notSetValue;
    }
  }
  return collection;
}
var hasIn$1 = (collection, keyPath) => getIn$1(collection, keyPath, NOT_SET) !== NOT_SET;
function is(valueA, valueB) {
  if (valueA === valueB || Number.isNaN(valueA) && Number.isNaN(valueB)) {
    return true;
  }
  if (!valueA || !valueB) {
    return false;
  }
  if (typeof valueA.valueOf === "function" && typeof valueB.valueOf === "function") {
    valueA = valueA.valueOf();
    valueB = valueB.valueOf();
    if (valueA === valueB || Number.isNaN(valueA) && Number.isNaN(valueB)) {
      return true;
    }
    if (!valueA || !valueB) {
      return false;
    }
  }
  return !!(isValueObject(valueA) && isValueObject(valueB) && valueA.equals(valueB));
}
function toJS(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (!isCollection(value)) {
    if (!isDataStructure(value)) {
      return value;
    }
    value = Seq(value);
  }
  if (isKeyed(value)) {
    const result2 = {};
    value.__iterate((v, k) => {
      result2[String(k)] = toJS(v);
    });
    return result2;
  }
  const result = [];
  value.__iterate((v) => {
    result.push(toJS(v));
  });
  return result;
}
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!isCollection(b) || a.size !== undefined && b.size !== undefined && a.size !== b.size || a.__hash !== undefined && b.__hash !== undefined && a.__hash !== b.__hash || isKeyed(a) !== isKeyed(b) || isIndexed(a) !== isIndexed(b) || isOrdered(a) !== isOrdered(b)) {
    return false;
  }
  if (a.size === 0 && b.size === 0) {
    return true;
  }
  const notAssociative = !isAssociative(a);
  if (isOrdered(a)) {
    const entries = a.entries();
    return !!(b.every((v, k) => {
      const entry = entries.next().value;
      return entry && is(entry[1], v) && (notAssociative || is(entry[0], k));
    }) && entries.next().done);
  }
  let flipped = false;
  if (a.size === undefined) {
    if (b.size === undefined) {
      if (typeof a.cacheResult === "function") {
        a.cacheResult();
      }
    } else {
      flipped = true;
      const _ = a;
      a = b;
      b = _;
    }
  }
  let allEqual = true;
  const bSize = b.__iterate((v, k) => {
    if (notAssociative ? !a.has(v) : flipped ? !is(v, a.get(k, NOT_SET)) : !is(a.get(k, NOT_SET), v)) {
      allEqual = false;
      return false;
    }
    return true;
  });
  return allEqual && a.size === bSize;
}
var smi = (i32) => i32 >>> 1 & 1073741824 | i32 & 3221225471;
function hash(o) {
  if (o === null || o === undefined) {
    return hashNullish(o);
  }
  if (typeof o.hashCode === "function") {
    return smi(o.hashCode(o));
  }
  const v = valueOf(o);
  if (v === null || v === undefined) {
    return hashNullish(v);
  }
  switch (typeof v) {
    case "boolean":
      return v ? 1108378657 : 1108378656;
    case "number":
      return hashNumber(v);
    case "string":
      return v.length > STRING_HASH_CACHE_MIN_STRLEN ? cachedHashString(v) : hashString(v);
    case "object":
    case "function":
      return hashJSObj(v);
    case "symbol":
      return hashSymbol(v);
    default:
      if (typeof v.toString === "function") {
        return hashString(v.toString());
      }
      throw new Error(`Value type ${typeof v} cannot be hashed.`);
  }
}
var hashNullish = (nullish) => nullish === null ? 1108378658 : 1108378659;
function hashNumber(n) {
  if (Number.isNaN(n) || n === Infinity) {
    return 0;
  }
  let hash2 = n | 0;
  if (hash2 !== n) {
    hash2 ^= n * 4294967295;
  }
  while (n > 4294967295) {
    n /= 4294967295;
    hash2 ^= n;
  }
  return smi(hash2);
}
function cachedHashString(string) {
  let hashed = stringHashCache[string];
  if (hashed === undefined) {
    hashed = hashString(string);
    if (STRING_HASH_CACHE_SIZE === STRING_HASH_CACHE_MAX_SIZE) {
      STRING_HASH_CACHE_SIZE = 0;
      stringHashCache = {};
    }
    STRING_HASH_CACHE_SIZE++;
    stringHashCache[string] = hashed;
  }
  return hashed;
}
function hashString(string) {
  let hashed = 0;
  for (let ii = 0;ii < string.length; ii++) {
    hashed = 31 * hashed + string.charCodeAt(ii) | 0;
  }
  return smi(hashed);
}
function hashSymbol(sym) {
  let hashed = symbolMap[sym];
  if (hashed !== undefined) {
    return hashed;
  }
  hashed = nextHash();
  symbolMap[sym] = hashed;
  return hashed;
}
function hashJSObj(obj) {
  let hashed = weakMap.get(obj);
  if (hashed !== undefined) {
    return hashed;
  }
  hashed = nextHash();
  weakMap.set(obj, hashed);
  return hashed;
}
var valueOf = (obj) => obj.valueOf !== Object.prototype.valueOf ? obj.valueOf() : obj;
function nextHash() {
  const nextHash2 = ++_objHashUID;
  if (_objHashUID & 1073741824) {
    _objHashUID = 0;
  }
  return nextHash2;
}
var weakMap = new WeakMap;
var symbolMap = Object.create(null);
var _objHashUID = 0;
var STRING_HASH_CACHE_MIN_STRLEN = 16;
var STRING_HASH_CACHE_MAX_SIZE = 255;
var STRING_HASH_CACHE_SIZE = 0;
var stringHashCache = {};
function hashCollection(collection) {
  if (collection.size === Infinity) {
    return 0;
  }
  const ordered = isOrdered(collection);
  const keyed = isKeyed(collection);
  let h = ordered ? 1 : 0;
  collection.__iterate(keyed ? ordered ? (v, k) => {
    h = 31 * h + hashMerge(hash(v), hash(k)) | 0;
  } : (v, k) => {
    h = h + hashMerge(hash(v), hash(k)) | 0;
  } : ordered ? (v) => {
    h = 31 * h + hash(v) | 0;
  } : (v) => {
    h = h + hash(v) | 0;
  });
  return murmurHashOfSize(collection.size, h);
}
var hashMerge = (a, b) => a ^ b + 2654435769 + (a << 6) + (a >> 2) | 0;
function murmurHashOfSize(size, h) {
  h = Math.imul(h, 3432918353);
  h = Math.imul(h << 15 | h >>> -15, 461845907);
  h = Math.imul(h << 13 | h >>> -13, 5);
  h = (h + 3864292196 | 0) ^ size;
  h = Math.imul(h ^ h >>> 16, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  h = smi(h ^ h >>> 16);
  return h;
}
function quoteString(value) {
  try {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch {
    return JSON.stringify(value);
  }
}
var reify = (iter, seq) => iter === seq ? iter : isSeq(iter) ? seq : iter.create ? iter.create(seq) : iter.constructor(seq);
var reifyValues = (collection, arr) => reify(collection, (isKeyed(collection) ? KeyedCollection : isIndexed(collection) ? IndexedCollection : SetCollection)(arr));
var defaultZipper = (...values) => values;
var Collection = (value) => isCollection(value) ? value : Seq(value);

class CollectionImpl {
  size = 0;
  static {
    this.prototype[IS_COLLECTION_SYMBOL] = true;
    this.prototype.__toStringMapper = quoteString;
    this.prototype[Symbol.iterator] = this.prototype.values;
    this.prototype.toJSON = this.prototype.toArray;
    this.prototype.contains = this.prototype.includes;
  }
  equals(other) {
    return deepEqual(this, other);
  }
  hashCode() {
    return this.__hash ?? (this.__hash = hashCollection(this));
  }
  toArray() {
    assertNotInfinite(this.size);
    const array = new Array(this.size || 0);
    const useTuples = isKeyed(this);
    let i = 0;
    this.__iterate((v, k) => {
      array[i++] = useTuples ? [k, v] : v;
    });
    return array;
  }
  toIndexedSeq() {
    return new ToIndexedSequence(this);
  }
  toJS() {
    return toJS(this);
  }
  toKeyedSeq() {
    return new ToKeyedSequence(this, true);
  }
  toMap() {
    throw new Error("toMap: not patched — import CollectionConversions");
  }
  toObject() {
    assertNotInfinite(this.size);
    const object = {};
    this.__iterate((v, k) => {
      object[k] = v;
    });
    return object;
  }
  toOrderedMap() {
    throw new Error("toOrderedMap: not patched — import CollectionConversions");
  }
  toOrderedSet() {
    throw new Error("toOrderedSet: not patched — import CollectionConversions");
  }
  toSet() {
    throw new Error("toSet: not patched — import CollectionConversions");
  }
  toSetSeq() {
    return new ToSetSequence(this);
  }
  toSeq() {
    return isIndexed(this) ? this.toIndexedSeq() : isKeyed(this) ? this.toKeyedSeq() : this.toSetSeq();
  }
  toStack() {
    throw new Error("toStack: not patched — import CollectionConversions");
  }
  toList() {
    throw new Error("toList: not patched — import CollectionConversions");
  }
  toString() {
    return "[Collection]";
  }
  __toString(head, tail) {
    if (this.size === 0) {
      return `${head}${tail}`;
    }
    return `${head} ${this.toSeq().map(this.__toStringMapper).join(", ")} ${tail}`;
  }
  concat(...values) {
    const isKeyedCollection = isKeyed(this);
    const iters = [this, ...values].map((v) => {
      if (!isCollection(v)) {
        v = isKeyedCollection ? keyedSeqFromValue(v) : indexedSeqFromValue(Array.isArray(v) ? v : [v]);
      } else if (isKeyedCollection) {
        v = KeyedCollection(v);
      }
      return v;
    }).filter((v) => v.size !== 0);
    if (iters.length === 0) {
      return this;
    }
    if (iters.length === 1) {
      const singleton = iters[0];
      if (singleton === this || isKeyedCollection && isKeyed(singleton) || isIndexed(this) && isIndexed(singleton)) {
        return singleton;
      }
    }
    return reify(this, new ConcatSeq(iters));
  }
  includes(searchValue) {
    return this.some((value) => is(value, searchValue));
  }
  every(predicate, context) {
    assertNotInfinite(this.size);
    let returnValue = true;
    this.__iterate((v, k, c) => {
      if (!predicate.call(context, v, k, c)) {
        returnValue = false;
        return false;
      }
    });
    return returnValue;
  }
  entries() {
    return this.__iterator();
  }
  filter(predicate, context) {
    const collection = this;
    const useKeys = isKeyed(this);
    const filterSequence = makeSequence(collection);
    if (useKeys) {
      filterSequence.has = (key) => {
        const v = collection.get(key, NOT_SET);
        return v !== NOT_SET && !!predicate.call(context, v, key, collection);
      };
      filterSequence.get = (key, notSetValue) => {
        const v = collection.get(key, NOT_SET);
        return v !== NOT_SET && predicate.call(context, v, key, collection) ? v : notSetValue;
      };
    }
    filterSequence.__iterateUncached = function(fn, reverse) {
      let iterations = 0;
      collection.__iterate((v, k) => {
        if (predicate.call(context, v, k, collection)) {
          iterations++;
          return fn(v, useKeys ? k : iterations - 1, this);
        }
      }, reverse);
      return iterations;
    };
    filterSequence.__iteratorUncached = function(reverse) {
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      return makeEntryIterator((entry) => {
        while (true) {
          const step = iterator.next();
          if (step.done) {
            return false;
          }
          const k = step.value[0];
          const v = step.value[1];
          if (predicate.call(context, v, k, collection)) {
            entry[0] = useKeys ? k : iterations++;
            entry[1] = v;
            return true;
          }
        }
      });
    };
    return reify(this, filterSequence);
  }
  partition(predicate, context) {
    const isKeyedIter = isKeyed(this);
    const groups = [[], []];
    this.__iterate((v, k) => {
      groups[predicate.call(context, v, k, this) ? 1 : 0].push(isKeyedIter ? [k, v] : v);
    });
    return groups.map((arr) => reifyValues(this, arr));
  }
  find(predicate, context, notSetValue) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[1] : notSetValue;
  }
  forEach(sideEffect, context) {
    assertNotInfinite(this.size);
    return this.__iterate(context ? sideEffect.bind(context) : sideEffect);
  }
  join(separator) {
    assertNotInfinite(this.size);
    separator = separator !== undefined ? String(separator) : ",";
    let joined = "";
    let isFirst = true;
    this.__iterate((v) => {
      if (isFirst) {
        isFirst = false;
      } else {
        joined += separator;
      }
      joined += v !== null && v !== undefined ? String(v) : "";
    });
    return joined;
  }
  keys() {
    const iterator = this.__iterator();
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      const step = iterator.next();
      if (step.done) {
        return DONE;
      }
      result.value = step.value[0];
      return result;
    });
  }
  map(mapper, context) {
    return reify(this, mapFactory(this, mapper, context));
  }
  reduce(reducer, initialReduction = NOT_SET, context) {
    return reduce(this, reducer, initialReduction, context, initialReduction === NOT_SET, false);
  }
  reduceRight(reducer, initialReduction = NOT_SET, context) {
    return reduce(this, reducer, initialReduction, context, initialReduction === NOT_SET, true);
  }
  reverse() {
    return reify(this, reverseFactory(this, isKeyed(this)));
  }
  slice(begin, end) {
    return reify(this, sliceFactory(this, begin, end, isKeyed(this)));
  }
  some(predicate, context) {
    assertNotInfinite(this.size);
    let returnValue = false;
    this.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        returnValue = true;
        return false;
      }
    });
    return returnValue;
  }
  sort(comparator) {
    return reify(this, sortFactory(this, comparator));
  }
  values() {
    const iterator = this.__iterator();
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      const step = iterator.next();
      if (step.done) {
        return DONE;
      }
      result.value = step.value[1];
      return result;
    });
  }
  butLast() {
    return this.slice(0, -1);
  }
  isEmpty() {
    return this.size !== undefined ? this.size === 0 : !this.some(() => true);
  }
  count(predicate, context) {
    return ensureSize(predicate ? this.toSeq().filter(predicate, context) : this);
  }
  countBy(_grouper, _context) {
    throw new Error("countBy: not patched — import CollectionConversions");
  }
  entrySeq() {
    const collection = this;
    if (collection._cache) {
      return new ArraySeq(collection._cache);
    }
    const entriesSequence = collection.toSeq().map(entryMapper).toIndexedSeq();
    entriesSequence.fromEntrySeq = () => collection.toSeq();
    return entriesSequence;
  }
  filterNot(predicate, context) {
    return this.filter(not(predicate), context);
  }
  findEntry(predicate, context, notSetValue) {
    let found = notSetValue;
    this.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        found = [k, v];
        return false;
      }
    });
    return found;
  }
  findKey(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry?.[0];
  }
  findLast(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().find(predicate, context, notSetValue);
  }
  findLastEntry(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().findEntry(predicate, context, notSetValue);
  }
  findLastKey(predicate, context) {
    return this.toKeyedSeq().reverse().findKey(predicate, context);
  }
  first(notSetValue) {
    return this.find(returnTrue, null, notSetValue);
  }
  flatMap(mapper, context) {
    return reify(this, this.toSeq().map((v, k) => (isKeyed(this) ? KeyedCollection : isIndexed(this) ? IndexedCollection : SetCollection)(mapper.call(context, v, k, this))).flatten(true));
  }
  flatten(depth) {
    const collection = this;
    const useKeys = isKeyed(this);
    const flatSequence = makeSequence(collection);
    flatSequence.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      let iterations = 0;
      let stopped = false;
      function flatDeep(iter, currentDepth) {
        iter.__iterate((v, k) => {
          if ((!depth || currentDepth < depth) && isCollection(v)) {
            flatDeep(v, currentDepth + 1);
          } else {
            iterations++;
            if (fn(v, useKeys ? k : iterations - 1, flatSequence) === false) {
              stopped = true;
            }
          }
          if (stopped) {
            return false;
          }
        }, reverse);
      }
      flatDeep(collection, 0);
      return iterations;
    };
    flatSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      let iterations = 0;
      const stack = [{
        iterator: collection.__iterator(reverse),
        depth: 0
      }];
      return makeEntryIterator((entry) => {
        while (stack.length > 0) {
          const frame = stack[stack.length - 1];
          const step = frame.iterator.next();
          if (step.done) {
            stack.pop();
            continue;
          }
          const v = step.value[1];
          if ((!depth || frame.depth < depth) && isCollection(v)) {
            stack.push({
              iterator: v.__iterator(reverse),
              depth: frame.depth + 1
            });
            continue;
          }
          entry[0] = useKeys ? step.value[0] : iterations++;
          entry[1] = v;
          return true;
        }
        return false;
      });
    };
    return reify(this, flatSequence);
  }
  fromEntrySeq() {
    return new FromEntriesSequence(this);
  }
  get(searchKey, notSetValue) {
    return this.find((_, key) => is(key, searchKey), undefined, notSetValue);
  }
  getIn(searchKeyPath, notSetValue) {
    return getIn$1(this, searchKeyPath, notSetValue);
  }
  groupBy(_grouper, _context) {
    throw new Error("groupBy: not patched — import CollectionConversions");
  }
  has(searchKey) {
    return this.get(searchKey, NOT_SET) !== NOT_SET;
  }
  hasIn(searchKeyPath) {
    return hasIn$1(this, searchKeyPath);
  }
  isSubset(iter) {
    const other = typeof iter.includes === "function" ? iter : Collection(iter);
    return this.every((value) => other.includes(value));
  }
  isSuperset(iter) {
    const other = typeof iter.isSubset === "function" ? iter : Collection(iter);
    return other.isSubset(this);
  }
  keyOf(searchValue) {
    return this.findKey((value) => is(value, searchValue));
  }
  keySeq() {
    return this.toSeq().map(keyMapper).toIndexedSeq();
  }
  last(notSetValue) {
    return this.toSeq().reverse().first(notSetValue);
  }
  lastKeyOf(searchValue) {
    return this.toKeyedSeq().reverse().keyOf(searchValue);
  }
  max(comparator) {
    return maxFactory(this, comparator);
  }
  maxBy(mapper, comparator) {
    return maxFactory(this, comparator, mapper);
  }
  min(comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator);
  }
  minBy(mapper, comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator, mapper);
  }
  rest() {
    return this.slice(1);
  }
  skip(amount) {
    return amount === 0 ? this : this.slice(Math.max(0, amount));
  }
  skipLast(amount) {
    return amount === 0 ? this : this.slice(0, -Math.max(0, amount));
  }
  skipWhile(predicate, context) {
    const collection = this;
    const useKeys = isKeyed(this);
    const skipSequence = makeSequence(collection);
    skipSequence.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      let skipping = true;
      let iterations = 0;
      collection.__iterate((v, k) => {
        if (skipping && predicate.call(context, v, k, this)) {
          return;
        }
        skipping = false;
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }, reverse);
      return iterations;
    };
    skipSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      const seq = this;
      let skipping = true;
      return makeEntryIterator((entry) => {
        while (true) {
          const step = iterator.next();
          if (step.done) {
            return false;
          }
          const k = step.value[0];
          const v = step.value[1];
          if (skipping && predicate.call(context, v, k, seq)) {
            continue;
          }
          skipping = false;
          entry[0] = useKeys ? k : iterations++;
          entry[1] = v;
          return true;
        }
      });
    };
    return reify(this, skipSequence);
  }
  skipUntil(predicate, context) {
    return this.skipWhile(not(predicate), context);
  }
  sortBy(mapper, comparator) {
    return reify(this, sortFactory(this, comparator, mapper));
  }
  take(amount) {
    return this.slice(0, Math.max(0, amount));
  }
  takeLast(amount) {
    return this.slice(-Math.max(0, amount));
  }
  takeWhile(predicate, context) {
    const collection = this;
    const takeSequence = makeSequence(collection);
    takeSequence.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      let iterations = 0;
      collection.__iterate((v, k) => {
        if (!predicate.call(context, v, k, this)) {
          return false;
        }
        iterations++;
        return fn(v, k, this);
      }, reverse);
      return iterations;
    };
    takeSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      const iterator = collection.__iterator(reverse);
      const seq = this;
      let finished = false;
      return makeIterator(() => {
        if (finished) {
          return DONE;
        }
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        if (!predicate.call(context, step.value[1], step.value[0], seq)) {
          finished = true;
          return DONE;
        }
        return step;
      });
    };
    return reify(this, takeSequence);
  }
  takeUntil(predicate, context) {
    return this.takeWhile(not(predicate), context);
  }
  update(fn) {
    return fn(this);
  }
  valueSeq() {
    return this.toIndexedSeq();
  }
  __iterate(fn, reverse = false) {
    const iterator = this.__iterator(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      iterations++;
      if (fn(step.value[1], step.value[0], this) === false) {
        break;
      }
    }
    return iterations;
  }
  __iterator(_reverse = false) {
    throw new Error("CollectionImpl does not implement __iterator. Use a subclass instead.");
  }
}
var KeyedCollection = (value) => isKeyed(value) ? value : KeyedSeq(value);

class KeyedCollectionImpl extends CollectionImpl {
  static {
    this.prototype[IS_KEYED_SYMBOL] = true;
    this.prototype.__toStringMapper = (v, k) => `${quoteString(k)}: ${quoteString(v)}`;
    this.prototype[Symbol.iterator] = CollectionImpl.prototype.entries;
    this.prototype.toJSON = function() {
      assertNotInfinite(this.size);
      const object = {};
      this.__iterate((v, k) => {
        object[k] = v;
      });
      return object;
    };
  }
  flip() {
    return reify(this, flipFactory(this));
  }
  mapEntries(mapper, context) {
    let iterations = 0;
    return reify(this, this.toSeq().map((v, k) => mapper.call(context, [k, v], iterations++, this)).fromEntrySeq());
  }
  mapKeys(mapper, context) {
    return reify(this, this.toSeq().flip().map((k, v) => mapper.call(context, k, v, this)).flip());
  }
}
var IndexedCollection = (value) => isIndexed(value) ? value : IndexedSeq(value);

class IndexedCollectionImpl extends CollectionImpl {
  static {
    this.prototype[IS_INDEXED_SYMBOL] = true;
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  toKeyedSeq() {
    return new ToKeyedSequence(this, false);
  }
  findIndex(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[0] : -1;
  }
  indexOf(searchValue) {
    const key = this.keyOf(searchValue);
    return key === undefined ? -1 : key;
  }
  lastIndexOf(searchValue) {
    const key = this.lastKeyOf(searchValue);
    return key === undefined ? -1 : key;
  }
  splice(index, removeNum = NOT_SET, ...values) {
    if (index === undefined) {
      return this;
    }
    const hasRemoveNum = removeNum !== NOT_SET;
    removeNum = hasRemoveNum ? Math.max(removeNum || 0, 0) : 0;
    if (hasRemoveNum && !removeNum && values.length === 0) {
      return this;
    }
    index = resolveBegin(index, index < 0 ? this.count() : this.size);
    const spliced = this.slice(0, index);
    return reify(this, !hasRemoveNum ? spliced : spliced.concat(values, this.slice(index + removeNum)));
  }
  findLastIndex(predicate, context) {
    const entry = this.findLastEntry(predicate, context);
    return entry ? entry[0] : -1;
  }
  first(notSetValue) {
    return this.get(0, notSetValue);
  }
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    return index < 0 || this.size === Infinity || this.size !== undefined && index > this.size ? notSetValue : this.find((_, key) => key === index, undefined, notSetValue);
  }
  has(index) {
    index = wrapIndex(this, index);
    return index >= 0 && (this.size !== undefined ? this.size === Infinity || index < this.size : this.indexOf(index) !== -1);
  }
  interpose(separator) {
    const collection = this;
    const interposedSequence = makeSequence(collection);
    interposedSequence.size = collection.size && collection.size * 2 - 1;
    interposedSequence.__iterateUncached = function(fn, reverse) {
      let iterations = 0;
      let isFirst = true;
      collection.__iterate((v) => {
        if (!isFirst) {
          if (fn(separator, iterations++, this) === false) {
            return false;
          }
        }
        isFirst = false;
        return fn(v, iterations++, this);
      }, reverse);
      return iterations;
    };
    interposedSequence.__iteratorUncached = function(reverse) {
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      let isFirst = true;
      let pendingValue;
      let hasPending = false;
      return makeEntryIterator((entry) => {
        if (hasPending) {
          hasPending = false;
          entry[0] = iterations++;
          entry[1] = pendingValue;
          return true;
        }
        const step = iterator.next();
        if (step.done) {
          return false;
        }
        const value = step.value[1];
        if (!isFirst) {
          pendingValue = value;
          hasPending = true;
          entry[0] = iterations++;
          entry[1] = separator;
          return true;
        }
        isFirst = false;
        entry[0] = iterations++;
        entry[1] = value;
        return true;
      });
    };
    return reify(this, interposedSequence);
  }
  interleave(...collections) {
    const thisAndCollections = [this, ...collections];
    const zipped = zipWithFactory(this.toSeq(), IndexedSeq.of, thisAndCollections);
    const interleaved = zipped.flatten(true);
    if (zipped.size) {
      interleaved.size = zipped.size * thisAndCollections.length;
    }
    return reify(this, interleaved);
  }
  keySeq() {
    throw new Error("keySeq: not patched — import CollectionConversions");
  }
  last(notSetValue) {
    return this.get(-1, notSetValue);
  }
  zip(...collections) {
    return this.zipWith(defaultZipper, ...collections);
  }
  zipAll(...collections) {
    const thisAndCollections = [this, ...collections];
    return reify(this, zipWithFactory(this, defaultZipper, thisAndCollections, true));
  }
  zipWith(zipper, ...collections) {
    const thisAndCollections = [this, ...collections];
    return reify(this, zipWithFactory(this, zipper, thisAndCollections));
  }
}
var SetCollection = (value) => isCollection(value) && !isAssociative(value) ? value : SetSeq(value);

class SetCollectionImpl extends CollectionImpl {
  static {
    this.prototype.has = CollectionImpl.prototype.includes;
    this.prototype.contains = CollectionImpl.prototype.includes;
    this.prototype.keys = SetCollectionImpl.prototype.values;
  }
  get(value, notSetValue) {
    return this.has(value) ? value : notSetValue;
  }
  includes(value) {
    return this.has(value);
  }
  keySeq() {
    return this.valueSeq();
  }
}
Collection.Keyed = KeyedCollection;
Collection.Indexed = IndexedCollection;
Collection.Set = SetCollection;
var IndexedCollectionPrototype = IndexedCollectionImpl.prototype;
var Seq = (value) => value === undefined || value === null ? emptySequence() : isImmutable(value) ? value.toSeq() : seqFromValue(value);
var makeSequence = (collection) => Object.create((isKeyed(collection) ? KeyedSeqImpl : isIndexed(collection) ? IndexedSeqImpl : SetSeqImpl).prototype);

class SeqImpl extends CollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
  }
  toSeq() {
    return this;
  }
  toString() {
    return this.__toString("Seq {", "}");
  }
  cacheResult() {
    if (!this._cache && this.__iterateUncached) {
      this._cache = this.entrySeq().toArray();
      this.size = this._cache.length;
    }
    return this;
  }
  __iterateUncached(fn, reverse) {
    const iterator = this.__iteratorUncached(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      iterations++;
      if (fn(step.value[1], step.value[0], this) === false) {
        break;
      }
    }
    return iterations;
  }
  __iterate(fn, reverse) {
    const cache = this._cache;
    if (cache) {
      const size = cache.length;
      let i = 0;
      while (i !== size) {
        const entry = cache[reverse ? size - ++i : i++];
        if (fn(entry[1], entry[0], this) === false) {
          break;
        }
      }
      return i;
    }
    return this.__iterateUncached(fn, reverse);
  }
  __iterator(reverse) {
    const cache = this._cache;
    if (cache) {
      const size = cache.length;
      let i = 0;
      const result = {
        done: false,
        value: undefined
      };
      return makeIterator(() => {
        if (i === size) {
          return DONE;
        }
        result.value = cache[reverse ? size - ++i : i++];
        return result;
      });
    }
    return this.__iteratorUncached(reverse);
  }
}
var seqMixin = {
  cacheResult: SeqImpl.prototype.cacheResult,
  __iterateUncached: SeqImpl.prototype.__iterateUncached,
  __iterate: SeqImpl.prototype.__iterate,
  __iterator: SeqImpl.prototype.__iterator
};
var KeyedSeq = (value) => value === undefined || value === null ? emptySequence().toKeyedSeq() : isCollection(value) ? isKeyed(value) ? value.toSeq() : value.fromEntrySeq() : isRecord(value) ? value.toSeq() : keyedSeqFromValue(value);

class KeyedSeqImpl extends KeyedCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toKeyedSeq() {
    return this;
  }
}
var IndexedSeq = (value) => value === undefined || value === null ? emptySequence() : isCollection(value) ? isKeyed(value) ? value.entrySeq() : value.toIndexedSeq() : isRecord(value) ? value.toSeq().entrySeq() : indexedSeqFromValue(value);
IndexedSeq.of = (...values) => IndexedSeq(values);

class IndexedSeqImpl extends IndexedCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toIndexedSeq() {
    return this;
  }
  toString() {
    return this.__toString("Seq [", "]");
  }
}
var SetSeq = (value) => (isCollection(value) && !isAssociative(value) ? value : IndexedSeq(value)).toSetSeq();
SetSeq.of = (...values) => SetSeq(values);

class SetSeqImpl extends SetCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toSetSeq() {
    return this;
  }
}
Seq.isSeq = isSeq;
Seq.Keyed = KeyedSeq;
Seq.Set = SetSeq;
Seq.Indexed = IndexedSeq;

class ArraySeq extends IndexedSeqImpl {
  constructor(array) {
    super();
    this._array = array;
    this.size = array.length;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._array[wrapIndex(this, index)] : notSetValue;
  }
  __iterateUncached(fn, reverse) {
    const array = this._array;
    const size = array.length;
    let i = 0;
    while (i !== size) {
      const ii = reverse ? size - ++i : i++;
      if (fn(array[ii], ii, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const array = this._array;
    const size = array.length;
    let i = 0;
    return makeEntryIterator((entry) => {
      if (i === size) {
        return false;
      }
      const ii = reverse ? size - ++i : i++;
      entry[0] = ii;
      entry[1] = array[ii];
      return true;
    });
  }
}

class ObjectSeq extends KeyedSeqImpl {
  static {
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  constructor(object) {
    super();
    const keys = [...Object.keys(object), ...Object.getOwnPropertySymbols(object)];
    this._object = object;
    this._keys = keys;
    this.size = keys.length;
  }
  get(key, notSetValue) {
    if (notSetValue !== undefined && !this.has(key)) {
      return notSetValue;
    }
    return this._object[key];
  }
  has(key) {
    return Object.hasOwn(this._object, key);
  }
  __iterateUncached(fn, reverse) {
    const object = this._object;
    const keys = this._keys;
    const size = keys.length;
    let i = 0;
    while (i !== size) {
      const key = keys[reverse ? size - ++i : i++];
      if (fn(object[key], key, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const object = this._object;
    const keys = this._keys;
    const size = keys.length;
    let i = 0;
    return makeEntryIterator((entry) => {
      if (i === size) {
        return false;
      }
      const key = keys[reverse ? size - ++i : i++];
      entry[0] = key;
      entry[1] = object[key];
      return true;
    });
  }
}

class CollectionSeq extends IndexedSeqImpl {
  constructor(collection) {
    super();
    this._collection = collection;
    this.size = collection.length || collection.size;
  }
  __iterateUncached(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    for (const value of this._collection) {
      if (fn(value, iterations, this) === false) {
        break;
      }
      iterations++;
    }
    return iterations;
  }
  __iteratorUncached(reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    const collection = this._collection;
    const iterator = getIterator(collection);
    if (!isIterator(iterator)) {
      return emptyIterator();
    }
    let iterations = 0;
    return makeEntryIterator((entry) => {
      const step = iterator.next();
      if (step.done) {
        return false;
      }
      entry[0] = iterations++;
      entry[1] = step.value;
      return true;
    });
  }
}
var emptySequence = () => new ArraySeq([]);
var maybeIndexedSeqFromValue = (value) => isArrayLike(value) ? new ArraySeq(value) : hasIterator(value) ? new CollectionSeq(value) : undefined;
function keyedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq.fromEntrySeq();
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError(`Expected Array or collection object of [k, v] entries, or keyed object: ${value}`);
}
function indexedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq;
  }
  throw new TypeError(`Expected Array or collection object of values: ${value}`);
}
function seqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return isEntriesIterable(value) ? seq.fromEntrySeq() : isKeysIterable(value) ? seq.toSetSeq() : seq;
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError(`Expected Array or collection object of values, or keyed object: ${value}`);
}

class ConcatSeq extends SeqImpl {
  constructor(iterables) {
    super();
    const wrappedIterables = [];
    let size = 0;
    let sizeKnown = true;
    for (const iterable of iterables) {
      if (iterable._wrappedIterables) {
        for (const wrapped of iterable._wrappedIterables) {
          wrappedIterables.push(wrapped);
          if (sizeKnown) {
            const s = wrapped.size;
            if (s !== undefined) {
              size += s;
            } else {
              sizeKnown = false;
            }
          }
        }
      } else {
        wrappedIterables.push(iterable);
        if (sizeKnown) {
          const s = iterable.size;
          if (s !== undefined) {
            size += s;
          } else {
            sizeKnown = false;
          }
        }
      }
    }
    this._wrappedIterables = wrappedIterables;
    this.size = sizeKnown ? size : undefined;
    const first = this._wrappedIterables[0];
    if (first[IS_KEYED_SYMBOL]) {
      this[IS_KEYED_SYMBOL] = true;
    }
    if (first[IS_INDEXED_SYMBOL]) {
      this[IS_INDEXED_SYMBOL] = true;
    }
    if (first[IS_ORDERED_SYMBOL]) {
      this[IS_ORDERED_SYMBOL] = true;
    }
  }
  __iterateUncached(fn, reverse) {
    if (this._wrappedIterables.length === 0) {
      return 0;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    const wrappedIterables = this._wrappedIterables;
    const reIndex = !isKeyed(this);
    let index = 0;
    let stopped = false;
    for (const iterable of wrappedIterables) {
      iterable.__iterate((v, k) => {
        if (fn(v, reIndex ? index++ : k, this) === false) {
          stopped = true;
          return false;
        }
      }, reverse);
      if (stopped) {
        break;
      }
    }
    return index;
  }
  __iteratorUncached(reverse) {
    if (this._wrappedIterables.length === 0) {
      return emptyIterator();
    }
    if (reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    const wrappedIterables = this._wrappedIterables;
    const reIndex = !isKeyed(this);
    let iterableIdx = 0;
    let currentIterator = wrappedIterables[0].__iterator(reverse);
    function nextStep() {
      while (iterableIdx < wrappedIterables.length) {
        const step = currentIterator.next();
        if (!step.done)
          return step;
        iterableIdx++;
        if (iterableIdx < wrappedIterables.length) {
          currentIterator = wrappedIterables[iterableIdx].__iterator(reverse);
        }
      }
      return;
    }
    if (reIndex) {
      let index = 0;
      return makeEntryIterator((entry) => {
        const step = nextStep();
        if (!step)
          return false;
        entry[0] = index++;
        entry[1] = step.value[1];
        return true;
      });
    }
    return makeIterator(() => nextStep() || DONE);
  }
}

class ToKeyedSequence extends KeyedSeqImpl {
  static {
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  constructor(indexed, useKeys) {
    super();
    this._iter = indexed;
    this._useKeys = useKeys;
    this.size = indexed.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  get(key, notSetValue) {
    return this._iter.get(key, notSetValue);
  }
  has(key) {
    return this._iter.has(key);
  }
  valueSeq() {
    return this._iter.valueSeq();
  }
  reverse() {
    const reversedSequence = reverseFactory(this, true);
    if (!this._useKeys) {
      reversedSequence.valueSeq = () => this._iter.toSeq().reverse();
    }
    return reversedSequence;
  }
  map(mapper, context) {
    const mappedSequence = mapFactory(this, mapper, context);
    if (!this._useKeys) {
      mappedSequence.valueSeq = () => this._iter.toSeq().map(mapper, context);
    }
    return mappedSequence;
  }
  __iterateUncached(fn, reverse) {
    return this._iter.__iterate(fn, reverse);
  }
  __iteratorUncached(reverse) {
    return this._iter.__iterator(reverse);
  }
}

class ToIndexedSequence extends IndexedSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  includes(value) {
    return this._iter.includes(value);
  }
  __iterateUncached(fn, reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(this);
    }
    const size = this.size;
    this._iter.__iterate((v) => {
      const ii = reverse ? size - ++i : i++;
      return fn(v, ii, this);
    }, reverse);
    return i;
  }
  __iteratorUncached(reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(this);
    }
    const size = this.size;
    return mapEntries(this._iter.__iterator(reverse), (k, v, entry) => {
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = v;
    });
  }
}

class ToSetSequence extends SetSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  has(key) {
    return this._iter.includes(key);
  }
  __iterateUncached(fn, reverse) {
    return this._iter.__iterate((v) => fn(v, v, this), reverse);
  }
  __iteratorUncached(reverse) {
    return mapEntries(this._iter.__iterator(reverse), (k, v, entry) => {
      entry[0] = v;
      entry[1] = v;
    });
  }
}

class FromEntriesSequence extends KeyedSeqImpl {
  constructor(entries) {
    super();
    this._iter = entries;
    this.size = entries.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  entrySeq() {
    return this._iter.toSeq();
  }
  __iterateUncached(fn, reverse) {
    let iterations = 0;
    this._iter.__iterate((entry) => {
      if (entry) {
        validateEntry(entry);
        iterations++;
        const indexedCollection = isCollection(entry);
        return fn(indexedCollection ? entry.get(1) : entry[1], indexedCollection ? entry.get(0) : entry[0], this);
      }
    }, reverse);
    return iterations;
  }
  __iteratorUncached(reverse) {
    const iterator = this._iter.__iterator(reverse);
    return makeEntryIterator((out) => {
      while (true) {
        const step = iterator.next();
        if (step.done) {
          return false;
        }
        const entry = step.value[1];
        if (entry) {
          validateEntry(entry);
          const indexedCollection = isCollection(entry);
          out[0] = indexedCollection ? entry.get(0) : entry[0];
          out[1] = indexedCollection ? entry.get(1) : entry[1];
          return true;
        }
      }
    });
  }
}
function cacheResultThrough() {
  if (this._iter.cacheResult) {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }
  return SeqImpl.prototype.cacheResult.call(this);
}
function validateEntry(entry) {
  if (entry !== Object(entry)) {
    throw new TypeError(`Expected [K, V] tuple: ${entry}`);
  }
}
var Map2 = (value) => value === undefined || value === null ? emptyMap() : isMap(value) && !isOrdered(value) ? value : emptyMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});

class MapImpl extends KeyedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      merge,
      mergeWith,
      mergeDeep,
      mergeDeepWith,
      mergeDeepIn,
      mergeIn,
      setIn,
      update,
      updateIn,
      wasAltered,
      withMutations,
      removeIn: deleteIn,
      concat: merge,
      [IS_MAP_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      removeAll: this.prototype.deleteAll,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.Map"
    });
  }
  constructor(size, root, ownerID, hash2) {
    super();
    this.size = size;
    this._root = root;
    this.__ownerID = ownerID;
    this.__hash = hash2;
    this.__altered = false;
  }
  create(value) {
    return Map2(value);
  }
  toString() {
    return this.__toString("Map {", "}");
  }
  get(k, notSetValue) {
    return this._root ? this._root.get(0, hash(k), k, notSetValue) : notSetValue;
  }
  set(k, v) {
    return updateMap(this, k, v);
  }
  remove(k) {
    return updateMap(this, k, NOT_SET);
  }
  deleteAll(keys) {
    const collection = Collection(keys);
    if (collection.size === 0) {
      return this;
    }
    return this.withMutations((map) => {
      collection.forEach((key) => map.remove(key));
    });
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._root = null;
      this.__hash = undefined;
      this.__altered = true;
      return this;
    }
    return emptyMap();
  }
  map(mapper, context) {
    return this.withMutations((map) => {
      map.forEach((value, key) => {
        map.set(key, mapper.call(context, value, key, this));
      });
    });
  }
  keys() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false, 0);
  }
  values() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false, 1);
  }
  entries() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false);
  }
  __iterator(reverse) {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, reverse);
  }
  __iterate(fn, reverse) {
    let iterations = 0;
    if (this._root) {
      this._root.iterate(([key, value]) => {
        iterations++;
        return fn(value, key, this);
      }, reverse);
    }
    return iterations;
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyMap();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeMap(this.size, this._root, ownerID, this.__hash);
  }
}
Map2.isMap = isMap;

class ArrayMapNode {
  constructor(ownerID, entries) {
    this.ownerID = ownerID;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    return linearGet(this.entries, key, notSetValue);
  }
  iterate(fn, reverse) {
    return iterateLinearEntries(this.entries, fn, reverse);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (;idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed || !exists) {
      SetRef(didChangeSize);
    }
    if (removed && len === 1) {
      return;
    }
    if (!exists && !removed && len >= MAX_ARRAY_MAP_SIZE) {
      return createNodes(ownerID, entries, key, value);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : entries.slice();
    if (exists) {
      if (removed) {
        if (idx === len - 1) {
          newEntries.pop();
        } else {
          newEntries[idx] = newEntries.pop();
        }
      } else {
        newEntries[idx] = [key, value];
      }
    } else {
      newEntries.push([key, value]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new ArrayMapNode(ownerID, newEntries);
  }
}

class BitmapIndexedNode {
  constructor(ownerID, bitmap, nodes) {
    this.ownerID = ownerID;
    this.bitmap = bitmap;
    this.nodes = nodes;
  }
  iterate(fn, reverse) {
    return iterateNodeArray(this.nodes, fn, reverse);
  }
  get(shift, keyHash, key, notSetValue) {
    const bit = 1 << ((shift === 0 ? keyHash : keyHash >>> shift) & MASK);
    const bitmap = this.bitmap;
    return (bitmap & bit) === 0 ? notSetValue : this.nodes[popCount(bitmap & bit - 1)].get(shift + SHIFT, keyHash, key, notSetValue);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const keyHashFrag = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const bit = 1 << keyHashFrag;
    const bitmap = this.bitmap;
    const exists = (bitmap & bit) !== 0;
    if (!exists && value === NOT_SET) {
      return this;
    }
    const idx = popCount(bitmap & bit - 1);
    const nodes = this.nodes;
    const node = exists ? nodes[idx] : undefined;
    const newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);
    if (newNode === node) {
      return this;
    }
    if (!exists && newNode && nodes.length >= MAX_BITMAP_INDEXED_SIZE) {
      return expandNodes(ownerID, nodes, bitmap, keyHashFrag, newNode);
    }
    if (exists && !newNode && nodes.length === 2 && isLeafNode(nodes[idx ^ 1])) {
      return nodes[idx ^ 1];
    }
    if (exists && newNode && nodes.length === 1 && isLeafNode(newNode)) {
      return newNode;
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newBitmap = exists ? newNode ? bitmap : bitmap ^ bit : bitmap | bit;
    const newNodes = exists ? newNode ? setAt(nodes, idx, newNode, isEditable) : spliceOut(nodes, idx, isEditable) : spliceIn(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.bitmap = newBitmap;
      this.nodes = newNodes;
      return this;
    }
    return new BitmapIndexedNode(ownerID, newBitmap, newNodes);
  }
}

class HashArrayMapNode {
  constructor(ownerID, count, nodes) {
    this.ownerID = ownerID;
    this.count = count;
    this.nodes = nodes;
  }
  iterate(fn, reverse) {
    return iterateNodeArray(this.nodes, fn, reverse);
  }
  get(shift, keyHash, key, notSetValue) {
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const node = this.nodes[idx];
    return node ? node.get(shift + SHIFT, keyHash, key, notSetValue) : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const removed = value === NOT_SET;
    const nodes = this.nodes;
    const node = nodes[idx];
    if (removed && !node) {
      return this;
    }
    const newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);
    if (newNode === node) {
      return this;
    }
    let newCount = this.count;
    if (!node) {
      newCount++;
    } else if (!newNode) {
      newCount--;
      if (newCount < MIN_HASH_ARRAY_MAP_SIZE) {
        return packNodes(ownerID, nodes, newCount, idx);
      }
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newNodes = setAt(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.count = newCount;
      this.nodes = newNodes;
      return this;
    }
    return new HashArrayMapNode(ownerID, newCount, newNodes);
  }
}

class HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    return linearGet(this.entries, key, notSetValue);
  }
  iterate(fn, reverse) {
    return iterateLinearEntries(this.entries, fn, reverse);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash !== this.keyHash) {
      if (value === NOT_SET) {
        return this;
      }
      SetRef(didAlter);
      SetRef(didChangeSize);
      return mergeIntoNode(this, ownerID, shift, keyHash, [key, value]);
    }
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (;idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed || !exists) {
      SetRef(didChangeSize);
    }
    if (removed && len === 2) {
      return new ValueNode(ownerID, this.keyHash, entries[idx ^ 1]);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : entries.slice();
    if (exists) {
      if (removed) {
        if (idx === len - 1) {
          newEntries.pop();
        } else {
          newEntries[idx] = newEntries.pop();
        }
      } else {
        newEntries[idx] = [key, value];
      }
    } else {
      newEntries.push([key, value]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new HashCollisionNode(ownerID, this.keyHash, newEntries);
  }
}

class ValueNode {
  constructor(ownerID, keyHash, entry) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entry = entry;
  }
  iterate(fn, _reverse) {
    return fn(this.entry);
  }
  get(shift, keyHash, key, notSetValue) {
    return is(key, this.entry[0]) ? this.entry[1] : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const keyMatch = is(key, this.entry[0]);
    if (keyMatch ? value === this.entry[1] : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed) {
      SetRef(didChangeSize);
      return;
    }
    if (keyMatch) {
      if (ownerID && ownerID === this.ownerID) {
        this.entry[1] = value;
        return this;
      }
      return new ValueNode(ownerID, this.keyHash, [key, value]);
    }
    SetRef(didChangeSize);
    return mergeIntoNode(this, ownerID, shift, hash(key), [key, value]);
  }
}
function linearGet(entries, key, notSetValue) {
  for (let ii = 0, len = entries.length;ii < len; ii++) {
    if (is(key, entries[ii][0])) {
      return entries[ii][1];
    }
  }
  return notSetValue;
}
function iterateLinearEntries(entries, fn, reverse) {
  for (let ii = 0, maxIndex = entries.length - 1;ii <= maxIndex; ii++) {
    if (fn(entries[reverse ? maxIndex - ii : ii]) === false) {
      return false;
    }
  }
}
function iterateNodeArray(nodes, fn, reverse) {
  for (let ii = 0, maxIndex = nodes.length - 1;ii <= maxIndex; ii++) {
    const node = nodes[reverse ? maxIndex - ii : ii];
    if (node?.iterate(fn, reverse) === false) {
      return false;
    }
  }
}
function mapIteratorGenerator(node, reverse, entryIndex) {
  let stack = {
    node,
    index: 0,
    __prev: null
  };
  const extractValue = entryIndex !== undefined ? (entry) => entry[entryIndex] : (entry) => entry;
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    while (stack) {
      const node2 = stack.node;
      const index = stack.index++;
      let maxIndex;
      if (node2.entry) {
        if (index === 0) {
          result.value = extractValue(node2.entry);
          return result;
        }
      } else if (node2.entries) {
        maxIndex = node2.entries.length - 1;
        if (index <= maxIndex) {
          result.value = extractValue(node2.entries[reverse ? maxIndex - index : index]);
          return result;
        }
      } else {
        maxIndex = node2.nodes.length - 1;
        if (index <= maxIndex) {
          const subNode = node2.nodes[reverse ? maxIndex - index : index];
          if (subNode) {
            if (subNode.entry) {
              result.value = extractValue(subNode.entry);
              return result;
            }
            stack = {
              node: subNode,
              index: 0,
              __prev: stack
            };
          }
          continue;
        }
      }
      stack = stack.__prev;
    }
    return DONE;
  });
}
var makeMap = (size, root, ownerID, hash2) => new MapImpl(size, root, ownerID, hash2);
var EMPTY_MAP;
var emptyMap = () => EMPTY_MAP || (EMPTY_MAP = makeMap(0));
function updateMap(map, k, v) {
  let newRoot;
  let newSize;
  if (!map._root) {
    if (v === NOT_SET) {
      return map;
    }
    newSize = 1;
    newRoot = new ArrayMapNode(map.__ownerID, [[k, v]]);
  } else {
    const didChangeSize = MakeRef();
    const didAlter = MakeRef();
    newRoot = updateNode(map._root, map.__ownerID, 0, hash(k), k, v, didChangeSize, didAlter);
    if (!didAlter.value) {
      return map;
    }
    newSize = map.size + (didChangeSize.value ? v === NOT_SET ? -1 : 1 : 0);
  }
  if (map.__ownerID) {
    map.size = newSize;
    map._root = newRoot;
    map.__hash = undefined;
    map.__altered = true;
    return map;
  }
  return newRoot ? makeMap(newSize, newRoot) : emptyMap();
}
function updateNode(node, ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
  if (!node) {
    if (value === NOT_SET) {
      return node;
    }
    SetRef(didAlter);
    SetRef(didChangeSize);
    return new ValueNode(ownerID, keyHash, [key, value]);
  }
  return node.update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter);
}
var isLeafNode = (node) => node.constructor === ValueNode || node.constructor === HashCollisionNode;
function mergeIntoNode(node, ownerID, shift, keyHash, entry) {
  if (node.keyHash === keyHash) {
    return new HashCollisionNode(ownerID, keyHash, [node.entry, entry]);
  }
  const idx1 = (shift === 0 ? node.keyHash : node.keyHash >>> shift) & MASK;
  const idx2 = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
  const newNode = new ValueNode(ownerID, keyHash, entry);
  const nodes = idx1 === idx2 ? [mergeIntoNode(node, ownerID, shift + SHIFT, keyHash, entry)] : idx1 < idx2 ? [node, newNode] : [newNode, node];
  return new BitmapIndexedNode(ownerID, 1 << idx1 | 1 << idx2, nodes);
}
function createNodes(ownerID, entries, key, value) {
  if (!ownerID) {
    ownerID = new OwnerID;
  }
  let node = new ValueNode(ownerID, hash(key), [key, value]);
  for (const [k, v] of entries) {
    node = node.update(ownerID, 0, hash(k), k, v);
  }
  return node;
}
function packNodes(ownerID, nodes, count, excluding) {
  let bitmap = 0;
  let packedII = 0;
  const packedNodes = new Array(count);
  for (let ii = 0, bit = 1, len = nodes.length;ii < len; ii++, bit <<= 1) {
    const node = nodes[ii];
    if (node !== undefined && ii !== excluding) {
      bitmap |= bit;
      packedNodes[packedII++] = node;
    }
  }
  return new BitmapIndexedNode(ownerID, bitmap, packedNodes);
}
function expandNodes(ownerID, nodes, bitmap, including, node) {
  let count = 0;
  const expandedNodes = new Array(SIZE);
  for (let ii = 0;bitmap !== 0; ii++, bitmap >>>= 1) {
    expandedNodes[ii] = bitmap & 1 ? nodes[count++] : undefined;
  }
  expandedNodes[including] = node;
  return new HashArrayMapNode(ownerID, count + 1, expandedNodes);
}
function popCount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function setAt(array, idx, val, canEdit) {
  const newArray = canEdit ? array : array.slice();
  newArray[idx] = val;
  return newArray;
}
function spliceIn(array, idx, val, canEdit) {
  const newLen = array.length + 1;
  if (canEdit && idx + 1 === newLen) {
    array[idx] = val;
    return array;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0;ii < newLen; ii++) {
    if (ii === idx) {
      newArray[ii] = val;
      after = -1;
    } else {
      newArray[ii] = array[ii + after];
    }
  }
  return newArray;
}
function spliceOut(array, idx, canEdit) {
  const newLen = array.length - 1;
  if (canEdit && idx === newLen) {
    array.pop();
    return array;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0;ii < newLen; ii++) {
    if (ii === idx) {
      after = 1;
    }
    newArray[ii] = array[ii + after];
  }
  return newArray;
}
var MAX_ARRAY_MAP_SIZE = SIZE / 4;
var MAX_BITMAP_INDEXED_SIZE = SIZE / 2;
var MIN_HASH_ARRAY_MAP_SIZE = SIZE / 4;
function shallowCopy(from) {
  if (Array.isArray(from)) {
    return from.slice();
  }
  return {
    ...from
  };
}
var merge$1 = (collection, ...sources) => mergeWithSources(collection, sources);
var mergeWith$1 = (merger, collection, ...sources) => mergeWithSources(collection, sources, merger);
var mergeDeepWithSources = (collection, sources, merger) => mergeWithSources(collection, sources, deepMergerWith(merger));
var mergeDeep$1 = (collection, ...sources) => mergeDeepWithSources(collection, sources);
var mergeDeepWith$1 = (merger, collection, ...sources) => mergeDeepWithSources(collection, sources, merger);
function mergeWithSources(collection, sources, merger) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot merge into non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    return typeof merger === "function" && collection.mergeWith ? collection.mergeWith(merger, ...sources) : collection.merge ? collection.merge(...sources) : collection.concat(...sources);
  }
  const isArray = Array.isArray(collection);
  let merged = collection;
  const Collection2 = isArray ? IndexedCollection : KeyedCollection;
  const mergeItem = isArray ? (value) => {
    if (merged === collection) {
      merged = shallowCopy(merged);
    }
    merged.push(value);
  } : (value, key) => {
    const hasVal = Object.hasOwn(merged, key);
    const nextVal = hasVal && merger ? merger(merged[key], value, key) : value;
    if (!hasVal || nextVal !== merged[key]) {
      if (merged === collection) {
        merged = shallowCopy(merged);
      }
      merged[key] = nextVal;
    }
  };
  for (const source of sources) {
    Collection2(source).forEach(mergeItem);
  }
  return merged;
}
function deepMergerWith(merger) {
  function deepMerger(oldValue, newValue, key) {
    return isDataStructure(oldValue) && isDataStructure(newValue) && areMergeable(oldValue, newValue) ? mergeWithSources(oldValue, [newValue], deepMerger) : merger ? merger(oldValue, newValue, key) : newValue;
  }
  return deepMerger;
}
function areMergeable(oldDataStructure, newDataStructure) {
  const oldSeq = Seq(oldDataStructure);
  const newSeq = Seq(newDataStructure);
  return isIndexed(oldSeq) === isIndexed(newSeq) && isKeyed(oldSeq) === isKeyed(newSeq);
}
function remove(collection, key) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot update non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    if (!collection.remove) {
      throw new TypeError(`Cannot update immutable value without .remove() method: ${collection}`);
    }
    return collection.remove(key);
  }
  if (!Object.hasOwn(collection, key)) {
    return collection;
  }
  const collectionCopy = shallowCopy(collection);
  if (Array.isArray(collectionCopy)) {
    collectionCopy.splice(key, 1);
  } else {
    delete collectionCopy[key];
  }
  return collectionCopy;
}
function set(collection, key, value) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot update non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    if (!collection.set) {
      throw new TypeError(`Cannot update immutable value without .set() method: ${collection}`);
    }
    return collection.set(key, value);
  }
  if (Object.hasOwn(collection, key) && value === collection[key]) {
    return collection;
  }
  const collectionCopy = shallowCopy(collection);
  collectionCopy[key] = value;
  return collectionCopy;
}
function updateIn$1(collection, keyPath, notSetValue, updater) {
  if (!updater) {
    updater = notSetValue;
    notSetValue = undefined;
  }
  const updatedValue = updateInDeeply(isImmutable(collection), collection, coerceKeyPath(keyPath), 0, notSetValue, updater);
  return updatedValue === NOT_SET ? notSetValue : updatedValue;
}
function updateInDeeply(inImmutable, existing, keyPath, i, notSetValue, updater) {
  const wasNotSet = existing === NOT_SET;
  if (i === keyPath.length) {
    const existingValue = wasNotSet ? notSetValue : existing;
    const newValue = updater(existingValue);
    return newValue === existingValue ? existing : newValue;
  }
  if (!wasNotSet && !isDataStructure(existing)) {
    throw new TypeError(`Cannot update within non-data-structure value in path [${Array.from(keyPath).slice(0, i).map(quoteString)}]: ${existing}`);
  }
  const key = keyPath[i];
  const nextExisting = wasNotSet ? NOT_SET : get(existing, key, NOT_SET);
  const nextUpdated = updateInDeeply(nextExisting === NOT_SET ? inImmutable : isImmutable(nextExisting), nextExisting, keyPath, i + 1, notSetValue, updater);
  if (nextUpdated === nextExisting) {
    return existing;
  }
  if (nextUpdated === NOT_SET) {
    return remove(existing, key);
  }
  const collection = wasNotSet ? inImmutable ? emptyMap() : {} : existing;
  return set(collection, key, nextUpdated);
}
var removeIn = (collection, keyPath) => updateIn$1(collection, keyPath, () => NOT_SET);
var setIn$1 = (collection, keyPath, value) => updateIn$1(collection, keyPath, NOT_SET, () => value);
function update$1(collection, key, notSetValue, updater) {
  return updateIn$1(collection, [key], notSetValue, updater);
}
function asImmutable() {
  return this.__ensureOwner();
}
function asMutable() {
  return this.__ownerID ? this : this.__ensureOwner(new OwnerID);
}
function wasAltered() {
  return this.__altered;
}
function withMutations(fn) {
  const mutable = this.asMutable();
  fn(mutable);
  return mutable.wasAltered() ? mutable.__ensureOwner(this.__ownerID) : this;
}
function getIn(searchKeyPath, notSetValue) {
  return getIn$1(this, searchKeyPath, notSetValue);
}
function hasIn(searchKeyPath) {
  return hasIn$1(this, searchKeyPath);
}
function deleteIn(keyPath) {
  return removeIn(this, keyPath);
}
function setIn(keyPath, v) {
  return setIn$1(this, keyPath, v);
}
function update(key, notSetValue, updater) {
  return typeof key === "function" ? key(this) : update$1(this, key, notSetValue, updater);
}
function updateIn(keyPath, notSetValue, updater) {
  return updateIn$1(this, keyPath, notSetValue, updater);
}
function toObject() {
  assertNotInfinite(this.size);
  const object = {};
  this.__iterate((v, k) => {
    object[k] = v;
  });
  return object;
}
function merge(...iters) {
  return mergeIntoKeyedWith(this, iters);
}
function mergeWith(merger, ...iters) {
  if (typeof merger !== "function") {
    throw new TypeError(`Invalid merger function: ${merger}`);
  }
  return mergeIntoKeyedWith(this, iters, merger);
}
function mergeIntoKeyedWith(collection, collections, merger) {
  const iters = [];
  for (const item of collections) {
    const collection2 = KeyedCollection(item);
    if (collection2.size !== 0) {
      iters.push(collection2);
    }
  }
  if (iters.length === 0) {
    return collection;
  }
  if (collection.toSeq().size === 0 && !collection.__ownerID && iters.length === 1) {
    return isRecord(collection) ? collection : collection.create(iters[0]);
  }
  return collection.withMutations((collection2) => {
    const mergeIntoCollection = merger ? (value, key) => {
      update$1(collection2, key, NOT_SET, (oldVal) => oldVal === NOT_SET ? value : merger(oldVal, value, key));
    } : (value, key) => {
      collection2.set(key, value);
    };
    for (const iter of iters) {
      iter.forEach(mergeIntoCollection);
    }
  });
}
function mergeDeep(...iters) {
  return mergeDeepWithSources(this, iters);
}
function mergeDeepWith(merger, ...iters) {
  return mergeDeepWithSources(this, iters, merger);
}
function mergeIn(keyPath, ...iters) {
  return updateIn$1(this, keyPath, emptyMap(), (m) => mergeWithSources(m, iters));
}
function mergeDeepIn(keyPath, ...iters) {
  return updateIn$1(this, keyPath, emptyMap(), (m) => mergeDeepWithSources(m, iters));
}
function mixin(Class, methods) {
  Object.assign(Class.prototype, methods);
}
var List = (value) => {
  const empty = emptyList();
  if (value === undefined || value === null) {
    return empty;
  }
  if (isList(value)) {
    return value;
  }
  const iter = IndexedCollection(value);
  const size = iter.size;
  if (size === 0) {
    return empty;
  }
  assertNotInfinite(size);
  if (size > 0 && size < SIZE) {
    return makeList(0, size, SHIFT, null, new VNode(iter.toArray()));
  }
  return empty.withMutations((list) => {
    list.setSize(size);
    iter.forEach((v, i) => list.set(i, v));
  });
};
List.of = (...values) => List(values);

class ListImpl extends IndexedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      mergeDeepIn,
      mergeIn,
      setIn,
      update,
      updateIn,
      wasAltered,
      withMutations,
      removeIn: deleteIn,
      [IS_LIST_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      merge: this.prototype.concat,
      [Symbol.toStringTag]: "Immutable.List",
      [Symbol.iterator]: this.prototype.values
    });
  }
  constructor(origin, capacity, level, root, tail, ownerID, hash2) {
    super();
    this.size = capacity - origin;
    this._origin = origin;
    this._capacity = capacity;
    this._level = level;
    this._root = root;
    this._tail = tail;
    this.__ownerID = ownerID;
    this.__hash = hash2;
    this.__altered = false;
  }
  create(value) {
    return List(value);
  }
  toString() {
    return this.__toString("List [", "]");
  }
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    if (index >= 0 && index < this.size) {
      index += this._origin;
      const node = listNodeFor(this, index);
      return node?.array[index & MASK];
    }
    return notSetValue;
  }
  set(index, value) {
    return updateList(this, index, value);
  }
  remove(index) {
    return !this.has(index) ? this : index === 0 ? this.shift() : index === this.size - 1 ? this.pop() : this.splice(index, 1);
  }
  insert(index, value) {
    return this.splice(index, 0, value);
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = this._origin = this._capacity = 0;
      this._level = SHIFT;
      this._root = this._tail = this.__hash = undefined;
      this.__altered = true;
      return this;
    }
    return emptyList();
  }
  push(...values) {
    const oldSize = this.size;
    return this.withMutations((list) => {
      setListBounds(list, 0, oldSize + values.length);
      for (let ii = 0;ii < values.length; ii++) {
        list.set(oldSize + ii, values[ii]);
      }
    });
  }
  pop() {
    return setListBounds(this, 0, -1);
  }
  unshift(...values) {
    return this.withMutations((list) => {
      setListBounds(list, -values.length);
      for (let ii = 0;ii < values.length; ii++) {
        list.set(ii, values[ii]);
      }
    });
  }
  shift() {
    return setListBounds(this, 1);
  }
  shuffle(random = Math.random) {
    return this.withMutations((mutable) => {
      let current = mutable.size;
      let destination;
      let tmp;
      while (current) {
        destination = Math.floor(random() * current--);
        tmp = mutable.get(destination);
        mutable.set(destination, mutable.get(current));
        mutable.set(current, tmp);
      }
    });
  }
  concat(...collections) {
    const seqs = [];
    for (const collection of collections) {
      const seq = IndexedCollection(typeof collection !== "string" && hasIterator(collection) ? collection : [collection]);
      if (seq.size !== 0) {
        seqs.push(seq);
      }
    }
    if (seqs.length === 0) {
      return this;
    }
    if (this.size === 0 && !this.__ownerID && seqs.length === 1) {
      return List(seqs[0]);
    }
    return this.withMutations((list) => {
      seqs.forEach((seq) => seq.forEach((value) => list.push(value)));
    });
  }
  setSize(size) {
    return setListBounds(this, 0, size);
  }
  map(mapper, context) {
    return this.withMutations((list) => {
      for (let i = 0;i < this.size; i++) {
        list.set(i, mapper.call(context, list.get(i), i, this));
      }
    });
  }
  slice(begin, end) {
    const size = this.size;
    if (wholeSlice(begin, end, size)) {
      return this;
    }
    return setListBounds(this, resolveBegin(begin, size), resolveEnd(end, size));
  }
  __iterate(fn, reverse) {
    let index = reverse ? this.size : 0;
    iterateListCallback(this, (value) => fn(value, reverse ? --index : index++, this), reverse);
    return reverse ? this.size - index : index;
  }
  __iterator(reverse) {
    let index = reverse ? this.size : 0;
    const iter = iterateList(this, reverse);
    return makeEntryIterator((entry) => {
      const step = iter.next();
      if (step.done) {
        return false;
      }
      entry[0] = reverse ? --index : index++;
      entry[1] = step.value;
      return true;
    });
  }
  values() {
    return iterateList(this, false);
  }
  keys() {
    return makeIndexKeys(this.size);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyList();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeList(this._origin, this._capacity, this._level, this._root, this._tail, ownerID, this.__hash);
  }
}
List.isList = isList;

class VNode {
  constructor(array, ownerID) {
    this.array = array;
    this.ownerID = ownerID;
  }
  removeBefore(ownerID, level, index) {
    if ((index & (1 << level + SHIFT) - 1) === 0 || this.array.length === 0) {
      return this;
    }
    const originIndex = index >>> level & MASK;
    if (originIndex >= this.array.length) {
      return new VNode([], ownerID);
    }
    const removingFirst = originIndex === 0;
    let newChild;
    if (level > 0) {
      const oldChild = this.array[originIndex];
      newChild = oldChild?.removeBefore(ownerID, level - SHIFT, index);
      if (newChild === oldChild && removingFirst) {
        return this;
      }
    }
    if (removingFirst && !newChild) {
      return this;
    }
    const editable = editableVNode(this, ownerID);
    if (!removingFirst) {
      for (let ii = 0;ii < originIndex; ii++) {
        editable.array[ii] = undefined;
      }
    }
    if (newChild) {
      editable.array[originIndex] = newChild;
    }
    return editable;
  }
  removeAfter(ownerID, level, index) {
    if (index === (level ? 1 << level + SHIFT : SIZE) || this.array.length === 0) {
      return this;
    }
    const sizeIndex = index - 1 >>> level & MASK;
    if (sizeIndex >= this.array.length) {
      return this;
    }
    let newChild;
    if (level > 0) {
      const oldChild = this.array[sizeIndex];
      newChild = oldChild?.removeAfter(ownerID, level - SHIFT, index);
      if (newChild === oldChild && sizeIndex === this.array.length - 1) {
        return this;
      }
    }
    const editable = editableVNode(this, ownerID);
    editable.array.splice(sizeIndex + 1);
    if (newChild) {
      editable.array[sizeIndex] = newChild;
    }
    return editable;
  }
}
function iterateList(list, reverse) {
  const left = list._origin;
  const right = list._capacity;
  const tailPos = getTailOffset(right);
  const tail = list._tail;
  const stack = [];
  pushFrame(list._root, list._level, 0);
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.from === frame.to) {
        stack.pop();
        continue;
      }
      const idx = reverse ? --frame.to : frame.from++;
      if (frame.isLeaf) {
        result.value = frame.array?.[idx];
        return result;
      }
      const childNode = frame.array?.[idx];
      const childLevel = frame.level - SHIFT;
      const childOffset = frame.offset + (idx << frame.level);
      pushFrame(childNode, childLevel, childOffset);
    }
    return DONE;
  });
  function pushFrame(node, level, offset) {
    if (level === 0) {
      const array = offset === tailPos ? tail?.array : node?.array;
      const from = offset > left ? 0 : left - offset;
      let to = right - offset;
      if (to > SIZE) {
        to = SIZE;
      }
      if (from !== to) {
        stack.push({
          array,
          from,
          to,
          isLeaf: true
        });
      }
    } else {
      const array = node?.array;
      const from = offset > left ? 0 : left - offset >> level;
      let to = (right - offset >> level) + 1;
      if (to > SIZE) {
        to = SIZE;
      }
      if (from !== to) {
        stack.push({
          array,
          from,
          to,
          level,
          offset,
          isLeaf: false
        });
      }
    }
  }
}
function iterateListCallback(list, fn, reverse) {
  const left = list._origin;
  const right = list._capacity;
  const tailPos = getTailOffset(right);
  const tail = list._tail;
  const level = list._level;
  const root = list._root;
  return level === 0 ? iterateLeaf(root, 0, left, right, tailPos, tail, fn, reverse) : iterateNode(root, level, 0, left, right, tailPos, tail, fn, reverse);
}
function iterateLeaf(node, offset, left, right, tailPos, tail, fn, reverse) {
  const array = offset === tailPos ? tail?.array : node?.array;
  let from = offset > left ? 0 : left - offset;
  let to = right - offset;
  if (to > SIZE) {
    to = SIZE;
  }
  while (from !== to) {
    const idx = reverse ? --to : from++;
    if (fn(array?.[idx]) === false) {
      return false;
    }
  }
}
function iterateNode(node, level, offset, left, right, tailPos, tail, fn, reverse) {
  const array = node?.array;
  let from = offset > left ? 0 : left - offset >> level;
  let to = (right - offset >> level) + 1;
  if (to > SIZE) {
    to = SIZE;
  }
  const nextLevel = level - SHIFT;
  while (from !== to) {
    const idx = reverse ? --to : from++;
    const nextOffset = offset + (idx << level);
    if ((nextLevel === 0 ? iterateLeaf(array?.[idx], nextOffset, left, right, tailPos, tail, fn, reverse) : iterateNode(array?.[idx], nextLevel, nextOffset, left, right, tailPos, tail, fn, reverse)) === false) {
      return false;
    }
  }
}
var makeList = (origin, capacity, level, root, tail, ownerID, hash2) => new ListImpl(origin, capacity, level, root, tail, ownerID, hash2);
var emptyList = () => makeList(0, 0, SHIFT);
function updateList(list, index, value) {
  index = wrapIndex(list, index);
  if (Number.isNaN(index)) {
    return list;
  }
  if (index >= list.size || index < 0) {
    return list.withMutations((list2) => {
      if (index < 0) {
        setListBounds(list2, index).set(0, value);
      } else {
        setListBounds(list2, 0, index + 1).set(index, value);
      }
    });
  }
  index += list._origin;
  let newTail = list._tail;
  let newRoot = list._root;
  const didAlter = MakeRef();
  if (index >= getTailOffset(list._capacity)) {
    newTail = updateVNode(newTail, list.__ownerID, 0, index, value, didAlter);
  } else {
    newRoot = updateVNode(newRoot, list.__ownerID, list._level, index, value, didAlter);
  }
  if (!didAlter.value) {
    return list;
  }
  if (list.__ownerID) {
    list._root = newRoot;
    list._tail = newTail;
    list.__hash = undefined;
    list.__altered = true;
    return list;
  }
  return makeList(list._origin, list._capacity, list._level, newRoot, newTail);
}
function updateVNode(node, ownerID, level, index, value, didAlter) {
  const idx = index >>> level & MASK;
  const nodeHas = node && idx < node.array.length;
  if (!nodeHas && value === undefined) {
    return node;
  }
  let newNode;
  if (level > 0) {
    const lowerNode = node?.array[idx];
    const newLowerNode = updateVNode(lowerNode, ownerID, level - SHIFT, index, value, didAlter);
    if (newLowerNode === lowerNode) {
      return node;
    }
    newNode = editableVNode(node, ownerID);
    newNode.array[idx] = newLowerNode;
    return newNode;
  }
  if (nodeHas && node.array[idx] === value) {
    return node;
  }
  if (didAlter) {
    SetRef(didAlter);
  }
  newNode = editableVNode(node, ownerID);
  if (value === undefined && idx === newNode.array.length - 1) {
    newNode.array.pop();
  } else {
    newNode.array[idx] = value;
  }
  return newNode;
}
function editableVNode(node, ownerID) {
  if (ownerID && ownerID === node?.ownerID) {
    return node;
  }
  return new VNode(node?.array.slice() ?? [], ownerID);
}
function listNodeFor(list, rawIndex) {
  if (rawIndex >= getTailOffset(list._capacity)) {
    return list._tail;
  }
  if (rawIndex < 1 << list._level + SHIFT) {
    let node = list._root;
    let level = list._level;
    while (node && level > 0) {
      node = node.array[rawIndex >>> level & MASK];
      level -= SHIFT;
    }
    return node;
  }
}
function setListBounds(list, begin, end) {
  if (begin !== undefined) {
    begin |= 0;
  }
  if (end !== undefined) {
    end |= 0;
  }
  const owner = list.__ownerID || new OwnerID;
  let oldOrigin = list._origin;
  let oldCapacity = list._capacity;
  let newOrigin = oldOrigin + begin;
  let newCapacity = end === undefined ? oldCapacity : end < 0 ? oldCapacity + end : oldOrigin + end;
  if (newOrigin === oldOrigin && newCapacity === oldCapacity) {
    return list;
  }
  if (newOrigin >= newCapacity) {
    return list.clear();
  }
  let newLevel = list._level;
  let newRoot = list._root;
  let offsetShift = 0;
  while (newOrigin + offsetShift < 0) {
    newRoot = new VNode(newRoot?.array.length ? [undefined, newRoot] : [], owner);
    newLevel += SHIFT;
    offsetShift += 1 << newLevel;
  }
  if (offsetShift) {
    newOrigin += offsetShift;
    oldOrigin += offsetShift;
    newCapacity += offsetShift;
    oldCapacity += offsetShift;
  }
  const oldTailOffset = getTailOffset(oldCapacity);
  const newTailOffset = getTailOffset(newCapacity);
  while (newTailOffset >= 1 << newLevel + SHIFT) {
    newRoot = new VNode(newRoot?.array.length ? [newRoot] : [], owner);
    newLevel += SHIFT;
  }
  const oldTail = list._tail;
  let newTail = newTailOffset < oldTailOffset ? listNodeFor(list, newCapacity - 1) : newTailOffset > oldTailOffset ? new VNode([], owner) : oldTail;
  if (oldTail && newTailOffset > oldTailOffset && newOrigin < oldCapacity && oldTail.array.length) {
    newRoot = editableVNode(newRoot, owner);
    let node = newRoot;
    for (let level = newLevel;level > SHIFT; level -= SHIFT) {
      const idx = oldTailOffset >>> level & MASK;
      node = node.array[idx] = editableVNode(node.array[idx], owner);
    }
    node.array[oldTailOffset >>> SHIFT & MASK] = oldTail;
  }
  if (newCapacity < oldCapacity) {
    newTail = newTail?.removeAfter(owner, 0, newCapacity);
  }
  if (newOrigin >= newTailOffset) {
    newOrigin -= newTailOffset;
    newCapacity -= newTailOffset;
    newLevel = SHIFT;
    newRoot = null;
    newTail = newTail?.removeBefore(owner, 0, newOrigin);
  } else if (newOrigin > oldOrigin || newTailOffset < oldTailOffset) {
    offsetShift = 0;
    while (newRoot) {
      const beginIndex = newOrigin >>> newLevel & MASK;
      if (beginIndex !== newTailOffset >>> newLevel & MASK) {
        break;
      }
      if (beginIndex) {
        offsetShift += (1 << newLevel) * beginIndex;
      }
      newLevel -= SHIFT;
      newRoot = newRoot.array[beginIndex];
    }
    if (newRoot && newOrigin > oldOrigin) {
      newRoot = newRoot.removeBefore(owner, newLevel, newOrigin - offsetShift);
    }
    if (newRoot && newTailOffset < oldTailOffset) {
      newRoot = newRoot.removeAfter(owner, newLevel, newTailOffset - offsetShift);
    }
    if (offsetShift) {
      newOrigin -= offsetShift;
      newCapacity -= offsetShift;
    }
  }
  if (list.__ownerID) {
    list.size = newCapacity - newOrigin;
    list._origin = newOrigin;
    list._capacity = newCapacity;
    list._level = newLevel;
    list._root = newRoot;
    list._tail = newTail;
    list.__hash = undefined;
    list.__altered = true;
    return list;
  }
  return makeList(newOrigin, newCapacity, newLevel, newRoot, newTail);
}
var getTailOffset = (size) => size < SIZE ? 0 : size - 1 >>> SHIFT << SHIFT;
var OrderedMap = (value) => value === undefined || value === null ? emptyOrderedMap() : isOrderedMap(value) ? value : emptyOrderedMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
OrderedMap.of = (...values) => OrderedMap(values);

class OrderedMapImpl extends MapImpl {
  static {
    mixin(this, {
      [IS_ORDERED_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.OrderedMap",
      keys: CollectionImpl.prototype.keys,
      values: CollectionImpl.prototype.values,
      __iterate: CollectionImpl.prototype.__iterate
    });
  }
  constructor(map, list, ownerID, hash2) {
    super(map ? map.size : 0, undefined, ownerID, hash2);
    this._map = map;
    this._list = list;
  }
  create(value) {
    return OrderedMap(value);
  }
  toString() {
    return this.__toString("OrderedMap {", "}");
  }
  get(k, notSetValue) {
    const index = this._map.get(k);
    return index !== undefined ? this._list.get(index)[1] : notSetValue;
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._map.clear();
      this._list.clear();
      this.__altered = true;
      return this;
    }
    return emptyOrderedMap();
  }
  set(k, v) {
    return updateOrderedMap(this, k, v);
  }
  remove(k) {
    return updateOrderedMap(this, k, NOT_SET);
  }
  entries() {
    return this.__iterator(false);
  }
  __iterator(reverse) {
    const listIter = this._list.__iterator(reverse);
    return makeEntryIterator((entry) => {
      while (true) {
        const step = listIter.next();
        if (step.done) {
          return false;
        }
        const e = step.value[1];
        if (e) {
          entry[0] = e[0];
          entry[1] = e[1];
          return true;
        }
      }
    });
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newMap = this._map.__ensureOwner(ownerID);
    const newList = this._list.__ensureOwner(ownerID);
    if (!ownerID) {
      if (this.size === 0) {
        return emptyOrderedMap();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      this._map = newMap;
      this._list = newList;
      return this;
    }
    return makeOrderedMap(newMap, newList, ownerID, this.__hash);
  }
}
OrderedMap.isOrderedMap = isOrderedMap;
var makeOrderedMap = (map, list, ownerID, hash2) => new OrderedMapImpl(map, list, ownerID, hash2);
var emptyOrderedMap = () => makeOrderedMap(emptyMap(), emptyList());
function updateOrderedMap(omap, k, v) {
  const { _map: map, _list: list } = omap;
  const i = map.get(k);
  const has2 = i !== undefined;
  let newMap;
  let newList;
  if (v === NOT_SET) {
    if (!has2) {
      return omap;
    }
    if (list.size >= SIZE && list.size >= map.size * 2) {
      const entries = [];
      list.forEach((entry, idx) => {
        if (entry !== undefined && i !== idx) {
          entries.push(entry);
        }
      });
      newList = emptyList().withMutations((l) => {
        for (let j = 0;j < entries.length; j++) {
          l.set(j, entries[j]);
        }
      });
      newMap = emptyMap().withMutations((m) => {
        for (let j = 0;j < entries.length; j++) {
          m.set(entries[j][0], j);
        }
      });
      if (omap.__ownerID) {
        newMap.__ownerID = newList.__ownerID = omap.__ownerID;
      }
    } else {
      newMap = map.remove(k);
      newList = i === list.size - 1 ? list.pop() : list.set(i, undefined);
    }
  } else if (has2) {
    if (v === list.get(i)[1]) {
      return omap;
    }
    newMap = map;
    newList = list.set(i, [k, v]);
  } else {
    const newIdx = list.size;
    newMap = map.set(k, newIdx);
    newList = list.set(newIdx, [k, v]);
  }
  if (omap.__ownerID) {
    omap.size = newMap.size;
    omap._map = newMap;
    omap._list = newList;
    omap.__hash = undefined;
    omap.__altered = true;
    return omap;
  }
  return makeOrderedMap(newMap, newList);
}
var Stack2 = (value) => value === undefined || value === null ? emptyStack() : isStack(value) ? value : emptyStack().pushAll(value);
Stack2.of = (...values) => Stack2(values);

class StackImpl extends IndexedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      wasAltered,
      withMutations,
      [IS_STACK_SYMBOL]: true,
      shift: this.prototype.pop,
      unshift: this.prototype.push,
      unshiftAll: this.prototype.pushAll,
      [Symbol.toStringTag]: "Immutable.Stack",
      [Symbol.iterator]: this.prototype.values
    });
  }
  constructor(size, head, ownerID, hash2) {
    super();
    this.size = size;
    this._head = head;
    this.__ownerID = ownerID;
    this.__hash = hash2;
    this.__altered = false;
  }
  create(value) {
    return Stack2(value);
  }
  toString() {
    return this.__toString("Stack [", "]");
  }
  get(index, notSetValue) {
    let head = this._head;
    index = wrapIndex(this, index);
    while (head && index--) {
      head = head.next;
    }
    return head ? head.value : notSetValue;
  }
  peek() {
    return this._head?.value;
  }
  push(...values) {
    if (values.length === 0) {
      return this;
    }
    const newSize = this.size + values.length;
    let head = this._head;
    for (let ii = values.length - 1;ii >= 0; ii--) {
      head = {
        value: values[ii],
        next: head
      };
    }
    return returnStack(this, newSize, head);
  }
  pushAll(iter) {
    iter = IndexedCollection(iter);
    if (iter.size === 0) {
      return this;
    }
    if (this.size === 0 && isStack(iter)) {
      return iter;
    }
    assertNotInfinite(iter.size);
    let newSize = this.size;
    let head = this._head;
    iter.__iterate((value) => {
      newSize++;
      head = {
        value,
        next: head
      };
    }, true);
    return returnStack(this, newSize, head);
  }
  pop() {
    return this.slice(1);
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._head = undefined;
      this.__hash = undefined;
      this.__altered = true;
      return this;
    }
    return emptyStack();
  }
  slice(begin, end) {
    if (wholeSlice(begin, end, this.size)) {
      return this;
    }
    let resolvedBegin = resolveBegin(begin, this.size);
    const resolvedEnd = resolveEnd(end, this.size);
    if (resolvedEnd !== this.size) {
      return IndexedCollectionImpl.prototype.slice.call(this, begin, end);
    }
    const newSize = this.size - resolvedBegin;
    let head = this._head;
    while (resolvedBegin--) {
      head = head.next;
    }
    return returnStack(this, newSize, head);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyStack();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeStack(this.size, this._head, ownerID, this.__hash);
  }
  __iterate(fn, reverse) {
    if (reverse) {
      const arr = this.toArray();
      const size = arr.length;
      let i = 0;
      while (i !== size) {
        if (fn(arr[size - ++i], size - i, this) === false) {
          break;
        }
      }
      return i;
    }
    let iterations = 0;
    let node = this._head;
    while (node) {
      if (fn(node.value, iterations++, this) === false) {
        break;
      }
      node = node.next;
    }
    return iterations;
  }
  __iterator(reverse) {
    if (reverse) {
      const arr = this.toArray();
      const size = arr.length;
      let i = 0;
      return makeEntryIterator((entry) => {
        if (i === size) {
          return false;
        }
        const ii = size - ++i;
        entry[0] = ii;
        entry[1] = arr[ii];
        return true;
      });
    }
    let iterations = 0;
    let node = this._head;
    return makeEntryIterator((entry) => {
      if (!node) {
        return false;
      }
      entry[0] = iterations++;
      entry[1] = node.value;
      node = node.next;
      return true;
    });
  }
  values() {
    let node = this._head;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (!node)
        return DONE;
      result.value = node.value;
      node = node.next;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
}
Stack2.isStack = isStack;
function returnStack(stack, newSize, head) {
  if (stack.__ownerID) {
    stack.size = newSize;
    stack._head = head;
    stack.__hash = undefined;
    stack.__altered = true;
    return stack;
  }
  return makeStack(newSize, head);
}
var makeStack = (size, head, ownerID, hash2) => new StackImpl(size, head, ownerID, hash2);
var EMPTY_STACK;
var emptyStack = () => EMPTY_STACK || (EMPTY_STACK = makeStack(0));
var Set2 = (value) => value === undefined || value === null ? emptySet() : isSet(value) && !isOrdered(value) ? value : emptySet().withMutations((set2) => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v) => set2.add(v));
});
Set2.of = (...values) => Set2(values);
Set2.fromKeys = (value) => Set2(KeyedCollection(value).keySeq());
Set2.intersect = (sets) => {
  sets = Collection(sets).toArray();
  return sets.length ? Set2(sets.pop()).intersect(...sets) : emptySet();
};
Set2.union = (sets) => {
  const setArray = Collection(sets).toArray();
  return setArray.length ? Set2(setArray.pop()).union(...setArray) : emptySet();
};

class SetImpl extends SetCollectionImpl {
  static {
    mixin(this, {
      withMutations,
      asImmutable,
      asMutable,
      [IS_SET_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      merge: this.prototype.union,
      concat: this.prototype.union,
      [Symbol.toStringTag]: "Immutable.Set"
    });
  }
  constructor(map, ownerID) {
    super();
    this.size = map ? map.size : 0;
    this._map = map;
    this.__ownerID = ownerID;
  }
  create(value) {
    return Set2(value);
  }
  toString() {
    return this.__toString("Set {", "}");
  }
  has(value) {
    return this._map.has(value);
  }
  add(value) {
    return updateSet(this, this._map.set(value, value));
  }
  remove(value) {
    return updateSet(this, this._map.remove(value));
  }
  clear() {
    return updateSet(this, this._map.clear());
  }
  map(mapper, context) {
    let didChanges = false;
    const newMap = updateSet(this, this._map.mapEntries(([, v]) => {
      const mapped = mapper.call(context, v, v, this);
      if (mapped !== v) {
        didChanges = true;
      }
      return [mapped, mapped];
    }, context));
    return didChanges ? newMap : this;
  }
  union(...iters) {
    iters = iters.filter((x) => x.size !== 0);
    if (iters.length === 0) {
      return this;
    }
    if (this.size === 0 && !this.__ownerID && iters.length === 1) {
      return Set2(iters[0]);
    }
    return this.withMutations((set2) => {
      for (const iter of iters) {
        if (typeof iter === "string") {
          set2.add(iter);
        } else {
          SetCollection(iter).forEach((value) => set2.add(value));
        }
      }
    });
  }
  intersect(...iters) {
    return filterByIters(this, iters, (value, sets) => !sets.every((iter) => iter.includes(value)));
  }
  subtract(...iters) {
    return filterByIters(this, iters, (value, sets) => sets.some((iter) => iter.includes(value)));
  }
  wasAltered() {
    return this._map.wasAltered();
  }
  __iterator(reverse) {
    return this._map.__iterator(reverse);
  }
  __empty() {
    return emptySet();
  }
  __make(map, ownerID) {
    return makeSet(map, ownerID);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newMap = this._map.__ensureOwner(ownerID);
    if (!ownerID) {
      if (this.size === 0) {
        return this.__empty();
      }
      this.__ownerID = ownerID;
      this._map = newMap;
      return this;
    }
    return this.__make(newMap, ownerID);
  }
}
Set2.isSet = isSet;
var makeSet = (map, ownerID) => new SetImpl(map, ownerID);
var EMPTY_SET;
var emptySet = () => EMPTY_SET || (EMPTY_SET = makeSet(emptyMap()));
function filterByIters(set2, iters, shouldRemove) {
  if (iters.length === 0) {
    return set2;
  }
  iters = iters.map((iter) => SetCollection(iter));
  return set2.withMutations((s) => {
    set2.forEach((value) => {
      if (shouldRemove(value, iters)) {
        s.remove(value);
      }
    });
  });
}
function updateSet(set2, newMap) {
  if (set2.__ownerID) {
    set2.size = newMap.size;
    set2._map = newMap;
    return set2;
  }
  return newMap === set2._map ? set2 : newMap.size === 0 ? set2.__empty() : set2.__make(newMap);
}
var OrderedSet = (value) => value === undefined || value === null ? emptyOrderedSet() : isOrderedSet(value) ? value : emptyOrderedSet().withMutations((set2) => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v) => set2.add(v));
});
OrderedSet.of = (...values) => OrderedSet(values);
OrderedSet.fromKeys = (value) => OrderedSet(KeyedCollection(value).keySeq());

class OrderedSetImpl extends SetImpl {
  static {
    mixin(this, {
      [IS_ORDERED_SYMBOL]: true,
      [Symbol.toStringTag]: "Immutable.OrderedSet",
      zip: IndexedCollectionPrototype.zip,
      zipWith: IndexedCollectionPrototype.zipWith,
      zipAll: IndexedCollectionPrototype.zipAll
    });
  }
  create(value) {
    return OrderedSet(value);
  }
  toString() {
    return this.__toString("OrderedSet {", "}");
  }
  __empty() {
    return emptyOrderedSet();
  }
  __make(map, ownerID) {
    return makeOrderedSet(map, ownerID);
  }
}
OrderedSet.isOrderedSet = isOrderedSet;
var makeOrderedSet = (map, ownerID) => new OrderedSetImpl(map, ownerID);
var emptyOrderedSet = () => makeOrderedSet(emptyOrderedMap());
var PairSorting = {
  LeftThenRight: -1,
  RightThenLeft: 1
};
function throwOnInvalidDefaultValues(defaultValues) {
  if (isRecord(defaultValues)) {
    throw new Error("Can not call `Record` with an immutable Record as default values. Use a plain javascript object instead.");
  }
  if (isImmutable(defaultValues)) {
    throw new Error("Can not call `Record` with an immutable Collection as default values. Use a plain javascript object instead.");
  }
  if (defaultValues === null || typeof defaultValues !== "object") {
    throw new Error("Can not call `Record` with a non-object as default values. Use a plain javascript object instead.");
  }
}
var Record = (defaultValues, name) => {
  let hasInitialized;
  throwOnInvalidDefaultValues(defaultValues);
  const RecordType = function Record2(values) {
    if (values instanceof RecordType) {
      return values;
    }
    if (!(this instanceof RecordType)) {
      return new RecordType(values);
    }
    if (!hasInitialized) {
      hasInitialized = true;
      const keys = Object.keys(defaultValues);
      const indices = RecordTypePrototype._indices = {};
      RecordTypePrototype._name = name;
      RecordTypePrototype._keys = keys;
      RecordTypePrototype._defaultValues = defaultValues;
      for (let i = 0;i < keys.length; i++) {
        const propName = keys[i];
        indices[propName] = i;
        if (RecordTypePrototype[propName]) {
          console.warn(`Cannot define ${recordName(this)} with property "${propName}" since that property name is part of the Record API.`);
        } else {
          setProp(RecordTypePrototype, propName);
        }
      }
    }
    this.__ownerID = undefined;
    this._values = List().withMutations((l) => {
      l.setSize(this._keys.length);
      KeyedCollection(values).forEach((v, k) => {
        l.set(this._indices[k], v === this._defaultValues[k] ? undefined : v);
      });
    });
    return this;
  };
  const RecordTypePrototype = RecordType.prototype = Object.create(RecordPrototype);
  RecordTypePrototype.constructor = RecordType;
  RecordTypePrototype.create = RecordType;
  if (name) {
    RecordType.displayName = name;
  }
  return RecordType;
};

class RecordImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      getIn,
      hasIn,
      merge,
      mergeWith,
      mergeDeep,
      mergeDeepWith,
      mergeDeepIn,
      mergeIn,
      setIn,
      toObject,
      update,
      updateIn,
      withMutations,
      removeIn: deleteIn,
      toJSON: toObject,
      [IS_RECORD_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.Record"
    });
  }
  toString() {
    const body = this._keys.map((k) => `${k}: ${quoteString(this.get(k))}`).join(", ");
    return `${recordName(this)} { ${body} }`;
  }
  equals(other) {
    return this === other || isRecord(other) && recordSeq(this).equals(recordSeq(other));
  }
  hashCode() {
    return recordSeq(this).hashCode();
  }
  has(k) {
    return Object.hasOwn(this._indices, k);
  }
  get(k, notSetValue) {
    if (!this.has(k)) {
      return notSetValue;
    }
    const index = this._indices[k];
    const value = this._values.get(index);
    return value === undefined ? this._defaultValues[k] : value;
  }
  set(k, v) {
    if (this.has(k)) {
      const newValues = this._values.set(this._indices[k], v === this._defaultValues[k] ? undefined : v);
      if (newValues !== this._values && !this.__ownerID) {
        return makeRecord(this, newValues);
      }
    }
    return this;
  }
  remove(k) {
    return this.set(k);
  }
  clear() {
    const newValues = this._values.clear().setSize(this._keys.length);
    return this.__ownerID ? this : makeRecord(this, newValues);
  }
  wasAltered() {
    return this._values.wasAltered();
  }
  toSeq() {
    return recordSeq(this);
  }
  toJS() {
    return toJS(this);
  }
  entries() {
    return this.__iterator();
  }
  __iterate(fn, reverse) {
    return recordSeq(this).__iterate(fn, reverse);
  }
  __iterator(reverse) {
    return recordSeq(this).__iterator(reverse);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newValues = this._values.__ensureOwner(ownerID);
    if (!ownerID) {
      this.__ownerID = ownerID;
      this._values = newValues;
      return this;
    }
    return makeRecord(this, newValues, ownerID);
  }
}
Record.isRecord = isRecord;
var recordName = (record) => record.constructor.displayName || record.constructor.name || "Record";

class RecordSeq extends KeyedSeqImpl {
  constructor(record) {
    super();
    this._record = record;
    this.size = record._keys.length;
  }
  get(key, notSetValue) {
    return this._record.get(key, notSetValue);
  }
  has(key) {
    return this._record.has(key);
  }
  __iterateUncached(fn, reverse) {
    const record = this._record;
    const keys = record._keys;
    const size = keys.length;
    let i = 0;
    while (i !== size) {
      const ii = reverse ? size - ++i : i++;
      const k = keys[ii];
      if (fn(record.get(k), k, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const record = this._record;
    const keys = record._keys;
    const size = keys.length;
    let i = 0;
    return makeEntryIterator((entry) => {
      if (i === size) {
        return false;
      }
      const ii = reverse ? size - ++i : i++;
      const k = keys[ii];
      entry[0] = k;
      entry[1] = record.get(k);
      return true;
    });
  }
}
var recordSeq = (record) => new RecordSeq(record);
Record.getDescriptiveName = recordName;
var RecordPrototype = RecordImpl.prototype;
function makeRecord(likeRecord, values, ownerID) {
  const record = Object.create(Object.getPrototypeOf(likeRecord));
  record._values = values;
  record.__ownerID = ownerID;
  return record;
}
function setProp(prototype, name) {
  Object.defineProperty(prototype, name, {
    get() {
      return this.get(name);
    },
    set(value) {
      invariant(this.__ownerID, "Cannot set on an immutable record.");
      this.set(name, value);
    }
  });
}
var Range = (start, end, step = 1) => {
  invariant(step !== 0, "Cannot step a Range by 0");
  invariant(start !== undefined, "You must define a start value when using Range");
  invariant(end !== undefined, "You must define an end value when using Range");
  step = Math.abs(step);
  if (end < start) {
    step = -step;
  }
  const size = Math.max(0, Math.ceil((end - start) / step - 1) + 1);
  return new RangeImpl(start, end, step, size);
};

class RangeImpl extends IndexedSeqImpl {
  _start;
  _end;
  _step;
  constructor(start, end, step, size) {
    super();
    this._start = start;
    this._end = end;
    this._step = step;
    this.size = size;
  }
  toString() {
    return this.size === 0 ? "Range []" : `Range [ ${this._start}...${this._end}${this._step !== 1 ? ` by ${this._step}` : ""} ]`;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._start + wrapIndex(this, index) * this._step : notSetValue;
  }
  includes(searchValue) {
    const possibleIndex = (searchValue - this._start) / this._step;
    return possibleIndex >= 0 && possibleIndex < this.size && possibleIndex === Math.floor(possibleIndex);
  }
  slice(begin, end) {
    if (wholeSlice(begin, end, this.size)) {
      return this;
    }
    begin = resolveBegin(begin, this.size);
    end = resolveEnd(end, this.size);
    if (end <= begin) {
      return Range(0, 0);
    }
    return Range(this.get(begin, this._end), this.get(end, this._end), this._step);
  }
  indexOf(searchValue) {
    const offsetValue = searchValue - this._start;
    if (offsetValue % this._step === 0) {
      const index = offsetValue / this._step;
      if (index >= 0 && index < this.size) {
        return index;
      }
    }
    return -1;
  }
  lastIndexOf(searchValue) {
    return this.indexOf(searchValue);
  }
  __iterateUncached(fn, reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    while (i !== size) {
      const v = value;
      value += reverse ? -step : step;
      const ii = reverse ? size - ++i : i++;
      if (fn(v, ii, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    return makeEntryIterator((entry) => {
      if (i === size) {
        return false;
      }
      const v = value;
      value += reverse ? -step : step;
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = v;
      return true;
    });
  }
  values() {
    const size = this.size;
    const step = this._step;
    let value = this._start;
    let i = 0;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (i === size)
        return DONE;
      result.value = value;
      value += step;
      i++;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
  equals(other) {
    return other instanceof RangeImpl ? this._start === other._start && this._end === other._end && this._step === other._step : deepEqual(this, other);
  }
  static {
    this.prototype[Symbol.iterator] = this.prototype.values;
  }
}
var Repeat = (value, times) => {
  const size = times === undefined ? Infinity : Math.max(0, times);
  return new RepeatImpl(value, size);
};

class RepeatImpl extends IndexedSeqImpl {
  constructor(value, size) {
    super();
    this._value = value;
    this.size = size;
  }
  toString() {
    if (this.size === 0) {
      return "Repeat []";
    }
    return `Repeat [ ${this._value} ${this.size} times ]`;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._value : notSetValue;
  }
  includes(searchValue) {
    return is(this._value, searchValue);
  }
  slice(begin, end) {
    const size = this.size;
    return wholeSlice(begin, end, size) ? this : new RepeatImpl(this._value, resolveEnd(end, size) - resolveBegin(begin, size));
  }
  reverse() {
    return this;
  }
  indexOf(searchValue) {
    if (is(this._value, searchValue)) {
      return 0;
    }
    return -1;
  }
  lastIndexOf(searchValue) {
    if (is(this._value, searchValue)) {
      return this.size;
    }
    return -1;
  }
  __iterateUncached(fn, reverse) {
    const size = this.size;
    let i = 0;
    while (i !== size) {
      if (fn(this._value, reverse ? size - ++i : i++, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const size = this.size;
    const val = this._value;
    let i = 0;
    return makeEntryIterator((entry) => {
      if (i === size) {
        return false;
      }
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = val;
      return true;
    });
  }
  values() {
    const size = this.size;
    const val = this._value;
    let i = 0;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (i === size)
        return DONE;
      i++;
      result.value = val;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
  equals(other) {
    return other instanceof RepeatImpl ? this.size === other.size && is(this._value, other._value) : deepEqual(this, other);
  }
  static {
    this.prototype[Symbol.iterator] = this.prototype.values;
  }
}
var fromJS = (value, converter) => fromJSWith([], converter ?? defaultConverter, value, "", converter?.length > 2 ? [] : undefined, {
  "": value
});
function fromJSWith(stack, converter, value, key, keyPath, parentValue) {
  if (typeof value !== "string" && !isImmutable(value) && (isArrayLike(value) || hasIterator(value) || isPlainObject(value))) {
    if (stack.includes(value)) {
      throw new TypeError("Cannot convert circular structure to Immutable");
    }
    stack.push(value);
    if (keyPath && key !== "") {
      keyPath.push(key);
    }
    const converted = converter.call(parentValue, key, Seq(value).map((v, k) => fromJSWith(stack, converter, v, k, keyPath, value)), keyPath?.slice());
    stack.pop();
    if (keyPath) {
      keyPath.pop();
    }
    return converted;
  }
  return value;
}
var defaultConverter = (k, v) => isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
var asValues = (collection) => isKeyed(collection) ? collection.valueSeq() : collection;
function initCollectionConversions() {
  CollectionImpl.prototype.toMap = function toMap() {
    return Map2(this.toKeyedSeq());
  };
  CollectionImpl.prototype.toOrderedMap = function toOrderedMap() {
    return OrderedMap(this.toKeyedSeq());
  };
  CollectionImpl.prototype.toOrderedSet = function toOrderedSet() {
    return OrderedSet(asValues(this));
  };
  CollectionImpl.prototype.toSet = function toSet() {
    return Set2(asValues(this));
  };
  CollectionImpl.prototype.toStack = function toStack() {
    return Stack2(asValues(this));
  };
  CollectionImpl.prototype.toList = function toList() {
    return List(asValues(this));
  };
  CollectionImpl.prototype.countBy = function countBy(grouper, context) {
    const groups = Map2().asMutable();
    this.__iterate((v, k) => {
      groups.update(grouper.call(context, v, k, this), 0, (a) => a + 1);
    });
    return groups.asImmutable();
  };
  CollectionImpl.prototype.groupBy = function groupBy(grouper, context) {
    const isKeyedIter = isKeyed(this);
    const groups = (isOrdered(this) ? OrderedMap() : Map2()).asMutable();
    this.__iterate((v, k) => {
      groups.update(grouper.call(context, v, k, this), (a) => {
        a ??= [];
        a.push(isKeyedIter ? [k, v] : v);
        return a;
      });
    });
    return groups.map((arr) => reifyValues(this, arr)).asImmutable();
  };
  IndexedCollectionImpl.prototype.keySeq = function keySeq() {
    return Range(0, this.size);
  };
  MapImpl.prototype.sort = function sort(comparator) {
    return OrderedMap(sortFactory(this, comparator));
  };
  MapImpl.prototype.sortBy = function sortBy(mapper, comparator) {
    return OrderedMap(sortFactory(this, comparator, mapper));
  };
  SetImpl.prototype.sort = function sort(comparator) {
    return OrderedSet(sortFactory(this, comparator));
  };
  SetImpl.prototype.sortBy = function sortBy(mapper, comparator) {
    return OrderedSet(sortFactory(this, comparator, mapper));
  };
}
var version$1 = "7.0.0";
var pkg = {
  version: version$1
};
initCollectionConversions();
var { version } = pkg;

// src/renderer.js
var DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk"];

class Renderer {
  constructor(comps, h, fragment, comment, renderFn, getSeqInfo, cache) {
    this.comps = comps;
    this.h = h;
    this.fragment = fragment;
    this.comment = comment;
    this.renderFn = renderFn;
    this.getSeqInfo = getSeqInfo ?? basicGetSeqInfo;
    this.cache = cache ?? new WeakMapDomCache;
  }
  setNullCache() {
    this.cache = new NullDomCache;
  }
  renderToDOM(stack, val) {
    const rootNode = document.createElement("div");
    this.renderFn(this.h("div", null, [this.renderRoot(stack, val)]), rootNode);
    return rootNode.childNodes[0];
  }
  renderToString(stack, val, cleanAttrs = true) {
    const dom = this.renderToDOM(stack, val, this.renderFn);
    if (cleanAttrs) {
      const nodes = dom.querySelectorAll("[data-nid],[data-cid],[data-eid]");
      for (const { dataset } of nodes) {
        for (const name of DATASET_ATTRS) {
          delete dataset[name];
        }
      }
    }
    return dom.innerHTML;
  }
  renderRoot(stack, val, viewName = null) {
    const c = this.comps.getCompFor(val);
    const nid = c.getView(viewName).anode.nodeId ?? null;
    return c ? this._rValComp(stack, val, c, nid, "ROOT", viewName) : null;
  }
  renderIt(stack, nodeId, key, viewName) {
    const c = this.comps.getCompFor(stack.it);
    return c ? this._rValComp(stack, stack.it, c, nodeId, key, viewName) : null;
  }
  _rValComp(stack, val, comp, nid, key, viewName) {
    const cacheKey = `${viewName ?? stack.viewsId ?? ""}${nid}-${key}`;
    const cachedNode = this.cache.get(val, cacheKey);
    if (cachedNode) {
      return cachedNode;
    }
    const view = viewName ? comp.getView(viewName) : stack.lookupBestView(comp.views, "main");
    const meta = this.renderMetadata("Comp", { nid });
    const dom = this.renderFragment([meta, view.render(stack, this)]);
    this.cache.set(val, cacheKey, dom);
    return dom;
  }
  renderEach(stack, iterInfo, nodeId, viewName) {
    const { seq, filter, loopWith } = iterInfo.eval(stack);
    const [attrName, gen] = this.getSeqInfo(seq);
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    for (const [key, value] of gen(seq)) {
      if (filter.call(stack.it, key, value, iterData)) {
        const newStack = stack.enter(value, { key }, true);
        const dom = this.renderIt(newStack, nodeId, key, viewName);
        r.push(this.renderMetadata("Each", { nid: nodeId, [attrName]: key }));
        r.push(dom);
      }
    }
    return r;
  }
  renderEachWhen(stack, iterInfo, node, nid) {
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    const [attrName, gen] = this.getSeqInfo(seq);
    const hasEnricher = !!enricher;
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    for (const [key, value] of gen(seq)) {
      if (filter.call(stack.it, key, value, iterData)) {
        const bindings = { key, value };
        const cacheKey = `${nid}-${key}`;
        let cachedNode;
        if (hasEnricher) {
          enricher.call(stack.it, bindings, key, value, iterData);
          cachedNode = this.cache.get2(stack.it, value, cacheKey);
        } else {
          cachedNode = this.cache.get(value, cacheKey);
        }
        if (cachedNode) {
          r.push(this.renderMetadata("Each", { nid, [attrName]: key }));
          r.push(cachedNode);
          continue;
        }
        const newStack = stack.enter(value, bindings, false);
        const dom = node.render(newStack, this);
        r.push(this.renderMetadata("Each", { nid, [attrName]: key }));
        if (hasEnricher) {
          this.cache.set2(stack.it, value, cacheKey, dom);
        } else {
          this.cache.set(value, cacheKey, dom);
        }
        r.push(dom);
      }
    }
    return r;
  }
  renderText(text) {
    return text;
  }
  renderMetadata(type, info) {
    info.$ = type;
    return this.renderComment(`§${JSON.stringify(info)}§`);
  }
  renderComment(text) {
    return this.comment(text);
  }
  renderEmpty(_text) {
    return null;
  }
  renderTag(tagName, attrs, childs) {
    return this.h(tagName, attrs, childs);
  }
  renderFragment(childs) {
    return this.fragment(childs);
  }
}
function* imIndexedEntries(seq) {
  let i = 0;
  for (const v of seq)
    yield [i++, v];
}
function* imKeyedEntries(obj) {
  for (const [key, value] of obj.toSeq().entries())
    yield [key, value];
}
var seqInfoByClass = new Map;
var idxInfo = ["si", imIndexedEntries];
var keyInfo = ["sk", imKeyedEntries];
var unkInfo = ["si", function* nullEntries(_obj) {}];
function basicGetSeqInfo(seq) {
  return isIndexed(seq) ? idxInfo : isKeyed(seq) ? keyInfo : seqInfoByClass.get(seq?.constructor) ?? unkInfo;
}

// src/vdom.js
var isHtmlAttribute = (propName) => propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
var isObject = (v) => v !== null && typeof v === "object";
function applyProperties(node, props, previous) {
  for (const propName in props) {
    const propValue = props[propName];
    if (propValue === undefined) {
      removeProperty(node, propName, previous);
    } else if (isHtmlAttribute(propName)) {
      node.setAttribute(propName, propValue);
    } else if (propName === "dangerouslySetInnerHTML") {
      node.innerHTML = propValue.__html ?? "";
    } else if (isObject(propValue)) {
      patchObject(node, previous, propName, propValue);
    } else if (propName === "className") {
      node.setAttribute("class", propValue);
    } else {
      node[propName] = propValue;
    }
  }
}
function removeProperty(node, propName, previous) {
  const previousValue = previous[propName];
  if (propName === "dangerouslySetInnerHTML") {
    node.innerHTML = "";
  } else if (typeof previousValue === "string" || isHtmlAttribute(propName)) {
    const attrName = propName === "className" ? "class" : propName === "htmlFor" ? "for" : propName;
    node.removeAttribute(attrName);
  } else {
    node[propName] = null;
  }
}
function patchObject(node, previous, propName, propValue) {
  const previousValue = previous?.[propName];
  if (isObject(previousValue) && Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(propValue)) {
    node[propName] = propValue;
    return;
  }
  let current = node[propName];
  if (!isObject(current)) {
    node[propName] = {};
    current = node[propName];
  }
  const target = current;
  for (const k in propValue) {
    target[k] = propValue[k];
  }
}

class VBase {
  isEqualTo(other) {
    return this === other;
  }
  toDom(_opts) {
    return null;
  }
}
var getKey = (child) => child instanceof VNode2 ? child.key : undefined;
var isIterable = (obj) => obj != null && typeof obj !== "string" && typeof obj[Symbol.iterator] === "function";
function addChild(normalizedChildren, child) {
  if (child == null)
    return;
  if (isIterable(child)) {
    for (const c of child) {
      addChild(normalizedChildren, c);
    }
  } else if (child instanceof VBase) {
    if (child instanceof VFragment) {
      normalizedChildren.push(...child.childs);
    } else {
      normalizedChildren.push(child);
    }
  } else {
    normalizedChildren.push(new VText(child));
  }
}

class VText extends VBase {
  constructor(text) {
    super();
    this.text = String(text);
  }
  get nodeType() {
    return 3;
  }
  isEqualTo(other) {
    return other instanceof VText && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createTextNode(this.text);
  }
}

class VComment extends VBase {
  constructor(text) {
    super();
    this.text = text;
  }
  get nodeType() {
    return 8;
  }
  isEqualTo(other) {
    return other instanceof VComment && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createComment(this.text);
  }
}

class VFragment extends VBase {
  constructor(childs) {
    super();
    this.childs = [];
    addChild(this.childs, childs);
  }
  get nodeType() {
    return 11;
  }
  isEqualTo(other) {
    if (!(other instanceof VFragment) || this.childs.length !== other.childs.length) {
      return false;
    }
    for (let i = 0;i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts) {
    const fragment = opts.document.createDocumentFragment();
    for (const child of this.childs) {
      const childNode = child.toDom(opts);
      if (childNode) {
        fragment.appendChild(childNode);
      }
    }
    return fragment;
  }
}

class VNode2 extends VBase {
  constructor(tag, attrs, childs, key, namespace) {
    super();
    this.tag = tag;
    this.attrs = attrs ?? {};
    this.childs = childs ?? [];
    this.key = key != null ? String(key) : undefined;
    this.namespace = typeof namespace === "string" ? namespace : null;
  }
  get nodeType() {
    return 1;
  }
  isEqualTo(other) {
    if (!(other instanceof VNode2) || this.tag !== other.tag || this.key !== other.key || this.namespace !== other.namespace || this.childs.length !== other.childs.length) {
      return false;
    }
    for (const key in this.attrs) {
      if (this.attrs[key] !== other.attrs[key]) {
        return false;
      }
    }
    for (const key in other.attrs) {
      if (!Object.hasOwn(this.attrs, key)) {
        return false;
      }
    }
    for (let i = 0;i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts) {
    const doc = opts.document;
    const node = this.namespace === null ? doc.createElement(this.tag) : doc.createElementNS(this.namespace, this.tag);
    applyProperties(node, this.attrs, {});
    for (const child of this.childs) {
      const childNode = child.toDom(opts);
      if (childNode) {
        node.appendChild(childNode);
      }
    }
    return node;
  }
}
function diffProps(a, b) {
  let diff = null;
  for (const aKey in a) {
    if (!Object.hasOwn(b, aKey)) {
      diff ??= {};
      diff[aKey] = undefined;
      continue;
    }
    const aValue = a[aKey];
    const bValue = b[aKey];
    if (aValue === bValue) {} else if (isObject(aValue) && isObject(bValue)) {
      if (Object.getPrototypeOf(bValue) !== Object.getPrototypeOf(aValue)) {
        diff ??= {};
        diff[aKey] = bValue;
      } else {
        const objectDiff = diffProps(aValue, bValue);
        if (objectDiff) {
          diff ??= {};
          diff[aKey] = objectDiff;
        }
      }
    } else {
      diff ??= {};
      diff[aKey] = bValue;
    }
  }
  for (const bKey in b) {
    if (!Object.hasOwn(a, bKey)) {
      diff ??= {};
      diff[bKey] = b[bKey];
    }
  }
  return diff;
}
function replaceNode(domNode, vnode, options) {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}
var bothInstanceOf = (a, b, C) => a instanceof C && b instanceof C;
function morphNode(domNode, source, target, opts) {
  if (source === target || source.isEqualTo(target))
    return domNode;
  if (bothInstanceOf(source, target, VText) || bothInstanceOf(source, target, VComment)) {
    domNode.data = target.text;
    return domNode;
  }
  if (bothInstanceOf(source, target, VNode2) && source.tag === target.tag && source.namespace === target.namespace && source.key === target.key) {
    const propsDiff = diffProps(source.attrs, target.attrs);
    if (propsDiff) {
      applyProperties(domNode, propsDiff, source.attrs);
    }
    if (!target.attrs.dangerouslySetInnerHTML) {
      morphChildren(domNode, source.childs, target.childs, source.tag, opts);
    }
    return domNode;
  }
  if (bothInstanceOf(source, target, VFragment)) {
    morphChildren(domNode, source.childs, target.childs, null, opts);
    return domNode;
  }
  return replaceNode(domNode, target, opts);
}
function morphChildren(parentDom, oldChilds, newChilds, _parentTag, opts) {
  if (oldChilds.length === 0) {
    for (const child of newChilds) {
      const node = child.toDom(opts);
      if (node)
        parentDom.appendChild(node);
    }
    return;
  }
  if (newChilds.length === 0) {
    while (parentDom.firstChild) {
      parentDom.removeChild(parentDom.firstChild);
    }
    return;
  }
  const domNodes = Array.from(parentDom.childNodes);
  const oldKeyMap = {};
  for (let i = 0;i < oldChilds.length; i++) {
    const key = getKey(oldChilds[i]);
    if (key != null)
      oldKeyMap[key] = i;
  }
  const used = new Uint8Array(oldChilds.length);
  let unkeyedCursor = 0;
  for (let j = 0;j < newChilds.length; j++) {
    const newChild = newChilds[j];
    const newKey = getKey(newChild);
    let oldIdx = -1;
    if (newKey != null) {
      if (newKey in oldKeyMap && !used[oldKeyMap[newKey]]) {
        oldIdx = oldKeyMap[newKey];
      }
    } else {
      while (unkeyedCursor < oldChilds.length) {
        if (!used[unkeyedCursor] && getKey(oldChilds[unkeyedCursor]) == null) {
          oldIdx = unkeyedCursor++;
          break;
        }
        unkeyedCursor++;
      }
    }
    if (oldIdx >= 0) {
      used[oldIdx] = 1;
      const dom = domNodes[oldIdx];
      const newDom = morphNode(dom, oldChilds[oldIdx], newChild, opts);
      const ref = parentDom.childNodes[j] ?? null;
      if (newDom !== ref)
        parentDom.insertBefore(newDom, ref);
    } else {
      const dom = newChild.toDom(opts);
      if (dom) {
        const ref = parentDom.childNodes[j] ?? null;
        parentDom.insertBefore(dom, ref);
      }
    }
  }
  for (let i = oldChilds.length - 1;i >= 0; i--) {
    if (!used[i] && domNodes[i].parentNode === parentDom) {
      parentDom.removeChild(domNodes[i]);
    }
  }
}
var renderCache = new WeakMap;
function render(vnode, container, options) {
  const cached = renderCache.get(container);
  const isFragment = vnode instanceof VFragment;
  if (cached) {
    const wasFragment = cached.vnode instanceof VFragment;
    if (wasFragment === isFragment) {
      const rootNode = wasFragment ? container : cached.dom;
      const newDom = morphNode(rootNode, cached.vnode, vnode, options);
      const domToCache = isFragment ? container : newDom;
      renderCache.set(container, { vnode, dom: domToCache });
      return newDom;
    }
    renderCache.delete(container);
  }
  const domNode = vnode.toDom(options);
  if (domNode) {
    container.innerHTML = "";
    container.appendChild(domNode);
    const domToCache = isFragment ? container : domNode;
    renderCache.set(container, { vnode, dom: domToCache });
  }
  return domNode;
}
function h(tagName, properties, children) {
  const tag = tagName.toUpperCase();
  const props = {};
  let key, namespace;
  if (properties) {
    for (const propName in properties) {
      const propVal = properties[propName];
      switch (propName) {
        case "key":
          key = propVal;
          break;
        case "namespace":
          namespace = propVal;
          break;
        case "class":
          props.className = propVal;
          break;
        case "for":
          props.htmlFor = propVal;
          break;
        default:
          props[propName] = isHtmlAttribute(propName) ? String(propVal) : propVal;
      }
    }
  }
  const normalizedChildren = [];
  addChild(normalizedChildren, children);
  return new VNode2(tag, props, normalizedChildren, key, namespace);
}
// src/oo.js
var BAD_VALUE = Symbol("BadValue");
var nullCoercer = (v) => v;

class Field {
  constructor(type, name, typeCheck, coercer, defaultValue = null) {
    this.type = type;
    this.name = name;
    this.typeCheck = typeCheck;
    this.coercer = coercer;
    this.checks = [];
    this.defaultValue = defaultValue;
  }
  toDataDef() {
    const { type, defaultValue: dv } = this;
    return { type, defaultValue: dv?.toJS ? dv.toJS() : dv };
  }
  getFirstFailingCheck(v) {
    if (!this.typeCheck.isValid(v)) {
      return this.typeCheck;
    }
    for (const check of this.checks) {
      if (!check.isValid(v)) {
        return check;
      }
    }
    return null;
  }
  isValid(v) {
    return this.getFirstFailingCheck(v) === null;
  }
  addCheck(check) {
    this.checks.push(check);
    return this;
  }
  coerceOr(v, defaultValue = null) {
    if (this.isValid(v)) {
      return v;
    }
    const v1 = this.coercer(v);
    return this.isValid(v1) ? v1 : defaultValue;
  }
  coerceOrDefault(v) {
    return this.coerceOr(v, this.defaultValue);
  }
  extendProtoForType(_proto, _uname) {}
  extendProto(proto) {
    const { name } = this;
    const uname = name[0].toUpperCase() + name.slice(1);
    const setName = `set${uname}`;
    const that = this;
    proto[setName] = function(v) {
      const v1 = that.coerceOr(v, BAD_VALUE);
      if (v1 === BAD_VALUE) {
        console.warn("invalid value", v);
        return this;
      }
      return this.set(name, v1);
    };
    proto[`update${uname}`] = function(fn) {
      return this[setName](fn(this.get(name)));
    };
    proto[`reset${uname}`] = function() {
      return this.set(name, that.defaultValue);
    };
    proto[`is${uname}NotSet`] = function() {
      return this.get(name) == null;
    };
    proto[`is${uname}Set`] = function() {
      return this.get(name) != null;
    };
    this.extendProtoForType(proto, uname);
  }
}

class Check {
  isValid(_v) {
    return true;
  }
  getMessage(_v) {
    return "Invalid";
  }
}

class CheckTypeAny extends Check {
}
var CHECK_TYPE_ANY = new CheckTypeAny;

class FnCheck extends Check {
  constructor(isValidFn, getMessageFn) {
    super();
    this._isValid = isValidFn;
    this._getMessage = getMessageFn;
  }
  isValid(v) {
    return this._isValid(v);
  }
  getMessage(v) {
    return this._getMessage(v);
  }
}
var CHECK_TYPE_INT = new FnCheck((v) => Number.isInteger(v), () => "Integer expected");
var CHECK_TYPE_FLOAT = new FnCheck((v) => Number.isFinite(v), () => "Float expected");
var CHECK_TYPE_BOOL = new FnCheck((v) => typeof v === "boolean", () => "Boolean expected");
var CHECK_TYPE_STRING = new FnCheck((v) => typeof v === "string", () => "String expected");
var CHECK_TYPE_LIST = new FnCheck((v) => List.isList(v), () => "List expected");
var CHECK_TYPE_MAP = new FnCheck((v) => Map2.isMap(v), () => "Map expected");
var CHECK_TYPE_OMAP = new FnCheck((v) => OrderedMap.isOrderedMap(v), () => "OrderedMap expected");
var CHECK_TYPE_SET = new FnCheck((v) => Set2.isSet(v), () => "Set expected");
var boolCoercer = (v) => !!v;

class FieldBool extends Field {
  constructor(name, defaultValue = false) {
    super("bool", name, CHECK_TYPE_BOOL, boolCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    proto[`toggle${uname}`] = function() {
      return this.set(name, !this.get(name, false));
    };
    proto[`set${uname}`] = function(v) {
      return this.set(name, !!v);
    };
  }
}

class FieldAny extends Field {
  constructor(name, defaultValue = null) {
    super("any", name, CHECK_TYPE_ANY, nullCoercer, defaultValue);
  }
  toDataDef() {
    const { defaultValue: dv } = this;
    const type = getTypeName(dv) ?? "any";
    return { type, defaultValue: dv?.toJS ? dv.toJS() : dv };
  }
}
var stringCoercer = (v) => v?.toString?.() ?? "";

class FieldString extends Field {
  constructor(name, defaultValue = "") {
    super("text", name, CHECK_TYPE_STRING, stringCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoSized(proto, this.name, uname, "", "length");
  }
}
var intCoercer = (v) => Number.isFinite(v) ? Math.trunc(v) : null;

class FieldInt extends Field {
  constructor(name, defaultValue = 0) {
    super("int", name, CHECK_TYPE_INT, intCoercer, defaultValue);
  }
}
var floatCoercer = (_) => null;

class FieldFloat extends Field {
  constructor(name, defaultValue = 0) {
    super("float", name, CHECK_TYPE_FLOAT, floatCoercer, defaultValue);
  }
}
var getTypeName = (v) => v?.constructor?.getMetaClass?.()?.name;

class CheckTypeName {
  constructor(typeName) {
    this.typeName = typeName;
  }
  isValid(v) {
    return getTypeName(v) === this.typeName;
  }
  getMessage(v) {
    const got = getTypeName(v);
    return `Expected "${this.typeName}", got "${got}"`;
  }
}

class FieldComp extends Field {
  constructor(type, name, args) {
    super(type, name, new CheckTypeName(type), nullCoercer, null);
    this.args = args;
  }
  toDataDef() {
    return { component: this.typeName, args: this.args };
  }
}
var NONE2 = Symbol("NONE");
function extendProtoForKeyed(proto, name, uname) {
  extendProtoSized(proto, name, uname, EMPTY_LIST);
  proto[`setIn${uname}At`] = function(i, v) {
    return this.set(name, this.get(name).set(i, v));
  };
  proto[`getIn${uname}At`] = function(i, dval) {
    return this.get(name).get(i, dval);
  };
  proto[`updateIn${uname}At`] = function(i, fn) {
    const col = this.get(name);
    const v = col.get(i, NONE2);
    if (v !== NONE2) {
      return this.set(name, col.set(i, fn(v)));
    }
    console.warn("key", i, "not found in", name, col);
    return this;
  };
  extendDeleteInAt(proto, name, `${uname}At`);
}
function extendDeleteInAt(proto, name, uname) {
  proto[`deleteIn${uname}`] = function(v) {
    return this.set(name, this.get(name).delete(v));
  };
  proto[`removeIn${uname}`] = proto[`deleteIn${uname}`];
}
var EMPTY_LIST = List();
var listCoercer = (v) => Array.isArray(v) ? List(v) : null;

class FieldList extends Field {
  constructor(name, defaultValue = EMPTY_LIST) {
    super("list", name, CHECK_TYPE_LIST, listCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    extendProtoForKeyed(proto, name, uname);
    proto[`pushIn${uname}`] = function(v) {
      return this.set(name, this.get(name).push(v));
    };
    proto[`insertIn${uname}At`] = function(i, v) {
      return this.set(name, this.get(name).insert(i, v));
    };
  }
}
var imapCoercer = (v) => Map2(v);

class FieldMap extends Field {
  constructor(name, defaultValue = Map2()) {
    super("map", name, CHECK_TYPE_MAP, imapCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoForKeyed(proto, this.name, uname);
  }
}
var omapCoercer = (v) => OrderedMap(v);

class FieldOMap extends Field {
  constructor(name, defaultValue = OrderedMap()) {
    super("omap", name, CHECK_TYPE_OMAP, omapCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoForKeyed(proto, this.name, uname);
  }
}
function extendProtoSized(proto, name, uname, defaultEmpty, propName = "size") {
  proto[`is${uname}Empty`] = function() {
    return this.get(name, defaultEmpty)[propName] === 0;
  };
  proto[`${name}Len`] = function() {
    return this.get(name, defaultEmpty)[propName];
  };
}
var EMPTY_SET2 = Set2();
var isetCoercer = (v) => Array.isArray(v) ? Set2(v) : v instanceof Set ? Set2(v) : null;

class FieldSet extends Field {
  constructor(name, defaultValue = EMPTY_SET2) {
    super("set", name, CHECK_TYPE_SET, isetCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    extendProtoSized(proto, name, uname, EMPTY_SET2);
    proto[`addIn${uname}`] = function(v) {
      return this.set(name, this.get(name).add(v));
    };
    extendDeleteInAt(proto, name, uname);
    proto[`hasIn${uname}`] = function(v) {
      return this.get(name).has(v);
    };
    proto[`toggleIn${uname}`] = function(v) {
      const current = this.get(name);
      return this.set(name, current.has(v) ? current.delete(v) : current.add(v));
    };
  }
}
function mkCompField(field, scope, args) {
  const Comp = scope.lookupComponent(field.type);
  console.assert(Comp !== null, "component not found", { field });
  return Comp?.make({ ...field.args, ...args }, { scope }) ?? null;
}

class ClassBuilder {
  constructor(name) {
    const fields = {};
    const compFields = new Set;
    this.name = name;
    this.fields = fields;
    this.compFields = compFields;
    this._methods = {};
    this._statics = {
      make: function(inArgs = {}, opts = {}) {
        const args = {};
        for (const key in inArgs) {
          const field = fields[key];
          if (compFields.has(key)) {
            args[key] = mkCompField(field, opts.scope, inArgs[key]);
          } else if (field === undefined) {
            console.warn("extra argument to constructor:", name, key, inArgs);
            continue;
          }
          args[key] = field.coerceOrDefault(inArgs[key]);
        }
        for (const key of compFields) {
          if (args[key] === undefined) {
            args[key] = mkCompField(fields[key], opts.scope, inArgs[key]);
          }
        }
        return this(args);
      }
    };
  }
  build() {
    const fieldVals = {};
    const proto = {};
    const { name, _methods, fields } = this;
    for (const fieldName in fields) {
      const field = fields[fieldName];
      fieldVals[fieldName] = field.defaultValue;
      field.extendProto(proto);
    }
    const Class = { [name]: Record(fieldVals, name) }[name];
    Object.assign(Class.prototype, proto, _methods);
    const metaClass = { fields, name, methods: _methods };
    Object.assign(Class, this._statics, { getMetaClass: () => metaClass });
    return Class;
  }
  methods(proto) {
    return this._mergeProto(this._methods, proto, "method");
  }
  statics(proto) {
    return this._mergeProto(this._statics, proto, "static");
  }
  _mergeProto(target, proto, _name) {
    for (const k in proto) {
      target[k] = proto[k];
    }
    return this;
  }
  addField(name, dval, FieldCls) {
    const field = new FieldCls(name, dval);
    this.fields[name] = field;
    return field;
  }
  addCompField(name, type, args) {
    const field = new FieldComp(type, name, args);
    this.compFields.add(name);
    this.fields[name] = field;
    return field;
  }
}
var fieldsByClass = new Map;
var fieldsByTypeName = {
  text: FieldString,
  int: FieldInt,
  float: FieldFloat,
  bool: FieldBool,
  list: FieldList,
  map: FieldMap,
  omap: FieldOMap,
  set: FieldSet,
  any: FieldAny
};
function classFromData(name, { fields = {}, methods, statics }) {
  const b = new ClassBuilder(name);
  for (const field in fields) {
    const value = fields[field];
    const type = typeof value;
    if (type === "string") {
      b.addField(field, value, FieldString);
    } else if (type === "number") {
      b.addField(field, value, FieldFloat);
    } else if (type === "boolean") {
      b.addField(field, value, FieldBool);
    } else if (List.isList(value) || Array.isArray(value)) {
      b.addField(field, List(value), FieldList);
    } else if (Set2.isSet(value) || value instanceof Set) {
      b.addField(field, Set2(value), FieldSet);
    } else if (OrderedMap.isOrderedMap(value)) {
      b.addField(field, value, FieldOMap);
    } else if (value?.type && value?.defaultValue !== undefined) {
      const Field2 = fieldsByTypeName[value.type] ?? FieldAny;
      b.addField(field, new Field2().coerceOr(value.defaultValue), Field2);
    } else if (value?.component && value?.args !== undefined) {
      b.addCompField(field, value.component, value.args);
    } else if (Map2.isMap(value) || value?.constructor === Object) {
      b.addField(field, Map2(value), FieldMap);
    } else {
      const Field2 = fieldsByClass.get(value?.constructor) ?? FieldAny;
      b.addField(field, value, Field2);
    }
  }
  if (methods) {
    b.methods(methods);
  }
  if (statics) {
    b.statics(statics);
  }
  return b.build();
}
var component = (opts) => new Component(opts.name ?? "Comp", classFromData(opts.name, opts), opts.view ?? "Not Defined", opts.views, opts.style, opts.commonStyle ?? "", opts.globalStyle ?? "", opts.computed, opts.input, opts.logic, opts.bubble, opts.response, opts.alter, opts.dynamic, opts.on);

// index.js
var css = String.raw;
var html = String.raw;
function macro(defaults, rawView) {
  return new Macro(defaults, rawView);
}
var toNode = (nodeOrSelector) => typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
function tutuca(nodeOrSelector) {
  const rootNode = toNode(nodeOrSelector);
  const comps = new Components;
  const fragment = (childs) => new VFragment(childs);
  const comment = (text) => new VComment(text);
  const ropts = { document };
  const render1 = (vnode, cont) => render(vnode, cont, ropts);
  const renderer = new Renderer(comps, h, fragment, comment, render1);
  return new App(rootNode, render1, comps, renderer, ParseContext);
}
export {
  version,
  updateIn$1 as updateIn,
  update$1 as update,
  tutuca,
  setIn$1 as setIn,
  set,
  seqInfoByClass,
  removeIn,
  remove,
  mergeWith$1 as mergeWith,
  mergeDeepWith$1 as mergeDeepWith,
  mergeDeep$1 as mergeDeep,
  merge$1 as merge,
  macro,
  isValueObject,
  isStack,
  isSet,
  isSeq,
  isRecord,
  isPlainObject,
  isOrderedSet,
  isOrderedMap,
  isOrdered,
  isOrderedMap as isOMap,
  isMap,
  isList,
  isKeyed,
  isIndexed,
  isImmutable,
  isMap as isIMap,
  isCollection,
  isAssociative,
  is,
  injectCss,
  html,
  hash,
  hasIn$1 as hasIn,
  has,
  getIn$1 as getIn,
  get,
  fromJS,
  fieldsByClass,
  css,
  component,
  Stack2 as Stack,
  Set2 as Set,
  Seq,
  Repeat,
  Record,
  Range,
  ParseContext,
  PairSorting,
  OrderedSet,
  OrderedMap,
  OrderedMap as OMap,
  Map2 as Map,
  List,
  Set2 as ISet,
  Map2 as IMap,
  Collection
};

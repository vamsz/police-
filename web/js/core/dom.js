/**
 * Small DOM helpers.
 *
 * Everything user-supplied reaches the page as a text node. The previous build
 * interpolated officer names and alert text straight into innerHTML, which let
 * anyone who could register choose markup that ran in the supervisor's console.
 * Building nodes instead of strings makes that class of bug impossible.
 */

export function el(tag, props = {}, children = []) {
  // Props are optional: el('p', ['text']) and el('p', {}, ['text']) both work,
  // which keeps deeply nested markup from drowning in empty object literals.
  if (Array.isArray(props) || props instanceof Node || typeof props === 'string') {
    children = props;
    props = {};
  }

  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }

  for (const child of [children].flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function render(node, ...children) {
  node.replaceChildren(...children.flat().filter(Boolean));
  return node;
}

export function show(node, visible = true) {
  node.hidden = !visible;
}

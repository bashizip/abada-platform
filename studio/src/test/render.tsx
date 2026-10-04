import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders into a fresh container attached to the document. */
export function render(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  return container;
}

/** Sets a controlled input's value the way typing does, so React sees the change. */
export function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export function click(element: Element) {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

export function blur(element: Element) {
  act(() => { element.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

export const byLabel = <T extends Element>(container: Element, label: string) =>
  container.querySelector(`[aria-label="${label}"]`) as T;

export const buttons = (container: Element) => [...container.querySelectorAll('button')];

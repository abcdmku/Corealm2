/**
 * The smallest DOM the touch and layout suites need. There is no jsdom in this project by
 * design; UI tests fake exactly the surface they exercise, as `production-panel-quantity` does.
 */
import { vi } from "vitest";

export class FakeClassList {
  private readonly names = new Set<string>();
  add(...names: string[]): void { for (const name of names) this.names.add(name); }
  remove(...names: string[]): void { for (const name of names) this.names.delete(name); }
  contains(name: string): boolean { return this.names.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }
  get length(): number { return this.names.size; }
  [Symbol.iterator](): Iterator<string> { return this.names.values(); }
}

export class FakeElement extends EventTarget {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";
  hidden = false;
  parent: FakeElement | null = null;
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  private captured: number | null = null;

  constructor(readonly tag = "div") { super(); }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  appendChild(child: FakeElement): FakeElement { this.append(child); return child; }
  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index !== -1) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  getBoundingClientRect(): DOMRect { return this.rect as DOMRect; }
  setPointerCapture(pointerId: number): void { this.captured = pointerId; }
  hasPointerCapture(pointerId: number): boolean { return this.captured === pointerId; }
  releasePointerCapture(pointerId: number): void { if (this.captured === pointerId) this.captured = null; }
  focus(): void {}
}

/** Installs `document` for the test and returns the root it hands out for `#ui-root`. */
export function installFakeDocument(): FakeElement {
  const root = new FakeElement("div");
  vi.stubGlobal("document", {
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => (id === "ui-root" ? root : null),
    activeElement: null,
  });
  return root;
}

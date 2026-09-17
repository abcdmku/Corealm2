import assert from 'node:assert/strict';
import type { Page } from 'playwright';

type ResponseAction = { kind: 'movement' | 'menu' } | { kind: 'attack'; target: string } | { kind: 'walk' };

/** Observe real browser input without calling gameplay actions or changing the simulation.
 * GPU completion is a separate milestone from semantic response, and is not display scanout. */
export async function armInputResponse(page: Page, action: ResponseAction, eventType: string): Promise<void> {
  await page.evaluate(({ action, eventType }) => {
    const w = window as any, d = w.__gameDebug;
    w.__inputResponse = null;
    window.addEventListener(eventType, event => {
      const start = event.timeStamp, origin = d.getPlayerPosition();
      const initialFrame = d.getPresentationState().submitted;
      const result: any = { action: action.kind, eventType, startedAt: start,
        dispatchDelayMs: performance.now() - start, semanticMs: null, submittedMs: null, completedMs: null,
        graphicsAtInput: d.getPresentationState() };
      w.__inputResponse = result;
      let requiredFrame: number | null = null, done = false;
      const sample = () => {
        const now = performance.now(), p = d.getPresentationState();
        const position = d.getPlayerPosition();
        const feedback = action.kind === 'menu' ? null : w.__interactionFeedback.snapshot();
        const moved = (x: number, z: number) => Math.hypot(x - origin.x, z - origin.z) > .002;
        const reacted = action.kind === 'menu'
          ? document.querySelector<HTMLElement>('.title')?.hidden === false
          : action.kind === 'movement' ? moved(position.x, position.z)
          : action.kind === 'attack' ? d.getState().combatTargetId === action.target && d.getState().selectedEntityId === action.target
          : feedback.markers.some((m: any) => m.name === 'walk-destination' && m.visible && m.ready);
        if (reacted && result.semanticMs === null) {
          result.semanticMs = now - start;
          result.graphicsAtResponse = p;
          // Selection/markers are changed by handlers between frames. Their first GPU frame
          // must be a new submission, not the previous image still in flight.
          if (action.kind !== 'movement' && action.kind !== 'menu') requiredFrame = p.submitted + 1;
        }
        if (result.semanticMs !== null && action.kind !== 'menu') {
          if (action.kind === 'movement' && requiredFrame === null && p.submitted > initialFrame
            && moved(feedback.playerDrawn[0], feedback.playerDrawn[2])) requiredFrame = p.submitted;
          if (requiredFrame !== null && p.submitted >= requiredFrame && result.submittedMs === null) {
            result.submittedMs = now - start;result.graphicsAtDraw = p;
          }
          const completed = p.recent.find((frame: any) => requiredFrame !== null && frame.id >= requiredFrame);
          if (completed) { result.completedMs = completed.at - start; done = true; }
        }
        if (now - start > 2000) { result.timedOut = true; done = true; }
      };
      // Run after the real handler, so immediate targeting/menu responses are measured
      // without adding an artificial RAF delay to the result.
      queueMicrotask(sample);
      // Browsers can run the capture listener's microtask before later event listeners.
      // The bubble listener measures synchronous canvas handlers after they have run.
      window.addEventListener(eventType, sample, { once: true });
      const frame = () => {
        sample();
        if (action.kind === 'menu' && result.semanticMs !== null) { result.nextFrameMs = performance.now() - start; done = true; }
        if (!done) requestAnimationFrame(frame);
        else { result.done = true; window.removeEventListener(eventType, sample); }
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  }, { action, eventType });
}

export async function collectInputResponse(page: Page) {
  await page.waitForFunction(() => (window as any).__inputResponse?.done, undefined, { timeout: 3000 });
  return page.evaluate(() => (window as any).__inputResponse);
}

/** Validate after saving every sample, so a slow input leaves useful diagnostic evidence. */
export function assertInputResponse(result: any): void {
  assert.ok(!result.timedOut, `${result.action} did not respond: ${JSON.stringify(result)}`);
  assert.ok(result.dispatchDelayMs < 100, `${result.action} input dispatch took ${result.dispatchDelayMs} ms`);
  assert.ok(result.semanticMs !== null && result.semanticMs < 100, `${result.action} semantic response: ${JSON.stringify(result)}`);
  if (result.action === 'menu') assert.ok(result.nextFrameMs < 150, `Menu response missed its frame: ${JSON.stringify(result)}`);
  else assert.ok(result.completedMs !== null && result.completedMs < 250, `${result.action} input-to-GPU-completion: ${JSON.stringify(result)}`);
}

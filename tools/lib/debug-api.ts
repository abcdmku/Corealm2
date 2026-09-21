export interface HarnessGameDebug {
  getState(): { ready?: boolean; [key: string]: unknown };
  getPlayer(): unknown;
  getPlayerPosition(): unknown;
  getCamera(): unknown;
  getEntities(): Promise<unknown>;
  getCurrentActivity(): unknown;
  getObjectives(): unknown;
  getNavigationState(): unknown;
  reset(): Promise<void>;
  [method: string]: unknown;
}

declare global {
  interface Window {
    __gameDebug?: HarnessGameDebug;
  }
}

export {};

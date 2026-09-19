import { GameplayWork } from "../render/gameplayWork.js";

/** Optional UI preparation shares one queue, including continuations of large computations.
 * Run small DOM jobs with run(); split CPU loops into bounded steps with runSliced(). */
export const uiWork = new GameplayWork();
uiWork.setInteractive(true);

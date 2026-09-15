/** Runtime preview orchestration; callbacks keep application ownership explicit. */
import { growthFraction } from '../hair/growthPreview.js';
export function createGrowthPreview({ renderer, finishEditing, isBusy, sync = () => {} }) {
  let fraction = 1;
  return {
    get fraction() { return fraction; },
    canStyle: () => fraction === 1,
    set(value) {
      const next = growthFraction(value);
      if (next === null) return false;
      if (next !== fraction && next < 1 && fraction === 1) {
        finishEditing();
        if (isBusy()) { sync(); return false; }
      }
      if (renderer.setGrowthFraction(next) === false) return false;
      fraction = next;
      sync();
      return true;
    },
  };
}

import { ErrorState, LoadingRows } from "../../../ui/States.js";
import { useItemsData } from "../../items/data.js";
import type { ViewProps } from "../../types.js";
import { OutfitFocus } from "./OutfitFocus.js";
import { OutfitMatrix } from "./OutfitMatrix.js";

/** Art review of worn gear: the tier ladder at `#/art/outfits`, one outfit on the rig at `#/art/outfits/<setId>`. */
export default function OutfitsView({ recordId, navigate }: ViewProps) {
  const data = useItemsData();
  if (data.error) return <ErrorState message={data.error} />;
  if (data.loading) return <div className="p-4"><LoadingRows /></div>;
  if (recordId) return <OutfitFocus id={recordId} data={data} navigate={navigate} />;
  return <OutfitMatrix data={data} navigate={navigate} />;
}

import { CollectionPage } from "../../pages/CollectionPage.js";
import { ErrorState } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { ItemPage } from "./ItemPage.js";
import { useItemsData } from "./data.js";

/** The catalog: the generic browser for the list, the purpose-built item page for a record. */
export default function CatalogView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <CollectionPage collection="items" recordId={undefined} navigate={navigate} />;
  return <CatalogRecord id={recordId} navigate={navigate} />;
}

function CatalogRecord({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const data = useItemsData();
  if (data.error) return <ErrorState message={data.error} />;
  return <ItemPage id={id} navigate={navigate} data={data} />;
}

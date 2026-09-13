import { useState } from "react";
import { ImageOff } from "lucide-react";
import { itemIconUrl } from "../../../game/src/ui/itemIcons.js";
import { gameUrl } from "../model/gameUrl.js";

export function ItemIcon({ id, name = "", large = false }: { id: string; name?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = itemIconUrl({ id } as NonNullable<Parameters<typeof itemIconUrl>[0]>);
  const source = url && large && !__DEVDOCS_PLAYER__ ? `/__devdocs/icons/${url.split("/").at(-1)}` : url ? gameUrl(url) : undefined;
  return <span className={`item-art${large ? " item-art-large" : ""}`}>
    {failed ? <ImageOff aria-label={`Missing icon for ${name || id}`} size={large ? 32 : 17}/> : <img key={id} src={source} alt={name} width={large ? 96 : 40} height={large ? 96 : 40} loading="lazy" decoding="async" onError={() => setFailed(true)}/>}
  </span>;
}

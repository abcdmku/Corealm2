import { useQuery } from "@tanstack/react-query";
import { playerQuery } from "../../api/adminData.js";

/**
 * What the shell's header calls the player whose record is open.
 *
 * The route is the account id, because that is how the admin API keys a player, but nobody
 * recognises `acc_playerMossbackKilnhalt111` on sight. The id is still on the record header below,
 * beside its copy button, which is where an admin goes when the id is what they want. Until the
 * reading lands the id stands in for the name, so the header never jumps from empty to full.
 */
export default function PlayerCrumb({ id }: { id: string }) {
  const query = useQuery(playerQuery(id));
  return <span title={id}>{query.data?.name ?? id}</span>;
}

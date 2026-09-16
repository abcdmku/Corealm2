import { createContext, useContext } from "react";

/** The view route a list publishes its record set under (`creatures/bestiary`). Provided by the shell. */
export const RecordSetKey = createContext<string | undefined>(undefined);

export const useRecordSetKey = (): string | undefined => useContext(RecordSetKey);

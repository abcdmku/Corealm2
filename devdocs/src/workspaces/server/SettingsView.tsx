import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RotateCcw, Undo2 } from "lucide-react";
import { failureMessage, patchSettings, settingsQuery, type SettingsPayload } from "../../api/adminData.js";
import { Badge, Button } from "../../components/ui/index.js";
import { ActionError } from "../../ui/Confirm.js";
import { Field, FieldRows, NumberField, Row, Section, Sheet, Static, TextField, ToggleField } from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import { PAGE, PAGE_HEADING } from "../../ui/layout.js";

/**
 * The settings a server changes without a restart.
 *
 * Every one of them has two values: what the configuration file, flags and environment gave it, and
 * what an admin stored over that. The sheet shows the value in force and marks the ones that are an
 * override, with the default named beside them and a way back to it, because an owner reading this
 * page needs to know which of these answers came from their `corealm-server.json`.
 */

interface Draft { name: string; description: string; registerWithDirectory: boolean; capacity: Record<string, number> }

const draftOf = (payload: SettingsPayload): Draft => ({
  name: payload.settings.name,
  description: payload.settings.description ?? "",
  registerWithDirectory: payload.settings.registerWithDirectory,
  capacity: { ...payload.settings.capacity },
});

export default function SettingsView() {
  const query = useQuery(settingsQuery());
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const payload = query.data;
  const base = useMemo(() => payload && draftOf(payload), [payload]);
  const current = draft ?? base;

  if (query.isPending || !payload || !base || !current) {
    return <div className={PAGE}>{query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : <LoadingRows />}</div>;
  }

  const overrides = payload.overrides, defaults = payload.defaults;
  const overridden = (key: string) => Object.prototype.hasOwnProperty.call(overrides, key) && overrides[key] !== null && overrides[key] !== undefined;
  const patch = (next: Partial<Draft>) => setDraft({ ...current, ...next });

  /** Only the keys that differ from what the server holds; `null` clears an override. */
  const changes: Record<string, unknown> = {};
  if (current.name !== base.name) changes.name = current.name;
  if (current.description !== base.description) changes.description = current.description.trim() ? current.description.trim() : null;
  if (current.registerWithDirectory !== base.registerWithDirectory) changes.registerWithDirectory = current.registerWithDirectory;
  const worlds: Record<string, { capacity: number }> = {};
  for (const [worldId, capacity] of Object.entries(current.capacity)) if (capacity !== base.capacity[worldId]) worlds[worldId] = { capacity };
  if (Object.keys(worlds).length) changes.worlds = worlds;
  const dirty = Object.keys(changes).length > 0;

  async function send(body: Record<string, unknown>): Promise<void> {
    setSaving(true); setError("");
    try {
      const next = await patchSettings(body);
      queryClient.setQueryData(settingsQuery().queryKey, next);
      setDraft(undefined);
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setSaving(false); }
  }

  const restore = (key: string) => void send(key.startsWith("capacity.") ? { worlds: { [key.slice("capacity.".length)]: { capacity: null } } } : { [key]: null });

  return <div className={PAGE}>
    <div className={PAGE_HEADING}>
      <h1>Settings</h1>
      <span className="ml-auto flex items-center gap-1.5">
        {dirty && <Button variant="ghost" size="sm" onClick={() => { setDraft(undefined); setError(""); }}><Undo2 />Discard</Button>}
        <Button variant="default" size="sm" disabled={!dirty || saving} onClick={() => void send(changes)}>
          {saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Save settings
        </Button>
      </span>
    </div>
    <ActionError message={error} className="mb-2" />

    <Sheet>
      <Section title="Directory listing">
        <Row label="">
          <Static muted>A value with an override badge is stored on this server. Everything else comes from its configuration file.</Static>
        </Row>
        <Field label="Name" dirty={current.name !== base.name} hint="3 to 48 letters, digits, spaces or _ . ' - . This is what the public directory lists.">
          <TextField value={current.name} onChange={value => patch({ name: value })} ariaLabel="Server name" width="text" />
        </Field>
        <Fallback shown={overridden("name")} label={defaults.name} onRestore={() => restore("name")} busy={saving} />

        <Field label="Description" dirty={current.description !== base.description} hint="Up to 200 characters. Shown on every world in /worlds and in the directory.">
          <TextField value={current.description} onChange={value => patch({ description: value })} ariaLabel="Server description" width="full" />
        </Field>
        <Fallback shown={overridden("description")} label={defaults.description ?? "empty"} onRestore={() => restore("description")} busy={saving} />

        <Field label="Register with directory" dirty={current.registerWithDirectory !== base.registerWithDirectory}
          hint="Announce this server to the identity service's public list every four minutes. It needs an identity service.">
          <ToggleField value={current.registerWithDirectory} onChange={value => patch({ registerWithDirectory: value === true })} ariaLabel="Register with the public directory" />
        </Field>
        <Fallback shown={overridden("registerWithDirectory")} label={defaults.registerWithDirectory ? "on" : "off"} onRestore={() => restore("registerWithDirectory")} busy={saving} />
      </Section>

      <Section title="World capacity" aside="decides the next join">
        <FieldRows columns={3}>
          {Object.keys(defaults.capacity).map(worldId => <Field key={worldId} label={worldId} unit="players" dirty={current.capacity[worldId] !== base.capacity[worldId]}
            hint={overridden(`capacity.${worldId}`) ? `Overrides the configuration's ${defaults.capacity[worldId]}.` : "From the configuration file."}>
            <NumberField value={current.capacity[worldId] ?? defaults.capacity[worldId]} integer min={1} max={1000} ariaLabel={`${worldId} capacity`}
              onChange={value => patch({ capacity: { ...current.capacity, [worldId]: Math.max(1, Math.min(1000, Math.round(value ?? 1))) } })} />
          </Field>)}
        </FieldRows>
        {Object.keys(defaults.capacity).filter(worldId => overridden(`capacity.${worldId}`)).map(worldId =>
          <Fallback key={worldId} shown label={`${worldId}: ${defaults.capacity[worldId]}`} onRestore={() => restore(`capacity.${worldId}`)} busy={saving} />)}
        <Row label="">
          <Static muted>Players already in a world stay when its capacity drops below them, and /worlds reports the world as full.</Static>
        </Row>
      </Section>
    </Sheet>
  </div>;
}

/** The line under an overridden field: what the configuration says, and the way back to it. */
function Fallback({ shown, label, onRestore, busy }: { shown: boolean; label: string; onRestore: () => void; busy: boolean }) {
  if (!shown) return null;
  return <Row label="">
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Badge variant="accent">override</Badge>
      <span>The configuration says <strong className="font-medium text-foreground">{label}</strong>.</span>
      <Button variant="link" size="xs" disabled={busy} onClick={onRestore}><RotateCcw />Restore default</Button>
    </span>
  </Row>;
}

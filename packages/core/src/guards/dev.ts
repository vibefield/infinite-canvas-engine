/** DEV-guard toggle. Guards are on by default; production apps may disable. */
let enabled = true;

export function setDevGuards(on: boolean): void {
  enabled = on;
}

export function devGuardsEnabled(): boolean {
  return enabled;
}

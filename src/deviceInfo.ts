interface HardwareEntry {
  hwModel?: number;
  hwModelSlug?: string;
  platformioTarget: string;
  displayName: string;
  images?: string[];
}

let byTarget: Map<string, HardwareEntry> | null = null;
let byModel: Map<number, HardwareEntry> | null = null;

export async function initDeviceInfo(): Promise<void> {
  try {
    const list: HardwareEntry[] = await fetch('/data/hardware-list.json').then((r) => r.json());
    byTarget = new Map(list.map((h) => [h.platformioTarget, h]));
    byModel = new Map(
        list.filter((h) => h.hwModel !== undefined).map((h) => [h.hwModel!, h]),
    );
  } catch {
    byTarget = new Map();
    byModel = new Map();
  }
}

export function lookupDevice(platformioTarget: string): HardwareEntry | undefined {
  return byTarget?.get(platformioTarget);
}

export function lookupDeviceByModel(hwModel: number): HardwareEntry | undefined {
  return byModel?.get(hwModel);
}

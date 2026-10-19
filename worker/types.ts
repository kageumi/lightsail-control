export interface Env {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN?: string;
  ADMIN_PASSWORD: string;
  AWS_REGIONS?: string;
  ASSETS: Fetcher;
  SUB: KVNamespace;
}
export interface Instance {
  name: string;
  state: { name: string };
  publicIpAddress?: string;
  isStaticIp?: boolean;
  location?: { regionName: string; availabilityZone?: string };
  blueprintName?: string;
  bundleId?: string;
  privateIpAddress?: string;
  ipv6Addresses?: string[];
  username?: string;
  hardware?: {
    cpuCount?: number;
    ramSizeInGb?: number;
    disks?: { sizeInGb?: number; isSystemDisk?: boolean }[];
  };
}
export type InstanceCommand = "start" | "stop";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

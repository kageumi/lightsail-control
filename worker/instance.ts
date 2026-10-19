import { HttpError, type Instance } from "./types";

// Keep AWS resource metadata and unused networking details out of API responses.
export function publicInstance(instance: Instance): Instance {
  if (
    !instance ||
    typeof instance.name !== "string" ||
    typeof instance.state?.name !== "string"
  )
    throw new HttpError(502, "AWS 实例响应格式不正确");
  return {
    name: instance.name,
    state: { name: instance.state.name },
    publicIpAddress: instance.publicIpAddress,
    privateIpAddress: instance.privateIpAddress,
    ipv6Addresses: instance.ipv6Addresses,
    isStaticIp: instance.isStaticIp,
    blueprintName: instance.blueprintName,
    bundleId: instance.bundleId,
    username: instance.username,
    location: instance.location && {
      regionName: instance.location.regionName,
      availabilityZone: instance.location.availabilityZone,
    },
    hardware: instance.hardware && {
      cpuCount: instance.hardware.cpuCount,
      ramSizeInGb: instance.hardware.ramSizeInGb,
      disks: instance.hardware.disks?.map((disk) => ({
        sizeInGb: disk.sizeInGb,
        isSystemDisk: disk.isSystemDisk,
      })),
    },
  };
}
